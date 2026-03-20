// supabase/functions/flutterwave-webhook/index.ts
//
// Handles two cases:
//
// 1. Flutterwave payment webhook (charge.completed)
//    Sets subscription_status = 'active' and extends subscription_expires_at
//    by 30 days on the user's profile.
//
// 2. Free coupon redemption (type: "coupon_redeem")
//    Called by the extension when MAVERIC100 is applied.
//    Requires a valid user JWT — verifies that body.user_id matches the
//    authenticated user to prevent unauthorized free-access grants.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const FLW_SECRET = Deno.env.get("FLW_WEBHOOK_SECRET")!;

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    const body = await req.json();

    // ── Free coupon redemption ────────────────────────────────
    // Requires a valid JWT — verifies body.user_id matches the caller
    if (body.type === "coupon_redeem") {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) return json({ error: "MISSING_AUTH" }, 401);

        const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user }, error: authError } = await userClient.auth.getUser();
        if (authError || !user) return json({ error: "INVALID_AUTH" }, 401);
        if ((body.user_id as string) !== user.id) return json({ error: "USER_MISMATCH" }, 403);

        return await handleCouponRedeem(body);
    }

    // ── Flutterwave webhook ───────────────────────────────────
    const signature = req.headers.get("verif-hash");
    if (signature !== FLW_SECRET) {
        return json({ error: "INVALID_SIGNATURE" }, 401);
    }

    if (body.event !== "charge.completed") return json({ ok: true, skipped: true });
    if (body.data?.status !== "successful") return json({ ok: true, skipped: true });

    return await handlePayment(body.data);
});

// ── Payment success ───────────────────────────────────────────
// tx_ref format: wizard_<userId>_<timestamp>_<coupon_or_none>
async function handlePayment(data: Record<string, unknown>) {
    const txRef = data.tx_ref as string;

    // Idempotency — skip if this tx_ref was already processed
    const { data: existing } = await supabase
        .from("user_profiles")
        .select("id")
        .eq("flutterwave_ref", txRef)
        .maybeSingle();
    if (existing) return json({ ok: true, duplicate: true });

    const parts = txRef.split("_");
    const userId = parts[1];
    const couponCode = parts[3] && parts[3] !== "none" ? parts[3] : null;

    if (!userId) return json({ error: "INVALID_TX_REF" }, 400);

    let couponId = null;

    if (couponCode) {
        const { error: couponErr } = await supabase.rpc("redeem_coupon", { p_code: couponCode });
        if (!couponErr) {
            const { data: coupon } = await supabase
                .from("coupons")
                .select("id")
                .eq("code", couponCode.toUpperCase().trim())
                .single();
            couponId = coupon?.id ?? null;
        }
    }

    // Extend subscription by 30 days from now (or from current expiry if still active)
    const { data: profile } = await supabase
        .from("user_profiles")
        .select("subscription_expires_at, subscription_status")
        .eq("id", userId)
        .single();

    const baseDate = (profile?.subscription_status === "active" && profile?.subscription_expires_at)
        ? new Date(profile.subscription_expires_at)
        : new Date();

    baseDate.setDate(baseDate.getDate() + 30);

    await supabase
        .from("user_profiles")
        .update({
            subscription_status:     "active",
            subscription_expires_at: baseDate.toISOString(),
            flutterwave_ref:         txRef,
            coupon_id:               couponId ?? undefined,
        })
        .eq("id", userId);

    return json({ ok: true });
}

// ── Free coupon redemption (MAVERIC100) ──────────────────────
async function handleCouponRedeem(body: Record<string, unknown>) {
    const { user_id, coupon } = body as { user_id: string; coupon: string };

    if (!user_id || !coupon) return json({ error: "MISSING_FIELDS" }, 400);
    if (coupon.toUpperCase().trim() !== "MAVERIC100") return json({ error: "NOT_FREE_COUPON" }, 400);

    const { data: profile } = await supabase
        .from("user_profiles")
        .select("id, subscription_status")
        .eq("id", user_id)
        .single();

    if (!profile) return json({ error: "USER_NOT_FOUND" }, 404);
    if (profile.subscription_status === "active" || profile.subscription_status === "free") {
        return json({ error: "ALREADY_SUBSCRIBED" }, 400);
    }

    // Redeem coupon atomically
    const { error: couponErr } = await supabase.rpc("redeem_coupon", { p_code: coupon });
    if (couponErr) {
        const msg = couponErr.message.includes("COUPON_EXHAUSTED") ? "COUPON_EXHAUSTED" : "COUPON_INVALID";
        return json({ error: msg }, 400);
    }

    const { data: couponRow } = await supabase
        .from("coupons")
        .select("id")
        .eq("code", "MAVERIC100")
        .single();

    await supabase
        .from("user_profiles")
        .update({
            subscription_status:     "free",
            subscription_expires_at: "2099-01-01T00:00:00Z",
            coupon_id:               couponRow?.id ?? null,
        })
        .eq("id", user_id);

    return json({ ok: true });
}

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, "Content-Type": "application/json" },
    });
}
