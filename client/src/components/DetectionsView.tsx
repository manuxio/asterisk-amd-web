import { useEffect, useRef, useState } from 'react';
import type {
  Detection,
  DetectionFilters,
  DetectionPage,
  Notifications,
  ServerInfo,
} from '../../../shared/types.js';
import { api, audioUrl, csvUrl, downloadUrl } from '../api';
import {
  actionLabel,
  confidence,
  dateTime,
  isKilled,
  ms,
  n,
  stateLabel,
  time,
} from '../format';
import DateRange, { type Range } from './DateRange';

const PAGE = 50;

export default function DetectionsView({
  range,
  onRange,
  info,
}: {
  range: Range;
  onRange: (r: Range) => void;
  info: ServerInfo | null;
}) {
  const [q, setQ] = useState('');
  const [operator, setOperator] = useState('');
  const [onlyDetected, setOnlyDetected] = useState(false);
  const [onlyAudio, setOnlyAudio] = useState(false);
  const [offset, setOffset] = useState(0);

  const [page, setPage] = useState<DetectionPage | null>(null);
  const [operators, setOperators] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  /* Il testo di ricerca si applica dopo una pausa: evita una query per
   * ogni tasto premuto mentre si digita un numero. */
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filters: DetectionFilters = {
    from: range.from,
    to: range.to,
    q: debouncedQ || undefined,
    operator: operator || undefined,
    onlyDetected,
    onlyAudio,
    limit: PAGE,
    offset,
  };

  /* Cambiare un filtro riporta alla prima pagina. */
  const filterKey = `${range.from}|${range.to}|${debouncedQ}|${operator}|${onlyDetected}|${onlyAudio}`;
  const prevKey = useRef(filterKey);
  useEffect(() => {
    if (prevKey.current !== filterKey) {
      prevKey.current = filterKey;
      setOffset(0);
      setOpenId(null);
    }
  }, [filterKey]);

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .detections(filters)
      .then((res) => {
        if (cancelled) return;
        setPage(res);
        setError('');
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, offset, reloadToken]);

  useEffect(() => {
    api
      .operators(range.from, range.to)
      .then((r) => setOperators(r.operators))
      .catch(() => setOperators([]));
  }, [range.from, range.to]);

  const rows = page?.rows ?? [];
  const total = page?.total ?? 0;

  return (
    <>
      <section className="card">
        <div className="filters">
          <DateRange value={range} onChange={onRange} />
          <label className="field">
            Ricerca
            <input
              className="input"
              placeholder="chiamante, chiamato o UID"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label className="field">
            Operatore
            <select className="select" value={operator} onChange={(e) => setOperator(e.target.value)}>
              <option value="">Tutti</option>
              {operators.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={onlyDetected}
              onChange={(e) => setOnlyDetected(e.target.checked)}
            />
            Solo rilevate
          </label>
          <label className="check">
            <input type="checkbox" checked={onlyAudio} onChange={(e) => setOnlyAudio(e.target.checked)} />
            Solo con audio
          </label>
          <span className="spacer" />
          <span className="actions">
            <button className="btn" onClick={() => setReloadToken((t) => t + 1)} disabled={loading}>
              Aggiorna
            </button>
            <a className="btn" href={csvUrl(filters)}>
              Esporta CSV
            </a>
          </span>
        </div>
      </section>

      <section className="card">
        <header>
          <h2>Chiamate</h2>
          <span className="hint">
            {loading ? 'caricamento…' : `${n(total)} risultat${total === 1 ? 'o' : 'i'}`}
          </span>
        </header>

        {error && (
          <div className="body">
            <p className="error">{error}</p>
          </div>
        )}

        {!error && rows.length === 0 && !loading && (
          <p className="empty">Nessuna chiamata nel periodo selezionato.</p>
        )}

        {!error && rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ora</th>
                  <th>Chiamante</th>
                  <th>Chiamato</th>
                  <th>Stato</th>
                  <th>Operatore</th>
                  <th className="num">Conf.</th>
                  <th>Azione</th>
                  <th>Notifica</th>
                  <th className="num">Rilevata a</th>
                  <th>Audio</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <Row
                    key={d.id}
                    d={d}
                    notif={info?.notifications ?? null}
                    open={openId === d.id}
                    onToggle={() => setOpenId(openId === d.id ? null : d.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE && (
          <div className="pager">
            <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              ← Precedenti
            </button>
            <span>
              {n(offset + 1)}–{n(Math.min(offset + PAGE, total))} di {n(total)}
            </span>
            <button
              className="btn"
              disabled={offset + PAGE >= total}
              onClick={() => setOffset(offset + PAGE)}
            >
              Successive →
            </button>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * Stato della notifica per una chiamata.
 *
 * Attenzione a cosa si puo' affermare: il database conserva UNA sola azione
 * per chiamata, la piu' decisiva (src/amd_audiohook.c). `notify_url` finisce
 * nella riga solo se non e' stato eseguito nient'altro, quindi una notifica
 * partita insieme a un hangup non lascia traccia. Per questo si distingue
 * fra "registrata" (fatto certo, letto dal database) e "prevista"
 * (dedotta dalla configurazione del modulo, non confermata).
 */
type NotifState =
  | { kind: 'registrata'; url: string }
  | { kind: 'prevista'; url: string; perche: string }
  | { kind: 'nessuna' };

function notifState(d: Detection, n: Notifications | null): NotifState {
  if (d.action === 'notify_url' && d.action_argument)
    return { kind: 'registrata', url: d.action_argument };
  if (n?.terminatedNotifyUrl && (isKilled(d.action) || d.action === 'redirect'))
    return { kind: 'prevista', url: n.terminatedNotifyUrl, perche: 'chiamata interrotta dal modulo' };
  if (n?.reportUrl && (d.operator || n.notifyNonDetected))
    return { kind: 'prevista', url: n.reportUrl, perche: 'report di fine chiamata' };
  return { kind: 'nessuna' };
}

function Row({
  d,
  notif,
  open,
  onToggle,
}: {
  d: Detection;
  notif: Notifications | null;
  open: boolean;
  onToggle: () => void;
}) {
  const ns = notifState(d, notif);
  return (
    <>
      <tr className={`row-main${open ? ' open' : ''}`} onClick={onToggle}>
        <td title={dateTime(d.datetime)}>{time(d.datetime)}</td>
        <td className="mono">{d.caller || '—'}</td>
        <td className="mono">{d.called || '—'}</td>
        <td>
          <span className="badge">{stateLabel(d.call_state)}</span>
        </td>
        <td>
          {d.operator ? (
            <span className="badge op">{d.operator}</span>
          ) : (
            <span className="badge none">nessuna</span>
          )}
        </td>
        <td className="num">{confidence(d.confidence)}</td>
        <td>
          <span className={`badge${isKilled(d.action) ? ' killed' : d.action && d.action !== 'none' ? ' ok' : ' none'}`}>
            {actionLabel(d.action)}
          </span>
        </td>
        <td>
          {ns.kind === 'registrata' && (
            <span className="badge ok" title={`Inviata a ${ns.url}`}>
              ✉ inviata
            </span>
          )}
          {ns.kind === 'prevista' && (
            <span className="badge none" title={`Prevista a ${ns.url} — ${ns.perche}`}>
              ✉ prevista
            </span>
          )}
          {ns.kind === 'nessuna' && <span style={{ color: 'var(--ink-3)' }}>—</span>}
        </td>
        <td className="num">{d.operator ? ms(d.timediff_setup_ms) : '—'}</td>
        <td>{d.hasAudio ? '🔊' : <span style={{ color: 'var(--ink-3)' }}>—</span>}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} style={{ padding: 0, whiteSpace: 'normal' }}>
            <div className="detail">
              <dl className="detail-grid">
                <div>
                  <dt>UID</dt>
                  <dd>{d.uid || '—'}</dd>
                </div>
                <div>
                  <dt>Data e ora</dt>
                  <dd>{dateTime(d.datetime)}</dd>
                </div>
                <div>
                  <dt>Kernel</dt>
                  <dd>{d.kernel_id || '—'}</dd>
                </div>
                <div>
                  <dt>Argomento azione</dt>
                  <dd>{d.action_argument || '—'}</dd>
                </div>
                <div>
                  <dt>Da ultimo cambio stato</dt>
                  <dd>{ms(d.timediff_last_state_ms)}</dd>
                </div>
                <div className="wide">
                  <dt>Notifica</dt>
                  <dd>
                    {ns.kind === 'registrata' && <>Inviata a {ns.url}</>}
                    {ns.kind === 'prevista' && (
                      <>
                        Prevista a {ns.url} — {ns.perche}
                        <span className="note">
                          {' '}
                          (configurata nel modulo; il database registra una sola azione per
                          chiamata, quindi l&apos;invio non risulta dalla riga)
                        </span>
                      </>
                    )}
                    {ns.kind === 'nessuna' && <>Nessuna notifica registrata né configurata</>}
                  </dd>
                </div>
                <div className="wide">
                  <dt>File audio</dt>
                  <dd>{d.recorded_audio_path || '—'}</dd>
                </div>
              </dl>

              {d.hasAudio ? (
                <div className="player">
                  {/* WAV PCM 8 kHz mono: riproducibile nativamente. I file
                      pesano poche decine di kB, quindi si precarica la
                      durata per mostrarla subito nel player. */}
                  <audio controls preload="metadata" src={audioUrl(d.id)} />
                  <a className="btn" href={downloadUrl(d.id)} download>
                    ⭳ Scarica WAV
                  </a>
                </div>
              ) : (
                <p style={{ color: 'var(--ink-3)', margin: 0 }}>
                  {d.recorded_audio_path
                    ? 'Il file registrato non è più presente sul server.'
                    : 'Nessun audio salvato per questa chiamata (vedi save_all_calls in amd_detex.conf).'}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
