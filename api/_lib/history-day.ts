// Past-day reads for the basketball and tennis feeds.
//
// The main feeds come from a pre-built snapshot that starts at yesterday 00:00 UTC (it has to stay
// small: every snapshot read is Supabase egress). The date picker on the basketball and tennis pages
// offers 30 days back, so older days were always empty. With ?date=YYYY-MM-DD the feed loads just that
// one local day straight from the tables, and because a past day hardly changes it is cached for hours.

export const HISTORY_MAX_DAYS = 35;

/** Accepts YYYY-MM-DD between HISTORY_MAX_DAYS ago and today (UTC, one day of slack for time zones). */
export function parseHistoryDate(raw: string | null | undefined, now: Date = new Date()): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const check = new Date(t);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayMs = 86400000;
  if (t > todayUtc + dayMs) return null;
  if (t < todayUtc - HISTORY_MAX_DAYS * dayMs) return null;
  return raw;
}

/** Minutes the time zone is ahead of UTC at a given instant. */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

function localMidnightUtc(y: number, m: number, d: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d);
  let ts = guess - tzOffsetMinutes(tz, new Date(guess)) * 60000;
  // Second pass so a DST change on that day lands on the right side.
  ts = guess - tzOffsetMinutes(tz, new Date(ts)) * 60000;
  return ts;
}

/** UTC window [start, end) of one calendar day in the given time zone. */
export function localDayWindow(date: string, tz: string): { start: string; end: string; endMs: number } {
  const [y, m, d] = date.split('-').map(Number);
  const startMs = localMidnightUtc(y, m, d, tz);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const endMs = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz);
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), endMs };
}

/** A day that ended 6h+ ago is settled history: cache it long. Otherwise use the normal feed TTL. */
export function isClosedDay(endMs: number, now: number = Date.now()): boolean {
  return endMs < now - 6 * 3600 * 1000;
}

export const HISTORY_FRESH_MS = 6 * 3600 * 1000;
export const HISTORY_STALE_MS = 24 * 3600 * 1000;
export const HISTORY_PUBLIC_CACHE = 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400';
export const HISTORY_CDN_CACHE = 'public, s-maxage=21600, stale-while-revalidate=86400';
