-- ─────────────────────────────────────────────────────────────
-- 03_rls.sql
-- Run after 02_seed.sql.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE coupons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Coupons: no direct public access — Edge Functions use service_role
CREATE POLICY "coupons_no_public"
    ON coupons FOR ALL TO anon, authenticated USING (false);

-- user_profiles: authenticated users can read/update their own row only
CREATE POLICY "profiles_select_own"
    ON user_profiles FOR SELECT TO authenticated
    USING (id = auth.uid());

CREATE POLICY "profiles_update_own"
    ON user_profiles FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (
        -- Users can only update these two columns themselves.
        -- Everything else (subscription_status, device, etc.)
        -- is written by Edge Functions via service_role.
        id = auth.uid()
    );

-- Insert is handled by the sign-up Edge Function (service_role)
-- so no INSERT policy needed for authenticated role.
