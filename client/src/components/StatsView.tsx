import { useEffect, useState } from 'react';
import type { ServerInfo, Stats } from '../../../shared/types.js';
import { api } from '../api';
import { confidence, ms, n, pct } from '../format';
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
  const [summary, setSummary] = useState<{ today: Stats; yesterday: Stats } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .stats(range.from, range.to)
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
  }, [range.from, range.to]);

  useEffect(() => {
    api.summary().then(setSummary).catch(() => setSummary(null));
  }, []);

  return (
    <>
      <section className="card">
        <div className="filters">
          <DateRange value={range} onChange={onRange} />
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      {summary && (
        <div className="stat-grid">
          <DayCard title="Oggi" s={summary.today} />
          <DayCard title="Ieri" s={summary.yesterday} />
        </div>
      )}

      {loading && !stats && <p className="loading">Caricamento statistiche…</p>}

      {stats && (
        <>
          <div className="stat-grid">
            <Stat label="Chiamate" value={n(stats.calls)} sub="nel periodo selezionato" />
            <Stat
              label="Rilevazioni"
              value={n(stats.detected)}
              sub={`${pct(stats.detected, stats.calls)} delle chiamate`}
              accent
            />
            <Stat
              label="Chiamate interrotte"
              value={n(stats.killed)}
              sub={`${pct(stats.killed, stats.calls)} delle chiamate`}
            />
            <Stat
              label="Risposte"
              value={n(stats.answered)}
              sub={`${pct(stats.answered, stats.calls)} arrivate a connect`}
            />
            <Stat
              label="Confidenza media"
              value={confidence(stats.avgConfidence)}
              sub="sulle sole rilevazioni"
            />
            <Stat label="Tempo di rilevazione" value={ms(stats.avgDetectMs)} sub="media dal setup" />
          </div>

          <section className="card">
            <header>
              <h2>{stats.bucketMode === 'hour' ? 'Distribuzione oraria' : 'Andamento giornaliero'}</h2>
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

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value${accent ? ' accent' : ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function DayCard({ title, s }: { title: string; s: Stats }) {
  return (
    <div className="stat">
      <div className="label">{title}</div>
      <div className="value">
        {n(s.detected)}
        <span style={{ fontSize: 15, color: 'var(--ink-3)', fontWeight: 400 }}>
          {' '}
          / {n(s.calls)}
        </span>
      </div>
      <div className="sub">
        rilevazioni su chiamate — {pct(s.detected, s.calls)} · {n(s.killed)} interrotte
      </div>
    </div>
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
