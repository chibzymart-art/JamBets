import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchVlBalance } from '../virtual-life/vlifeApi';

/**
 * Banta Coins on the Banter profile: the member's balance and a link to Virtual Life.
 * Hidden when Virtual Life isn't available (not applied yet, no access, or an error).
 */
export function BanterCoinsCard() {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetchVlBalance().then((b) => { if (live) setBalance(b); });
    return () => { live = false; };
  }, []);
  if (balance == null) return null;
  return (
    <div className="bh-card bh-coins">
      <span className="bh-coins-icon" aria-hidden="true">B</span>
      <div className="bh-coins-text">
        <b>{balance.toLocaleString('en-US')} Banta Coins</b>
        <small>+10 for every pick you win. Spend them in Virtual Life.</small>
      </div>
      <Link className="bh-btn bh-coins-link" to="/virtual-life">Virtual Life</Link>
    </div>
  );
}
