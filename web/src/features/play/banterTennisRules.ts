/** Banter Hub tennis helpers (pure, no network). */

/** Tennis matches that are open for picks: scheduled only. */
export const TENNIS_OPEN_STATUS = 'scheduled';

export function tennisPickLabel(selection: 'p1' | 'p2', player1?: string | null, player2?: string | null): string {
  const name = selection === 'p1' ? player1 : player2;
  return `${name || (selection === 'p1' ? 'Player 1' : 'Player 2')} to win`;
}
