-- ─────────────────────────────────────────────────────────────
-- 05_on_signup_trigger.sql
-- Auto-creates a user_profiles row when a new auth.users row
-- is inserted (i.e. on every sign-up).
-- Run after 03_rls.sql.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO user_profiles (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
