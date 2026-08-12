/*
 * static.ts — asset del client.
 *
 * In produzione i file compilati da Vite sono incorporati nel bundle
 * (assets.generated.ts, prodotto da scripts/embed-assets.mjs): l'eseguibile
 * e' autosufficiente, non serve copiare directory sul PBX.
 *
 * Se il modulo generato e' vuoto (build del server senza build del client)
 * si ricade su dist/client su disco, utile durante lo sviluppo.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { ServerResponse } from 'node:http';
import { EMBEDDED_ASSETS } from './assets.generated.js';
import { appDir } from './config.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.map']);

interface Asset {
  body: Buffer;
  gzip?: Buffer;
  type: string;
}

const cache = new Map<string, Asset | null>();

function diskRoot(): string {
  /* Ordine: accanto all'eseguibile, poi la build locale durante lo sviluppo. */
  const candidates = [
    path.join(appDir(), 'client'),
    path.resolve(process.cwd(), 'dist/client'),
    path.resolve(process.cwd(), 'web/dist/client'),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, 'index.html'))) || '';
}

function loadAsset(name: string): Asset | null {
  if (cache.has(name)) return cache.get(name) ?? null;

  let body: Buffer | null = null;
  const embedded = EMBEDDED_ASSETS[name];
  if (embedded) {
    body = Buffer.from(embedded, 'base64');
  } else {
    const root = diskRoot();
    if (root) {
      const full = path.join(root, name);
      const rel = path.relative(root, full);
      if (!rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(full)) {
        try {
          body = fs.readFileSync(full);
        } catch {
          body = null;
        }
      }
    }
  }

  if (!body) {
    cache.set(name, null);
    return null;
  }

  const ext = path.extname(name).toLowerCase();
  const asset: Asset = {
    body,
    type: MIME[ext] || 'application/octet-stream',
    gzip: COMPRESSIBLE.has(ext) && body.length > 1024 ? zlib.gzipSync(body, { level: 9 }) : undefined,
  };
  cache.set(name, asset);
  return asset;
}

export function hasClient(): boolean {
  return Object.keys(EMBEDDED_ASSETS).length > 0 || diskRoot() !== '';
}

/**
 * Serve un asset. `urlPath` e' il path della richiesta; le rotte sconosciute
 * senza estensione ricadono su index.html (single page app).
 */
export function serveStatic(res: ServerResponse, urlPath: string, acceptEncoding: string): boolean {
  let name = decodeURIComponent(urlPath.replace(/^\/+/, ''));
  if (name === '' || name.endsWith('/')) name += 'index.html';
  /* Normalizzazione POSIX: gli asset sono indicizzati con '/' anche quando
   * la build gira su Windows. */
  name = path.posix.normalize(name);
  if (name.startsWith('..')) return false;

  let asset = loadAsset(name);
  if (!asset && !path.extname(name)) asset = loadAsset('index.html');
  if (!asset) return false;

  const isIndex = name === 'index.html' || !path.extname(name);
  const headers: Record<string, string> = {
    'Content-Type': asset.type,
    /* I nomi dei bundle contengono l'hash: cache lunga per gli asset,
     * mai per index.html (altrimenti un aggiornamento non si vede). */
    'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  };

  const body = asset.gzip && /\bgzip\b/.test(acceptEncoding) ? asset.gzip : asset.body;
  if (body === asset.gzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = String(body.length);

  res.writeHead(200, headers);
  res.end(body);
  return true;
}
