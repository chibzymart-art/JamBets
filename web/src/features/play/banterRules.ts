/**
 * Banter Hub rules in one place. Scoring is used by the settle step and leaderboard (later changes);
 * the owner has not yet confirmed 3 vs 10 points for a correct pick, so change it here only.
 */

export const BANTER_POINTS = {
  won: 3,
  lost: 0,
  void: 0.5,
} as const;

/** Picks close this many seconds before kickoff (matches the database check). */
export const PICK_LOCK_SECONDS = 60;

export type FootballMarket = '1X2' | 'OU25' | 'BTTS';

export const FOOTBALL_MARKETS: { id: FootballMarket; label: string; options: { value: string; label: string }[] }[] = [
  {
    id: '1X2',
    label: 'Match result',
    options: [
      { value: 'home', label: 'Home' },
      { value: 'draw', label: 'Draw' },
      { value: 'away', label: 'Away' },
    ],
  },
  {
    id: 'OU25',
    label: 'Goals 2.5',
    options: [
      { value: 'over', label: 'Over' },
      { value: 'under', label: 'Under' },
    ],
  },
  {
    id: 'BTTS',
    label: 'Both teams score',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
  },
];

/**
 * Leagues ticked by default (owner): England Premier League, Spain La Liga, Italy Serie A,
 * France Ligue 1, Germany Bundesliga. Codes are football_leagues.code as seeded from
 * python/src/config.py.
 */
export const DEFAULT_LEAGUE_CODES = ['ENG_PL', 'ESP_LL', 'ITA_SA', 'FRA_L1', 'GER_BL'];

/** Ticked leagues to use: the member's saved ticks, else the defaults. */
export function initialLeagueTicks(saved: string[] | null | undefined): string[] {
  return saved && saved.length ? saved : DEFAULT_LEAGUE_CODES;
}

/** Plain label for a pick, e.g. "Over 2.5" or "Home". */
export function selectionLabel(market: string, selection: string, home?: string, away?: string): string {
  if (market === '1X2') {
    if (selection === 'home') return home ? `${home} win` : 'Home win';
    if (selection === 'away') return away ? `${away} win` : 'Away win';
    return 'Draw';
  }
  if (market === 'OU25') return selection === 'over' ? 'Over 2.5 goals' : 'Under 2.5 goals';
  if (market === 'BTTS') return selection === 'yes' ? 'Both teams score: Yes' : 'Both teams score: No';
  return selection;
}

/** "Locks in 2h 05m", "Locks in 4m", or null once locked. */
export function lockLabel(kickoffIso: string, nowMs: number): string | null {
  const lockAt = new Date(kickoffIso).getTime() - PICK_LOCK_SECONDS * 1000;
  const ms = lockAt - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'Locks in under a minute';
  if (mins < 60) return `Locks in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return `Locks in ${h}h ${String(m).padStart(2, '0')}m`;
  return `Locks in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Error code from the pick RPCs → plain message. */
export function pickErrorMessage(code: string): string {
  switch (code) {
    case 'pick_locked':
      return 'This match has locked. Picks close a minute before kickoff.';
    case 'fixture_not_pickable':
      return "This match isn't open for picks.";
    case 'no_profile':
      return 'Choose a username first.';
    case 'no_access':
      return 'Banter Hub is for paid members. Upgrade to keep picking.';
    case 'not_signed_in':
      return 'Please sign in again.';
    default:
      return "Couldn't save that pick. Please try again.";
  }
}
