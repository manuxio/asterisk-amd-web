/*
 * build-sea.mjs — impacchetta il server dentro un eseguibile Node autonomo.
 *
 * Usa le Single Executable Applications native di Node: il bundle CJS viene
 * trasformato in un blob e iniettato in una copia del binario `node`. Il
 * risultato e' un file unico da copiare sul PBX, dove Node non deve essere
 * installato.
 *
 *   node scripts/build-sea.mjs                    eseguibile per questa macchina
 *   node scripts/build-sea.mjs --target linux-x64 eseguibile per il server Asterisk
 *   node scripts/build-sea.mjs --node v24.11.1    versione di Node da incorporare
 *
 * Per un target diverso dalla macchina di build il binario Node ufficiale
 * viene scaricato da nodejs.org e messo in cache in .cache/node/.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inject } from 'postject';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const cacheDir = path.join(root, '.cache', 'node');

/* Sentinella cercata da postject nel binario Node: e' un valore fisso
 * dell'implementazione SEA, non un parametro nostro. */
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

/* Sotto questa versione node:sqlite non e' disponibile senza flag. */
const MIN_NODE = [22, 13, 0];

function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const eq = argv[i].indexOf('=');
    if (eq !== -1) flags.set(argv[i].slice(2, eq), argv[i].slice(eq + 1));
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags.set(argv[i].slice(2), argv[++i]);
    else flags.set(argv[i].slice(2), '1');
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const hostTarget = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const target = flags.get('target') || hostTarget;
const nodeVersion = flags.get('node') || process.version;

function fail(msg) {
  console.error(`build-sea: ${msg}`);
  process.exit(1);
}

const [major, minor, patch] = nodeVersion.replace(/^v/, '').split('.').map(Number);
if (
  major < MIN_NODE[0] ||
  (major === MIN_NODE[0] && (minor < MIN_NODE[1] || (minor === MIN_NODE[1] && patch < MIN_NODE[2])))
)
  fail(`Node ${nodeVersion} non basta: node:sqlite richiede >= v${MIN_NODE.join('.')}`);

if (!fs.existsSync(path.join(dist, 'server.cjs')))
  fail("dist/server.cjs mancante — eseguire prima 'npm run build'");

/* ── binario Node di base ───────────────────────────────────────────── */

const isWindowsTarget = target.startsWith('win');

async function download(url, dest) {
  console.log(`build-sea: scarico ${url}`);
  const res = await fetch(url);
  if (!res.ok) fail(`download fallito (${res.status}) — ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function baseBinary() {
  if (target === hostTarget && nodeVersion === process.version) return process.execPath;

  const name = isWindowsTarget
    ? `node-${nodeVersion}-${target}`
    : `node-${nodeVersion}-${target === 'darwin-arm64' ? 'darwin-arm64' : target}`;
  const archive = isWindowsTarget ? `${name}.zip` : `${name}.tar.gz`;
  const archivePath = path.join(cacheDir, archive);
  const extractDir = path.join(cacheDir, name);
  const binary = isWindowsTarget
    ? path.join(extractDir, 'node.exe')
    : path.join(extractDir, 'bin', 'node');

  if (fs.existsSync(binary)) return binary;

  if (!fs.existsSync(archivePath))
    await download(`https://nodejs.org/dist/${nodeVersion}/${archive}`, archivePath);

  fs.mkdirSync(cacheDir, { recursive: true });
  /* Si estrae SOLO il binario: gli archivi Node contengono symlink
   * (bin/npm, bin/npx) che Windows non sa creare senza privilegi e che
   * farebbero fallire l'estrazione completa. bsdtar — presente su Windows
   * 10+, macOS e la maggior parte dei Linux — legge sia .tar.gz sia .zip. */
  const member = isWindowsTarget ? `${name}/node.exe` : `${name}/bin/node`;
  execFileSync('tar', ['-xf', archivePath, '-C', cacheDir, member], { stdio: 'inherit' });

  if (!fs.existsSync(binary)) fail(`binario non trovato dopo l'estrazione: ${binary}`);
  return binary;
}

/* ── blob SEA ───────────────────────────────────────────────────────── */

/* La cache del codice e' legata a versione+piattaforma del Node che genera
 * il blob: attivarla in cross-build produrrebbe un eseguibile che non parte. */
const sameHost = target === hostTarget && nodeVersion === process.version;

const seaConfig = {
  main: path.join(dist, 'server.cjs'),
  output: path.join(dist, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: sameHost,
};

const seaConfigPath = path.join(dist, 'sea-config.json');
fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

console.log('build-sea: genero il blob SEA');
execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], { stdio: 'inherit' });

/* ── iniezione ──────────────────────────────────────────────────────── */

const base = await baseBinary();
const outName = `amd-detex-web${isWindowsTarget ? '.exe' : ''}${target === hostTarget ? '' : `-${target}`}`;
const outPath = path.join(dist, outName);

fs.copyFileSync(base, outPath);
if (!isWindowsTarget) fs.chmodSync(outPath, 0o755);

const blob = fs.readFileSync(seaConfig.output);
console.log(`build-sea: inietto ${(blob.length / 1024).toFixed(0)} kB in ${outName}`);

await inject(outPath, 'NODE_SEA_BLOB', blob, {
  sentinelFuse: SENTINEL,
  machOSegmentName: target.startsWith('darwin') ? 'NODE_SEA' : undefined,
});

fs.rmSync(seaConfig.output, { force: true });

const size = fs.statSync(outPath).size;
console.log(`build-sea: dist/${outName} pronto (${(size / 1024 / 1024).toFixed(1)} MB, Node ${nodeVersion})`);

if (target.startsWith('darwin'))
  console.log('build-sea: su macOS firmare l\'eseguibile con `codesign --sign - <file>` prima di distribuirlo.');
if (!sameHost && os.platform() === 'win32' && !isWindowsTarget)
  console.log('build-sea: ricordarsi di dare il bit di esecuzione dopo la copia sul server (chmod +x).');
