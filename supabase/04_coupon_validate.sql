-- ─────────────────────────────────────────────────────────────
-- 04_coupon_validate.sql
-- Atomically validates and redeems a coupon.
-- Called by Edge Functions via service_role.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION redeem_coupon(p_code text)
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

    UPDATE coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
    v_coupon.used_count := v_coupon.used_count + 1;
    RETURN v_coupon;
END;
$$;
