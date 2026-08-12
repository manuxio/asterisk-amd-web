/*
 * embed-assets.mjs — incorpora la build del client nel sorgente del server.
 *
 * Legge dist/client (prodotto da Vite) e genera
 * server/src/assets.generated.ts con i file in base64: il bundle del server
 * diventa autosufficiente e l'eseguibile finale non ha asset esterni da
 * distribuire insieme.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(root, 'dist', 'client');
const outFile = path.join(root, 'server', 'src', 'assets.generated.ts');

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    /* Chiavi sempre con '/': il server le confronta con il path della
     * richiesta HTTP, anche quando la build gira su Windows. */
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(full, rel));
    else out.push({ rel, full });
  }
  return out;
}

if (!fs.existsSync(path.join(clientDir, 'index.html'))) {
  console.error(`embed-assets: ${clientDir} non contiene index.html — eseguire prima 'npm run build:client'`);
  process.exit(1);
}

const files = walk(clientDir).filter((f) => !f.rel.endsWith('.map'));
const lines = [
  '/* GENERATO da scripts/embed-assets.mjs — non modificare a mano. */',
  '/* eslint-disable */',
  'export const EMBEDDED_ASSETS: Record<string, string> = {',
];

let total = 0;
for (const f of files.sort((a, b) => a.rel.localeCompare(b.rel))) {
  const buf = fs.readFileSync(f.full);
  total += buf.length;
  lines.push(`  ${JSON.stringify(f.rel)}: ${JSON.stringify(buf.toString('base64'))},`);
}
lines.push('};', '');

fs.writeFileSync(outFile, lines.join('\n'));
console.log(
  `embed-assets: ${files.length} file, ${(total / 1024).toFixed(1)} kB → server/src/assets.generated.ts`,
);
