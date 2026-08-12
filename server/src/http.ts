/*
 * http.ts — router HTTP. Nessun framework: node:http basta e tiene
 * l'eseguibile finale senza dipendenze runtime.
 *
 * Tutte le rotte /api tranne /api/login richiedono una sessione valida.
 */

import http from 'node:http';
import fs from 'node:fs';
import { URL } from 'node:url';
import type { WebConfig } from './config.js';
import {
  EXPOSED_DIRECTIVES,
  readAmdConf,
  readNotifications,
  resolveAudioPath,
  resolveDatabasePath,
} from './config.js';
import {
  COOKIE_NAME,
  clearCookie,
  createSession,
  loginBlocked,
  parseCookies,
  readUsers,
  recordFailure,
  recordSuccess,
  sessionCookie,
  verifyPassword,
  verifySession,
} from './auth.js';
import {
  DbUnavailable,
  computeStats,
  exportDetections,
  getDetection,
  listDetections,
  listOperators,
} from './db.js';
import { audioExists, buildRoots, safeAudioPath, sendAudio } from './audio.js';
import { serveStatic } from './static.js';
import { dayRangeToUtc, shiftDay, today } from './tz.js';
import type { Detection, ServerInfo } from '../../shared/types.js';

export const VERSION = '1.0.0';

const MAX_BODY = 64 * 1024;

function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function clientIp(req: http.IncomingMessage): string {
  /* X-Forwarded-For e' attendibile solo dietro un reverse proxy nostro;
   * serve unicamente a distinguere i client per il freno sui login. */
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('richiesta troppo grande');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('JSON non valido');
  }
}

/* ── Parametri di query ─────────────────────────────────────────────── */

interface Range {
  fromDay: string;
  toDay: string;
  from: string;
  to: string;
}

function parseRange(url: URL, tz: string): Range {
  const t = today(tz);
  const fromDay = url.searchParams.get('from') || t;
  const toDay = url.searchParams.get('to') || fromDay;
  const { from, to } = dayRangeToUtc(fromDay, toDay, tz);
  return { fromDay, toDay, from, to };
}

function parseInt0(v: string | null, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

const ALLOWED_STATES = new Set(['pre', 'setup', 'alerting', 'connect']);

function listQueryFrom(url: URL, range: Range) {
  const state = (url.searchParams.get('state') || '').trim();
  return {
    from: range.from,
    to: range.to,
    q: (url.searchParams.get('q') || '').trim().slice(0, 64) || undefined,
    operator: (url.searchParams.get('operator') || '').trim().slice(0, 64) || undefined,
    /* Valore non riconosciuto = nessun filtro: mai interpolato in SQL. */
    state: ALLOWED_STATES.has(state) ? state : undefined,
    onlyDetected: url.searchParams.get('detected') === '1',
    onlyAudio: url.searchParams.get('audio') === '1',
    limit: parseInt0(url.searchParams.get('limit'), 50, 1, 500),
    offset: parseInt0(url.searchParams.get('offset'), 0, 0, 5_000_000),
  };
}

/* ── CSV ────────────────────────────────────────────────────────────── */

const CSV_HEADERS = [
  'id',
  'uid',
  'datetime_utc',
  'chiamante',
  'chiamato',
  'stato',
  'azione',
  'argomento_azione',
  'ms_da_setup',
  'ms_da_ultimo_stato',
  'operatore',
  'kernel_id',
  'confidenza',
  'audio',
];

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Detection[]): Buffer {
  const lines = [CSV_HEADERS.join(';')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.uid,
        r.datetime,
        r.caller,
        r.called,
        r.call_state,
        r.action,
        r.action_argument,
        r.timediff_setup_ms,
        r.timediff_last_state_ms,
        r.operator,
        r.kernel_id,
        r.confidence ? r.confidence.toFixed(4) : '',
        r.recorded_audio_path,
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  /* BOM: senza, Excel apre il CSV in ANSI e sbaglia gli accenti. */
  return Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]);
}

/* ── Server ─────────────────────────────────────────────────────────── */

export function createServer(cfg: WebConfig): http.Server {
  const roots = () => buildRoots(resolveAudioPath(cfg), cfg.extraAudioRoots);

  return http.createServer((req, res) => {
    handle(req, res, cfg, roots).catch((err: Error) => {
      if (!res.headersSent) json(res, 500, { error: err.message || 'errore interno' });
      else res.end();
    });
  });
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: WebConfig,
  roots: () => ReturnType<typeof buildRoots>,
): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { error: 'metodo non consentito' });
      return;
    }
    if (serveStatic(res, pathname, String(req.headers['accept-encoding'] || ''))) return;
    json(res, 404, { error: 'non trovato' });
    return;
  }

  /* ── login / logout ── */
  if (pathname === '/api/login') {
    if (req.method !== 'POST') return json(res, 405, { error: 'metodo non consentito' });
    const ip = clientIp(req);
    const wait = loginBlocked(ip);
    if (wait) return json(res, 429, { error: `troppi tentativi, riprovare fra ${wait} s` });

    const body = (await readBody(req)) as { username?: string; password?: string };
    const username = String(body.username || '');
    const password = String(body.password || '');
    if (!username || !password) return json(res, 400, { error: 'credenziali mancanti' });

    let users;
    try {
      users = readUsers(cfg.usersFile);
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
    if (users.length === 0)
      return json(res, 503, {
        error: 'nessun utente configurato: eseguire `amd-detex-web useradd <nome>` sul server',
      });

    if (!verifyPassword(users, username, password)) {
      recordFailure(ip);
      return json(res, 401, { error: 'credenziali non valide' });
    }
    recordSuccess(ip);
    const token = createSession(cfg.sessionSecret, username, cfg.sessionHours);
    return json(res, 200, { username }, { 'Set-Cookie': sessionCookie(token, cfg.sessionHours, cfg.secureCookie) });
  }

  if (pathname === '/api/logout') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(cfg.secureCookie) });
  }

  /* ── da qui in poi serve la sessione ── */
  const cookies = parseCookies(req.headers.cookie);
  const user = verifySession(cfg.sessionSecret, cookies[COOKIE_NAME]);

  if (pathname === '/api/me') {
    if (!user) return json(res, 401, { error: 'non autenticato' });
    return json(res, 200, { username: user });
  }

  if (!user) return json(res, 401, { error: 'non autenticato' });

  const dbPath = resolveDatabasePath(cfg);

  try {
    if (pathname === '/api/info') {
      const conf = readAmdConf(cfg);
      const audioPath = resolveAudioPath(cfg);
      const info: ServerInfo = {
        amdConfigPath: cfg.amdConfigPath,
        amdConfigFound: conf.found,
        databasePath: dbPath,
        databaseFound: !!dbPath && fs.existsSync(dbPath),
        audioPath,
        audioFound: !!audioPath && fs.existsSync(audioPath),
        timezone: cfg.timezone,
        version: VERSION,
        settings: EXPOSED_DIRECTIVES.filter((k) => conf.values.has(k)).map((k) => ({
          key: k,
          value: conf.values.get(k) || '',
        })),
        notifications: readNotifications(cfg),
      };
      return json(res, 200, info);
    }

    if (pathname === '/api/detections') {
      const range = parseRange(url, cfg.timezone);
      const q = listQueryFrom(url, range);
      const allowed = roots();
      const page = listDetections(dbPath, q, (p) => audioExists(p, allowed));
      return json(res, 200, page);
    }

    if (pathname === '/api/operators') {
      const range = parseRange(url, cfg.timezone);
      return json(res, 200, { operators: listOperators(dbPath, range.from, range.to) });
    }

    if (pathname === '/api/stats') {
      const range = parseRange(url, cfg.timezone);
      const stats = computeStats(dbPath, range.fromDay, range.toDay, range.from, range.to, cfg.timezone);
      return json(res, 200, stats);
    }

    /* Riepilogo rapido per le schede in cima: oggi + ieri in una chiamata. */
    if (pathname === '/api/summary') {
      const t = today(cfg.timezone);
      const y = shiftDay(t, -1);
      const build = (day: string) => {
        const r = dayRangeToUtc(day, day, cfg.timezone);
        return computeStats(dbPath, day, day, r.from, r.to, cfg.timezone);
      };
      return json(res, 200, { today: build(t), yesterday: build(y) });
    }

    if (pathname === '/api/export.csv') {
      const range = parseRange(url, cfg.timezone);
      const rows = exportDetections(dbPath, listQueryFrom(url, range));
      const csv = toCsv(rows);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Length': String(csv.length),
        'Content-Disposition': `attachment; filename="rilevazioni_${range.fromDay}_${range.toDay}.csv"`,
        'Cache-Control': 'no-store',
      });
      res.end(csv);
      return;
    }

    const audioMatch = /^\/api\/audio\/(\d+)$/.exec(pathname);
    if (audioMatch) {
      const det = getDetection(dbPath, Number(audioMatch[1]));
      if (!det) return json(res, 404, { error: 'rilevazione non trovata' });
      const safe = safeAudioPath(det.recorded_audio_path, roots());
      if (!safe)
        return json(res, 404, {
          error: det.recorded_audio_path
            ? 'audio fuori dalle directory consentite'
            : 'nessun audio registrato per questa chiamata',
        });
      sendAudio(res, safe, req.headers.range as string | undefined, url.searchParams.get('download') === '1');
      return;
    }

    return json(res, 404, { error: 'endpoint sconosciuto' });
  } catch (e) {
    if (e instanceof DbUnavailable) return json(res, 503, { error: e.message });
    const msg = (e as Error).message || '';
    /* Il modulo tiene il database in WAL: anche per la sola lettura SQLite
     * deve poter scrivere il file e creare -wal/-shm nella sua cartella.
     * L'errore grezzo di SQLite non lo spiega, e manda fuori strada. */
    if (/readonly database|unable to open database|attempt to write/i.test(msg))
      return json(res, 503, {
        error:
          'Database non accessibile in scrittura. Il modulo lo tiene in modalità WAL: ' +
          'anche per leggerlo servono i permessi di scrittura sul file e sulla sua ' +
          'cartella. Esegui il servizio come utente asterisk, oppure allinea i permessi.',
      });
    return json(res, 400, { error: msg });
  }
}
