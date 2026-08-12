/*
 * build-server.mjs — bundle del server in un unico file CommonJS.
 *
 * CJS e non ESM perche' e' il formato richiesto dalle Single Executable
 * Applications di Node. Non ci sono dipendenze runtime: sqlite arriva da
 * node:sqlite, l'hashing da node:crypto, l'HTTP da node:http.
 */

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'dist', 'server.cjs');

const result = await esbuild.build({
  entryPoints: [path.join(root, 'server', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile,
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
});

const size = fs.statSync(outfile).size;
console.log(`build-server: dist/server.cjs (${(size / 1024).toFixed(1)} kB)`);

if (process.env.AMD_WEB_META) {
  fs.writeFileSync(path.join(root, 'dist', 'meta.json'), JSON.stringify(result.metafile));
}
