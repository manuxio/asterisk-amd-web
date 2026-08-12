import { useEffect, useState } from 'react';
import type { ServerInfo, Stats } from '../../../shared/types.js';
import { api } from '../api';
import { n, pct } from '../format';
import DateRange, { type Range } from './DateRange';
import { BucketChart, OperatorBars } from './Charts';

export default function StatsView({
  range,
  onRange,
  info,
}: {
  range: Range;
  onRange: (r: Range) => void;
  info: ServerInfo | null;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  /* Finestra oraria: vuota = giornata intera. Impostandola a 09:00-20:45 si
   * riproduce la giornata lavorativa di daily_stats.bat. */
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .stats(range.from, range.to, fromTime, toTime)
      .then((s) => {
        if (!cancelled) {
          setStats(s);
          setError('');
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, fromTime, toTime]);

  return (
    <>
      <section className="card">
        <div className="filters">
          <DateRange value={range} onChange={onRange} />
          <label className="field">
            Dalle
            <input
              className="input"
              type="time"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
            />
          </label>
          <label className="field">
            Alle
            <input
              className="input"
              type="time"
              value={toTime}
              onChange={(e) => setToTime(e.target.value)}
            />
          </label>
          <button
            className="btn chip"
            aria-pressed={fromTime === '09:00' && toTime === '20:45'}
            title="Stessa finestra usata da daily_stats.bat"
            onClick={() => {
              setFromTime('09:00');
              setToTime('20:45');
            }}
          >
            Orario lavorativo
          </button>
          {(fromTime || toTime) && (
            <button
              className="btn chip"
              onClick={() => {
                setFromTime('');
                setToTime('');
              }}
            >
              Giornata intera
            </button>
          )}
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      {loading && !stats && <p className="loading">Caricamento statistiche…</p>}

      {stats && (
        <>
          <TransitoCard stats={stats} />
          <FiltraggioCard stats={stats} />

          <section className="card">
            <header>
              <h2>
                {stats.bucketMode === 'hour' ? 'Filtraggio per ora' : 'Filtraggio per giorno'}
              </h2>
              <span className="hint">fuso {stats.timezone}</span>
            </header>
            <div className="body">
              {stats.bucketsTruncated ? (
                <p className="empty">
                  Intervallo troppo ampio per il grafico: selezionare un periodo più breve.
                </p>
              ) : (
                <BucketChart buckets={stats.buckets} mode={stats.bucketMode} />
              )}
            </div>
          </section>

          <section className="card">
            <header>
              <h2>Rilevazioni per operatore</h2>
              <span className="hint">{n(stats.detected)} totali</span>
            </header>
            <div className="body">
              <OperatorBars data={stats.byOperator} total={stats.detected} />
            </div>
          </section>
        </>
      )}

      {info && <InfoCard info={info} />}
    </>
  );
}

/** Riga di una tabella di ripartizione: valore + quota sulla base. */
function BreakRow({
  label,
  value,
  base,
  strong,
  indent,
  hint,
}: {
  label: string;
  value: number;
  base: number;
  strong?: boolean;
  indent?: boolean;
  hint?: string;
}) {
  return (
    <tr className={strong ? 'strong' : undefined}>
      <td className={indent ? 'indent' : undefined}>
        {label}
        {hint && <span className="note"> — {hint}</span>}
      </td>
      <td className="num">{n(value)}</td>
      <td className="num quota">{base ? pct(value, base) : '—'}</td>
    </tr>
  );
}

function TransitoCard({ stats }: { stats: Stats }) {
  const t = stats.transito;
  return (
    <section className="card">
      <header>
        <h2>Transito PBX</h2>
      </header>
      <div className="table-wrap">
        <table className="breakdown">
          <tbody>
            <BreakRow label="Chiamate transitate dal PBX" value={t.totale} base={t.totale} strong />
            <BreakRow
              label="non contattabili in quel momento"
              value={t.nonContattabili}
              base={t.totale}
              indent
              hint="nessuna risposta, occupato, numero errato, errori di rete"
            />
            <BreakRow
              label="segreterie"
              value={t.segreterie}
              base={t.totale}
              indent
              hint="chiuse dal modulo prima della connessione"
            />
            <BreakRow
              label="segreterie post"
              value={t.segreteriePost}
              base={t.totale}
              indent
              hint="riconosciute dopo la risposta"
            />
            <BreakRow
              label="connesse"
              value={t.connesse}
              base={t.totale}
              indent
              hint="arrivate a connect e non chiuse dal modulo"
            />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FiltraggioCard({ stats }: { stats: Stats }) {
  const f = stats.filtraggio;
  return (
    <section className="card">
      <header>
        <h2>Filtraggio</h2>
        <span className="hint">base = terminate dal modulo + connesse, esclude le non contattabili</span>
      </header>
      <div className="table-wrap">
        <table className="breakdown">
          <tbody>
            <BreakRow
              label="Chiamate terminate dal modulo + connesse (base)"
              value={f.base}
              base={f.base}
              strong
            />
            <BreakRow
              label="Chiamate terminate dal modulo"
              value={f.terminateDalModulo}
              base={f.base}
              strong
              hint="in qualunque stato"
            />
            <BreakRow
              label="di cui prima della connessione"
              value={f.terminatePreConnect}
              base={f.base}
              indent
            />
            <BreakRow
              label="di cui entro 2 s dalla risposta"
              value={f.terminatePostEntro2s}
              base={f.base}
              indent
            />
            <BreakRow
              label="di cui oltre 2 s dalla risposta"
              value={f.terminatePostOltre2s}
              base={f.base}
              indent
            />
            <BreakRow
              label="Chiamate filtrate"
              value={f.filtrate}
              base={f.base}
              hint="definizione di daily_stats: pre-connect + post entro 2 s"
            />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InfoCard({ info }: { info: ServerInfo }) {
  return (
    <section className="card">
      <header>
        <h2>Configurazione del modulo</h2>
        <span className="hint">amd-detex-web {info.version}</span>
      </header>
      <div className="body">
        <dl className="detail-grid">
          <div>
            <dt>amd_detex.conf</dt>
            <dd>
              {info.amdConfigPath} {info.amdConfigFound ? '' : '(non trovato)'}
            </dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd>
              {info.databasePath || '(non configurato)'} {info.databaseFound ? '' : '(non trovato)'}
            </dd>
          </div>
          <div>
            <dt>Cartella audio</dt>
            <dd>
              {info.audioPath || '(non configurata)'} {info.audioFound ? '' : '(non trovata)'}
            </dd>
          </div>
          {info.settings.map((s) => (
            <div key={s.key}>
              <dt>{s.key}</dt>
              <dd>{s.value || '(vuoto)'}</dd>
            </div>
          ))}
        </dl>

        <h3 className="sub-head">Canali di notifica</h3>
        <dl className="detail-grid">
          <Channel
            label="report_url"
            url={info.notifications.reportUrl}
            hint={`report JSON a fine chiamata${
              info.notifications.notifyNonDetected ? ', anche senza rilevazione' : ', solo se rilevata'
            }`}
          />
          <Channel
            label="terminated_notify_url"
            url={info.notifications.terminatedNotifyUrl}
            hint="quando il modulo interrompe la chiamata"
          />
          <Channel
            label="monitor_url"
            url={info.notifications.monitorUrl}
            hint="bundle completo con audio e cronologia"
          />
          {info.notifications.notifyInStates && (
            <div>
              <dt>notify_in_states</dt>
              <dd>{info.notifications.notifyInStates}</dd>
            </div>
          )}
        </dl>
        <p className="note">
          Il database conserva una sola azione per chiamata, la più decisiva: una notifica
          partita insieme a un hangup non lascia traccia nella riga. Nell&apos;elenco è
          marcata «inviata» solo quando risulta dal database, «prevista» quando la
          configurazione qui sopra la implica. Le credenziali eventualmente presenti negli
          URL non vengono mostrate.
        </p>
      </div>
    </section>
  );
}

function Channel({ label, url, hint }: { label: string; url: string; hint: string }) {
  return (
    <div className="wide">
      <dt>{label}</dt>
      <dd>
        {url ? (
          <>
            {url} <span className="note">— {hint}</span>
          </>
        ) : (
          <span style={{ color: 'var(--ink-3)' }}>non configurato</span>
        )}
      </dd>
    </div>
  );
}
