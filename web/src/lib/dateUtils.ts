/**
 * Date utilities for Oddsbanta predictions
 * Centralized WAT (Africa/Lagos) formatting for deterministic calendar ribbons & date navigation
 */

export interface DateDetails {
  iso: string;           // '2026-09-15'
  dayName: string;       // 'Wednesday'
  shortDay: string;      // 'Wed'
  dateFormatted: string; // '16 Sep'
  fullLabel: string;     // 'Wed (16 Sep)'
  subLabel: string;      // '16 Sep'
  formatted: string;     // 'Wed 16 Sep'
  longFormatted: string; // 'Wed, 16 Sep 2026'
  offsetDays: number;
}

export interface PastDateOption {
  iso: string;
  formatted: string;     // 'Sun, 13 Sep 2026'
  shortFormatted: string;// 'Sun 13 Sep'
  count?: number;
}

export const getLagosDateParts = (): [number, number, number] => {
  const lagosParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  return lagosParts.split('-').map(Number) as [number, number, number];
};

export const getDateDetailsByOffset = (offsetDays: number): DateDetails => {
  const [year, month, day] = getLagosDateParts();
  const d = new Date(Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0));
  const iso = d.toISOString().split('T')[0];

  const weekdayLong = d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long' });
  const weekdayShort = d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' });
  const dateFormatted = d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const formatted = `${weekdayShort} ${dateFormatted}`;
  const fullLabel = `${weekdayShort} (${dateFormatted})`;
  const longFormatted = d.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  return {
    iso,
    dayName: weekdayLong,
    shortDay: weekdayShort,
    dateFormatted,
    fullLabel,
    subLabel: dateFormatted,
    formatted,
    longFormatted,
    offsetDays
  };
};

export const getTodayIsoDate = (): string => getDateDetailsByOffset(0).iso;
export const getYesterdayIsoDate = (): string => getDateDetailsByOffset(-1).iso;
export const getTomorrowIsoDate = (): string => getDateDetailsByOffset(1).iso;

/**
 * Generates all past dates starting from yesterday going back maxDays (default 30 days)
 * Merges any extra known fixture past dates, sorted descending (newest past date first)
 */
export const getPastDatesList = (
  maxDays = 30,
  extraIsoDates: string[] = []
): PastDateOption[] => {
  const todayIso = getTodayIsoDate();
  const pastMap = new Map<string, PastDateOption>();

  // 1. Generate past 30 days
  for (let i = 1; i <= maxDays; i++) {
    const details = getDateDetailsByOffset(-i);
    pastMap.set(details.iso, {
      iso: details.iso,
      formatted: details.longFormatted,
      shortFormatted: details.formatted,
    });
  }

  // 2. Merge any extra past dates (e.g. from fixtures database) that are < todayIso
  for (const iso of extraIsoDates) {
    if (iso && iso < todayIso && !pastMap.has(iso)) {
      try {
        const [y, m, d] = iso.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        const longFormatted = dt.toLocaleDateString('en-GB', {
          timeZone: 'UTC',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
        const shortFormatted = dt.toLocaleDateString('en-GB', {
          timeZone: 'UTC',
          weekday: 'short',
          day: 'numeric',
          month: 'short'
        });
        pastMap.set(iso, { iso, formatted: longFormatted, shortFormatted });
      } catch {}
    }
  }

  return Array.from(pastMap.values()).sort((a, b) => b.iso.localeCompare(a.iso));
};

export const formatKickoff = (isoString: string) => {
  const d = new Date(isoString);
  return {
    timeStr: d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false }),
    dateStr: d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', month: 'short', day: 'numeric' })
  };
};

/**
 * Extract YYYY-MM-DD date strictly in Africa/Lagos (WAT / UTC+1) timezone
 */
export const getFixtureWatDate = (targetKickoffIso?: string | null): string => {
  if (!targetKickoffIso) return '';
  try {
    const d = new Date(targetKickoffIso);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
  } catch {
    return '';
  }
};

