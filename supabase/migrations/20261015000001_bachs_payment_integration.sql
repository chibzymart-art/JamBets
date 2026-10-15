-- =====================================================================
-- JamBets / Oddsbanta: Bachs.io Recurring Subscription Integration
-- Migration: 20261015000001_bachs_payment_integration.sql
-- Strictly non-destructive: Extends existing tables and adds idempotency logging.
-- =====================================================================

-- 1. Extend public.subscriptions with Bachs tracking columns
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS bachs_subscription_id TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS bachs_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS bachs_product_id TEXT,
    ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

-- Create high-speed lookup indexes for subscription and customer references
CREATE INDEX IF NOT EXISTS idx_subscriptions_bachs_sub_id 
    ON public.subscriptions (bachs_subscription_id) 
    WHERE bachs_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_bachs_cust_id 
    ON public.subscriptions (bachs_customer_id) 
    WHERE bachs_customer_id IS NOT NULL;

-- 2. Extend public.payments with Bachs payment tracking
ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS bachs_payment_id TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'bachs';

CREATE INDEX IF NOT EXISTS idx_payments_bachs_payment_id 
    ON public.payments (bachs_payment_id) 
    WHERE bachs_payment_id IS NOT NULL;

-- 3. Create public.webhook_events_log for zero-cheat anti-replay guarantee
CREATE TABLE IF NOT EXISTS public.webhook_events_log (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'bachs',
    payload JSONB DEFAULT '{}'::jsonb,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS Security: Restrict webhook_events_log strictly to service_role and admin
ALTER TABLE public.webhook_events_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_events_log_service_role" ON public.webhook_events_log;
CREATE POLICY "webhook_events_log_service_role" ON public.webhook_events_log
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Ensure public cannot read or write webhook events log
REVOKE ALL ON public.webhook_events_log FROM anon, authenticated;
GRANT ALL ON public.webhook_events_log TO service_role;
GRANT ALL ON public.webhook_events_log TO postgres;
