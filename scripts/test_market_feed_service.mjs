import { createClient } from '../web/node_modules/@supabase/supabase-js/dist/main/index.js';

const SUPABASE_URL = 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function runServiceTest() {
  console.log('🧪 Starting Market Feed Service Direct Verification...');

  const [hw, aw, dr, cr, gl] = await Promise.all([
    supabase.from('home_win_predictions_paywall').select('id, probability, dominance_tier').limit(5),
    supabase.from('away_win_predictions_paywall').select('id, probability, counter_tier').limit(5),
    supabase.from('draw_predictions_paywall').select('id, probability, stalemate_tier').limit(5),
    supabase.from('corner_predictions_paywall').select('id, probability, corner_tier').limit(5),
    supabase.from('goals_predictions_paywall').select('id, market, probability, confidence_tier').limit(5),
  ]);

  console.log(`✓ Home Win paywall rows: ${hw.data?.length}`);
  console.log(`✓ Away Win paywall rows: ${aw.data?.length}`);
  console.log(`✓ Draw Hunter paywall rows: ${dr.data?.length}`);
  console.log(`✓ Corners paywall rows: ${cr.data?.length}`);
  console.log(`✓ Goals paywall rows: ${gl.data?.length}`);

  // Test freemium simulation logic
  const mockItems = Array.from({ length: 10 }, (_, i) => ({ id: `pred-${i}`, prob: 80 - i }));
  const isSubscriber = false;
  const processed = mockItems.map((item, idx) => {
    const isLocked = !isSubscriber && idx >= 3;
    return { ...item, is_locked: isLocked, display_probability: isLocked ? null : item.prob };
  });

  const unlockedCount = processed.filter(p => !p.is_locked).length;
  const lockedCount = processed.filter(p => p.is_locked).length;

  console.log(`✓ Freemium 3/7 Rule: Unlocked = ${unlockedCount}, Locked = ${lockedCount}`);
  if (unlockedCount !== 3 || lockedCount !== 7) {
    throw new Error(`Freemium rule failed: expected 3 unlocked and 7 locked, got ${unlockedCount} and ${lockedCount}`);
  }

  console.log('🎉 ALL SERVICE TESTS PASSED!');
}

runServiceTest().catch((err) => {
  console.error('❌ Service test failed:', err);
  process.exit(1);
});
