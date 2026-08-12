import { shiftDay, todayLocal } from '../format';

export interface Range {
  from: string;
  to: string;
}

const PRESETS: { label: string; make: () => Range }[] = [
  { label: 'Oggi', make: () => ({ from: todayLocal(), to: todayLocal() }) },
  {
    label: 'Ieri',
    make: () => ({ from: shiftDay(todayLocal(), -1), to: shiftDay(todayLocal(), -1) }),
  },
  { label: 'Ultimi 7 giorni', make: () => ({ from: shiftDay(todayLocal(), -6), to: todayLocal() }) },
  { label: 'Ultimi 30 giorni', make: () => ({ from: shiftDay(todayLocal(), -29), to: todayLocal() }) },
];

export function isPreset(range: Range, label: string): boolean {
  const p = PRESETS.find((x) => x.label === label);
  if (!p) return false;
  const r = p.make();
  return r.from === range.from && r.to === range.to;
}

/** Selettore intervallo: scorciatoie + due date libere. */
export default function DateRange({
  value,
  onChange,
}: {
  value: Range;
  onChange: (r: Range) => void;
}) {
  const max = todayLocal();

  return (
    <>
      <div className="presets">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className="btn chip"
            aria-pressed={isPreset(value, p.label)}
            onClick={() => onChange(p.make())}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="field">
        Dal
        <input
          className="input"
          type="date"
          value={value.from}
          max={value.to || max}
          onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
        />
      </label>
      <label className="field">
        Al
        <input
          className="input"
          type="date"
          value={value.to}
          min={value.from}
          onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
        />
      </label>
    </>
  );
}
