/** My Picks rows for every sport (pure, no network). */
import type { BanterPick } from './banterApi';
import type { BanterTennisPick } from './banterTennisApi';
import { selectionLabel } from './banterRules';
import { tennisPickLabel } from './banterTennisRules';

const MARKET_NAME: Record<string, string> = { '1X2': 'Match result', OU25: 'Goals 2.5', BTTS: 'Both teams score' };
export const STATUS_TEXT: Record<BanterPick['status'], string> = { pending: 'Pending', won: '✓ Won', lost: '✗ Lost', void: '⊘ Void' };

/** One row on My Picks, whatever the sport. */
export interface PickRow {
  id: string;
  sport: 'football' | 'tennis';
  meta: string;
  kickoff_at: string;
  left: string;
  right: string;
  score: string | null;
  market: string;
  pick: string;
  status: BanterPick['status'];
  points: number | null;
}

export function footballRow(p: BanterPick): PickRow {
  return {
    id: `f-${p.id}`,
    sport: 'football',
    meta: `${p.league_country || ''} · ${p.league_name || ''}`,
    kickoff_at: p.kickoff_at,
    left: p.home_team || 'Home',
    right: p.away_team || 'Away',
    score: p.home_score != null && p.away_score != null ? `${p.home_score} – ${p.away_score}` : null,
    market: MARKET_NAME[p.market] || p.market,
    pick: selectionLabel(p.market, p.selection, p.home_team || undefined, p.away_team || undefined),
    status: p.status,
    points: p.points,
  };
}

export function tennisRow(p: BanterTennisPick): PickRow {
  return {
    id: `t-${p.id}`,
    sport: 'tennis',
    meta: `Tennis · ${p.tournament_name || ''}`,
    kickoff_at: p.kickoff_at,
    left: p.player1 || 'Player 1',
    right: p.player2 || 'Player 2',
    score: p.p1_sets != null && p.p2_sets != null ? `${p.p1_sets} – ${p.p2_sets}` : null,
    market: 'Match winner',
    pick: tennisPickLabel(p.selection, p.player1, p.player2),
    status: p.status,
    points: p.points,
  };
}

/** Newest first across sports. */
export function mergePickRows(rows: PickRow[]): PickRow[] {
  return [...rows].sort((a, b) => new Date(b.kickoff_at).getTime() - new Date(a.kickoff_at).getTime());
}
