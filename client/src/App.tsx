import { useEffect, useState } from 'react';
import { ApiError, api } from './api';
import { todayLocal } from './format';
import Login from './components/Login';
import DetectionsView from './components/DetectionsView';
import StatsView from './components/StatsView';
import type { Range } from './components/DateRange';

type Tab = 'detections' | 'stats';

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('detections');
  /* L'intervallo e' condiviso fra le due schede: passare da statistiche a
   * elenco non deve far perdere il periodo che si sta guardando. */
  const [range, setRange] = useState<Range>({ from: todayLocal(), to: todayLocal() });

  useEffect(() => {
    api
      .me()
      .then((me) => setUser(me.username))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  /* Sessione scaduta durante l'uso: si torna al login senza ricaricare. */
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof ApiError && e.reason.status === 401) setUser(null);
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);

  if (!ready) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          AMD Detex <small>riconoscimenti</small>
        </div>
        <nav className="tabs" role="tablist">
          <button
            className="tab"
            role="tab"
            aria-selected={tab === 'detections'}
            onClick={() => setTab('detections')}
          >
            Riconoscimenti
          </button>
          <button
            className="tab"
            role="tab"
            aria-selected={tab === 'stats'}
            onClick={() => setTab('stats')}
          >
            Statistiche
          </button>
        </nav>
        <span className="spacer" />
        <div className="who">
          <span className="name">{user}</span>
          <button
            className="btn ghost"
            onClick={async () => {
              await api.logout().catch(() => undefined);
              setUser(null);
            }}
          >
            Esci
          </button>
        </div>
      </header>

      <main>
        {tab === 'detections' ? (
          <DetectionsView range={range} onRange={setRange} />
        ) : (
          <StatsView range={range} onRange={setRange} />
        )}
      </main>
    </div>
  );
}

function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#3987e5" />
      <g fill="#fff">
        <rect x="7" y="13" width="3" height="6" rx="1.5" />
        <rect x="12.5" y="9" width="3" height="14" rx="1.5" />
        <rect x="18" y="11" width="3" height="10" rx="1.5" />
        <rect x="23.5" y="14" width="3" height="4" rx="1.5" />
      </g>
    </svg>
  );
}
