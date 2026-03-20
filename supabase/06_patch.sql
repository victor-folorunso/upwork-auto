-- ─────────────────────────────────────────────────────────────
-- 06_patch.sql
-- Run after 05_on_signup_trigger.sql.
-- ─────────────────────────────────────────────────────────────


-- ══════════════════════════════════════════════════════════════
-- 1. Migrate existing trial/free users → expired FIRST
--    (must happen before the constraint is tightened)
-- ══════════════════════════════════════════════════════════════

UPDATE user_profiles
SET
    subscription_status     = 'expired',
    subscription_expires_at = now()
WHERE subscription_status IN ('trial', 'free');


-- ══════════════════════════════════════════════════════════════
-- 2. Now safe to tighten the constraint
-- ══════════════════════════════════════════════════════════════

ALTER TABLE user_profiles
    DROP CONSTRAINT IF EXISTS user_profiles_subscription_status_check;

ALTER TABLE user_profiles
    ADD CONSTRAINT user_profiles_subscription_status_check
    CHECK (subscription_status IN ('active', 'expired'));


-- ══════════════════════════════════════════════════════════════
-- 3. Replace on_auth_user_created trigger
-- ══════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO user_profiles (id, email, subscription_status, subscription_expires_at)
    VALUES (NEW.id, NEW.email, 'expired', now());
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ══════════════════════════════════════════════════════════════
-- 4. Per-user coupon usage tracking
-- ══════════════════════════════════════════════════════════════

CREATE TABLE user_coupon_uses (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    coupon_id  uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    used_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, coupon_id)
);

CREATE INDEX idx_user_coupon_uses_user ON user_coupon_uses(user_id);

ALTER TABLE user_coupon_uses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coupon_uses_select_own"
    ON user_coupon_uses FOR SELECT TO authenticated
    USING (user_id = auth.uid());


-- ══════════════════════════════════════════════════════════════
-- 5. Replace redeem_coupon function
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS redeem_coupon(text);

CREATE OR REPLACE FUNCTION redeem_coupon(p_code text, p_user_id uuid)
RETURNS coupons
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_coupon coupons;
BEGIN
    SELECT * INTO v_coupon
    FROM coupons
    WHERE code = upper(trim(p_code))
      AND active = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'COUPON_INVALID';
    END IF;

    IF v_coupon.max_uses > 0 AND v_coupon.used_count >= v_coupon.max_uses THEN
        RAISE EXCEPTION 'COUPON_EXHAUSTED';
    END IF;

    IF EXISTS (
        SELECT 1 FROM user_coupon_uses
        WHERE user_id = p_user_id AND coupon_id = v_coupon.id
    ) THEN
        RAISE EXCEPTION 'COUPON_ALREADY_USED';
    END IF;

    UPDATE coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
    v_coupon.used_count := v_coupon.used_count + 1;

    INSERT INTO user_coupon_uses (user_id, coupon_id)
    VALUES (p_user_id, v_coupon.id);

    RETURN v_coupon;
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 6. Replace coupon seed data with new 4-tier structure
--    Must null out user_profiles.coupon_id references first,
--    otherwise the DELETE violates the foreign key constraint.
-- ══════════════════════════════════════════════════════════════

UPDATE user_profiles SET coupon_id = NULL WHERE coupon_id IS NOT NULL;

DELETE FROM coupons;

INSERT INTO coupons (code, discount_percent, max_uses) VALUES
    ('MAVERIC50',  50,  50),
    ('MAVERIC75',  75,  30),
    ('MAVERIC90',  90,  15),
    ('MAVERIC100', 100,  5);


-- ══════════════════════════════════════════════════════════════
-- 7. Messages table (in-extension contact form)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE messages (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    email      text NOT NULL,
    body       text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 2000),
    read       boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_user    ON messages(user_id);
CREATE INDEX idx_messages_read    ON messages(read);
CREATE INDEX idx_messages_created ON messages(created_at DESC);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_insert_own"
    ON messages FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "messages_select_own"
    ON messages FOR SELECT TO authenticated
    USING (user_id = auth.uid());
