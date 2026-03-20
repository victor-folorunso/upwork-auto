-- ─────────────────────────────────────────────────────────────
-- 05_on_signup_trigger.sql
-- Auto-creates a user_profiles row when a new auth.users row
-- is inserted (i.e. on every sign-up).
--
-- Trial policy:
--   First 100 accounts → 30-day trial granted automatically
--   Account 101+       → subscription_status = 'expired', must pay to use
--
-- Run after 03_rls.sql.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account_count integer;
    v_status        text;
    v_expires_at    timestamptz;
BEGIN
    -- Count existing profiles atomically
    SELECT COUNT(*) INTO v_account_count FROM user_profiles;

    IF v_account_count < 100 THEN
        -- Early adopter — full 30-day trial
        v_status     := 'trial';
        v_expires_at := now() + interval '30 days';
    ELSE
        -- Trial slots exhausted — must pay
        v_status     := 'expired';
        v_expires_at := now();
    END IF;

    INSERT INTO user_profiles (id, email, subscription_status, subscription_expires_at)
    VALUES (NEW.id, NEW.email, v_status, v_expires_at);

    RETURN NEW;
END;
$$;

-- Re-create trigger (DROP first in case it already exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
