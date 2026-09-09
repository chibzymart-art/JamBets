-- JamBets Migration: Compliance-Safe User Account Soft Deletion
-- Date: 2026-09-09
-- Purpose: Add soft-delete flag, status enum, and timestamp to public.users. Accounts are NEVER hard-deleted.

ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'suspended')),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Index for high-performance lookup of active/disabled users
CREATE INDEX IF NOT EXISTS idx_users_is_deleted_status 
  ON public.users(is_deleted, status);

-- Update RLS policy to ensure users can update their own profile (including soft-delete deactivation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'users' AND policyname = 'Users can update their own account status'
  ) THEN
    CREATE POLICY "Users can update their own account status"
      ON public.users
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;
