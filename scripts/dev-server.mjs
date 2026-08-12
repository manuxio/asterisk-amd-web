/*
 * dev-server.mjs — server in sviluppo: ricompila e riavvia a ogni modifica
 * dei sorgenti in server/src. Il client gira separatamente con
 * `npm run dev:client` (Vite, porta 5173) che inoltra /api qui.
 */

import esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'dist', 'server.dev.cjs');

let child = null;

function restart() {
  if (child) child.kill();
  child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: 'inherit' });
}

const ctx = await esbuild.context({
  entryPoints: [path.join(root, 'server', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile,
  sourcemap: 'inline',
  logLevel: 'info',
  plugins: [
    {
      name: 'restart',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) restart();
        });
      },
    },
  ],
});

await ctx.watch();
console.log('dev-server: in ascolto delle modifiche in server/src');

process.on('SIGINT', () => {
  if (child) child.kill();
  ctx.dispose().then(() => process.exit(0));
});
