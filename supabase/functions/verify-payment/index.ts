// supabase/functions/verify-payment/index.ts
//
// Called by the extension to check if a Flutterwave payment has completed.
// Uses the Flutterwave secret key server-side — never exposed to the client.
//
// Request body: { tx_ref: string }
// Authorization header: Bearer <supabase_jwt>
//
// NOTE: coupon counter increments are handled exclusively by the
// flutterwave-webhook function to prevent double-counting.
// This function only reads the coupon id (no redeem_coupon call).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FLW_SECRET_KEY    = Deno.env.get("FLW_SECRET_KEY")!;

const CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "MISSING_AUTH" }, 401);

    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "INVALID_AUTH" }, 401);

    const body = await req.json().catch(() => ({}));
    const { tx_ref } = body as { tx_ref?: string };

    if (!tx_ref) return json({ error: "MISSING_TX_REF" }, 400);

    // tx_ref format: wizard_<userId>_<timestamp>_<coupon_or_none>
    const parts = tx_ref.split("_");
    if (parts[1] !== user.id) return json({ error: "TX_REF_MISMATCH" }, 403);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Idempotency — already processed?
    const { data: existing } = await adminClient
        .from("user_profiles")
        .select("flutterwave_ref")
        .eq("id", user.id)
        .single();

    if (existing?.flutterwave_ref === tx_ref) {
        return json({ ok: true, status: "duplicate" });
    }

    // Call Flutterwave verify API
    let flwData: Record<string, unknown>;
    try {
        const flwRes = await fetch(
            `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`,
            {
                headers: {
                    Authorization:  `Bearer ${FLW_SECRET_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );
        flwData = await flwRes.json();
    } catch (_) {
        return json({ error: "FLW_UNREACHABLE" }, 502);
    }

    const status = (flwData?.data as Record<string, unknown>)?.status as string;

    if (flwData?.status !== "success" || status !== "successful") {
        return json({ ok: false, status: "pending" });
    }

    // Payment confirmed — activate subscription.
    // Coupon counter NOT incremented here (webhook handles that).
    // We only look up the coupon id to record it on the profile.
    const couponCode = parts[3] && parts[3] !== "none" ? parts[3] : null;
    let couponId: string | null = null;

    if (couponCode) {
        const { data: coupon } = await adminClient
            .from("coupons")
            .select("id")
            .eq("code", couponCode.toUpperCase().trim())
            .single();
        couponId = coupon?.id ?? null;
    }

    const { data: profile } = await adminClient
        .from("user_profiles")
        .select("subscription_expires_at, subscription_status")
        .eq("id", user.id)
        .single();

    const baseDate = (
        profile?.subscription_status === "active" &&
        profile?.subscription_expires_at
    )
        ? new Date(profile.subscription_expires_at)
        : new Date();

    baseDate.setDate(baseDate.getDate() + 30);

    await adminClient
        .from("user_profiles")
        .update({
            subscription_status:     "active",
            subscription_expires_at: baseDate.toISOString(),
            flutterwave_ref:         tx_ref,
            ...(couponId ? { coupon_id: couponId } : {}),
        })
        .eq("id", user.id);

    return json({ ok: true, status: "activated" });
});

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, "Content-Type": "application/json" },
    });
}
