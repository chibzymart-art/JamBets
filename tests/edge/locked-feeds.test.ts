// Behaviour test for Edge feed redaction (Phase 1).
// Runs the real handlers against a mocked Supabase whose rows carry sensitive fields,
// and checks what a visitor, an expired user and a trial user receive.
// Run: node tests/edge/run.mjs
import tennis from '../../api/tennis-feed';
import goals from '../../api/goals-feed';
import market from '../../api/market-feed';

const SECRET = 'SECRET_PICK_DETAIL';
const VIP_MARK = 'VIPTOKEN';
const MARKET_ALLOWED = new Set(['id','fixture_id','market','market_category','market_label','market_icon','target_kickoff_at','fixture','is_locked','prediction','probability','display_probability','confidence_tier','confidence_category','metrics','tactical_rationale','tactical_tag','settlement_status','settlement_notes','settled_at','ht_score','actual_score','actual_corners','metadata']);
const kickoff = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
const fixture = { id: 'f1', status: 'scheduled', target_kickoff_at: kickoff, metadata: { internal: SECRET },
  league: { id: 'l1', code: 'ENG_PL', name: 'Premier League', country: 'England' },
  home_team: { id: 'h', name: 'home' }, away_team: { id: 'a', name: 'away' },
  player1: { id: 'p1', display_name: 'A' }, player2: { id: 'p2', display_name: 'B' }, tournament: { id: 't1', name: 'T' } };

const tennisRow = { id: 'tp1', fixture_id: 'f1', fixture, market: 'match_winner', prediction: 'A to win', probability: 0.81,
  confidence_category: 'TOP PICK', fair_odds: 1.2, market_odds: 1.3, settlement_status: 'pending', target_kickoff_at: kickoff,
  secondary_predictions: [{ market: 'set_handicap', prediction: SECRET }], simulations_count: 250000, tier_required: 'bigbang',
  publication_status: 'published', metadata: { surface: 'hard_outdoor', court_pace_index: 37.5, tactical_reasoning: SECRET,
  elo_delta: 458, p1_hold_rate: 0.78, correct_set_scores: { '2-0': 0.56 }, markov: { x: SECRET } } };

const goalsRow = { id: 'g1', fixture_id: 'f1', fixture, market: 'over_2.5_goals', predicted_outcome: 'Over 2.5', probability: 0.77,
  confidence_tier: 'BANGER', xg_combined: 3.4, home_over25_rate: 71, away_over25_rate: 66, h2h_over25_rate: 80, ht_goal_frequency: 79,
  avg_first_goal_minute: 21, target_kickoff_at: kickoff, settlement_status: 'pending', publication_status: 'published',
  metadata: { reasoning: SECRET } };

const drawRow = { id: 'd1', fixture_id: 'f1', fixture, market: 'draw', prediction: 'Draw', probability: 0.41,
  confidence_category: 'BANGER', stalemate_tier: 'HIGH', tactical_equilibrium_score: 0.9, low_scoring_density: 0.8,
  settlement_status: 'pending', publication_status: 'published', target_kickoff_at: kickoff, metadata: { reasoning: SECRET } };

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const auth = String(init?.headers?.Authorization || init?.headers?.authorization || '');
  const isVip = auth.includes(VIP_MARK);
  if (url.includes('/auth/v1/user')) {
    // VIP account is old (no trial); trial account was created just now.
    const created = isVip ? new Date(Date.now() - 90 * 864e5).toISOString() : new Date().toISOString();
    return json({ id: isVip ? 'vip1' : 'u1', email: isVip ? 'vip@example.com' : 'trial@example.com', created_at: created, app_metadata: {} });
  }
  if (url.includes('rpc/get_user_session_bootstrap') && isVip) {
    return json({ user: { role: 'bigbang' }, subscription: { tier: 'bigbang', status: 'active', current_period_end: null }, entitlement: null });
  }
  if (url.includes('cached_feeds')) {
    if (url.includes('feed:tennis')) return json([{ payload: { predictions: [tennisRow], tournaments: [], settlements: [], stats: {} }, updated_at: new Date().toISOString() }]);
    if (url.includes('feed:goals')) return json([{ payload: { predictions: [goalsRow], leagues: [] }, updated_at: new Date().toISOString() }]);
    return json([]);
  }
  if (url.includes('rpc/get_user_session_bootstrap')) return json({ user: null, subscription: null, entitlement: null });
  if (url.includes('draw_predictions')) return json([drawRow]);
  if (url.includes('goals_predictions')) return json([goalsRow]);
  if (url.includes('/rest/v1/')) return json([]);
  return json({}, 404);
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
let ip = 1;
const call = async (handler: any, path: string, token?: string) => {
  const headers: Record<string, string> = { 'user-agent': UA, origin: 'https://www.oddsbanta.com', 'x-forwarded-for': `10.0.0.${ip++}` };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await handler(new Request(`https://www.oddsbanta.com${path}`, { headers }));
  return { status: res.status, body: await res.json() };
};

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
  if (!ok) failures++;
};
const fakeJwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

(async () => {
  // Tennis, visitor
  const tv = await call(tennis, '/api/tennis-feed');
  const tvp = (tv.body.predictions || [])[0] || {};
  const tvs = JSON.stringify(tv.body);
  check('tennis visitor: request ok', tv.status === 200, String(tv.status));
  check('tennis visitor: item locked', tvp.is_locked === true && tvp.probability === null);
  check('tennis visitor: no model detail anywhere', !tvs.includes(SECRET) && !tvs.includes('tactical_reasoning') && !tvs.includes('elo_delta') && !tvs.includes('correct_set_scores') && !tvs.includes('hold_rate'), tvs.slice(0, 300));
  check('tennis visitor: keeps surface for the card', tvp.metadata?.surface === 'hard_outdoor');

  // Goals, visitor and trial
  const gv = await call(goals, '/api/goals-feed');
  const gvs = JSON.stringify(gv.body);
  const gvp = (gv.body.predictions || [])[0] || {};
  check('goals visitor: request ok', gv.status === 200, String(gv.status));
  check('goals visitor: item locked', gvp.is_locked === true && gvp.probability === null);
  check('goals visitor: no xG or Over 2.5 rates', !('xg_combined' in gvp) && !('home_over25_rate' in gvp) && !('ht_goal_frequency' in gvp), JSON.stringify(gvp).slice(0, 300));
  check('goals visitor: no secret anywhere', !gvs.includes(SECRET), gvs.slice(0, 300));
  const gt = await call(goals, '/api/goals-feed', fakeJwt({ sub: 'u1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const gtp = (gt.body.predictions || [])[0] || {};
  check('goals trial: full item still delivered', gtp.is_locked !== true && gtp.xg_combined === 3.4, JSON.stringify({is_locked: gtp.is_locked, xg: gtp.xg_combined, auth: gt.body.auth_status}));

  // Market, visitor on a membership market (draw)
  const mv = await call(market, '/api/market-feed?market=draw');
  check('market draw visitor: request ok', mv.status === 200, String(mv.status));
  check('market draw visitor: no fixture list', Array.isArray(mv.body.predictions) && mv.body.predictions.length === 0, JSON.stringify(mv.body.predictions).slice(0, 200));
  check('market draw visitor: count only', mv.body.locked_preview?.market === 'draw' && typeof mv.body.locked_preview?.count === 'number', JSON.stringify(mv.body.locked_preview));
  check('market draw visitor: no secret anywhere', !JSON.stringify(mv.body).includes(SECRET));
  check('market draw visitor: leagues withheld', Array.isArray(mv.body.leagues) && mv.body.leagues.length === 0);

  // Market, trial user on draw: rows delivered
  const mt = await call(market, '/api/market-feed?market=draw', fakeJwt({ sub: 'u2', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }));
  check('market draw trial: rows delivered unlocked', (mt.body.predictions || []).length > 0 && mt.body.predictions[0].is_locked === false && !mt.body.locked_preview, JSON.stringify(mt.body).slice(0, 300));

  // Tennis, BigBang VIP: full detail still delivered (no over-redaction)
  const vipTok = fakeJwt({ sub: 'vip1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, mark: VIP_MARK }) + VIP_MARK;
  const tvip = await call(tennis, '/api/tennis-feed', vipTok);
  const tvipp = (tvip.body.predictions || [])[0] || {};
  check('tennis VIP: full pick and reasoning delivered', tvipp.is_locked === false && tvipp.prediction === 'A to win' && tvipp.metadata?.tactical_reasoning === SECRET, JSON.stringify({ sub: tvip.body.is_subscriber, pred: tvipp.prediction }));

  // Market, visitor on the general market: only allowlisted fields
  const mg = await call(market, '/api/market-feed?market=general');
  const extra = (mg.body.predictions || []).flatMap((p: any) => Object.keys(p).filter((k) => !MARKET_ALLOWED.has(k)));
  check('market general visitor: only allowlisted fields', mg.status === 200 && extra.length === 0, extra.join(','));
  { const b = JSON.stringify(mg.body); const i = b.indexOf(SECRET); check('market general visitor: no secret anywhere', i < 0, b.slice(Math.max(0, i - 160), i + 20)); }

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
