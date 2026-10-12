-- =====================================================================
-- Oddsbanta — Phase 2: High-Performance Pre-Computed Feed Snapshot Cache
-- Enables Zero-Join, Ultra-Low-Latency Edge Reads for 10,000+ Concurrent Users
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.cached_feeds (
    key TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for instant primary key lookup
CREATE INDEX IF NOT EXISTS idx_cached_feeds_key ON public.cached_feeds(key);

-- Enable Row Level Security
ALTER TABLE public.cached_feeds ENABLE ROW LEVEL SECURITY;

-- Allow public read access for Edge workers using anon key or direct query
DROP POLICY IF EXISTS "cached_feeds_public_read" ON public.cached_feeds;
CREATE POLICY "cached_feeds_public_read" ON public.cached_feeds
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow service_role full write and update access (Python cron and settlement engines)
DROP POLICY IF EXISTS "cached_feeds_service_role_write" ON public.cached_feeds;
CREATE POLICY "cached_feeds_service_role_write" ON public.cached_feeds
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow admins full management access
DROP POLICY IF EXISTS "cached_feeds_admin_write" ON public.cached_feeds;
CREATE POLICY "cached_feeds_admin_write" ON public.cached_feeds
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
