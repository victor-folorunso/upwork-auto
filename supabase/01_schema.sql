-- ─────────────────────────────────────────────────────────────
-- 01_schema.sql
-- Run this first. Clean slate — no prior tables assumed.
-- ─────────────────────────────────────────────────────────────

-- ── Coupons ──────────────────────────────────────────────────
CREATE TABLE coupons (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code             text NOT NULL UNIQUE,
    discount_percent integer NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
    max_uses         integer NOT NULL DEFAULT 0,   -- 0 = unlimited
    used_count       integer NOT NULL DEFAULT 0,
    active           boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── User profiles ─────────────────────────────────────────────
-- One row per auth.users entry, created on sign-up.
--
-- subscription_status:
--   'trial'    — within 30-day trial window
--   'active'   — paid and current
--   'expired'  — trial ended or payment lapsed
--   'free'     — granted via MAVERIC100 coupon (no expiry)
--
-- device: single JSONB object — 1 device per account.
--   { fingerprint, user_agent, first_seen, last_seen }
--   NULL until first login after sign-up.
--
-- custom_prompt: the user's editable prompt prefix.
--   NULL means use the built-in default.
--
-- prompt_format_locked: the output format block appended to
--   custom_prompt before copying. Stored here so we can update
--   it server-side without a client release.
CREATE TABLE user_profiles (
    id                      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email                   text NOT NULL,
    subscription_status     text NOT NULL DEFAULT 'trial'
                                CHECK (subscription_status IN ('trial','active','expired','free')),
    subscription_expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
    flutterwave_ref         text,                  -- last successful payment ref
    coupon_id               uuid REFERENCES coupons(id),
    custom_prompt           text,                  -- NULL = use built-in default
    device                  jsonb,                 -- single device object or NULL
    install_date            timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX idx_user_profiles_email  ON user_profiles(email);
CREATE INDEX idx_user_profiles_status ON user_profiles(subscription_status);
