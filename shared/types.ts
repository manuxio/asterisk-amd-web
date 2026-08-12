/* Tipi condivisi fra server e client. Rispecchiano 1:1 le colonne della
 * tabella `detections` scritta da src/amd_report.c. */

export interface Detection {
  id: number;
  uid: string;
  /** ISO UTC, formato "YYYY-MM-DDTHH:MM:SSZ" (gmtime nel modulo). */
  datetime: string;
  caller: string;
  called: string;
  /** setup | alerting | connect */
  call_state: string;
  /** none | hangup | hangup_with_reason | redirect | set_variable | notify_url */
  action: string;
  action_argument: string;
  timediff_setup_ms: number;
  timediff_last_state_ms: number;
  recorded_audio_path: string;
  /** nome del kernel che ha fatto match, "" se nessuna rilevazione */
  operator: string;
  kernel_id: string;
  confidence: number;
  /** calcolato dal server: il WAV esiste ancora su disco */
  hasAudio: boolean;
}

export interface DetectionPage {
  rows: Detection[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Un intervallo del grafico. Il totale della barra e' la BASE, non tutte
 * le chiamate transitate: cio' che conta sono le chiamate che senza il
 * modulo sarebbero passate. Occupato, numeri errati e mancate risposte
 * restano fuori.
 */
export interface Bucket {
  /** etichetta locale: "14" per l'ora, "2026-08-11" per il giorno */
  key: string;
  /** tutte le chiamate transitate dal PBX nell'intervallo, non contattabili
   *  comprese: e' il contesto, disegnato come barra sfumata dietro */
  totale: number;
  /** terminate dal modulo (qualunque stato) + connesse nette */
  base: number;
  /** di cui terminate dal modulo */
  terminate: number;
}

export interface Stats {
  from: string;
  to: string;
  timezone: string;
  calls: number;
  detected: number;
  killed: number;
  answered: number;
  byOperator: { operator: string; count: number }[];
  buckets: Bucket[];
  /** 'hour' quando l'intervallo copre al massimo 2 giorni, altrimenti 'day' */
  bucketMode: 'hour' | 'day';
  /** true se i grafici sono stati omessi perche' l'intervallo e' troppo ampio */
  bucketsTruncated: boolean;
  /** finestra oraria applicata agli estremi dell'intervallo (HH:MM) */
  fromTime: string;
  toTime: string;
  transito: Transito;
  filtraggio: Filtraggio;
}

/**
 * Partizione esatta delle chiamate transitate dal PBX in quattro classi
 * disgiunte che sommano al totale. Definizioni identiche a
 * tools/daily_stats.cjs nel repo del modulo: sono la contabilita' gia' in
 * uso, e duplicarla con criteri diversi genererebbe solo confusione.
 */
export interface Transito {
  /** COUNT(*): una riga per ogni chiamata conclusa */
  totale: number;
  /** mai connesse e mai fermate dal modulo: nessuna risposta, occupato,
   *  numero errato, errori di rete */
  nonContattabili: number;
  /** terminate dal modulo PRIMA della connessione (call_state <> connect) */
  segreterie: number;
  /** terminate dal modulo DOPO la risposta (call_state = connect) */
  segreteriePost: number;
  /** call_state = connect meno le segreterie post */
  connesse: number;
}

/**
 * Efficacia del filtro sulle sole chiamate che sono arrivate da qualche
 * parte, escludendo quindi le non contattabili.
 *
 * La base somma due classi DISGIUNTE: le chiamate chiuse dal modulo
 * (in qualunque stato) e le connesse NETTE, cioe' quelle arrivate a
 * connect e non chiuse dal modulo. Usare il connect lordo conterebbe due
 * volte le segreterie riconosciute dopo la risposta.
 */
export interface Filtraggio {
  /** terminateDalModulo + connesse nette */
  base: number;
  /** hangup del modulo in qualunque stato: e' il numeratore principale */
  terminateDalModulo: number;
  /** di cui chiuse prima della connessione */
  terminatePreConnect: number;
  /** di cui chiuse entro 2 s dalla risposta */
  terminatePostEntro2s: number;
  /** di cui chiuse oltre 2 s dalla risposta */
  terminatePostOltre2s: number;
  /** definizione storica di daily_stats.cjs: pre-connect + post entro 2 s.
   *  Conservata per poter confrontare i due conteggi. */
  filtrate: number;
}

export interface Me {
  username: string;
}

export interface ServerInfo {
  /** path del file di configurazione di amd_detex letto dal server */
  amdConfigPath: string;
  amdConfigFound: boolean;
  databasePath: string;
  databaseFound: boolean;
  audioPath: string;
  audioFound: boolean;
  timezone: string;
  version: string;
  /** direttive utili lette da amd_detex.conf, per il pannello informativo */
  settings: { key: string; value: string }[];
  /** canali di notifica configurati nel modulo (URL senza credenziali) */
  notifications: Notifications;
}

/**
 * Canali di notifica del modulo, letti da amd_detex.conf.
 *
 * Sono una CONFIGURAZIONE, non un registro: il database conserva una sola
 * azione per chiamata (la piu' decisiva), quindi una notifica partita
 * insieme a un hangup non lascia traccia nella riga. Serve a dire
 * all'utente quali invii sono attivi, non a certificare che siano andati
 * a buon fine.
 */
export interface Notifications {
  /** report_url: un POST JSON a fine chiamata */
  reportUrl: string;
  /** terminated_notify_url: POST quando il modulo interrompe la chiamata */
  terminatedNotifyUrl: string;
  /** monitor_url: bundle completo verso il server di monitoraggio */
  monitorUrl: string;
  /** notify_non_detected: il report parte anche senza rilevazione */
  notifyNonDetected: boolean;
  /** notify_in_states: stati SIP in cui le notifiche possono partire */
  notifyInStates: string;
}

/**
 * Filtro sullo stato SIP con cui la chiamata si e' chiusa (colonna
 * `call_state`). 'pre' raggruppa setup e alerting, cioe' tutto cio' che si
 * e' concluso PRIMA della risposta.
 */
export type StateFilter = '' | 'pre' | 'setup' | 'alerting' | 'connect';

export const STATE_FILTERS: StateFilter[] = ['', 'pre', 'setup', 'alerting', 'connect'];

export interface DetectionFilters {
  from?: string;
  to?: string;
  q?: string;
  operator?: string;
  state?: StateFilter;
  onlyDetected?: boolean;
  onlyAudio?: boolean;
  limit?: number;
  offset?: number;
}
