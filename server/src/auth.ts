/*
 * auth.ts — utenti su file + sessioni con cookie firmato.
 *
 * Nessuna dipendenza esterna: scrypt e HMAC arrivano da node:crypto, cosi'
 * l'eseguibile singolo resta senza moduli nativi da compilare.
 *
 * Il file utenti e' un JSON:
 *   { "users": [ { "username": "admin", "salt": "<hex>", "hash": "<hex>",
 *                  "createdAt": "..." } ] }
 * La password in chiaro non viene mai scritta ne' registrata nei log.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface UserRecord {
  username: string;
  salt: string;
  hash: string;
  createdAt?: string;
}

interface UsersFile {
  users: UserRecord[];
}

const SCRYPT_KEYLEN = 64;
/* Parametri scrypt: costo alto quanto basta (~100 ms) senza rendere
 * attaccabile il login con richieste concorrenti. */
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(password, s, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
  return { salt: s, hash: h };
}

export function readUsers(file: string): UserRecord[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as UsersFile | UserRecord[];
    const users = Array.isArray(parsed) ? parsed : parsed.users;
    return Array.isArray(users) ? users : [];
  } catch (e) {
    throw new Error(`file utenti non valido (${file}): ${(e as Error).message}`);
  }
}

export function writeUsers(file: string, users: UserRecord[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  /* 0600: il file contiene hash di password, non deve essere leggibile
   * dagli altri utenti del PBX. */
  fs.writeFileSync(file, JSON.stringify({ users }, null, 2) + '\n', { mode: 0o600 });
}

export function upsertUser(file: string, username: string, password: string): void {
  const users = readUsers(file);
  const { salt, hash } = hashPassword(password);
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) {
    users.push({ username, salt, hash, createdAt: new Date().toISOString() });
  } else {
    users[idx] = { ...users[idx], salt, hash };
  }
  writeUsers(file, users);
}

export function deleteUser(file: string, username: string): boolean {
  const users = readUsers(file);
  const next = users.filter((u) => u.username !== username);
  if (next.length === users.length) return false;
  writeUsers(file, next);
  return true;
}

/**
 * Verifica le credenziali. Il confronto e' a tempo costante e, quando
 * l'utente non esiste, viene comunque eseguito uno scrypt fittizio: senza
 * questo, i tempi di risposta rivelerebbero quali username sono validi.
 */
export function verifyPassword(users: UserRecord[], username: string, password: string): boolean {
  const user = users.find((u) => u.username === username);
  if (!user) {
    hashPassword(password, 'decoy'.padEnd(32, '0'));
    return false;
  }
  const { hash } = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ── Sessioni ───────────────────────────────────────────────────────── */

export const COOKIE_NAME = 'amd_detex_web';

interface SessionPayload {
  u: string;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function createSession(secret: string, username: string, hours: number): string {
  const payload: SessionPayload = { u: username, exp: Date.now() + hours * 3600_000 };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(secret: string, token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.u || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload.u;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string, hours: number, secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.round(hours * 3600)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearCookie(secure: boolean): string {
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/* ── Freno ai tentativi di login ────────────────────────────────────── */

const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;

export function loginBlocked(ip: string): number {
  const rec = attempts.get(ip);
  if (!rec) return 0;
  if (Date.now() > rec.until) {
    attempts.delete(ip);
    return 0;
  }
  return rec.count >= MAX_ATTEMPTS ? Math.ceil((rec.until - Date.now()) / 1000) : 0;
}

export function recordFailure(ip: string): void {
  const rec = attempts.get(ip);
  if (!rec || Date.now() > rec.until) {
    attempts.set(ip, { count: 1, until: Date.now() + WINDOW_MS });
    return;
  }
  rec.count += 1;
}

export function recordSuccess(ip: string): void {
  attempts.delete(ip);
}
