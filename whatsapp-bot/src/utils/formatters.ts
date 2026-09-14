/**
 * Formats market names and outcomes cleanly for WhatsApp
 */
export function formatMarketName(market: string): string {
  if (!market) return '';
  const m = market.toLowerCase();
  if (m === '1x2') return 'Match Winner';
  if (m === 'double_chance') return 'Double Chance';
  if (m.startsWith('over_under_')) return `Total Goals (${market.replace('over_under_', '')})`;
  if (m === 'btts') return 'Both Teams To Score';
  if (m === 'ht_over_0.5_goals') return '1st Half Over 0.5';
  if (m === 'over_2.5_goals') return 'Over 2.5 Goals';
  return market.replace(/_/g, ' ').toUpperCase();
}

export function formatOutcome(outcome: string): string {
  if (!outcome) return '';
  const o = outcome.toLowerCase();
  if (o === '1' || o === 'home') return 'Home Win';
  if (o === '2' || o === 'away') return 'Away Win';
  if (o === 'x' || o === 'draw') return 'Draw';
  if (o === '1x') return 'Home or Draw (1X)';
  if (o === 'x2') return 'Away or Draw (X2)';
  if (o === '12') return 'Home or Away (12)';
  if (o === 'yes') return 'Yes (GG)';
  if (o === 'no') return 'No (NG)';
  if (o === 'over') return 'Over';
  if (o === 'under') return 'Under';
  return outcome.toUpperCase();
}

export function formatKickoffTime(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', {
      timeZone: 'Africa/Lagos',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return '';
  }
}
