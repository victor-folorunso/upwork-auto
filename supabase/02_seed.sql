-- ─────────────────────────────────────────────────────────────
-- 02_seed.sql
-- Run once after 01_schema.sql.
-- ─────────────────────────────────────────────────────────────

INSERT INTO coupons (code, discount_percent, max_uses) VALUES
    ('MAVERIC50',  50,  20),
    ('MAVERIC100', 100, 10);
