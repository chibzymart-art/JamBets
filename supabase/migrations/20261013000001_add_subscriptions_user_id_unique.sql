-- =====================================================================
-- Oddsbanta / JamBets — Migration: Add Unique Constraint to Subscriptions
-- Resolves: PostgreSQL Error 42P10 where ON CONFLICT (user_id) requires
--           a UNIQUE or EXCLUSION constraint on public.subscriptions.
-- =====================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'subscriptions_user_id_unique' 
           OR conname = 'subscriptions_user_id_key'
    ) THEN
        ALTER TABLE public.subscriptions 
        ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
    END IF;
END $$;
