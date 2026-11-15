// Banter Hub push: SQL safety rules, sender endpoint checks, push-only service worker, website wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-push');
const sql = readFileSync('../../supabase/migrations/20261115000007_banter_push.sql', 'utf8');
const api = readFileSync('../../api/banter-push.ts', 'utf8');
const sw = readFileSync('../../web/public/banter-sw.js', 'utf8');
const client = readFileSync('../../web/src/features/play/banterPush.ts', 'utf8');
const play = (f: string) => readFileSync(`../../web/src/features/play/${f}`, 'utf8');
const MEMBER_RPCS = [
  'banter_save_push_subscription(text, text, text, text)',
  'banter_remove_push_subscription(text)',
  'banter_push_settings()',
  'banter_set_push_settings(boolean, boolean, boolean)',
  'banter_set_league_mute(uuid, boolean)',
];
const SERVICE_RPCS = ['banter_user_has_access(uuid)', 'banter_push_targets(uuid, text, uuid)', 'banter_push_results(text[], text[])'];
const TABLES = ['banter_push_subscriptions', 'banter_push_settings', 'banter_league_mutes', 'banter_push_log'];
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2));
};

test('tables have RLS on and no direct access', () => {
  for (const t of TABLES) {
    assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
    assert.ok(sql.includes(`revoke all on table public.${t} from anon, authenticated;`), t);
  }
  assert.ok(!/create policy/i.test(sql));
  assert.ok(!/grant [a-z, ]+ on table public\.\w+ to (anon|authenticated)/.test(sql));
});

test('member RPCs: definer, pinned search_path, paid-only, closed to public/anon', () => {
  for (const sig of MEMBER_RPCS) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated, service_role;`), sig);
    const b = fnBody(sig.split('(')[0]);
    assert.ok(b.includes('security definer') && b.includes("set search_path = ''") && b.includes('public.has_banter_access()'), sig);
  }
});

test('sender helpers are service-role only', () => {
  for (const sig of SERVICE_RPCS) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon, authenticated;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to service_role;`), sig);
    assert.ok(!sql.includes(`grant execute on function public.${sig} to authenticated`), sig);
    const b = fnBody(sig.split('(')[0]);
    assert.ok(b.includes('security definer') && b.includes("set search_path = ''"), sig);
  }
});

test('targets: only the writer, only recent, once per message, never yourself, paid recipients, settings and mutes', () => {
  const b = fnBody('banter_push_targets');
  assert.ok(b.includes('r.user_id = p_sender') && b.includes('p.user_id = p_sender'));
  assert.ok((b.match(/interval '10 minutes'/g) || []).length >= 3);
  assert.ok(b.includes('on conflict do nothing') && b.includes('if v_n = 0 then return; end if;'));
  assert.ok(b.includes('x.uid <> p_sender') && b.includes('lm.user_id <> p_sender'));
  assert.ok((b.match(/public\.banter_user_has_access\(/g) || []).length >= 4, 'sender + every recipient path');
  assert.ok(b.includes('coalesce(st.replies, true)') && b.includes('coalesce(st.league_messages, true)') && b.includes('coalesce(st.league_activity, true)'));
  assert.ok((b.match(/banter_league_mutes/g) || []).length >= 2);
  assert.ok(b.includes('leaderboard_banned'));
  assert.ok(b.includes("interval '1 hour'") && b.includes('>= 120'));
});

test('subscriptions: https endpoints, sane key sizes, only your own removed', () => {
  assert.ok(sql.includes("endpoint like 'https://%'"));
  assert.ok(fnBody('banter_remove_push_subscription').includes('s.user_id = v_uid'));
  assert.ok(fnBody('banter_set_league_mute').includes("raise exception 'not_member'"));
});

test('sender endpoint verifies the token with Supabase Auth and validates input', () => {
  assert.ok(api.includes('/auth/v1/user'));
  assert.ok(api.includes("return json(req, 401, { error: 'not_signed_in' })"));
  assert.ok(api.includes("new Set(['reply', 'post', 'join'])") && api.includes('UUID.test(id)'));
  assert.ok(api.includes("serviceRpc<Target[]>('banter_push_targets', { p_sender: userId"));
  assert.ok(api.includes('banter_push_results') && api.includes('r.gone'));
  assert.ok(api.includes('429'));
  assert.ok(!/console\.log\([^)]*(PRIVATE|SERVICE_KEY|token)/i.test(api), 'no secrets in logs');
  assert.ok(api.includes("process.env.VAPID_PRIVATE_KEY") && !api.includes('publicKey: keys.privateKey'));
});

test('service worker is push-only: no fetch handler, no caching, opens only Banter pages', () => {
  assert.ok(!/addEventListener\(\s*['"]fetch['"]/.test(sw));
  assert.ok(!/caches\.|CacheStorage|importScripts/.test(sw));
  assert.ok(sw.includes("addEventListener('push'") && sw.includes("addEventListener('notificationclick'"));
  assert.ok(sw.includes("u.pathname.startsWith('/play')") && sw.includes('u.origin !== self.location.origin'));
});

test('registered only by the Banter Hub, scoped to /play/, permission only after a tap', () => {
  assert.ok(client.includes("export const SW_SCOPE = '/play/'"));
  assert.ok(client.includes('navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })'));
  const app = readFileSync('../../web/src/App.tsx', 'utf8');
  const main = readFileSync('../../web/src/main.tsx', 'utf8');
  assert.ok(!app.includes('banter-sw') && !main.includes('serviceWorker'), 'nothing outside the Banter Hub registers it');
  const ui = play('BanterPushUI.tsx');
  assert.ok(!/useEffect\([^]*?turnOnPush\(\)/.test(ui.slice(0, ui.indexOf('const on = async'))), 'no prompt on load');
  assert.ok(client.includes('ios_needs_home_screen') && ui.includes('Add to Home Screen'));
});

test('website asks the server to push after posting, replying and joining', () => {
  assert.ok(play('BanterWall.tsx').includes("notifyPush('post', r.data.id)"));
  assert.ok(play('BanterDiscussion.tsx').includes("notifyPush('reply', r.data.id)"));
  assert.ok((play('BanterLeagues.tsx').match(/notifyPush\('join'/g) || []).length === 2);
  assert.ok(play('BanterProfile.tsx').includes('<PushSettingsCard'));
  assert.ok(play('PlayHub.tsx').includes('<PushPrompt'));
  assert.ok(play('BanterLeagues.tsx').includes('<LeagueMuteButton'));
});

console.log(`banter-push: ${passed} passed`);
