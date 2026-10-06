import { useState, useEffect } from 'react';

export type CurrencyCode = 'NGN' | 'USD';
export type BillingCycle = 'monthly' | 'quarterly';

export interface GeoPricingTier {
  monthly: number;
  quarterly: number;
  monthlyEquivalent: number;
  savingsPercent: number;
}

export interface GeoPricingMatrix {
  standard: GeoPricingTier;
  bigbang: GeoPricingTier;
}

export const PRICING_BY_CURRENCY: Record<CurrencyCode, GeoPricingMatrix> = {
  NGN: {
    standard: {
      monthly: 5000,
      quarterly: 13500, // ₦15,000 - 10%
      monthlyEquivalent: 4500,
      savingsPercent: 10,
    },
    bigbang: {
      monthly: 10000,
      quarterly: 27000, // ₦30,000 - 10%
      monthlyEquivalent: 9000,
      savingsPercent: 10,
    },
  },
  USD: {
    standard: {
      monthly: 5,
      quarterly: 13.50, // $15 - 10%
      monthlyEquivalent: 4.50,
      savingsPercent: 10,
    },
    bigbang: {
      monthly: 10,
      quarterly: 27.00, // $30 - 10%
      monthlyEquivalent: 9.00,
      savingsPercent: 10,
    },
  },
};

const STORAGE_KEY = 'oddsbanta_currency_preference';

/**
 * Format a numeric amount with the proper currency symbol and formatting.
 * Examples:
 *   formatAmount(5000, 'NGN')  => "₦5,000"
 *   formatAmount(13500, 'NGN') => "₦13,500"
 *   formatAmount(5, 'USD')     => "$5"
 *   formatAmount(13.5, 'USD')  => "$13.50"
 */
export function formatAmount(amount: number, currency: CurrencyCode): string {
  if (currency === 'NGN') {
    return `₦${Math.round(amount).toLocaleString('en-US')}`;
  }
  // USD
  const hasDecimals = amount % 1 !== 0;
  return `$${hasDecimals ? amount.toFixed(2) : amount}`;
}

/**
 * Fast client-side fallback detection based on browser timezone
 * Used while `/api/geo` is loading or when running offline/local.
 */
export function detectLocalDefaultCurrency(): CurrencyCode {
  if (typeof window === 'undefined') return 'NGN';
  
  // 1. Check user manual override preference
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'NGN' || saved === 'USD') return saved;

  // 2. Check timezone heuristic: Africa/Lagos -> NGN; all others -> USD
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === 'Africa/Lagos') return 'NGN';
  } catch {}

  // Default to USD for all non-Nigeria zones
  return 'USD';
}

export function useGeoCurrency() {
  const [currency, setCurrencyState] = useState<CurrencyCode>(detectLocalDefaultCurrency);
  const [detectedCountry, setDetectedCountry] = useState<string>('DETECTING');
  const [hasResolved, setHasResolved] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    // Check if user has explicitly pinned their preferred currency
    const userOverride = localStorage.getItem(STORAGE_KEY);
    if (userOverride === 'NGN' || userOverride === 'USD') {
      setCurrencyState(userOverride);
      setHasResolved(true);
      return;
    }

    // Call edge geolocation endpoint
    fetch('/api/geo')
      .then((res) => {
        if (!res.ok) throw new Error('Geo lookup failed');
        return res.json();
      })
      .then((data) => {
        if (!isMounted) return;
        setDetectedCountry(data.country || 'UNKNOWN');
        // Only Nigeria sees NGN (5000 / 10000). All others see USD ($5 / $10).
        const resolved: CurrencyCode = data.isNigeria ? 'NGN' : 'USD';
        setCurrencyState(resolved);
        setHasResolved(true);
      })
      .catch(() => {
        if (!isMounted) return;
        // Fallback to timezone heuristic
        setCurrencyState(detectLocalDefaultCurrency());
        setHasResolved(true);
      });

    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent<CurrencyCode>;
      if (customEvent.detail === 'NGN' || customEvent.detail === 'USD') {
        setCurrencyState(customEvent.detail);
      }
    };
    window.addEventListener('oddsbanta_currency_change', handleSync);

    return () => {
      isMounted = false;
      window.removeEventListener('oddsbanta_currency_change', handleSync);
    };
  }, []);

  const setCurrency = (newCurrency: CurrencyCode) => {
    setCurrencyState(newCurrency);
    try {
      localStorage.setItem(STORAGE_KEY, newCurrency);
      window.dispatchEvent(new CustomEvent('oddsbanta_currency_change', { detail: newCurrency }));
    } catch {}
  };

  const currentPricing = PRICING_BY_CURRENCY[currency];
  const symbol = currency === 'NGN' ? '₦' : '$';
  const isNigeria = currency === 'NGN';

  return {
    currency,
    symbol,
    isNigeria,
    pricing: currentPricing,
    hasResolved,
    detectedCountry,
    setCurrency,
    formatPrice: (amount: number) => formatAmount(amount, currency),
  };
}
