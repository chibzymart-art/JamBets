// Behaviour test for Edge feed redaction (Phase 1).
// Runs the real handlers against a mocked Supabase whose rows carry sensitive fields,
// and checks what a visitor, an expired user and a trial user receive.
// Run: node tests/edge/run.mjs
import tennis from '../../api/tennis-feed';
import goals from '../../api/goals-feed';
import market from '../../api/market-feed';
import football from '../../api/predictions-feed';
import basketball from '../../api/basketball-feed';

const SECRET = 'SECRET_PICK_DETAIL';
const VIP_MARK = 'VIPTOKEN';
const MARKET_ALLOWED = new Set(['id','fixture_id','market','market_category','market_label','market_icon','target_kickoff_at','fixture','is_locked','prediction','probability','display_probability','confidence_tier','confidence_category','metrics','tactical_rationale','tactical_tag','settlement_status','settlement_notes','settled_at','ht_score','actual_score','actual_corners','metadata']);
const kickoff = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
const fixture = { id: 'f1', status: 'scheduled', target_kickoff_at: kickoff, metadata: { internal: SECRET },
  league: { id: 'l1', code: 'ENG_PL', name: 'Premier League', country: 'England' },
  home_team: { id: 'h', name: 'home' }, away_team: { id: 'a', name: 'away' },
  player1: { id: 'p1', display_name: 'A', current_rank: 15, hard_elo: 2040, clay_elo: 2000 }, player2: { id: 'p2', display_name: 'B', current_rank: 100, hard_elo: 1625, clay_elo: 1600 }, tournament: { id: 't1', name: 'T' } };

const tennisRow = { id: 'tp1', fixture_id: 'f1', fixture, market: 'match_winner', prediction: 'A to win', probability: 0.81,
  confidence_category: 'TOP PICK', fair_odds: 1.2, market_odds: 1.3, settlement_status: 'pending', target_kickoff_at: kickoff,
  secondary_predictions: [{ market: 'set_handicap', prediction: SECRET }], simulations_count: 250000, tier_required: 'bigbang',
  publication_status: 'published', metadata: { surface: 'hard_outdoor', court_pace_index: 37.5, tactical_reasoning: SECRET,
  elo_delta: 458, p1_hold_rate: 0.78, correct_set_scores: { '2-0': 0.56 }, markov: { x: SECRET } } };

const tennisSkipRow = { ...tennisRow, id: 'tp2', market: 'NO_SAFE_BANKER', prediction: 'SKIP', confidence_category: 'NO_SAFE_BANKER' };

const goalsRow = { id: 'g1', fixture_id: 'f1', fixture, market: 'over_2.5_goals', predicted_outcome: 'Over 2.5', probability: 0.77,
  confidence_tier: 'BANGER', xg_combined: 3.4, home_over25_rate: 71, away_over25_rate: 66, h2h_over25_rate: 80, ht_goal_frequency: 79,
  avg_first_goal_minute: 21, target_kickoff_at: kickoff, settlement_status: 'pending', publication_status: 'published',
  metadata: { reasoning: SECRET } };

// Football: four open picks on one day (enough to publish a daily tier total) and one settled pick.
const footballOpen = [1, 2, 3, 4].map((i) => ({ id: `fp${i}`, fixture_id: 'f1', fixture, prediction: 'Home Win', market: '1X2', probability: 0.97,
  confidence_category: i < 3 ? 'BANGER' : 'TOP_PICK', secondary_predictions: [{ market: 'btts', prediction: SECRET }], metadata: { reasoning: SECRET },
  settlement_status: 'pending', settlement_notes: null, target_kickoff_at: kickoff, publication_status: 'published', tier_required: 'standard' }));
const footballSettled = { id: 'fs1', fixture_id: 'f1', fixture, prediction: 'Over 1.5', market: 'goals', probability: 0.97, confidence_category: 'BANGER',
  secondary_predictions: [], metadata: {}, settlement_status: 'won', settlement_notes: 'Final: 2-1 (Predicted: Over 1.5)', actual_score: '2-1',
  target_kickoff_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString(), publication_status: 'published', tier_required: 'standard' };
const basketballOpen = { id: 'bp1', fixture_id: 'f1', fixture, market: 'moneyline', prediction: 'home ML', probability: 0.9, confidence_category: 'BANGER',
  settlement_status: 'pending', target_kickoff_at: kickoff, secondary_predictions: [], metadata: { simulation: SECRET } };
const basketballSettled = { ...basketballOpen, id: 'bs1', settlement_status: 'won', target_kickoff_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString() };

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
    if (url.includes('feed:tennis')) return json([{ payload: { predictions: [tennisRow, tennisSkipRow], tournaments: [], settlements: [], stats: {} }, updated_at: new Date().toISOString() }]);
    if (url.includes('feed:goals')) return json([{ payload: { predictions: [goalsRow], leagues: [{ id: 'l1' }] }, updated_at: new Date().toISOString() }]);
    if (url.includes('feed:football')) return json([{ payload: { predictions: [...footballOpen, footballSettled], leagues: [] }, updated_at: new Date().toISOString() }]);
    if (url.includes('feed:market:counts')) {
      // Old snapshot shape: still carries the retired 1X2 keys with zero values.
      const c = { general: 1, curated: 2, 'over_2.5_goals': 1, 'ht_over_0.5_goals': 0, corners: 1, home_win: 0, away_win: 0, draw: 0 };
      return json([{ payload: { cached_at: new Date().toISOString(), counts_all: c, counts_today: c }, updated_at: new Date().toISOString() }]);
    }
    if (url.includes('feed:basketball')) return json([{ payload: { predictions: [basketballOpen, basketballSettled], leagues: [], settlements: [], stats: {} }, updated_at: new Date().toISOString() }]);
    return json([]);
  }
  if (url.includes('rpc/get_user_session_bootstrap')) return json({ user: null, subscription: null, entitlement: null });
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
  const trialTok = () => fakeJwt({ sub: 'u2', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  const vipTok = fakeJwt({ sub: 'vip1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, mark: VIP_MARK }) + VIP_MARK;

  // ---- Tennis, visitor
  const tv = await call(tennis, '/api/tennis-feed?tz=Africa/Lagos');
  const tvp = (tv.body.predictions || []).find((p: any) => p.id === 'tp1') || {};
  const tvskip = (tv.body.predictions || []).find((p: any) => p.id === 'tp2') || {};
  const tvs = JSON.stringify(tv.body);
  check('tennis visitor: request ok', tv.status === 200, String(tv.status));
  check('tennis visitor: item locked', tvp.is_locked === true && tvp.probability === null);
  check('tennis visitor: no model detail anywhere', !tvs.includes(SECRET) && !tvs.includes('tactical_reasoning') && !tvs.includes('elo_delta') && !tvs.includes('correct_set_scores') && !tvs.includes('hold_rate'), tvs.slice(0, 300));
  check('tennis visitor: keeps surface for the card', tvp.metadata?.surface === 'hard_outdoor');
  check('tennis visitor: no player Elo (Elo gap reveals the pick)', !/_elo"/.test(tvs) && tvp.fixture?.player1?.display_name === 'A' && tvp.fixture?.player1?.current_rank === 15, JSON.stringify(tvp.fixture?.player1));
  check('tennis visitor: no tier on the match', tvp.confidence_category === 'LOCKED' && !tvs.includes('TOP PICK'), String(tvp.confidence_category));
  check('tennis visitor: no-safe-banker pick not revealed by its market', tvskip.market === 'match_winner' && tvskip.confidence_category === 'LOCKED' && !/NO_SAFE|SKIP/i.test(JSON.stringify(tvskip)), JSON.stringify({ m: tvskip.market, c: tvskip.confidence_category }));
  check('tennis visitor: small day tier total withheld', Array.isArray(tv.body.locked_tier_counts?.withheld_dates) && tv.body.locked_tier_counts.withheld_dates.length === 1 && Object.keys(tv.body.locked_tier_counts.by_date).length === 0 && tv.body.locked_tier_counts.upcoming === null, JSON.stringify(tv.body.locked_tier_counts));
  const tvf = await call(tennis, '/api/tennis-feed?tier=bangers');
  check('tennis visitor: tier filter ignored (would reveal tiers)', (tvf.body.predictions || []).length === 2, String((tvf.body.predictions || []).length));

  // ---- Tennis, BigBang VIP: full detail still delivered (no over-redaction)
  const tvip = await call(tennis, '/api/tennis-feed', vipTok);
  const tvipp = (tvip.body.predictions || []).find((p: any) => p.id === 'tp1') || {};
  check('tennis VIP: full pick and reasoning delivered', tvipp.is_locked === false && tvipp.prediction === 'A to win' && tvipp.metadata?.tactical_reasoning === SECRET, JSON.stringify({ sub: tvip.body.is_subscriber, pred: tvipp.prediction }));
  check('tennis VIP: player Elo and tier kept', tvipp.fixture?.player1?.hard_elo === 2040 && tvipp.confidence_category === 'TOP PICK' && !tvip.body.locked_tier_counts, JSON.stringify(tvipp.fixture?.player1));
  const tvipf = await call(tennis, '/api/tennis-feed?tier=bangers', vipTok);
  check('tennis VIP: tier filter still works', (tvipf.body.predictions || []).length === 0, String((tvipf.body.predictions || []).length));

  // ---- Football, visitor
  const fv = await call(football, '/api/predictions-feed?tz=Africa/Lagos');
  const fvs = JSON.stringify(fv.body);
  const fopen = (fv.body.predictions || []).filter((p: any) => p.id.startsWith('fp'));
  const fset = (fv.body.predictions || []).find((p: any) => p.id === 'fs1') || {};
  check('football visitor: request ok', fv.status === 200 && fopen.length === 4, `${fv.status} ${fopen.length}`);
  check('football visitor: open picks carry no tier', fopen.every((p: any) => p.confidence_category === 'LOCKED' && p.is_locked === true && p.probability === null));
  check('football visitor: settled pick keeps its tier (track record)', fset.confidence_category === 'BANGER' && fset.settlement_status === 'won', JSON.stringify(fset).slice(0, 200));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(kickoff));
  const fc = fv.body.locked_tier_counts || {};
  check('football visitor: daily tier totals published', fc.time_zone === 'Africa/Lagos' && fc.by_date?.[today]?.BANGER === 2 && fc.by_date?.[today]?.TOP_PICK === 2 && fc.upcoming?.BANGER === 2, JSON.stringify(fc));
  check('football visitor: no secret anywhere', !fvs.includes(SECRET), fvs.slice(0, 200));
  const ft = await call(football, '/api/predictions-feed', trialTok());
  const ftp = (ft.body.predictions || []).find((p: any) => p.id === 'fp1') || {};
  check('football trial: full pick and tier delivered', ftp.confidence_category === 'BANGER' && ftp.probability === 0.97 && !ft.body.locked_tier_counts, JSON.stringify(ftp).slice(0, 200));

  // ---- Basketball, visitor
  const bv = await call(basketball, '/api/basketball-feed?tz=Africa/Lagos');
  const bopen = (bv.body.predictions || []).find((p: any) => p.id === 'bp1') || {};
  const bset = (bv.body.predictions || []).find((p: any) => p.id === 'bs1') || {};
  check('basketball visitor: open pick carries no tier', bopen.confidence_category === 'LOCKED' && bopen.is_locked === true, JSON.stringify(bopen).slice(0, 160));
  check('basketball visitor: settled pick is locked too (track record is admin-only)', bset.confidence_category === 'LOCKED' && bset.is_locked === true && bset.probability === null && bset.settlement_status === 'pending', JSON.stringify(bset).slice(0, 160));
  check('basketball visitor: no secret on settled picks', !JSON.stringify(bset).includes(SECRET), JSON.stringify(bset).slice(0, 200));
  check('basketball visitor: no secret on open picks', !JSON.stringify(bopen).includes(SECRET), JSON.stringify(bopen).slice(0, 200));
  check('basketball visitor: tier totals sent (one match on each day, so both withheld)', bv.body.locked_tier_counts?.withheld_dates?.length === 2, JSON.stringify(bv.body.locked_tier_counts));

  // ---- Goals feed: the list itself is the pick, so locked users get a count
  const gv = await call(goals, '/api/goals-feed');
  check('goals visitor: request ok', gv.status === 200, String(gv.status));
  check('goals visitor: no fixture list', Array.isArray(gv.body.predictions) && gv.body.predictions.length === 0 && Array.isArray(gv.body.leagues) && gv.body.leagues.length === 0, JSON.stringify(gv.body).slice(0, 200));
  check('goals visitor: count only', gv.body.locked_preview?.count === 1 && gv.body.locked_preview?.by_market?.['over_2.5_goals'] === 1, JSON.stringify(gv.body.locked_preview));
  check('goals visitor: no secret anywhere', !JSON.stringify(gv.body).includes(SECRET));
  const gt = await call(goals, '/api/goals-feed', trialTok());
  const gtp = (gt.body.predictions || [])[0] || {};
  check('goals trial: full item still delivered', gtp.is_locked !== true && gtp.xg_combined === 3.4 && !gt.body.locked_preview, JSON.stringify({is_locked: gtp.is_locked, xg: gtp.xg_combined, auth: gt.body.auth_status}));

  // ---- Market feed
  for (const m of ['over_2.5_goals', 'general', 'curated', 'corners', 'ht_over_0.5_goals']) {
    const r = await call(market, `/api/market-feed?market=${m}`);
    check(`market ${m} visitor: count only, no fixtures`, r.status === 200 && (r.body.predictions || []).length === 0 && r.body.locked_preview?.market === m && (r.body.leagues || []).length === 0 && !JSON.stringify(r.body).includes(SECRET), JSON.stringify(r.body).slice(0, 200));
  }
  const mo = await call(market, '/api/market-feed?market=over_2.5_goals');
  check('market over_2.5 visitor: count matches rows', mo.body.locked_preview?.count === 1, JSON.stringify(mo.body.locked_preview));
  const mt = await call(market, '/api/market-feed?market=over_2.5_goals', trialTok());
  check('market over_2.5 trial: rows delivered unlocked', (mt.body.predictions || []).length === 1 && mt.body.predictions[0].is_locked === false && !mt.body.locked_preview, JSON.stringify(mt.body).slice(0, 300));
  for (const m of ['draw', 'home_win', 'away_win']) {
    const r = await call(market, `/api/market-feed?market=${m}`);
    check(`market ${m}: retired (410), never Over 2.5 rows`, r.status === 410 && r.body.error === 'market_retired' && !r.body.predictions, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  const mu = await call(market, '/api/market-feed?market=bogus');
  check('market unknown: 400', mu.status === 400 && mu.body.error === 'unknown_market', String(mu.status));
  const mc = await call(market, '/api/market-feed?market=corners');
  check('market counts: no retired keys (even from an old snapshot)', mc.body.counts && mc.body.counts.corners === 1 && !('draw' in mc.body.counts) && !('home_win' in mc.body.counts) && !('away_win' in mc.body.counts), JSON.stringify(mc.body.counts));

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
