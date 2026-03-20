// supabase/functions/flutterwave-webhook/index.ts
//
// Handles two cases:
//
// 1. Flutterwave payment webhook (charge.completed)
//    Extends subscription by 30 days on payment success.
//
// 2. 100% coupon redemption (type: "coupon_redeem")
//    Called by the extension for MAVERIC100 (zero-payment path).
//    Gives 30 days active — NOT lifetime free access.
//    Requires a valid user JWT. Verifies body.user_id === caller.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FLW_SECRET        = Deno.env.get("FLW_WEBHOOK_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    const body = await req.json();

    // ── 100% coupon redemption (zero-payment path) ────────────
    if (body.type === "coupon_redeem") {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) return json({ error: "MISSING_AUTH" }, 401);

        const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user }, error: authError } = await userClient.auth.getUser();
        if (authError || !user) return json({ error: "INVALID_AUTH" }, 401);
        if ((body.user_id as string) !== user.id) return json({ error: "USER_MISMATCH" }, 403);

        return await handleFreeCoupon(body, user.id);
    }

    // ── Flutterwave webhook ───────────────────────────────────
    const signature = req.headers.get("verif-hash");
    if (signature !== FLW_SECRET) return json({ error: "INVALID_SIGNATURE" }, 401);

    if (body.event !== "charge.completed") return json({ ok: true, skipped: true });
    if (body.data?.status !== "successful") return json({ ok: true, skipped: true });

    return await handlePayment(body.data);
});

// ── Extend subscription by 30 days ───────────────────────────
// Shared helper used by both payment and coupon paths.
async function extendSubscription(userId: string, txRef: string | null, couponId: string | null) {
    const { data: profile } = await supabase
        .from("user_profiles")
        .select("subscription_expires_at, subscription_status")
        .eq("id", userId)
        .single();

    const baseDate = (
        profile?.subscription_status === "active" &&
        profile?.subscription_expires_at
    )
        ? new Date(profile.subscription_expires_at)
        : new Date();

    baseDate.setDate(baseDate.getDate() + 30);

    await supabase
        .from("user_profiles")
        .update({
            subscription_status:     "active",
            subscription_expires_at: baseDate.toISOString(),
            ...(txRef     ? { flutterwave_ref: txRef }     : {}),
            ...(couponId  ? { coupon_id:       couponId }  : {}),
        })
        .eq("id", userId);
}

// ── Flutterwave payment success ───────────────────────────────
// tx_ref format: wizard_<userId>_<timestamp>_<coupon_or_none>
async function handlePayment(data: Record<string, unknown>) {
    const txRef = data.tx_ref as string;

    // Idempotency — skip if already processed
    const { data: existing } = await supabase
        .from("user_profiles")
        .select("id")
        .eq("flutterwave_ref", txRef)
        .maybeSingle();
    if (existing) return json({ ok: true, duplicate: true });

    const parts    = txRef.split("_");
    const userId   = parts[1];
    const couponCode = parts[3] && parts[3] !== "none" ? parts[3] : null;

    if (!userId) return json({ error: "INVALID_TX_REF" }, 400);

    let couponId: string | null = null;

    if (couponCode) {
        // redeem_coupon now requires user_id for per-user single-use enforcement
        const { error: couponErr } = await supabase.rpc("redeem_coupon", {
            p_code:    couponCode,
            p_user_id: userId,
        });
        if (!couponErr) {
            const { data: coupon } = await supabase
                .from("coupons")
                .select("id")
                .eq("code", couponCode.toUpperCase().trim())
                .single();
            couponId = coupon?.id ?? null;
        }
        // If coupon error (exhausted / already used) — don't block the payment,
        // just proceed without recording the coupon (payment already happened).
    }

    await extendSubscription(userId, txRef, couponId);
    return json({ ok: true });
}

// ── 100% coupon path (no Flutterwave) ────────────────────────
async function handleFreeCoupon(body: Record<string, unknown>, callerId: string) {
    const { user_id, coupon } = body as { user_id: string; coupon: string };

    if (!user_id || !coupon) return json({ error: "MISSING_FIELDS" }, 400);

    const { data: profile } = await supabase
        .from("user_profiles")
        .select("id, subscription_status")
        .eq("id", user_id)
        .single();

    if (!profile) return json({ error: "USER_NOT_FOUND" }, 404);

    // Redeem coupon atomically — enforces per-user single-use
    const { error: couponErr } = await supabase.rpc("redeem_coupon", {
        p_code:    coupon,
        p_user_id: user_id,
    });

    if (couponErr) {
        if (couponErr.message.includes("COUPON_EXHAUSTED"))   return json({ error: "COUPON_EXHAUSTED" }, 400);
        if (couponErr.message.includes("COUPON_ALREADY_USED")) return json({ error: "COUPON_ALREADY_USED" }, 400);
        return json({ error: "COUPON_INVALID" }, 400);
    }

    const { data: couponRow } = await supabase
        .from("coupons")
        .select("id")
        .eq("code", (coupon as string).toUpperCase().trim())
        .single();

    // 100% off = 30 days active — same as a paid month, not lifetime
    await extendSubscription(user_id, null, couponRow?.id ?? null);
    return json({ ok: true });
}

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, "Content-Type": "application/json" },
    });
}
