/* Formattazioni condivise. Le date in arrivo sono UTC ("...Z"): la
 * conversione al fuso locale la fa il browser, che sul PBX e' comunque
 * quello dell'operatore che guarda. */

const NUM = new Intl.NumberFormat('it-IT');

export const n = (v: number) => NUM.format(v || 0);

export function pct(part: number, total: number): string {
  if (!total) return '—';
  return `${((part / total) * 100).toFixed(1).replace('.', ',')}%`;
}

export function time(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
}

export function ms(v: number): string {
  if (!v) return '—';
  return v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1).replace('.', ',')} s`;
}

export function confidence(v: number): string {
  return v ? v.toFixed(2).replace('.', ',') : '—';
}

/** Giorno locale odierno in formato YYYY-MM-DD, per i selettori data. */
export function todayLocal(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

const STATE_LABEL: Record<string, string> = {
  setup: 'setup',
  alerting: 'squillo',
  connect: 'risposta',
};
export const stateLabel = (s: string) => STATE_LABEL[s] || s || '—';

const ACTION_LABEL: Record<string, string> = {
  none: '—',
  hangup: 'chiusa',
  hangup_with_reason: 'chiusa (causa)',
  redirect: 'deviata',
  set_variable: 'variabile',
  notify_url: 'notifica',
};
export const actionLabel = (a: string) => ACTION_LABEL[a] || a || '—';

export const isKilled = (a: string) => a === 'hangup' || a === 'hangup_with_reason';
