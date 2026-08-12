import { useState } from 'react';
import type { Bucket } from '../../../shared/types.js';
import { dayLabel, n, pct } from '../format';

/* Un solo colore di serie (blu, slot 1 della palette validata sulla
 * superficie #16161a); la quota non rilevata usa un neutro, che e' un
 * "resto" e non una seconda categoria. */
const SERIES = '#3987e5';
const REST = '#4a4a57';

const H = 168;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;
const GAP = 2; /* stacco fra i due segmenti dello stack */

/** Rettangolo con i due angoli superiori arrotondati. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return (
    `M${x},${y + h}` +
    `L${x},${y + rr}` +
    `Q${x},${y} ${x + rr},${y}` +
    `L${x + w - rr},${y}` +
    `Q${x + w},${y} ${x + w},${y + rr}` +
    `L${x + w},${y + h}Z`
  );
}

/** Massimo dell'asse arrotondato a un valore leggibile. */
function niceMax(v: number): number {
  if (v <= 5) return 5;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * mag;
    if (candidate >= v) return candidate;
  }
  return 10 * mag;
}

interface Hover {
  x: number;
  y: number;
  bucket: Bucket;
}

export function BucketChart({ buckets, mode }: { buckets: Bucket[]; mode: 'hour' | 'day' }) {
  const [hover, setHover] = useState<Hover | null>(null);

  const max = niceMax(Math.max(1, ...buckets.map((b) => b.calls)));
  /* Lo slot si adatta al numero di barre (24 ore, 7 o 30 giorni) in modo che
   * il grafico riempia la scheda anche con pochi intervalli, senza produrre
   * barre spropositate. */
  const slot = Math.max(18, Math.min(120, Math.floor(880 / Math.max(1, buckets.length))));
  const barW = Math.max(6, Math.min(44, slot - 8));
  const W = Math.max(320, buckets.length * slot);
  const scale = (v: number) => (v / max) * PLOT_H;

  /* Con molti giorni le etichette si sovrappongono: se ne mostra una ogni
   * `every`, sempre includendo la prima. */
  const every = Math.ceil(buckets.length / Math.floor(W / 56));
  const gridValues = [0, max / 2, max];

  return (
    <div className="chart-wrap">
      <div className="chart">
        <svg width={W} height={H} role="img" aria-label="Chiamate per intervallo">
          {gridValues.map((v) => {
            const y = PAD_TOP + PLOT_H - scale(v);
            return (
              <g key={v}>
                <line x1={0} x2={W} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} />
                <text x={2} y={y - 3} fill="var(--ink-3)" fontSize={10}>
                  {v === 0 ? '' : n(Math.round(v))}
                </text>
              </g>
            );
          })}

          {buckets.map((b, i) => {
            const x = i * slot + (slot - barW) / 2;
            const totalH = scale(b.calls);
            const detH = scale(b.detected);
            const restH = Math.max(0, totalH - detH);
            const base = PAD_TOP + PLOT_H;
            const showGap = detH > 0 && restH > GAP;
            const restTop = base - totalH;
            const detTop = base - detH;

            return (
              <g
                key={b.key}
                onMouseEnter={() => setHover({ x: x + barW / 2, y: base - totalH, bucket: b })}
                onMouseLeave={() => setHover((h) => (h?.bucket.key === b.key ? null : h))}
              >
                {/* area di aggancio piu' grande della barra */}
                <rect x={i * slot} y={PAD_TOP} width={slot} height={PLOT_H} fill="transparent" />
                {restH > 0 && (
                  <path
                    d={topRounded(x, restTop, barW, showGap ? restH - GAP : restH, 4)}
                    fill={REST}
                  />
                )}
                {detH > 0 &&
                  (restH > 0 ? (
                    <rect x={x} y={detTop} width={barW} height={detH} fill={SERIES} />
                  ) : (
                    <path d={topRounded(x, detTop, barW, detH, 4)} fill={SERIES} />
                  ))}
                {hover?.bucket.key === b.key && (
                  <rect
                    x={x - 1}
                    y={base - totalH - 1}
                    width={barW + 2}
                    height={totalH + 1}
                    fill="none"
                    stroke="var(--ink)"
                    strokeWidth={1}
                    opacity={0.35}
                    rx={4}
                  />
                )}
                {(i % every === 0 || i === 0) && (
                  <text
                    x={i * slot + slot / 2}
                    y={H - 8}
                    fill="var(--ink-3)"
                    fontSize={11}
                    textAnchor="middle"
                  >
                    {mode === 'hour' ? b.key : dayLabel(b.key)}
                  </text>
                )}
              </g>
            );
          })}

          <line
            x1={0}
            x2={W}
            y1={PAD_TOP + PLOT_H}
            y2={PAD_TOP + PLOT_H}
            stroke="var(--line-strong)"
            strokeWidth={1}
          />
        </svg>

        {hover && (
          <div
            className="chart-tooltip"
            style={{ left: hover.x, top: Math.max(0, hover.y - 8) }}
            role="tooltip"
          >
            <strong>{mode === 'hour' ? `Ore ${hover.bucket.key}:00` : dayLabel(hover.bucket.key)}</strong>
            <span>{n(hover.bucket.calls)} chiamate</span>
            <span>
              {n(hover.bucket.detected)} rilevate ({pct(hover.bucket.detected, hover.bucket.calls)})
            </span>
          </div>
        )}
      </div>

      <div className="legend">
        <span>
          <i style={{ background: SERIES }} /> Rilevate
        </span>
        <span>
          <i style={{ background: REST }} /> Non rilevate
        </span>
      </div>
    </div>
  );
}

export function OperatorBars({
  data,
  total,
}: {
  data: { operator: string; count: number }[];
  total: number;
}) {
  if (!data.length) return <p className="empty">Nessuna rilevazione nel periodo.</p>;
  const max = Math.max(...data.map((d) => d.count));

  return (
    <div>
      {data.map((d) => (
        <div className="op-row" key={d.operator}>
          <span className="name" title={d.operator}>
            {d.operator}
          </span>
          <span className="track">
            <span className="fill" style={{ width: `${Math.max(2, (d.count / max) * 100)}%` }} />
          </span>
          <span className="n">
            {n(d.count)}
            <small style={{ color: 'var(--ink-3)', marginLeft: 6 }}>{pct(d.count, total)}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
