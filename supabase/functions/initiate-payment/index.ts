// supabase/functions/initiate-payment/index.ts
//
// Creates a Flutterwave Standard payment link and returns it to the extension.
// The extension opens the link in a new tab — Flutterwave handles the full
// checkout UI (card, bank transfer, USSD, etc.).
//
// Request body: { tx_ref, amount, email }
// Authorization: Bearer <supabase_jwt>
//
// Response: { ok: true, payment_link, tx_ref }
//
// Required secret: FLW_SECRET_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FLW_SECRET_KEY   = Deno.env.get("FLW_SECRET_KEY")!;

const CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    // ── Auth ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "MISSING_AUTH" }, 401);

    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "INVALID_AUTH" }, 401);

    // ── Parse body ────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { tx_ref, amount, email } = body as {
        tx_ref?: string;
        amount?: number;
        email?: string;
    };

    if (!tx_ref || !amount || !email) return json({ error: "MISSING_FIELDS" }, 400);

    // tx_ref format: wizard_<userId>_<timestamp>_<coupon_or_none>
    const parts = tx_ref.split("_");
    if (parts[1] !== user.id) return json({ error: "TX_REF_MISMATCH" }, 403);
    if (amount !== 1000 && amount !== 500) return json({ error: "INVALID_AMOUNT" }, 400);

    // ── Create Flutterwave Standard payment ───────────────────
    // This creates a hosted checkout link — Flutterwave shows their
    // full payment UI (card, bank transfer, USSD, etc.)
    let flwData: Record<string, unknown>;
    try {
        const flwRes = await fetch("https://api.flutterwave.com/v3/payments", {
            method: "POST",
            headers: {
                Authorization:  `Bearer ${FLW_SECRET_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                tx_ref,
                amount,
                currency:     "NGN",
                payment_options: "card,banktransfer,ussd",
                redirect_url: "https://www.upwork.com",  // user lands back on Upwork after paying
                customer: {
                    email,
                    name: email.split("@")[0],
                },
                customizations: {
                    title:       "Upwork Wizard",
                    description: `Monthly subscription — ₦${amount.toLocaleString()}`,
                    logo:        "https://www.upwork.com/favicon.ico",
                },
                meta: {
                    source:  "upwork_wizard_extension",
                    user_id: user.id,
                },
            }),
        });

        flwData = await flwRes.json();
    } catch (e) {
        console.error("Flutterwave API error:", e);
        return json({ error: "FLW_UNREACHABLE" }, 502);
    }

    if (flwData?.status !== "success") {
        console.error("Flutterwave payment init failed:", JSON.stringify(flwData));
        return json({
            error:   "FLW_INITIATE_FAILED",
            message: (flwData?.message as string) ?? "Unknown error from Flutterwave",
        }, 502);
    }

    return json({
        ok:           true,
        payment_link: (flwData.data as Record<string, unknown>)?.link as string,
        tx_ref,
    });
});

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, "Content-Type": "application/json" },
    });
}
