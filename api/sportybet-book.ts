// POST /api/sportybet-book: turns the picks on a user's slip into a SportyBet booking code.
// Body: { items: [{ id?, homeTeam, awayTeam, targetKickoffAt, market, prediction }] } (max 50).
// The slip only holds picks the user can already see, so the code reveals nothing new.
// A booking code stakes nothing; see api/_lib/sportybet-booking.ts.
import { bookLegsCached, MAX_LEGS, type BookingLeg } from './_lib/sportybet-booking';
import { checkRateLimit, getClientIp } from './rate-limiter';

export const config = {
  runtime: 'edge',
  regions: ['cpt1'],
};

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Slip item -> booking leg. Raw keys in the item id ("<fixture>::over_2.5_goals::OVER_2.5") win over labels. */
export function itemToLeg(item: any): BookingLeg | null {
  if (!item || typeof item !== 'object') return null;
  const home = String(item.homeTeam || '').slice(0, 80).trim();
  const away = String(item.awayTeam || '').slice(0, 80).trim();
  const kickoffIso = String(item.targetKickoffAt || '').slice(0, 40);
  if (!home || !away || !Number.isFinite(Date.parse(kickoffIso))) return null;
  const idParts = String(item.id || '').split('::');
  const market = String(idParts.length === 3 ? idParts[1] : item.market || '').slice(0, 80);
  const pick = String(idParts.length === 3 ? idParts[2] : item.prediction || '').slice(0, 80);
  return {
    home,
    away,
    kickoffIso,
    market,
    pick,
    label: `${String(item.prediction || pick).slice(0, 60)}`,
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'Use POST.' });

  const rl = checkRateLimit(`sportybet-book:${getClientIp(req)}`, 6, 60);
  if (!rl.allowed) return reply(429, { ok: false, error: `Too many booking requests. Try again in ${rl.resetSec}s.` });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply(400, { ok: false, error: 'Invalid request.' });
  }
  const items: any[] = Array.isArray(body?.items) ? body.items.slice(0, MAX_LEGS) : [];
  const legs = items.map(itemToLeg).filter((l): l is BookingLeg => !!l);
  if (!legs.length) return reply(400, { ok: false, error: 'Add football picks to your slip first.' });

  const key = legs
    .map(l => `${l.home}|${l.away}|${l.kickoffIso}|${l.market}|${l.pick}`)
    .sort()
    .join(';');
  const result = await bookLegsCached(key, legs);

  return reply(200, {
    ok: result.ok,
    code: result.code,
    url: result.url,
    totalOdds: result.totalOdds,
    booked: result.booked.length,
    skipped: result.skipped.map(s => ({ match: `${s.leg.home} vs ${s.leg.away}`, pick: s.leg.label, reason: s.reason })),
    error: result.error,
  });
}
