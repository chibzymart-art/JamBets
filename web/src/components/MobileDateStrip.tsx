import { useEffect, useMemo, useState } from 'react';
import { getDateDetailsByOffset } from '../lib/dateUtils';
import './mobile-date-strip.css';

/**
 * Phone-only date row (two-hub prototype): [‹] 4 day chips [›] [📅].
 * Presentation only. The parent hub keeps its own selected-date state and fetch logic;
 * this just calls onSelect with the same ISO date (or 'all') its existing pills use.
 */
export interface MobileDateStripProps {
  /** Selected ISO date ('YYYY-MM-DD') or 'all'. */
  selected: string;
  onSelect: (value: string) => void;
  /** Visitor timezone used by the parent's own date tabs. */
  timeZone?: string;
  /** Oldest day reachable, as a negative offset from today (e.g. -90). */
  minOffset: number;
  /** Furthest future day the hub's existing bar offers (e.g. 4). */
  maxOffset: number;
  /** Optional match count per ISO date, shown under the date when known. */
  countFor?: (iso: string) => number | undefined;
  /** Show "All upcoming dates" in the calendar dropdown. */
  allowAll?: boolean;
}

const CHIPS = 4;

const dayDiff = (iso: string, todayIso: string) => {
  const [y1, m1, d1] = iso.split('-').map(Number);
  const [y2, m2, d2] = todayIso.split('-').map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
};

export function MobileDateStrip({
  selected, onSelect, timeZone, minOffset, maxOffset, countFor, allowAll = true,
}: MobileDateStripProps) {
  const todayIso = getDateDetailsByOffset(0, timeZone).iso;
  const lastStart = Math.max(minOffset, maxOffset - (CHIPS - 1));
  const clampStart = (s: number) => Math.min(Math.max(s, minOffset), lastStart);

  const selectedOffset = selected && selected !== 'all' && /^\d{4}-\d{2}-\d{2}$/.test(selected)
    ? dayDiff(selected, todayIso)
    : null;

  // Default window: Yesterday, Today, +1, +2.
  const [start, setStart] = useState(() => clampStart(-1));

  // Keep the selected date visible when it changes from elsewhere (calendar, desktop bar, URL).
  useEffect(() => {
    if (selectedOffset == null) return;
    setStart((s) => {
      if (selectedOffset >= s && selectedOffset < s + CHIPS) return s;
      return clampStart(selectedOffset < s ? selectedOffset : selectedOffset - (CHIPS - 1));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOffset, minOffset, maxOffset]);

  const chips = useMemo(
    () => Array.from({ length: CHIPS }, (_, i) => getDateDetailsByOffset(start + i, timeZone)),
    [start, timeZone],
  );

  const pastOptions = useMemo(() => {
    const out: { iso: string; label: string }[] = [];
    for (let o = -1; o >= minOffset; o--) {
      const d = getDateDetailsByOffset(o, timeZone);
      out.push({ iso: d.iso, label: o === -1 ? `Yesterday · ${d.formatted}` : d.formatted });
    }
    return out;
  }, [minOffset, timeZone]);

  const canBack = start > minOffset;
  const canNext = start < lastStart;
  const calendarValue = selected === 'all' ? 'all' : pastOptions.some((p) => p.iso === selected) ? selected : '';

  return (
    <div className="mds" role="group" aria-label="Choose a date">
      <button
        type="button"
        className="mds-arrow"
        onClick={() => setStart((s) => clampStart(s - 1))}
        disabled={!canBack}
        aria-label="Earlier dates"
      >
        ‹
      </button>

      <div className="mds-chips">
        {chips.map((d) => {
          const label = d.offsetDays === -1 ? 'Yesterday' : d.offsetDays === 0 ? 'Today' : d.shortDay;
          const count = countFor?.(d.iso);
          const active = selected === d.iso;
          return (
            <button
              key={d.iso}
              type="button"
              className={`mds-chip ${active ? 'is-active' : ''}`}
              onClick={() => onSelect(d.iso)}
              aria-pressed={active}
              title={count ? `${d.longFormatted} · ${count} matches` : d.longFormatted}
            >
              <span className={`mds-chip-label ${label.length > 6 ? 'mds-chip-label--long' : ''}`}>{label}</span>
              <span className="mds-chip-sub">{d.dateFormatted}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="mds-arrow"
        onClick={() => setStart((s) => clampStart(s + 1))}
        disabled={!canNext}
        aria-label="Later dates"
      >
        ›
      </button>

      <label
        className={`mds-cal ${selected === 'all' || (selectedOffset != null && selectedOffset < -1) ? 'is-active' : ''}`}
        title="Past dates and all dates"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <rect x="2.5" y="3.5" width="13" height="12" rx="2" />
          <path d="M2.5 7.5h13M6 2v3M12 2v3" />
        </svg>
        <select
          className="mds-cal-select"
          value={calendarValue}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value);
          }}
          aria-label="Pick a past date"
        >
          <option value="" disabled>Pick a date…</option>
          {allowAll && <option value="all">All upcoming dates</option>}
          {pastOptions.map((p) => (
            <option key={p.iso} value={p.iso}>{p.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
