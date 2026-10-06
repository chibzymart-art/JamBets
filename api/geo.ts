export const config = {
  runtime: 'edge',
};

export interface GeoPricingTier {
  monthly: number;
  quarterly: number; // 3 months with 10% discount: 3 * monthly * 0.90
  monthlyEquivalent: number; // quarterly / 3
  savingsPercent: number; // 10
}

export interface GeoResponse {
  country: string;
  isNigeria: boolean;
  currency: 'NGN' | 'USD';
  symbol: string;
  timezone: string;
  pricing: {
    standard: GeoPricingTier;
    bigbang: GeoPricingTier;
  };
}

export default async function handler(req: Request): Promise<Response> {
  const countryHeader = req.headers.get('x-vercel-ip-country') || '';
  const timezone = req.headers.get('x-vercel-ip-timezone') || 'Africa/Lagos';

  // Strict rule: Only Nigeria ('NG') sees NGN (₦5,000 / ₦10,000).
  // All other geopolitical zones see USD ($5 / $10).
  const isNigeria = countryHeader.toUpperCase() === 'NG';
  const country = countryHeader ? countryHeader.toUpperCase() : (isNigeria ? 'NG' : 'GLOBAL');

  const data: GeoResponse = {
    country,
    isNigeria,
    currency: isNigeria ? 'NGN' : 'USD',
    symbol: isNigeria ? '₦' : '$',
    timezone,
    pricing: {
      standard: {
        monthly: isNigeria ? 5000 : 5,
        quarterly: isNigeria ? 13500 : 13.50, // ₦15,000 - 10% or $15 - 10%
        monthlyEquivalent: isNigeria ? 4500 : 4.50,
        savingsPercent: 10,
      },
      bigbang: {
        monthly: isNigeria ? 10000 : 10,
        quarterly: isNigeria ? 27000 : 27.00, // ₦30,000 - 10% or $30 - 10%
        monthlyEquivalent: isNigeria ? 9000 : 9.00,
        savingsPercent: 10,
      },
    },
  };

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
