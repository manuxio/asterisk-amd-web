/*
 * index.ts — entry point: CLI + avvio del server.
 *
 * Uso tipico sul PBX:
 *   ./amd-detex-web useradd admin      crea il primo utente
 *   ./amd-detex-web                    avvia il servizio sulla porta di config
 */

/* Primo import, prima di qualunque cosa carichi node:sqlite. */
import './quiet.js';

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { appDir, loadConfig } from './config.js';
import { deleteUser, readUsers, upsertUser } from './auth.js';
import { closeDb } from './db.js';
import { VERSION, createServer } from './http.js';
import { hasClient } from './static.js';

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) flags.set(a.slice(2, eq), a.slice(eq + 1));
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags.set(a.slice(2), argv[++i]);
      else flags.set(a.slice(2), '1');
    } else {
      positional.push(a);
    }
  }
  const known = ['useradd', 'passwd', 'userdel', 'users', 'init', 'serve'];
  const command = positional.length && known.includes(positional[0]) ? positional.shift()! : 'serve';
  return { command, positional, flags };
}

const HELP = `amd-detex-web ${VERSION} — interfaccia web per i riconoscimenti di app_amd_detex

USO
  amd-detex-web [serve] [--config <file>] [--port <n>]
  amd-detex-web useradd <utente> [--password <pw>]
  amd-detex-web passwd  <utente> [--password <pw>]
  amd-detex-web userdel <utente>
  amd-detex-web users
  amd-detex-web init [--dir <cartella>]

OPZIONI
  --config <file>   file di configurazione (default: amd-web.json accanto
                    all'eseguibile o nella cartella corrente, poi
                    /etc/asterisk/amd-web.json)
  --port <n>        forza la porta, ignorando quella del file di configurazione
  --help            questo messaggio
  --version         versione

CONFIGURAZIONE (amd-web.json)
  port            porta HTTP (default 8080)
  host            interfaccia di ascolto (default 0.0.0.0)
  amdConfigPath   path di amd_detex.conf: da li' vengono letti database_path
                  e detections_save_path
  usersFile       file con gli utenti (creato da 'useradd')
  timezone        fuso per giorni e ore nelle statistiche (default Europe/Rome)

Passare 'init' genera un amd-web.json di esempio commentato.
`;

const EXAMPLE_CONFIG = {
  port: 8080,
  host: '0.0.0.0',
  amdConfigPath: '/etc/asterisk/amd_detex.conf',
  usersFile: '/etc/asterisk/amd-web-users.json',
  timezone: 'Europe/Rome',
  sessionHours: 12,
  secureCookie: false,
  databasePath: '',
  audioPath: '',
  extraAudioRoots: [],
};

/** Legge una password da stdin senza mostrarla a schermo. */
function promptPassword(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('stdin non e\' un terminale: usare --password'));
      return;
    }
    /* readline con terminal:true rimanda a video ogni carattere digitato:
     * l'output va in uno stream che scarta tutto, e il prompt lo stampiamo
     * noi direttamente su stdout. */
    const sink = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output: sink, terminal: true });
    process.stdout.write(question);
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassword(flags: Map<string, string>): Promise<string> {
  const direct = flags.get('password');
  if (direct && direct !== '1') return direct;
  const pw = await promptPassword('Password: ');
  if (pw.length < 8) throw new Error('password troppo corta (minimo 8 caratteri)');
  const again = await promptPassword('Ripeti password: ');
  if (pw !== again) throw new Error('le due password non coincidono');
  return pw;
}

function fail(msg: string): never {
  process.stderr.write(`errore: ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.has('help') || args.flags.has('h')) {
    process.stdout.write(HELP);
    return;
  }
  if (args.flags.has('version')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (args.command === 'init') {
    const dir = args.flags.get('dir') || process.cwd();
    const target = path.join(dir, 'amd-web.json');
    if (fs.existsSync(target)) fail(`${target} esiste gia'`);
    fs.writeFileSync(target, JSON.stringify(EXAMPLE_CONFIG, null, 2) + '\n');
    process.stdout.write(`configurazione di esempio scritta in ${target}\n`);
    return;
  }

  let cfg;
  let configPath;
  try {
    const loaded = loadConfig(args.flags.get('config'));
    cfg = loaded.config;
    configPath = loaded.configPath;
  } catch (e) {
    return fail((e as Error).message);
  }

  const portOverride = args.flags.get('port');
  if (portOverride && portOverride !== '1') {
    const p = Number(portOverride);
    if (!Number.isInteger(p) || p < 1 || p > 65535) fail(`porta non valida: ${portOverride}`);
    cfg.port = p;
  }

  switch (args.command) {
    case 'useradd':
    case 'passwd': {
      const name = args.positional[0];
      if (!name) fail(`uso: amd-detex-web ${args.command} <utente>`);
      const exists = readUsers(cfg.usersFile).some((u) => u.username === name);
      if (args.command === 'useradd' && exists) fail(`l'utente ${name} esiste gia' (usare passwd)`);
      if (args.command === 'passwd' && !exists) fail(`l'utente ${name} non esiste`);
      const pw = await readPassword(args.flags);
      upsertUser(cfg.usersFile, name, pw);
      process.stdout.write(`utente ${name} salvato in ${cfg.usersFile}\n`);
      return;
    }
    case 'userdel': {
      const name = args.positional[0];
      if (!name) fail('uso: amd-detex-web userdel <utente>');
      if (!deleteUser(cfg.usersFile, name)) fail(`l'utente ${name} non esiste`);
      process.stdout.write(`utente ${name} rimosso\n`);
      return;
    }
    case 'users': {
      const users = readUsers(cfg.usersFile);
      if (!users.length) {
        process.stdout.write(`nessun utente in ${cfg.usersFile}\n`);
        return;
      }
      for (const u of users) process.stdout.write(`${u.username}\t${u.createdAt || ''}\n`);
      return;
    }
  }

  /* ── serve ── */
  const server = createServer(cfg);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') fail(`porta ${cfg.port} gia' in uso`);
    if (err.code === 'EACCES') fail(`permessi insufficienti per la porta ${cfg.port}`);
    fail(err.message);
  });

  server.listen(cfg.port, cfg.host, () => {
    const users = (() => {
      try {
        return readUsers(cfg.usersFile).length;
      } catch {
        return 0;
      }
    })();
    process.stdout.write(
      `amd-detex-web ${VERSION}\n` +
        `  in ascolto su http://${cfg.host}:${cfg.port}\n` +
        `  configurazione: ${configPath || '(default incorporati)'}\n` +
        `  amd_detex.conf: ${cfg.amdConfigPath}\n` +
        `  utenti:         ${users} in ${cfg.usersFile}\n` +
        `  eseguibile:     ${appDir()}\n`,
    );
    if (users === 0)
      process.stdout.write(
        '  ATTENZIONE: nessun utente configurato, il login non e\' possibile.\n' +
          '              creare il primo con: amd-detex-web useradd <nome>\n',
      );
    if (!hasClient())
      process.stdout.write(
        "  ATTENZIONE: interfaccia non incorporata; eseguire 'npm run build'.\n",
      );
  });

  const shutdown = () => {
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    /* Se restano connessioni aperte (uno stream audio lungo) non si aspetta
     * all'infinito: il servizio e' senza stato, chiudere e' sicuro. */
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e: Error) => fail(e.message));
