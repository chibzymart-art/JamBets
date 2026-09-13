-- =====================================================================
-- Oddsbanta / JamBets — Migration: Harden RLS & Prevent Privilege Escalation
-- Resolves SEC-02:
-- 1. Drops overly permissive FOR ALL policies on subscriptions, entitlements, payments.
-- 2. Restricts user access to SELECT only for own rows.
-- 3. Restricts INSERT/UPDATE/DELETE on subscriptions/entitlements/payments strictly to is_admin() or service_role.
-- 4. Installs a BEFORE UPDATE trigger on public.users preventing non-admins from modifying role, status, or is_deleted.
-- =====================================================================

-- 1. SUBSCRIPTIONS: Restrict regular users to SELECT only on their own records
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_admin_all" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_all_policy" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_select_policy" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_admin_write_policy" ON public.subscriptions;

-- Regular users can only VIEW their own subscription status; admins can view all
CREATE POLICY "subscriptions_select_policy" ON public.subscriptions
    FOR SELECT TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = user_id);

-- Only admins and service_role can INSERT/UPDATE/DELETE subscriptions
CREATE POLICY "subscriptions_admin_write_policy" ON public.subscriptions
    FOR ALL TO authenticated, service_role
    USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');


-- 2. ENTITLEMENTS: Restrict regular users to SELECT only on their own records
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entitlements_select_own" ON public.entitlements;
DROP POLICY IF EXISTS "entitlements_admin_all" ON public.entitlements;
DROP POLICY IF EXISTS "entitlements_all_policy" ON public.entitlements;
DROP POLICY IF EXISTS "entitlements_select_policy" ON public.entitlements;
DROP POLICY IF EXISTS "entitlements_admin_write_policy" ON public.entitlements;

-- Regular users can only VIEW their own entitlements; admins can view all
CREATE POLICY "entitlements_select_policy" ON public.entitlements
    FOR SELECT TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = user_id);

-- Only admins and service_role can INSERT/UPDATE/DELETE entitlements
CREATE POLICY "entitlements_admin_write_policy" ON public.entitlements
    FOR ALL TO authenticated, service_role
    USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');


-- 3. PAYMENTS: Restrict regular users to SELECT only on their own records
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;
DROP POLICY IF EXISTS "payments_all_policy" ON public.payments;
DROP POLICY IF EXISTS "payments_select_policy" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_write_policy" ON public.payments;

-- Regular users can only VIEW their own payment records; admins can view all
CREATE POLICY "payments_select_policy" ON public.payments
    FOR SELECT TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = user_id);

-- Only admins and service_role can INSERT/UPDATE/DELETE payments
CREATE POLICY "payments_admin_write_policy" ON public.payments
    FOR ALL TO authenticated, service_role
    USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');


-- 4. USERS: Prevent Self-Elevation to Admin & Unauthorized Status Alteration
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_select_policy" ON public.users;
DROP POLICY IF EXISTS "users_update_policy" ON public.users;
DROP POLICY IF EXISTS "users_delete_policy" ON public.users;

-- Users can view their own profile; admins can view all profiles
CREATE POLICY "users_select_policy" ON public.users
    FOR SELECT TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = id);

-- Users can update their own profile; admins can update any profile
CREATE POLICY "users_update_policy" ON public.users
    FOR UPDATE TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = id)
    WITH CHECK (public.is_admin() OR auth.uid() = id);

-- Only admins can delete accounts
CREATE POLICY "users_delete_policy" ON public.users
    FOR DELETE TO authenticated, service_role
    USING (public.is_admin());


-- 5. TRIGGER: Hard Stop on Role, Status, and Deactivation Tampering
CREATE OR REPLACE FUNCTION public.protect_user_roles_and_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Allow modifications if caller is an administrator, service_role, or superuser
    IF NOT (public.is_admin() OR auth.role() = 'service_role' OR current_user = 'postgres') THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Security Violation: Only Oddsbanta administrators can modify user roles (attempted change from % to %).', OLD.role, NEW.role;
        END IF;

        IF NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Security Violation: Only Oddsbanta administrators can modify account status (attempted change from % to %).', OLD.status, NEW.status;
        END IF;

        IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
            RAISE EXCEPTION 'Security Violation: Only Oddsbanta administrators can modify account soft-delete status.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_roles_and_status ON public.users;
CREATE TRIGGER trg_protect_user_roles_and_status
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_user_roles_and_status();

-- Ensure grants are in place
GRANT EXECUTE ON FUNCTION public.protect_user_roles_and_status() TO authenticated, service_role;
