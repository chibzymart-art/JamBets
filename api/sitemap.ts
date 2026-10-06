import { getTrackRecord } from './_lib/trackRecord';
import { renderSitemap } from './_lib/ssrRender';

/**
 * Dynamic sitemap.xml (vercel.json rewrites /sitemap.xml here).
 *
 * The URL list comes from the SSR route table in _lib/ssrRender.ts, so it follows route
 * changes automatically. lastmod comes from the latest settled result per sport. If the track
 * record is unavailable the sitemap is still served, just without lastmod, and not CDN-cached.
 */
export const config = {
  runtime: 'edge',
};

export default async function handler(): Promise<Response> {
  const tr = await getTrackRecord().catch(() => null);
  const xml = renderSitemap(tr);
  const cdn = tr ? 'public, s-maxage=3600, stale-while-revalidate=86400' : 'no-store';

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'CDN-Cache-Control': cdn,
      'Vercel-CDN-Cache-Control': cdn,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
