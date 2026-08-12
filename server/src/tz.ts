/*
 * tz.ts — conversioni fra date locali e la finestra UTC del database.
 *
 * Il modulo scrive `datetime` con gmtime_r() nel formato
 * "YYYY-MM-DDTHH:MM:SSZ" (src/amd_audiohook.c). E' UTC, a lunghezza fissa,
 * quindi confrontabile lessicograficamente: le query usano
 * `datetime >= from AND datetime < to` senza funzioni SQL sulle date.
 *
 * L'utente pero' ragiona in ora locale ("oggi", "ieri"), e in Italia lo
 * scarto e' +1 o +2 a seconda dell'ora legale: le conversioni passano da
 * Intl, mai da un offset fisso.
 */

/** Scarto (ms) fra il fuso `tz` e UTC nell'istante `date`. */
function offsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  /* 'hour' puo' valere 24 con hour12:false in alcune versioni di ICU. */
  const hour = get('hour') % 24;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asUtc - date.getTime();
}

/** Istante UTC corrispondente a una data/ora civile nel fuso `tz`. */
export function zonedTimeToUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  s: number,
  tz: string,
): Date {
  const naive = Date.UTC(y, m - 1, d, h, min, s);
  /* Due passate: la prima stima usa l'offset all'istante sbagliato, la
   * seconda lo ricalcola sull'istante corretto (necessario nei giorni di
   * cambio ora legale). */
  let ts = naive - offsetMs(new Date(naive), tz);
  ts = naive - offsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** "YYYY-MM-DD" nel fuso `tz` per l'istante dato. */
export function formatLocalDate(date: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(date);
}

/** Ora locale 0-23 per l'istante dato. */
export function localHour(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit' });
  return Number(dtf.format(date)) % 24;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converte un intervallo di giorni locali (estremi inclusi) nella coppia di
 * timestamp UTC da usare nel WHERE: [from, to).
 */
export function dayRangeToUtc(fromDay: string, toDay: string, tz: string): { from: string; to: string } {
  if (!DATE_RE.test(fromDay) || !DATE_RE.test(toDay))
    throw new Error('data non valida, atteso il formato YYYY-MM-DD');
  const [fy, fm, fd] = fromDay.split('-').map(Number);
  const [ty, tm, td] = toDay.split('-').map(Number);
  const start = zonedTimeToUtc(fy, fm, fd, 0, 0, 0, tz);
  /* Estremo destro esclusivo: mezzanotte del giorno successivo. Passare
   * day+1 a Date.UTC gestisce da solo i fine mese. */
  const endBase = new Date(Date.UTC(ty, tm - 1, td + 1));
  const end = zonedTimeToUtc(
    endBase.getUTCFullYear(),
    endBase.getUTCMonth() + 1,
    endBase.getUTCDate(),
    0,
    0,
    0,
    tz,
  );
  if (end.getTime() <= start.getTime()) throw new Error('intervallo di date vuoto o invertito');
  return { from: toDbStamp(start), to: toDbStamp(end) };
}

/** Formato esatto della colonna `datetime` del modulo. */
export function toDbStamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Giorno locale corrente ("oggi" per l'utente, non per UTC). */
export function today(tz: string): string {
  return formatLocalDate(new Date(), tz);
}

/** Giorno locale spostato di `days` rispetto a oggi. */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/** Numero di giorni locali coperti dall'intervallo, estremi inclusi. */
export function dayCount(fromDay: string, toDay: string): number {
  const utcOf = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utcOf(toDay) - utcOf(fromDay)) / 86_400_000) + 1;
}
