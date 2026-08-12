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

export interface Bucket {
  /** etichetta locale: "14" per l'ora, "2026-08-11" per il giorno */
  key: string;
  calls: number;
  detected: number;
}

export interface Stats {
  from: string;
  to: string;
  timezone: string;
  calls: number;
  detected: number;
  killed: number;
  answered: number;
  avgConfidence: number;
  avgDetectMs: number;
  byOperator: { operator: string; count: number }[];
  buckets: Bucket[];
  /** 'hour' quando l'intervallo copre al massimo 2 giorni, altrimenti 'day' */
  bucketMode: 'hour' | 'day';
  /** true se i grafici sono stati omessi perche' l'intervallo e' troppo ampio */
  bucketsTruncated: boolean;
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

export interface DetectionFilters {
  from?: string;
  to?: string;
  q?: string;
  operator?: string;
  onlyDetected?: boolean;
  onlyAudio?: boolean;
  limit?: number;
  offset?: number;
}
