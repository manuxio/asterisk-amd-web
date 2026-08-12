/*
 * audio.ts — streaming dei WAV registrati dal modulo.
 *
 * Il path arriva dalla colonna `recorded_audio_path` (scritta dal modulo,
 * non dal client) ma viene comunque confinato alle directory consentite:
 * chi ha accesso al database non deve poter far leggere /etc/shadow al
 * server passando per un path arbitrario.
 *
 * I file sono WAV PCM 8 kHz mono, riproducibili nativamente dal browser.
 * Il supporto alle richieste Range serve a far funzionare il seek del
 * player HTML.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

export interface AudioRoots {
  roots: string[];
}

export function buildRoots(audioPath: string, extra: string[]): AudioRoots {
  const roots = [audioPath, ...extra]
    .filter((p) => !!p)
    .map((p) => path.resolve(p));
  return { roots };
}

/**
 * Restituisce il path assoluto normalizzato se il file e' dentro una delle
 * root consentite ed e' un WAV, altrimenti null.
 */
export function safeAudioPath(raw: string, roots: AudioRoots): string | null {
  if (!raw) return null;
  const resolved = path.resolve(raw);
  if (path.extname(resolved).toLowerCase() !== '.wav') return null;
  if (roots.roots.length === 0) return null;
  const inRoot = roots.roots.some((root) => {
    const rel = path.relative(root, resolved);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  return inRoot ? resolved : null;
}

export function audioExists(raw: string, roots: AudioRoots): boolean {
  const p = safeAudioPath(raw, roots);
  if (!p) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Nome proposto al download: quello del file su disco. */
export function downloadName(p: string): string {
  return path.basename(p).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Invia il file, gestendo `Range: bytes=a-b` (una sola tratta, l'unica
 * forma usata dai browser per l'audio).
 */
export function sendAudio(
  res: ServerResponse,
  filePath: string,
  rangeHeader: string | undefined,
  asDownload: boolean,
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('audio non disponibile');
    return;
  }

  const size = stat.size;
  const disposition = asDownload
    ? `attachment; filename="${downloadName(filePath)}"`
    : `inline; filename="${downloadName(filePath)}"`;

  const base: Record<string, string> = {
    'Content-Type': 'audio/wav',
    'Content-Disposition': disposition,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=300',
  };

  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (match) {
    const startRaw = match[1];
    const endRaw = match[2];
    let start: number;
    let end: number;
    if (startRaw === '') {
      /* suffisso: "bytes=-500" = ultimi 500 byte */
      const len = Number(endRaw);
      if (!len) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        res.end();
        return;
      }
      start = Math.max(0, size - len);
      end = size - 1;
    } else {
      start = Number(startRaw);
      end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...base,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...base, 'Content-Length': String(size) });
  fs.createReadStream(filePath).pipe(res);
}
