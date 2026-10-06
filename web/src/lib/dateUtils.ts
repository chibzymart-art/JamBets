import { useState, useEffect } from 'react';

/**
 * Date and Time utilities for Oddsbanta predictions
 * Dynamic visitor local timezone detection with seamless fallback to WAT (Africa/Lagos)
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

const TIMEZONE_STORAGE_KEY = 'oddsbanta_timezone_preference';

/**
 * Detect the visitor's local timezone via browser Intl API or user manual override.
 * Defaults to 'Africa/Lagos' when executed server-side or if browser Intl is unavailable.
 */
export const getUserTimeZone = (): string => {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(TIMEZONE_STORAGE_KEY);
      if (saved) return saved;
    } catch {}
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) return detected;
    } catch {}
  }
  return 'Africa/Lagos';
};

/**
 * Return a clean, user-friendly timezone abbreviation (e.g. WAT, BST, EDT, CEST, JST, etc.)
 */
export const getTimeZoneAbbreviation = (tz?: string): string => {
  const targetTz = tz || getUserTimeZone();
  if (targetTz === 'Africa/Lagos') return 'WAT';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: targetTz, timeZoneName: 'short' }).formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (tzPart && !tzPart.startsWith('GMT') && !tzPart.startsWith('UTC')) return tzPart;

    const map: Record<string, string> = {
      'Europe/London': 'BST',
      'Europe/Paris': 'CEST',
      'Europe/Berlin': 'CEST',
      'Europe/Madrid': 'CEST',
      'Europe/Rome': 'CEST',
      'Europe/Amsterdam': 'CEST',
      'America/New_York': 'EDT',
      'America/Chicago': 'CDT',
      'America/Denver': 'MDT',
      'America/Los_Angeles': 'PDT',
      'America/Toronto': 'EDT',
      'America/Vancouver': 'PDT',
      'Asia/Tokyo': 'JST',
      'Asia/Dubai': 'GST',
      'Africa/Johannesburg': 'SAST',
      'Africa/Cairo': 'EEST',
      'Africa/Accra': 'GMT',
      'Africa/Nairobi': 'EAT',
      'Australia/Sydney': 'AEST',
    };
    return map[targetTz] || tzPart || targetTz;
  } catch {
    return targetTz;
  }
};

/**
 * React hook for dynamic visitor timezone subscription and broadcast sync
 */
export function useUserTimeZone() {
  const [timeZone, setTimeZoneState] = useState<string>(getUserTimeZone);

  useEffect(() => {
    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        setTimeZoneState(customEvent.detail);
      }
    };
    window.addEventListener('oddsbanta_timezone_change', handleSync);
    return () => {
      window.removeEventListener('oddsbanta_timezone_change', handleSync);
    };
  }, []);

  const setTimeZone = (newTz: string) => {
    setTimeZoneState(newTz);
    try {
      localStorage.setItem(TIMEZONE_STORAGE_KEY, newTz);
      window.dispatchEvent(new CustomEvent('oddsbanta_timezone_change', { detail: newTz }));
    } catch {}
  };

  const timeZoneAbbr = getTimeZoneAbbreviation(timeZone);

  return { timeZone, timeZoneAbbr, setTimeZone };
}

/**
 * Extract [year, month, day] in the visitor's local timezone
 */
export const getUserLocalDateParts = (timeZone?: string): [number, number, number] => {
  const tz = timeZone || getUserTimeZone();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return parts.split('-').map(Number) as [number, number, number];
  } catch {
    const now = new Date();
    return [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  }
};

// Backward-compatible alias
export const getLagosDateParts = getUserLocalDateParts;

export const getDateDetailsByOffset = (offsetDays: number, timeZone?: string): DateDetails => {
  const tz = timeZone || getUserTimeZone();
  const [year, month, day] = getUserLocalDateParts(tz);
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
    year: 'numeric',
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
    offsetDays,
  };
};

export const getTodayIsoDate = (timeZone?: string): string => getDateDetailsByOffset(0, timeZone).iso;
export const getYesterdayIsoDate = (timeZone?: string): string => getDateDetailsByOffset(-1, timeZone).iso;
export const getTomorrowIsoDate = (timeZone?: string): string => getDateDetailsByOffset(1, timeZone).iso;

/**
 * Generates all past dates starting from yesterday going back maxDays (default 30 days)
 * Merges any extra known fixture past dates, sorted descending (newest past date first)
 */
export const getPastDatesList = (
  maxDays = 30,
  extraIsoDates: string[] = [],
  timeZone?: string
): PastDateOption[] => {
  const todayIso = getTodayIsoDate(timeZone);
  const pastMap = new Map<string, PastDateOption>();

  // 1. Generate past 30 days
  for (let i = 1; i <= maxDays; i++) {
    const details = getDateDetailsByOffset(-i, timeZone);
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
          year: 'numeric',
        });
        const shortFormatted = dt.toLocaleDateString('en-GB', {
          timeZone: 'UTC',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });
        pastMap.set(iso, { iso, formatted: longFormatted, shortFormatted });
      } catch {}
    }
  }

  return Array.from(pastMap.values()).sort((a, b) => b.iso.localeCompare(a.iso));
};

export const formatKickoff = (isoString: string | Date, timeZone?: string) => {
  const tz = timeZone || getUserTimeZone();
  const abbr = getTimeZoneAbbreviation(tz);
  const d = typeof isoString === 'string' ? new Date(isoString) : isoString;
  const timeStr = isNaN(d.getTime())
    ? '--:--'
    : d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const dateStr = isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { timeZone: tz, month: 'short', day: 'numeric' });
  return {
    timeStr,
    dateStr,
    timeZoneAbbr: abbr,
    fullFormatted: `${timeStr} ${abbr}`,
  };
};

/**
 * Format card kickoff date & time (e.g. "Thu, Sep 10, 12:30 AM (EDT)" or "Thu, Sep 10, 5:30 AM (WAT)")
 */
export const formatCardKickoff = (isoString: string | Date, timeZone?: string): string => {
  const tz = timeZone || getUserTimeZone();
  const abbr = getTimeZoneAbbreviation(tz);
  const d = typeof isoString === 'string' ? new Date(isoString) : isoString;
  if (isNaN(d.getTime())) return 'Kickoff TBA';

  const datePart = d.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timePart = d.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart}, ${timePart} (${abbr})`;
};

/**
 * Relative date & time format for Goal Specialist cards (e.g. "Today • 19:45 WAT" or "Tomorrow • 14:30 EDT")
 */
export const formatFullKickoff = (isoDate: string | Date, timeZone?: string): string => {
  try {
    const tz = timeZone || getUserTimeZone();
    const abbr = getTimeZoneAbbreviation(tz);
    const d = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
    if (isNaN(d.getTime())) return 'Kickoff TBA';
    const now = new Date();

    const dLocalDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);

    const todayLocalDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const tomorrowLocalDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(now.getTime() + 86400000));

    const timeStr = d.toLocaleTimeString('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    if (dLocalDate === todayLocalDate) {
      return `Today • ${timeStr} ${abbr}`;
    }
    if (dLocalDate === tomorrowLocalDate) {
      return `Tomorrow • ${timeStr} ${abbr}`;
    }

    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(d);

    return `${dayName} • ${timeStr} ${abbr}`;
  } catch {
    return 'Kickoff TBA';
  }
};

/**
 * Extract YYYY-MM-DD date strictly in visitor's local timezone
 */
export const getFixtureLocalDate = (targetKickoffIso?: string | null, timeZone?: string): string => {
  if (!targetKickoffIso) return '';
  try {
    const d = new Date(targetKickoffIso);
    if (isNaN(d.getTime())) return '';
    const tz = timeZone || getUserTimeZone();
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return '';
  }
};

// Backward-compatible alias
export const getFixtureWatDate = getFixtureLocalDate;
