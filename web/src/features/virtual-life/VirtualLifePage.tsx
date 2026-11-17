import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchVlState } from './vlifeApi';
import type { VlState } from './vlifeRules';
import { VlWorld } from './VlWorld';
import './virtual-life.css';

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: '🧍', title: 'Your own fan avatar', text: 'Create a fan character that represents you in the Oddsbanta world.' },
  { icon: '✈️', title: 'Travel to match venues', text: 'Fly your avatar to the cities and grounds where the big matches are played.' },
  { icon: '🎯', title: 'Earn Banta Coins from predictions', text: 'Correct calls in the Banter Hub earn you Banta Coins to use in Virtual Life.' },
  { icon: '🏙️', title: 'Spend in a virtual world', text: 'Use your coins on outfits, homes, travel upgrades and fan gear for your avatar.' },
  { icon: '🤝', title: 'Meet other fans', text: 'Hang out, banter and celebrate results with other members in shared spaces.' },
  { icon: '🏆', title: 'Climb the fan rankings', text: 'Collect trophies and badges for your prediction streaks and travels.' },
  { icon: '🛡️', title: 'Just for fun, no real money', text: 'Banta Coins are never bought, cashed out or transferred. No staking, no betting.' },
];

interface VirtualLifePageProps {
  isSignedIn?: boolean;
  onCreateAccount?: () => void;
  onOpenPricing?: () => void;
}

/**
 * Virtual Life. Paid members with a Banter username get the world (VlWorld). Everyone else sees the
 * feature preview with the right next step. If the database functions are not live yet, the page
 * shows the original Coming Soon preview, so shipping the website before the migration is safe.
 */
export default function VirtualLifePage({ isSignedIn = false, onCreateAccount, onOpenPricing }: VirtualLifePageProps) {
  const [state, setState] = useState<VlState | null>(null);

  const load = useCallback(async () => {
    setState(null);
    setState(await fetchVlState(isSignedIn));
  }, [isSignedIn]);

  // Refresh after an action without blanking the page.
  const refresh = useCallback(async () => {
    const next = await fetchVlState(isSignedIn);
    if (next.status === 'ready') setState(next);
  }, [isSignedIn]);

  useEffect(() => { load(); }, [load]);

  if (!state) {
    return <section className="vlife" aria-busy="true"><p className="vlife-lead vlife-loading">Loading Virtual Life…</p></section>;
  }

  if (state.status === 'ready') {
    return <VlWorld state={state} onRefresh={refresh} />;
  }

  return <Preview state={state} onCreateAccount={onCreateAccount} onOpenPricing={onOpenPricing} onRetry={load} />;
}

function Preview({
  state,
  onCreateAccount,
  onOpenPricing,
  onRetry,
}: {
  state: Exclude<VlState, { status: 'ready' }>;
  onCreateAccount?: () => void;
  onOpenPricing?: () => void;
  onRetry: () => void;
}) {
  const open = state.status !== 'not_ready';
  return (
    <section className="vlife" aria-labelledby="vlife-title">
      <header className="vlife-hero">
        <span className="vlife-kicker">New from Oddsbanta</span>
        <h1 id="vlife-title" className="vlife-title">Virtual Life</h1>
        <p className="vlife-lead">
          {open
            ? 'A fan world where your football knowledge takes you places. Earn Banta Coins from your Banter Hub calls and spend them on your avatar, your room and trips to football cities.'
            : 'A fan world where your football knowledge takes you places. Here is what is on the way.'}
        </p>
      </header>

      <ul className="vlife-list">
        {FEATURES.map((f) => (
          <li key={f.title} className="vlife-item">
            <span className="vlife-item-icon" aria-hidden="true">{f.icon}</span>
            <span className="vlife-item-text">
              <strong>{f.title}</strong>
              <span>{f.text}</span>
            </span>
          </li>
        ))}
      </ul>

      {state.status === 'not_ready' && (
        <div className="vlife-soon" role="status">
          <span className="vlife-soon-badge">Coming Soon</span>
          <p>Virtual Life is being built. Keep making your calls in the Banter Hub so you are ready when it opens.</p>
        </div>
      )}

      {state.status === 'visitor' && (
        <div className="vlife-soon">
          <span className="vlife-soon-badge">Now open for paid members</span>
          <p>Create an account and pick a plan to build your fan avatar and start earning Banta Coins.</p>
          {onCreateAccount && <button type="button" className="vlife-cta" onClick={onCreateAccount}>Create an account</button>}
        </div>
      )}

      {state.status === 'no_access' && (
        <div className="vlife-soon">
          <span className="vlife-soon-badge">For paid members</span>
          <p>Upgrade to a paid plan to enter Virtual Life and the Banter Hub.</p>
          {onOpenPricing && <button type="button" className="vlife-cta" onClick={onOpenPricing}>See plans</button>}
        </div>
      )}

      {state.status === 'needs_profile' && (
        <div className="vlife-soon">
          <span className="vlife-soon-badge">One step first</span>
          <p>Choose your Banter Hub username. It is your name in Virtual Life too.</p>
          <Link className="vlife-cta" to="/play">Open Banter Hub</Link>
        </div>
      )}

      {state.status === 'error' && (
        <div className="vlife-soon" role="alert">
          <span className="vlife-soon-badge">We couldn't open Virtual Life</span>
          <p>Please check your connection and try again.</p>
          <button type="button" className="vlife-cta" onClick={onRetry}>Try again</button>
        </div>
      )}
    </section>
  );
}
