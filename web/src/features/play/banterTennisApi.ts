import { call } from './banterApi';

/** Banter Hub tennis calls (match winner). Kept apart from banterApi.ts so each sport stays separate. */

export interface BanterTennisMatch {
  fixture_id: string;
  kickoff_at: string;
  status: string;
  tournament_name: string;
  tour: string;
  category: string;
  round: string;
  player1: string | null;
  player2: string | null;
  p1_sets: number | null;
  p2_sets: number | null;
  winner: 'p1' | 'p2' | null;
}

export interface BanterTennisPick {
  id: string;
  fixture_id: string;
  selection: 'p1' | 'p2';
  kickoff_at: string;
  status: 'pending' | 'won' | 'lost' | 'void';
  points: number | null;
  settled_at: string | null;
  fixture_status: string;
  tournament_name: string | null;
  player1: string | null;
  player2: string | null;
  p1_sets: number | null;
  p2_sets: number | null;
}

export const fetchTennisMatches = (date: string, tz: string) =>
  call<BanterTennisMatch[]>('banter_tennis_fixtures', { p_date: date, p_tz: tz });

export const submitTennisPick = (fixtureId: string, selection: 'p1' | 'p2') =>
  call<{ id: string }>('banter_submit_tennis_pick', { p_fixture_id: fixtureId, p_selection: selection });

export const cancelTennisPick = (fixtureId: string) =>
  call<boolean>('banter_cancel_tennis_pick', { p_fixture_id: fixtureId });

export const fetchMyTennisPicks = (date: string | null, tz: string) =>
  call<BanterTennisPick[]>('banter_my_tennis_picks', { p_date: date, p_tz: tz });

export { TENNIS_OPEN_STATUS, tennisPickLabel } from './banterTennisRules';
