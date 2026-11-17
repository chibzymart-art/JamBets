import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { VlAvatar } from './VlAvatar';
import { vlAdminGrant, vlBuy, vlCheckIn, vlLeaderboard, vlSetAvatar, vlTravel, type VlLeaderRow } from './vlifeApi';
import {
  SLOT_KINDS,
  VL_COINS_PER_WIN,
  VL_WELCOME_COINS,
  canAfford,
  checkinBonus,
  currentCity,
  formatCoins,
  isOwned,
  itemByKey,
  nextStreak,
  reasonLabel,
  vlErrorMessage,
  type VlAvatarSlots,
  type VlItem,
  type VlKind,
  type VlState,
} from './vlifeRules';

type Ready = Extract<VlState, { status: 'ready' }>;
type Tab = 'home' | 'avatar' | 'shop' | 'travel' | 'rankings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'avatar', label: 'Avatar', icon: '🧍' },
  { id: 'shop', label: 'Shop', icon: '🛍️' },
  { id: 'travel', label: 'Travel', icon: '✈️' },
  { id: 'rankings', label: 'Rankings', icon: '🏆' },
];

const TAB_KEY = 'vl_tab';

function readTab(): Tab {
  try {
    const t = sessionStorage.getItem(TAB_KEY) as Tab | null;
    return t && TABS.some((x) => x.id === t) ? t : 'home';
  } catch {
    return 'home';
  }
}

/** The Virtual Life world for a paid member with a Banter username. */
export function VlWorld({ state, onRefresh }: { state: Ready; onRefresh: () => Promise<void> }) {
  const [tab, setTabState] = useState<Tab>(readTab);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  const setTab = (t: Tab) => {
    setTabState(t);
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const say = (text: string, kind: 'ok' | 'err' = 'ok') => setToast({ text, kind });
  const city = currentCity(state.trips, state.cities);

  return (
    <section className="vl" aria-labelledby="vl-title">
      <header className="vl-top">
        <VlAvatar slots={state.avatar} catalog={state.catalog} size="sm" />
        <div className="vl-top-who">
          <h1 id="vl-title">{state.handle}</h1>
          <small>{city ? `${city.flag} In ${city.name}` : '🏠 At home'}</small>
        </div>
        <div className="vl-wallet" aria-label={state.isAdmin ? 'Unlimited Banta Coins' : `${formatCoins(state.balance)} Banta Coins`}>
          <span className="vl-coin" aria-hidden="true">B</span>
          <b>{state.isAdmin ? 'Unlimited' : formatCoins(state.balance)}</b>
          <small>Banta Coins</small>
        </div>
      </header>

      <nav className="vl-tabs" role="tablist" aria-label="Virtual Life">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`vl-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {toast && (
        <p className={`vl-toast ${toast.kind === 'err' ? 'is-err' : ''}`} role={toast.kind === 'err' ? 'alert' : 'status'}>
          {toast.text}
        </p>
      )}

      {tab === 'home' && <HomeTab state={state} onRefresh={onRefresh} say={say} goTo={setTab} />}
      {tab === 'avatar' && <AvatarTab state={state} onRefresh={onRefresh} say={say} goTo={setTab} />}
      {tab === 'shop' && <ShopTab state={state} onRefresh={onRefresh} say={say} />}
      {tab === 'travel' && <TravelTab state={state} onRefresh={onRefresh} say={say} />}
      {tab === 'rankings' && <RankingsTab />}

      <p className="vl-footnote">
        Banta Coins are just for fun: they can't be bought, cashed out or sent to anyone. No staking, no betting.
      </p>
    </section>
  );
}

interface TabProps {
  state: Ready;
  onRefresh: () => Promise<void>;
  say: (text: string, kind?: 'ok' | 'err') => void;
  goTo?: (t: Tab) => void;
}

// ---------------------------------------------------------------------------
// Home: check-in, room, how to earn, recent coins
// ---------------------------------------------------------------------------

function HomeTab({ state, onRefresh, say, goTo }: TabProps) {
  const [busy, setBusy] = useState(false);
  const streakAfter = nextStreak(state.streak, state.checkedInToday);

  const checkIn = async () => {
    setBusy(true);
    const r = await vlCheckIn();
    if (r.ok) {
      say(`Checked in! +${r.data.bonus} Banta Coins. Streak: ${r.data.streak} ${r.data.streak === 1 ? 'day' : 'days'}.`);
      await onRefresh();
    } else {
      say(vlErrorMessage(r.code), 'err');
    }
    setBusy(false);
  };

  return (
    <div className="vl-stack">
      <div className="vl-card vl-checkin">
        <div className="vl-checkin-flame" aria-hidden="true">{state.streak > 0 ? '🔥' : '📅'}</div>
        <div className="vl-checkin-text">
          <strong>Daily check-in</strong>
          <span>
            {state.checkedInToday
              ? `Done for today. Streak: ${state.streak} ${state.streak === 1 ? 'day' : 'days'}. Come back tomorrow for +${checkinBonus(state.streak + 1)}.`
              : state.streak > 0
                ? `Keep your ${state.streak}-day streak going: +${checkinBonus(streakAfter)} coins today.`
                : `Check in every day. +${checkinBonus(1)} today, more each day in a row (up to +11).`}
          </span>
        </div>
        <button type="button" className="vl-btn vl-btn--gold" onClick={checkIn} disabled={busy || state.checkedInToday}>
          {state.checkedInToday ? 'Checked in ✓' : busy ? 'Checking in…' : 'Check in'}
        </button>
      </div>

      {state.isAdmin && <AdminGiveCoins say={say} onRefresh={onRefresh} />}

      <div className="vl-sec"><h2>Your room</h2></div>
      <VlRoom state={state} onShop={() => goTo?.('shop')} />

      <div className="vl-card vl-earn">
        <h3>How to earn Banta Coins</h3>
        <ul>
          <li><span aria-hidden="true">🎯</span> <b>+{VL_COINS_PER_WIN}</b> for every Banter Hub pick you win</li>
          <li><span aria-hidden="true">📅</span> <b>+5 to +11</b> for your daily check-in</li>
          <li><span aria-hidden="true">🎁</span> <b>+{formatCoins(VL_WELCOME_COINS)}</b> welcome coins to start</li>
        </ul>
        <p className="vl-muted">So far you've earned {formatCoins(state.earnedTotal)} coins, {state.wonPicksPaid} of them from won picks.</p>
      </div>

      {state.recent.length > 0 && (
        <>
          <div className="vl-sec"><h2>Recent coins</h2></div>
          <ul className="vl-card vl-ledger">
            {state.recent.slice(0, 6).map((r, i) => (
              <li key={`${r.at}-${i}`}>
                <span>{reasonLabel(r.reason)}</span>
                <small>{new Date(r.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>
                <b className={r.amount > 0 ? 'is-plus' : 'is-minus'}>{r.amount > 0 ? '+' : ''}{formatCoins(r.amount)}</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Admin only: give Banta Coins to a member by Banter username or email. The server checks admin. */
function AdminGiveCoins({ say, onRefresh }: { say: TabProps['say']; onRefresh: TabProps['onRefresh'] }) {
  const [who, setWho] = useState('');
  const [amount, setAmount] = useState('100');
  const [busy, setBusy] = useState(false);
  const n = Math.floor(Number(amount));
  const valid = who.trim().length >= 3 && Number.isFinite(n) && n >= 1 && n <= 100000;

  const give = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const r = await vlAdminGrant(who, n);
    if (r.ok) {
      say(`Gave ${formatCoins(r.data.amount)} coins to ${r.data.handle ?? who.trim()}. Their balance: ${formatCoins(r.data.balance)}.`);
      setWho('');
      await onRefresh();
    } else {
      say(vlErrorMessage(r.code), 'err');
    }
    setBusy(false);
  };

  return (
    <form className="vl-card vl-admin" onSubmit={give}>
      <h3>Admin: give coins</h3>
      <div className="vl-admin-row">
        <label className="vl-admin-field">
          <span>Username or email</span>
          <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="e.g. LagosOracle" autoComplete="off" autoCapitalize="off" spellCheck={false} />
        </label>
        <label className="vl-admin-field vl-admin-amount">
          <span>Coins</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
        </label>
        <button type="submit" className="vl-btn vl-btn--gold" disabled={!valid || busy}>{busy ? 'Giving…' : 'Give'}</button>
      </div>
      <p className="vl-muted">1 to 100,000 coins per gift. Shows in their coin history as "Gift from admin".</p>
    </form>
  );
}

/** Room spots for furniture, as percentages of the room box. */
const ROOM_SPOT: Record<string, { left: string; bottom: string; size?: number }> = {
  room_tv: { left: '50%', bottom: '58%', size: 46 },
  room_sofa: { left: '50%', bottom: '6%', size: 52 },
  room_plant: { left: '7%', bottom: '8%', size: 36 },
  room_poster: { left: '20%', bottom: '62%', size: 34 },
  room_neon: { left: '80%', bottom: '70%', size: 30 },
  room_popcorn: { left: '86%', bottom: '8%', size: 34 },
  room_console: { left: '67%', bottom: '8%', size: 30 },
  room_plush: { left: '22%', bottom: '8%', size: 30 },
};

export function VlRoom({ state, onShop }: { state: Ready; onShop?: () => void }) {
  const owned = (kind: VlKind) => state.catalog.filter((c) => c.kind === kind && state.owned.includes(c.key));
  const furniture = owned('room');
  const trophies = owned('trophy');
  const pennants = owned('city');
  const kit = itemByKey(state.catalog, state.avatar.kit);
  const style = { '--vl-kit1': kit?.colour1 ?? '#f8fafc', '--vl-kit2': kit?.colour2 ?? '#cbd5e1' } as CSSProperties;
  const empty = !furniture.length && !trophies.length && !pennants.length;

  return (
    <div className="vl-room-wrap">
      <div className="vl-room" style={style} role="img" aria-label={`Your room: ${furniture.length} items, ${trophies.length} trophies, ${pennants.length} city flags`}>
        <div className="vl-room-wall" />
        <div className="vl-room-floor" />
        <div className="vl-room-banner" aria-hidden="true" />
        {pennants.length > 0 && (
          <div className="vl-room-flags" aria-hidden="true">
            {pennants.slice(0, 12).map((p) => <span key={p.key} title={p.name}>{p.emoji}</span>)}
          </div>
        )}
        <div className="vl-room-shelf" aria-hidden="true">
          {trophies.map((t) => <span key={t.key} title={t.name}>{t.emoji}</span>)}
        </div>
        {furniture.map((f) => {
          const s = ROOM_SPOT[f.key] ?? { left: '50%', bottom: '10%' };
          return (
            <span key={f.key} className="vl-room-item" style={{ left: s.left, bottom: s.bottom, fontSize: s.size ?? 32 }} title={f.name} aria-hidden="true">
              {f.emoji}
            </span>
          );
        })}
        <div className="vl-room-me"><VlAvatar slots={state.avatar} catalog={state.catalog} size="md" /></div>
      </div>
      {empty && (
        <p className="vl-muted vl-room-hint">
          Your room is empty. Buy furniture and trophies in the shop, and fly to cities to collect their flags.
          {onShop && <> <button type="button" className="vl-link" onClick={onShop}>Open the shop</button></>}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar builder
// ---------------------------------------------------------------------------

const SLOT_LABEL: Record<keyof VlAvatarSlots, string> = { base: 'Face', kit: 'Kit', gear: 'Gear', badge: 'Badge' };

function AvatarTab({ state, onRefresh, say, goTo }: TabProps) {
  const [draft, setDraft] = useState<VlAvatarSlots>(state.avatar);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(state.avatar), [state.avatar]);

  const changed = (Object.keys(draft) as (keyof VlAvatarSlots)[]).some((k) => draft[k] !== state.avatar[k]);

  const save = async () => {
    setSaving(true);
    const r = await vlSetAvatar(draft);
    if (r.ok) {
      say('Avatar saved.');
      await onRefresh();
    } else {
      say(vlErrorMessage(r.code), 'err');
    }
    setSaving(false);
  };

  return (
    <div className="vl-stack">
      <div className="vl-card vl-builder-preview">
        <VlAvatar slots={draft} catalog={state.catalog} size="lg" />
        <div className="vl-builder-actions">
          <button type="button" className="vl-btn vl-btn--gold" onClick={save} disabled={!changed || saving}>
            {saving ? 'Saving…' : changed ? 'Save avatar' : 'Saved'}
          </button>
          {changed && <button type="button" className="vl-btn" onClick={() => setDraft(state.avatar)}>Undo</button>}
        </div>
      </div>

      {(Object.keys(SLOT_KINDS) as (keyof VlAvatarSlots)[]).map((slot) => {
        const items = state.catalog.filter((c) => SLOT_KINDS[slot].includes(c.kind));
        const mine = items.filter((c) => isOwned(c, state.owned));
        const locked = items.filter((c) => !isOwned(c, state.owned) && c.for_sale);
        return (
          <div key={slot} className="vl-card">
            <h3 className="vl-slot-title">{SLOT_LABEL[slot]}</h3>
            <div className="vl-picks" role="radiogroup" aria-label={SLOT_LABEL[slot]}>
              {slot !== 'base' && slot !== 'kit' && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft[slot] === null}
                  className={`vl-pick ${draft[slot] === null ? 'is-on' : ''}`}
                  onClick={() => setDraft({ ...draft, [slot]: null })}
                >
                  <span className="vl-pick-icon">—</span>
                  <small>None</small>
                </button>
              )}
              {mine.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={draft[slot] === c.key}
                  className={`vl-pick ${draft[slot] === c.key ? 'is-on' : ''}`}
                  onClick={() => setDraft({ ...draft, [slot]: c.key })}
                >
                  <ItemIcon item={c} />
                  <small>{c.name}</small>
                </button>
              ))}
              {locked.map((c) => (
                <button key={c.key} type="button" className="vl-pick is-locked" onClick={() => goTo?.('shop')} aria-label={`${c.name}, locked, ${c.price} coins in the shop`}>
                  <ItemIcon item={c} />
                  <small>🔒 {formatCoins(c.price)}</small>
                </button>
              ))}
            </div>
            {slot === 'badge' && <p className="vl-muted">Fly to a city to unlock its travel badge.</p>}
          </div>
        );
      })}
    </div>
  );
}

function ItemIcon({ item }: { item: VlItem }) {
  if (item.kind === 'kit') {
    return (
      <span
        className="vl-kit-swatch"
        style={{ '--vl-kit1': item.colour1 ?? '#f8fafc', '--vl-kit2': item.colour2 ?? '#cbd5e1' } as CSSProperties}
        aria-hidden="true"
      />
    );
  }
  return <span className="vl-pick-icon" aria-hidden="true">{item.emoji}</span>;
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

const SHOP_SECTIONS: { kind: VlKind; title: string }[] = [
  { kind: 'kit', title: 'Kits' },
  { kind: 'base', title: 'Faces' },
  { kind: 'gear', title: 'Fan gear' },
  { kind: 'badge', title: 'Badges' },
  { kind: 'trophy', title: 'Trophies' },
  { kind: 'room', title: 'Room items' },
];

function ShopTab({ state, onRefresh, say }: TabProps) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const buy = async (item: VlItem) => {
    if (confirm !== item.key) { setConfirm(item.key); return; }
    setBusy(item.key);
    const r = await vlBuy(item.key);
    if (r.ok) {
      say(`${item.name} is yours! ${['base', 'kit', 'gear', 'badge'].includes(item.kind) ? 'Wear it in Avatar.' : 'It is in your room.'}`);
      await onRefresh();
    } else {
      say(vlErrorMessage(r.code), 'err');
    }
    setBusy(null);
    setConfirm(null);
  };

  return (
    <div className="vl-stack">
      <p className="vl-muted">Tap a price, then tap Confirm to buy.</p>
      {SHOP_SECTIONS.map((s) => {
        const items = state.catalog.filter((c) => c.kind === s.kind && c.for_sale && c.price > 0);
        if (!items.length) return null;
        return (
          <div key={s.kind}>
            <div className="vl-sec"><h2>{s.title}</h2></div>
            <div className="vl-shop-grid">
              {items.map((c) => {
                const owned = isOwned(c, state.owned);
                const short = !canAfford(c.price, state.balance, state.isAdmin);
                return (
                  <div key={c.key} className={`vl-shop-item ${owned ? 'is-owned' : ''}`}>
                    <ItemIcon item={c} />
                    <strong>{c.name}</strong>
                    {owned ? (
                      <span className="vl-owned">Owned ✓</span>
                    ) : (
                      <button
                        type="button"
                        className={`vl-btn vl-btn--sm ${confirm === c.key ? 'vl-btn--gold' : ''}`}
                        disabled={busy !== null || short}
                        onClick={() => buy(c)}
                        aria-label={confirm === c.key ? `Confirm buying ${c.name} for ${c.price} coins` : `Buy ${c.name} for ${c.price} coins`}
                      >
                        {busy === c.key ? 'Buying…' : confirm === c.key ? 'Confirm' : <>🪙 {formatCoins(c.price)}</>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

function TravelTab({ state, onRefresh, say }: TabProps) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const visited = useMemo(() => new Set(state.trips.map((t) => t.city)), [state.trips]);
  const here = currentCity(state.trips, state.cities);

  const fly = async (key: string, name: string) => {
    if (confirm !== key) { setConfirm(key); return; }
    setBusy(key);
    const r = await vlTravel(key);
    if (r.ok) {
      setLanded(key);
      say(`You landed in ${name}! Travel badge unlocked.`);
      await onRefresh();
    } else {
      say(vlErrorMessage(r.code), 'err');
    }
    setBusy(null);
    setConfirm(null);
  };

  return (
    <div className="vl-stack">
      <div className="vl-card vl-travel-head">
        <span className="vl-plane" aria-hidden="true">✈️</span>
        <div>
          <strong>{here ? `You're in ${here.name} ${here.flag}` : "You're at home"}</strong>
          <span>
            {visited.size} of {state.cities.length} cities visited. Fly to a football city to collect its flag for your room and a travel badge for your avatar.
          </span>
        </div>
      </div>
      <div className="vl-city-grid">
        {state.cities.map((c) => {
          const been = visited.has(c.key);
          return (
            <div key={c.key} className={`vl-city ${been ? 'is-visited' : ''} ${landed === c.key ? 'is-landed' : ''}`}>
              <span className="vl-city-flag" aria-hidden="true">{c.flag}</span>
              <div className="vl-city-name">
                <strong>{c.name}</strong>
                <small>{c.country}</small>
              </div>
              {been ? (
                <span className="vl-owned">Visited ✓</span>
              ) : (
                <button
                  type="button"
                  className={`vl-btn vl-btn--sm ${confirm === c.key ? 'vl-btn--gold' : ''}`}
                  disabled={busy !== null || !canAfford(c.price, state.balance, state.isAdmin)}
                  onClick={() => fly(c.key, c.name)}
                  aria-label={confirm === c.key ? `Confirm flight to ${c.name} for ${c.price} coins` : `Fly to ${c.name} for ${c.price} coins`}
                >
                  {busy === c.key ? 'Flying…' : confirm === c.key ? 'Confirm' : <>✈️ {formatCoins(c.price)}</>}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

function RankingsTab() {
  const [kind, setKind] = useState<'rich' | 'travel'>('rich');
  const [rows, setRows] = useState<VlLeaderRow[] | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setRows(undefined);
    vlLeaderboard(kind, 50).then((r) => { if (live) setRows(r.ok ? r.data : null); });
    return () => { live = false; };
  }, [kind]);

  return (
    <div className="vl-stack">
      <div className="vl-seg" role="tablist" aria-label="Ranking">
        <button type="button" role="tab" aria-selected={kind === 'rich'} className={`vl-seg-btn ${kind === 'rich' ? 'is-active' : ''}`} onClick={() => setKind('rich')}>
          🪙 Richest fans
        </button>
        <button type="button" role="tab" aria-selected={kind === 'travel'} className={`vl-seg-btn ${kind === 'travel' ? 'is-active' : ''}`} onClick={() => setKind('travel')}>
          ✈️ Most travelled
        </button>
      </div>
      {rows === undefined ? (
        <p className="vl-muted" aria-busy="true">Loading rankings…</p>
      ) : rows === null ? (
        <p className="vl-error" role="alert">Couldn't load the rankings. Please try again.</p>
      ) : rows.length === 0 ? (
        <div className="vl-card"><p className="vl-muted">No fans here yet.</p></div>
      ) : (
        <ol className="vl-card vl-board">
          {rows.map((r, i) => (
            <li key={`${r.handle}-${i}`} className={r.is_me ? 'is-me' : ''}>
              <span className="vl-board-place">{r.place <= 3 ? ['🥇', '🥈', '🥉'][r.place - 1] : `#${r.place}`}</span>
              <span className="vl-board-face" aria-hidden="true">{r.base_emoji ?? r.avatar_emoji}</span>
              <span className="vl-board-name">{r.handle}{r.is_me && <small> (you)</small>}</span>
              <b>{kind === 'rich' ? `🪙 ${formatCoins(r.value)}` : `${r.value} ${r.value === 1 ? 'city' : 'cities'}`}</b>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
