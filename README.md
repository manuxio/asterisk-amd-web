# asterisk-amd-web

Interfaccia web di consultazione per **`app_amd_detex`**, il modulo nativo
Asterisk di riconoscimento segreterie telefoniche: elenco delle chiamate
analizzate, riproduzione e download delle registrazioni, statistiche
giornaliere e su intervalli liberi.

Tema scuro, due schermate, nessuna configurazione da duplicare.

## Installazione

Sul server Asterisk:

```bash
git clone https://github.com/manuxio/asterisk-amd-web.git
cd asterisk-amd-web
sudo ./install
```

Fine. Lo script scarica l'eseguibile gia' compilato, lo installa in
`/opt/amd-detex-web`, crea la configurazione, chiede il primo utente e
registra il servizio systemd. L'interfaccia risponde su
`http://<server>:8080`.

**Sul server non serve Node**: l'eseguibile include l'interprete.

Opzioni:

```bash
sudo ./install --port 9000 --dir /srv/amd-web --user asterisk
sudo ./install --no-service          # niente systemd, avvio manuale
sudo ./install --local               # usa ./dist invece di scaricare
sudo ./install --help
```

Per aggiornare:

```bash
git pull && sudo ./install
```

L'eseguibile viene sostituito (copia `.new` + rinomina atomica, come si fa
con un binario in esecuzione); **configurazione e utenti restano
invariati**.

## Cosa legge

Solo quello che il modulo ha gia' prodotto:

- il **database SQLite** indicato da `database_path` in `amd_detex.conf`
  (una riga per chiamata conclusa);
- i **WAV** salvati in `detections_save_path`.

Non parla con Asterisk, non usa ARI ne' AMI, non modifica nulla. Il
database viene aperto con `PRAGMA query_only`: da qui non e' possibile
scrivere.

I path **non si duplicano**: vengono letti da `amd_detex.conf`, che
l'interfaccia rilegge quando cambia l'mtime (controllo ogni 5 s, come fa il
modulo). Se cambi `database_path` lato Asterisk non devi riavviare nulla.

## Le due schermate

**Riconoscimenti** — tabella delle chiamate con filtri per periodo, ricerca
su chiamante/chiamato/UID, operatore, solo rilevate, solo con audio.
Cliccando una riga si aprono i dettagli (UID, kernel, argomento dell'azione)
con il player e il pulsante di download. Export CSV dei risultati filtrati,
pronto per Excel.

**Statistiche** — oggi e ieri sempre in cima, piu' l'intervallo scelto:
chiamate, rilevazioni, chiamate interrotte, risposte, confidenza media,
tempo medio di rilevazione. Grafico per ora (fino a 2 giorni) o per giorno,
distribuzione per operatore, e le direttive attive lette da
`amd_detex.conf`.

Terminologia coerente con il modulo: *rilevazione* = riga con `operator`
valorizzato; *chiamata interrotta* = `action` in (`hangup`,
`hangup_with_reason`).

## Utenti

```bash
cd /opt/amd-detex-web
sudo -u asterisk ./amd-detex-web useradd <nome>    # password chiesta a video
sudo -u asterisk ./amd-detex-web passwd  <nome>
sudo -u asterisk ./amd-detex-web userdel <nome>
sudo -u asterisk ./amd-detex-web users
```

Password con scrypt (N=16384, salt per utente), file `0600`. Sessioni con
cookie firmato HMAC, `HttpOnly` + `SameSite=Strict`. Freno sui tentativi di
login falliti.

## Configurazione — `amd-web.json`

Creato da `./install` in `/opt/amd-detex-web/`. Cercato, in ordine:
`--config <file>`, poi accanto all'eseguibile o nella cartella corrente,
poi `/etc/asterisk/amd-web.json`.

| chiave | default | significato |
|---|---|---|
| `port` | `8080` | porta HTTP (anche `--port` o `AMD_WEB_PORT`) |
| `host` | `0.0.0.0` | interfaccia di ascolto; `127.0.0.1` dietro un reverse proxy |
| `amdConfigPath` | `/etc/asterisk/amd_detex.conf` | da qui arrivano `database_path` e `detections_save_path` |
| `usersFile` | `users.json` | utenti e hash delle password |
| `timezone` | `Europe/Rome` | fuso per giorni e ore delle statistiche |
| `sessionHours` | `12` | durata della sessione |
| `secureCookie` | `false` | metti `true` se servi in HTTPS |
| `databasePath` | *(vuoto)* | forza il path del SQLite ignorando `amd_detex.conf` |
| `audioPath` | *(vuoto)* | forza la cartella dei WAV |
| `extraAudioRoots` | `[]` | altre cartelle da cui e' lecito servire audio |

`sessionSecret` viene generato al primo avvio e salvato nel file: senza,
ogni riavvio scollegherebbe tutti gli utenti.

## Note operative

- **Audio mancante.** Con `save_all_calls = no` (default del modulo) solo le
  chiamate con rilevazione positiva hanno un WAV: nelle altre righe la
  colonna Audio resta vuota, non e' un errore.
- **Permessi.** Il servizio gira come `asterisk` e deve poter leggere il
  database (con i suoi `-wal`/`-shm`) e la cartella delle registrazioni.
- **Esposizione.** Non c'e' HTTPS integrato. Se l'interfaccia esce dalla
  LAN, mettila dietro nginx con TLS, `host: "127.0.0.1"` e
  `secureCookie: true`.
- **Fusi orari.** Il modulo scrive gli orari in UTC; giorni e ore vengono
  convertiti passando da `Intl`, non da un offset fisso, quindi i giorni di
  cambio ora legale restano corretti.
- **Sicurezza dei path.** I WAV sono serviti solo se il percorso letto dal
  database ricade dentro `detections_save_path` (o `extraAudioRoots`) e ha
  estensione `.wav`.

## Sviluppo

Serve Node >= 22.13 (solo per compilare, non per eseguire).

```bash
npm install
npm run dev:server     # API su :8080, ricompila a ogni modifica
npm run dev:client     # Vite su :5173, inoltra /api a :8080

npm run typecheck
npm run build          # client + server -> dist/server.cjs
npm run build:exe      # eseguibile per questa macchina
npm run build:exe:linux  # eseguibile linux-x64 per il PBX
```

`build:exe:linux` scarica una volta il binario Node ufficiale per Linux (in
`.cache/`) e ci inietta l'applicazione con le Single Executable Applications
di Node: si puo' quindi produrre da Windows o macOS l'eseguibile destinato
al server.

Nessuna dipendenza runtime: SQLite arriva da `node:sqlite`, l'hashing da
`node:crypto`, l'HTTP da `node:http`. Nessun modulo nativo da compilare.

```
install                 installazione/aggiornamento sul server
server/src/
  index.ts              CLI (serve, useradd, passwd, init) e avvio
  http.ts               router: /api/* + file statici
  config.ts             amd-web.json + parser di amd_detex.conf
  auth.ts               scrypt, sessioni, freno ai login
  db.ts                 query sul SQLite del modulo (node:sqlite)
  tz.ts                 conversioni giorno locale <-> finestra UTC
  audio.ts              streaming WAV con Range e confinamento dei path
  static.ts             asset del client (incorporati o da disco)
client/src/             React + TypeScript, tema scuro, nessuna libreria UI
shared/types.ts         tipi condivisi, rispecchiano le colonne di `detections`
scripts/                build: embed asset, bundle esbuild, impacchettamento SEA
```
