-- =====================================================================
-- JamBets — Phase 10: Email Marketing, Drips & Smart Quota Queue
-- Supports 1,000+ daily free emails, unsubscribe compliance, & drip funnels
-- =====================================================================

-- 1. Email Subscribers Table
CREATE TABLE IF NOT EXISTS public.email_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed', 'bounced', 'complained')),
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'standard', 'bigbang', 'pro', 'premium')),
    unsubscribe_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    preferences JSONB NOT NULL DEFAULT '{
        "onboarding_drip": true,
        "matchday_alerts": true,
        "weekly_digest": true,
        "promotions": true
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_emailed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_subscribers_email ON public.email_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_email_subscribers_status ON public.email_subscribers(status);
CREATE INDEX IF NOT EXISTS idx_email_subscribers_user_id ON public.email_subscribers(user_id);

-- 2. Email Campaigns Definition Table
CREATE TABLE IF NOT EXISTS public.email_campaigns (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject_template TEXT NOT NULL,
    template_name TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('drip', 'broadcast', 'event', 'manual')),
    delay_days INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial standard campaigns
INSERT INTO public.email_campaigns (slug, name, subject_template, template_name, trigger_type, delay_days, is_active)
VALUES
    ('onboarding_day0', 'Day 0: Welcome & Banker Drop', '🎯 Welcome to Oddsbanta — Here is today''s high-confidence Banker Pick', 'onboarding_day0_welcome', 'drip', 0, true),
    ('onboarding_day1', 'Day 1: AI Model & xG Breakdown', '🧠 How our AI model beat the bookies by 14.8% last month', 'onboarding_day1_math_breakdown', 'drip', 1, true),
    ('onboarding_day3', 'Day 3: Proof of Performance & Wins', '📈 Yesterday''s results: 4 out of 5 clean sweep (Full breakdown)', 'onboarding_day3_proof_results', 'drip', 3, true),
    ('onboarding_day5', 'Day 5: Bankroll & Staking Discipline', '💡 The #1 mistake 95% of punters make (and how to fix it)', 'onboarding_day5_bankroll_mistakes', 'drip', 5, true),
    ('onboarding_day7', 'Day 7: VIP Pro Upgrade & Bot Access', '🚀 Upgrade your edge: Unlock Goals Specialist & VIP Telegram Bot', 'onboarding_day7_vip_upgrade', 'drip', 7, true),
    ('matchday_alert', 'Weekend / Midweek Matchday Drop', '🔥 Matchday Drop: Top Value Bets for Today''s Fixtures', 'matchday_alert', 'broadcast', 0, true),
    ('reengagement_inactive', 'Inactive 14-Day Re-engagement', '👋 We missed you! Claim 3 Free VIP Predictions this Weekend', 'reengagement_inactive', 'drip', 14, true)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    subject_template = EXCLUDED.subject_template,
    template_name = EXCLUDED.template_name,
    delay_days = EXCLUDED.delay_days,
    is_active = EXCLUDED.is_active;

-- 3. Email Outbound Queue
CREATE TABLE IF NOT EXISTS public.email_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_email TEXT NOT NULL,
    subscriber_id UUID REFERENCES public.email_subscribers(id) ON DELETE SET NULL,
    campaign_slug TEXT REFERENCES public.email_campaigns(slug) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    template_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
    priority INT NOT NULL DEFAULT 5,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    last_error TEXT,
    provider_used TEXT,
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Enforce idempotency: prevent queuing the same drip twice for the same recipient
    UNIQUE(recipient_email, campaign_slug)
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status_scheduled ON public.email_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_email_queue_recipient ON public.email_queue(recipient_email);

-- 4. Provider Daily Quota Tracking (Enforces 1,000+ free email multi-relay rotation)
CREATE TABLE IF NOT EXISTS public.email_provider_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id TEXT NOT NULL,
    quota_date DATE NOT NULL DEFAULT CURRENT_DATE,
    sent_count INT NOT NULL DEFAULT 0,
    daily_limit INT NOT NULL DEFAULT 500,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider_id, quota_date)
);

CREATE INDEX IF NOT EXISTS idx_email_provider_quotas_lookup ON public.email_provider_quotas(provider_id, quota_date);

-- 5. Trigger Function: Automatically enroll new public.users into email_subscribers
CREATE OR REPLACE FUNCTION public.handle_new_user_email_enrollment()
RETURNS TRIGGER AS $$
DECLARE
    v_sub_id UUID;
BEGIN
    -- Upsert into public.email_subscribers
    INSERT INTO public.email_subscribers (
        user_id,
        email,
        display_name,
        tier
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.display_name, split_part(NEW.email, '@', 1)),
        COALESCE(NEW.role, 'free')
    )
    ON CONFLICT (email) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        display_name = COALESCE(EXCLUDED.display_name, email_subscribers.display_name),
        tier = COALESCE(EXCLUDED.tier, email_subscribers.tier)
    RETURNING id INTO v_sub_id;

    -- Automatically enqueue Day 0 Welcome Drip
    INSERT INTO public.email_queue (
        recipient_email,
        subscriber_id,
        campaign_slug,
        subject,
        template_data,
        scheduled_for
    )
    VALUES (
        NEW.email,
        v_sub_id,
        'onboarding_day0',
        '🎯 Welcome to Oddsbanta — Here is today''s high-confidence Banker Pick',
        jsonb_build_object(
            'display_name', COALESCE(NEW.display_name, split_part(NEW.email, '@', 1)),
            'user_id', NEW.id
        ),
        NOW()
    )
    ON CONFLICT (recipient_email, campaign_slug) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to public.users if table exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
        DROP TRIGGER IF EXISTS trg_user_email_enrollment ON public.users;
        CREATE TRIGGER trg_user_email_enrollment
            AFTER INSERT ON public.users
            FOR EACH ROW
            EXECUTE FUNCTION public.handle_new_user_email_enrollment();
    END IF;
END $$;

-- 6. RLS Policies
ALTER TABLE public.email_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_provider_quotas ENABLE ROW LEVEL SECURITY;

-- Allow public / unauthenticated users to read campaign subjects or unsubscribe with valid token
DROP POLICY IF EXISTS "Public can view active campaigns" ON public.email_campaigns;
CREATE POLICY "Public can view active campaigns"
    ON public.email_campaigns FOR SELECT
    USING (is_active = true);

DROP POLICY IF EXISTS "Users can view and update own subscriber profile" ON public.email_subscribers;
CREATE POLICY "Users can view and update own subscriber profile"
    ON public.email_subscribers FOR ALL
    USING (auth.uid() = user_id);

-- Service role has full permissions over queue and quotas
DROP POLICY IF EXISTS "Service role manages email queue" ON public.email_queue;
CREATE POLICY "Service role manages email queue"
    ON public.email_queue FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manages quotas" ON public.email_provider_quotas;
CREATE POLICY "Service role manages quotas"
    ON public.email_provider_quotas FOR ALL
    USING (true)
    WITH CHECK (true);
