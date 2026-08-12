/*
 * config.ts — configurazione della web app + lettura di amd_detex.conf.
 *
 * Due file distinti:
 *   1. amd-web.json      configurazione DI QUESTA interfaccia (porta, utenti,
 *                        dove sta amd_detex.conf)
 *   2. amd_detex.conf    configurazione DEL MODULO: da qui ricaviamo
 *                        database_path e detections_save_path, cosi' i path
 *                        non vanno mai duplicati a mano.
 *
 * amd_detex.conf viene riletto quando cambia l'mtime (stessa filosofia del
 * modulo, che lo ricontrolla ogni 5 s): cambiare i path lato Asterisk si
 * riflette qui senza riavviare l'interfaccia.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface WebConfig {
  /** porta HTTP dell'interfaccia */
  port: number;
  /** interfaccia di ascolto; 127.0.0.1 se sta dietro un reverse proxy */
  host: string;
  /** path di /etc/asterisk/amd_detex.conf */
  amdConfigPath: string;
  /** file JSON degli utenti (username + hash scrypt) */
  usersFile: string;
  /** segreto HMAC per i cookie di sessione; generato al primo avvio */
  sessionSecret: string;
  /** durata della sessione in ore */
  sessionHours: number;
  /** fuso orario usato per giorni/ore nelle statistiche e nella tabella */
  timezone: string;
  /** override di database_path letto da amd_detex.conf (di norma vuoto) */
  databasePath: string;
  /** override di detections_save_path (di norma vuoto) */
  audioPath: string;
  /** directory extra da cui e' lecito servire audio (path storici) */
  extraAudioRoots: string[];
  /** true quando l'interfaccia e' servita su HTTPS: marca il cookie Secure */
  secureCookie: boolean;
}

const DEFAULTS: WebConfig = {
  port: 8080,
  host: '0.0.0.0',
  amdConfigPath: '/etc/asterisk/amd_detex.conf',
  usersFile: 'users.json',
  sessionSecret: '',
  sessionHours: 12,
  timezone: 'Europe/Rome',
  databasePath: '',
  audioPath: '',
  extraAudioRoots: [],
  secureCookie: false,
};

export const CONFIG_CANDIDATES = [
  'amd-web.json',
  '/etc/asterisk/amd-web.json',
  '/etc/amd-detex-web/amd-web.json',
];

/** Directory dell'eseguibile: con SEA process.argv[1] non e' utilizzabile. */
export function appDir(): string {
  return path.dirname(process.execPath);
}

function resolveFrom(base: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

export interface LoadedConfig {
  config: WebConfig;
  /** file effettivamente caricato, '' se si usano solo i default */
  configPath: string;
}

export function findConfigFile(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const roots = [process.cwd(), appDir()];
  for (const cand of CONFIG_CANDIDATES) {
    if (path.isAbsolute(cand)) {
      if (fs.existsSync(cand)) return cand;
      continue;
    }
    for (const root of roots) {
      const full = path.join(root, cand);
      if (fs.existsSync(full)) return full;
    }
  }
  return '';
}

export function loadConfig(explicit?: string): LoadedConfig {
  const configPath = findConfigFile(explicit);
  let raw: Partial<WebConfig> = {};

  if (configPath) {
    if (!fs.existsSync(configPath))
      throw new Error(`file di configurazione non trovato: ${configPath}`);
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<WebConfig>;
    } catch (e) {
      throw new Error(`configurazione non valida (${configPath}): ${(e as Error).message}`);
    }
  }

  const config: WebConfig = { ...DEFAULTS, ...raw };
  const base = configPath ? path.dirname(configPath) : process.cwd();

  config.usersFile = resolveFrom(base, config.usersFile || DEFAULTS.usersFile);
  if (config.databasePath) config.databasePath = resolveFrom(base, config.databasePath);
  if (config.audioPath) config.audioPath = resolveFrom(base, config.audioPath);
  config.extraAudioRoots = (config.extraAudioRoots || []).map((p) => resolveFrom(base, p));

  const envPort = process.env.AMD_WEB_PORT;
  if (envPort) config.port = Number(envPort);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error(`porta non valida: ${config.port}`);

  /* Il segreto di sessione non deve cambiare a ogni riavvio, altrimenti tutti
   * gli utenti vengono disconnessi. Se manca lo generiamo e lo scriviamo nel
   * file di configurazione (permessi 0600). */
  if (!config.sessionSecret) {
    config.sessionSecret = crypto.randomBytes(32).toString('hex');
    if (configPath) persistSessionSecret(configPath, config.sessionSecret);
  }

  return { config, configPath };
}

function persistSessionSecret(configPath: string, secret: string): void {
  try {
    const obj = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    obj.sessionSecret = secret;
    fs.writeFileSync(configPath, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  } catch {
    /* Configurazione in sola lettura: si prosegue con un segreto effimero,
     * le sessioni non sopravvivono al riavvio ma il servizio funziona. */
  }
}

/* ── amd_detex.conf ─────────────────────────────────────────────────── */

export interface AmdConf {
  path: string;
  found: boolean;
  values: Map<string, string>;
  mtimeMs: number;
}

const AMD_CONF_CACHE = { conf: null as AmdConf | null, checkedAt: 0 };
const RECHECK_MS = 5000;

/**
 * Parser del formato Asterisk usato da amd_detex.conf: sezioni fra parentesi
 * quadre, `chiave = valore`, commenti che iniziano con ';'. Ci interessa solo
 * [general], che e' l'unica sezione prevista dal modulo.
 */
export function parseAmdConf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) {
      section = trimmed.slice(1, trimmed.indexOf(']') === -1 ? undefined : trimmed.indexOf(']')).trim();
      continue;
    }
    if (section && section !== 'general') continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    /* Un ';' a fine riga e' un commento inline solo se preceduto da spazio:
     * i valori (path, URL) non contengono ';' ma restiamo prudenti. */
    let value = trimmed.slice(eq + 1).trim();
    const inline = value.search(/\s;/);
    if (inline !== -1) value = value.slice(0, inline).trim();
    if (key) out.set(key, value);
  }
  return out;
}

export function readAmdConf(cfg: WebConfig, force = false): AmdConf {
  const now = Date.now();
  const cached = AMD_CONF_CACHE.conf;
  if (!force && cached && now - AMD_CONF_CACHE.checkedAt < RECHECK_MS) return cached;
  AMD_CONF_CACHE.checkedAt = now;

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(cfg.amdConfigPath).mtimeMs;
  } catch {
    const conf: AmdConf = { path: cfg.amdConfigPath, found: false, values: new Map(), mtimeMs: 0 };
    AMD_CONF_CACHE.conf = conf;
    return conf;
  }

  if (cached && cached.found && cached.mtimeMs === mtimeMs) return cached;

  let values = new Map<string, string>();
  try {
    values = parseAmdConf(fs.readFileSync(cfg.amdConfigPath, 'utf8'));
  } catch {
    /* illeggibile: trattato come assente */
  }
  const conf: AmdConf = { path: cfg.amdConfigPath, found: true, values, mtimeMs };
  AMD_CONF_CACHE.conf = conf;
  return conf;
}

/** Path del database SQLite: override della web config, altrimenti amd_detex.conf. */
export function resolveDatabasePath(cfg: WebConfig): string {
  if (cfg.databasePath) return cfg.databasePath;
  return readAmdConf(cfg).values.get('database_path') || '';
}

/** Directory dei WAV: override della web config, altrimenti amd_detex.conf. */
export function resolveAudioPath(cfg: WebConfig): string {
  if (cfg.audioPath) return cfg.audioPath;
  return readAmdConf(cfg).values.get('detections_save_path') || '';
}

/** Direttive mostrate nel pannello informativo (mai URL con credenziali). */
export const EXPOSED_DIRECTIVES = [
  'enabled',
  'actions_enabled',
  'mock_actions',
  'check_interval_ms',
  'disengage_after_connect_ms',
  'destructive_actions_states',
  'notify_in_states',
  'detections_save_path',
  'save_all_calls',
  'database_path',
  'monitor_calls',
  'notify_non_detected',
  'log_level',
];
