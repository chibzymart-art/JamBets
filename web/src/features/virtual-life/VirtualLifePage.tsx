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

/** Virtual Life preview: what the feature will be, then a Coming Soon notice. Static, no data. */
export default function VirtualLifePage() {
  return (
    <section className="vlife" aria-labelledby="vlife-title">
      <header className="vlife-hero">
        <span className="vlife-kicker">New from Oddsbanta</span>
        <h1 id="vlife-title" className="vlife-title">Virtual Life</h1>
        <p className="vlife-lead">
          A fan world where your football knowledge takes you places. Here is what is on the way.
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

      <div className="vlife-soon" role="status">
        <span className="vlife-soon-badge">Coming Soon</span>
        <p>Virtual Life is being built. Keep making your calls in the Banter Hub so you are ready when it opens.</p>
      </div>
    </section>
  );
}
