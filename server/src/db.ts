/*
 * db.ts — accesso in sola lettura al SQLite scritto da src/amd_report.c.
 *
 * Usa node:sqlite (integrato in Node >= 22.13): niente moduli nativi da
 * compilare, requisito per impacchettare tutto in un eseguibile singolo.
 *
 * Il database viene aperto in lettura/scrittura ma con `PRAGMA query_only`:
 * il modulo lo tiene in WAL e l'accesso davvero read-only richiederebbe di
 * poter creare lo -shm, cosa non garantita a seconda dei permessi. query_only
 * impedisce comunque qualsiasi scrittura da qui.
 *
 * L'handle viene riaperto quando cambia il path o quando il file compare
 * dopo l'avvio (primo report scritto dal modulo).
 */

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Detection, DetectionPage, Stats, Bucket } from '../../shared/types.js';
import { OPERATOR_NONE } from '../../shared/types.js';
import { dayCount, formatLocalDate, localHour, shiftDay } from './tz.js';

/* Oltre questa soglia i grafici vengono omessi: le serie orarie/giornaliere
 * si calcolano in JS (il raggruppamento e' su ora LOCALE, non su UTC) e non
 * vale la pena scaricare milioni di righe per disegnare 24 barre. */
const BUCKET_ROW_CAP = 300_000;

let handle: DatabaseSync | null = null;
let handlePath = '';

export class DbUnavailable extends Error {}

function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: false });
  db.exec('PRAGMA query_only = 1;');
  db.exec('PRAGMA busy_timeout = 3000;');
  return db;
}

export function getDb(path: string): DatabaseSync {
  if (!path) throw new DbUnavailable('database_path non configurato in amd_detex.conf');
  if (handle && handlePath === path) return handle;
  if (!fs.existsSync(path))
    throw new DbUnavailable(`database non trovato: ${path} (nessuna chiamata ancora registrata?)`);
  if (handle) {
    try {
      handle.close();
    } catch {
      /* handle gia' invalido: irrilevante, stiamo per sostituirlo */
    }
  }
  handle = openDb(path);
  handlePath = path;
  return handle;
}

export function closeDb(): void {
  if (handle) {
    try {
      handle.close();
    } catch {
      /* in chiusura: niente da recuperare */
    }
    handle = null;
    handlePath = '';
  }
}

/* ── Righe ──────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

const COLUMNS =
  'id, uid, datetime, caller, called, call_state, action, action_argument,' +
  ' timediff_setup_ms, timediff_last_state_ms, recorded_audio_path, operator,' +
  ' kernel_id, confidence';

function toDetection(row: Row, audioExists: (p: string) => boolean): Detection {
  const audioPath = str(row.recorded_audio_path);
  return {
    id: num(row.id),
    uid: str(row.uid),
    datetime: str(row.datetime),
    caller: str(row.caller),
    called: str(row.called),
    call_state: str(row.call_state),
    action: str(row.action),
    action_argument: str(row.action_argument),
    timediff_setup_ms: num(row.timediff_setup_ms),
    timediff_last_state_ms: num(row.timediff_last_state_ms),
    recorded_audio_path: audioPath,
    operator: str(row.operator),
    kernel_id: str(row.kernel_id),
    confidence: num(row.confidence),
    hasAudio: audioPath ? audioExists(audioPath) : false,
  };
}

export interface ListQuery {
  from: string;
  to: string;
  q?: string;
  operator?: string;
  /** '' | 'pre' | 'setup' | 'alerting' | 'connect' */
  state?: string;
  onlyDetected?: boolean;
  onlyAudio?: boolean;
  limit: number;
  offset: number;
}

interface WhereParts {
  sql: string;
  params: (string | number)[];
}

function buildWhere(q: ListQuery): WhereParts {
  const clauses = ['datetime >= ?', 'datetime < ?'];
  const params: (string | number)[] = [q.from, q.to];

  if (q.q) {
    clauses.push('(caller LIKE ? OR called LIKE ? OR uid LIKE ?)');
    const like = `%${q.q}%`;
    params.push(like, like, like);
  }
  if (q.operator === OPERATOR_NONE) {
    /* Chiamate senza rilevazione: e' proprio il contrario di onlyDetected. */
    clauses.push("operator = ''");
  } else if (q.operator) {
    clauses.push('operator = ?');
    params.push(q.operator);
  }
  /* 'pre' = chiuse prima della risposta. Si esprime come "diverso da
   * connect" e non come "setup OR alerting": cosi' comprende anche le righe
   * con call_state vuoto o inatteso, che altrimenti sparirebbero da
   * entrambi i lati del filtro. */
  if (q.state === 'pre') {
    clauses.push("call_state <> 'connect'");
  } else if (q.state) {
    clauses.push('call_state = ?');
    params.push(q.state);
  }
  if (q.onlyDetected) clauses.push("operator <> ''");
  if (q.onlyAudio) clauses.push("recorded_audio_path <> ''");

  return { sql: clauses.join(' AND '), params };
}

export function listDetections(
  dbPath: string,
  q: ListQuery,
  audioExists: (p: string) => boolean,
): DetectionPage {
  const db = getDb(dbPath);
  const where = buildWhere(q);

  const total = num(
    (db.prepare(`SELECT COUNT(*) AS n FROM detections WHERE ${where.sql}`).get(...where.params) as Row)
      ?.n,
  );

  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM detections WHERE ${where.sql}` +
        ' ORDER BY datetime DESC, id DESC LIMIT ? OFFSET ?',
    )
    .all(...where.params, q.limit, q.offset) as Row[];

  return {
    rows: rows.map((r) => toDetection(r, audioExists)),
    total,
    limit: q.limit,
    offset: q.offset,
  };
}

/** Righe complete per l'export CSV: stessi filtri, senza paginazione. */
export function exportDetections(dbPath: string, q: ListQuery, cap = 100_000): Detection[] {
  const db = getDb(dbPath);
  const where = buildWhere(q);
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM detections WHERE ${where.sql} ORDER BY datetime DESC, id DESC LIMIT ?`,
    )
    .all(...where.params, cap) as Row[];
  return rows.map((r) => toDetection(r, () => false));
}

export function getDetection(dbPath: string, id: number): Detection | null {
  const db = getDb(dbPath);
  const row = db.prepare(`SELECT ${COLUMNS} FROM detections WHERE id = ?`).get(id) as Row | undefined;
  return row ? toDetection(row, () => false) : null;
}

/** Operatori presenti nell'intervallo, per popolare il filtro a tendina. */
export function listOperators(dbPath: string, from: string, to: string): string[] {
  const db = getDb(dbPath);
  const rows = db
    .prepare(
      "SELECT DISTINCT operator FROM detections WHERE operator <> ''" +
        ' AND datetime >= ? AND datetime < ? ORDER BY operator',
    )
    .all(from, to) as Row[];
  return rows.map((r) => str(r.operator));
}

/* ── Statistiche ────────────────────────────────────────────────────── */

/* Stessa definizione usata da tools/daily_stats.cjs: "interrotta" = il
 * modulo ha eseguito una hangup. */
const KILLED = "action IN ('hangup','hangup_with_reason')";

/* Entro questa soglia una segreteria riconosciuta dopo la risposta conta
 * come "filtrata": l'operatore non ha fatto in tempo a parlarci. Valore
 * fisso a 2 s come in daily_stats.cjs — cambiarlo qui renderebbe i due
 * conteggi non piu' confrontabili. */
const POST_SOGLIA_MS = 2000;

export function computeStats(
  dbPath: string,
  fromDay: string,
  toDay: string,
  from: string,
  to: string,
  tz: string,
  fromTime = '00:00',
  toTime = '24:00',
): Stats {
  const db = getDb(dbPath);

  const agg = db
    .prepare(
      `SELECT COUNT(*) AS calls,
              SUM(operator <> '') AS detected,
              SUM(${KILLED}) AS killed,
              SUM(call_state = 'connect') AS answered,
              -- Classi del TRANSITO (stesse definizioni di daily_stats.cjs)
              SUM(${KILLED} AND call_state <> 'connect') AS killed_pre,
              SUM(${KILLED} AND call_state = 'connect') AS killed_post,
              SUM(${KILLED} AND call_state = 'connect'
                  AND timediff_last_state_ms <= ${POST_SOGLIA_MS}) AS killed_post_fast
         FROM detections WHERE datetime >= ? AND datetime < ?`,
    )
    .get(from, to) as Row;

  const byOperator = (
    db
      .prepare(
        "SELECT operator, COUNT(*) AS n FROM detections WHERE operator <> ''" +
          ' AND datetime >= ? AND datetime < ? GROUP BY operator ORDER BY n DESC',
      )
      .all(from, to) as Row[]
  ).map((r) => ({ operator: str(r.operator), count: num(r.n) }));

  const days = dayCount(fromDay, toDay);
  const bucketMode: 'hour' | 'day' = days <= 2 ? 'hour' : 'day';
  const calls = num(agg.calls);

  let buckets: Bucket[] = [];
  let bucketsTruncated = false;

  if (calls > BUCKET_ROW_CAP) {
    bucketsTruncated = true;
  } else if (calls > 0) {
    /* Le date in tabella sono UTC: il raggruppamento per ora/giorno LOCALE
     * non e' esprimibile in SQL senza incorporare le regole dell'ora legale,
     * quindi si scaricano solo le colonne necessarie e si aggrega qui. */
    const rows = db
      .prepare(
        `SELECT datetime, (${KILLED}) AS killed, (call_state = 'connect') AS conn` +
          ' FROM detections WHERE datetime >= ? AND datetime < ?',
      )
      .all(from, to) as Row[];
    buckets = bucketMode === 'hour' ? bucketByHour(rows, tz) : bucketByDay(rows, fromDay, toDay, tz);
  } else {
    buckets = bucketMode === 'hour' ? emptyHours() : emptyDays(fromDay, toDay);
  }

  /* ── TRANSITO: quattro classi disgiunte che sommano al totale ──
   * Definizioni identiche a tools/daily_stats.cjs. */
  const killedPre = num(agg.killed_pre);
  const killedPost = num(agg.killed_post);
  const killedPostFast = num(agg.killed_post_fast);
  const connectLordo = num(agg.answered);
  /* Connesse NETTE: chi e' arrivato a connect senza essere chiuso dal
   * modulo. Le segreterie post stanno nella loro classe, non qui. */
  const connesse = connectLordo - killedPost;
  const nonContattabili = calls - killedPre - killedPost - connesse;

  const transito = {
    totale: calls,
    nonContattabili,
    segreterie: killedPre,
    segreteriePost: killedPost,
    connesse,
  };

  /* ── FILTRAGGIO: efficacia sulle chiamate arrivate da qualche parte ──
   * Base = terminate dal modulo + connesse nette, due insiemi disgiunti:
   * sommare il connect LORDO conterebbe due volte le segreterie post. */
  const terminateDalModulo = killedPre + killedPost;
  const filtraggio = {
    base: terminateDalModulo + connesse,
    terminateDalModulo,
    terminatePreConnect: killedPre,
    terminatePostEntro2s: killedPostFast,
    terminatePostOltre2s: killedPost - killedPostFast,
    filtrate: killedPre + killedPostFast,
  };

  return {
    from: fromDay,
    to: toDay,
    fromTime,
    toTime,
    transito,
    filtraggio,
    timezone: tz,
    calls,
    detected: num(agg.detected),
    killed: num(agg.killed),
    answered: num(agg.answered),
    byOperator,
    buckets,
    bucketMode,
    bucketsTruncated,
  };
}

function emptyHours(): Bucket[] {
  return Array.from({ length: 24 }, (_, h) => ({
    key: String(h).padStart(2, '0'),
    totale: 0,
    base: 0,
    terminate: 0,
  }));
}

function emptyDays(fromDay: string, toDay: string): Bucket[] {
  const out: Bucket[] = [];
  for (let day = fromDay; ; day = shiftDay(day, 1)) {
    out.push({ key: day, totale: 0, base: 0, terminate: 0 });
    if (day === toDay || out.length > 400) break;
  }
  return out;
}

/**
 * Aggiunge una riga al suo intervallo applicando la regola della base:
 * contano solo le chiamate che senza il modulo sarebbero passate, cioe'
 * quelle che il modulo ha chiuso e quelle arrivate a connect. Occupato,
 * numeri errati e mancate risposte non entrano nel grafico.
 */
function addRow(b: Bucket, r: Row): void {
  b.totale += 1;
  const killed = !!num(r.killed);
  const conn = !!num(r.conn);
  if (!killed && !conn) return;
  b.base += 1;
  if (killed) b.terminate += 1;
}

function bucketByHour(rows: Row[], tz: string): Bucket[] {
  const out = emptyHours();
  for (const r of rows) {
    const d = new Date(str(r.datetime));
    if (Number.isNaN(d.getTime())) continue;
    addRow(out[localHour(d, tz)], r);
  }
  return out;
}

function bucketByDay(rows: Row[], fromDay: string, toDay: string, tz: string): Bucket[] {
  const out = emptyDays(fromDay, toDay);
  const index = new Map(out.map((b, i) => [b.key, i]));
  for (const r of rows) {
    const d = new Date(str(r.datetime));
    if (Number.isNaN(d.getTime())) continue;
    const i = index.get(formatLocalDate(d, tz));
    if (i === undefined) continue;
    addRow(out[i], r);
  }
  return out;
}
