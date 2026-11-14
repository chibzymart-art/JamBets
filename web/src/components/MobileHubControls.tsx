/**
 * Phone-only control-card parts (app layout) for hubs other than football:
 * tier pills, stat boxes and the heading row. Presentation only: every value and
 * click handler comes from the hub, which keeps its existing filter and paywall logic.
 * Styles live in app-shell.css (.m-tiers, .m-stats, .m-sec), hidden on desktop.
 */

export interface MobileTierPill {
  id: string;
  label: string;
  /** Win rate to show beside the label; omitted when locked or unknown. */
  rate?: number | string | null;
  active: boolean;
  onClick: () => void;
}

export interface MobileStatBox {
  key: string;
  label: string;
  value: string | number;
  tone?: 'won' | 'lost' | 'rate';
  active?: boolean;
  onClick?: () => void;
}

export function MobileTierPills({ pills }: { pills: MobileTierPill[] }) {
  return (
    <div className="m-tiers" role="group" aria-label="Filter by confidence tier">
      {pills.map((p) => (
        <button key={p.id} type="button" className={`m-tier ${p.active ? 'is-active' : ''}`} onClick={p.onClick} aria-pressed={p.active}>
          {p.label}
          {p.rate != null && Number(p.rate) > 0 ? <span className="m-tier-rate">{p.rate}%</span> : null}
        </button>
      ))}
    </div>
  );
}

export function MobileStatBoxes({ stats }: { stats: MobileStatBox[] }) {
  return (
    <div className="m-stats" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
      {stats.map((s) => (
        <button
          key={s.key}
          type="button"
          className={`m-stat ${s.tone ? `is-${s.tone}` : ''} ${s.active ? 'is-active' : ''}`}
          onClick={s.onClick}
        >
          <small>{s.label}</small>
          <b>{s.value}</b>
        </button>
      ))}
    </div>
  );
}

export interface MobileHeadingOption {
  value: string;
  label: string;
}

export function MobileHubHeading({
  title,
  live,
  onLiveClick,
  liveActive,
  pickerValue,
  pickerOptions,
  onPickerChange,
  pickerAllLabel,
  pickerAriaLabel,
}: {
  title: string;
  live?: number;
  onLiveClick?: () => void;
  liveActive?: boolean;
  pickerValue: string;
  pickerOptions: MobileHeadingOption[];
  onPickerChange: (value: string) => void;
  /** Short label shown on the chip when nothing is picked, e.g. "All leagues". */
  pickerAllLabel: string;
  pickerAriaLabel: string;
}) {
  const current = pickerOptions.find((o) => o.value === pickerValue);
  const chipLabel = pickerValue === 'all' ? pickerAllLabel : (current?.label.replace(/\s*\(\d+\)$/, '') || pickerAllLabel);
  return (
    <div className="m-sec">
      <h2 className="m-sec-title">{title}</h2>
      <div className="m-sec-right">
        {live != null && live > 0 && (
          <button type="button" className={`m-live ${liveActive ? 'is-active' : ''}`} onClick={onLiveClick}>
            <i aria-hidden="true" />
            {live} live
          </button>
        )}
        <label className="m-league">
          <span>{chipLabel}</span>
          <span aria-hidden="true">▾</span>
          <select value={pickerValue} onChange={(e) => onPickerChange(e.target.value)} aria-label={pickerAriaLabel}>
            {pickerOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/** "Today", "Yesterday", "All dates" or "Sat 15 Nov" for a selected ISO date. */
export function dayHeadingLabel(selected: string, todayIso: string, yesterdayIso: string): string {
  if (selected === 'all') return 'All dates';
  if (selected === todayIso) return 'Today';
  if (selected === yesterdayIso) return 'Yesterday';
  const [y, m, d] = selected.split('-').map(Number);
  if (!y || !m || !d) return selected;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}
