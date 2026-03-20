// supabase/functions/validate-license/index.ts
//
// Called by the extension on every startup (after trial expires).
// Validates the license key and records/updates the machine fingerprint.
// Max 2 unique fingerprints per license key.
//
// Request body: { license_key, fingerprint }
// Response:
//   200 { ok: true, email }          — valid and activated
//   400 { error: "KEY_INVALID" }     — key not found or revoked
//   400 { error: "KEY_EXPIRED" }     — past expires_at
//   403 { error: "DEVICE_LIMIT" }    — 2 fingerprints already registered
//                                       and this one is not among them

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const MAX_ACTIVATIONS = 2;

serve(async (req) => {
    const { license_key, fingerprint } = await req.json();

    if (!license_key || !fingerprint) {
        return json({ error: "MISSING_FIELDS" }, 400);
    }

    // ── Fetch license ─────────────────────────────────────────
    const { data: license } = await supabase
        .from("licenses")
        .select("id, email, status, expires_at")
        .eq("license_key", license_key.trim().toUpperCase())
        .maybeSingle();

    if (!license || license.status !== "active") {
        return json({ error: "KEY_INVALID" }, 400);
    }

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
        return json({ error: "KEY_EXPIRED" }, 400);
    }

    // ── Check existing activations ────────────────────────────
    const { data: activations } = await supabase
        .from("license_activations")
        .select("id, fingerprint")
        .eq("license_id", license.id);

    const existing = activations ?? [];
    const alreadyRegistered = existing.find(a => a.fingerprint === fingerprint);

    if (alreadyRegistered) {
        // Known device — just update last_seen_at
        await supabase
            .from("license_activations")
            .update({ last_seen_at: new Date().toISOString() })
            .eq("id", alreadyRegistered.id);

        return json({ ok: true, email: license.email });
    }

    // New fingerprint — check device cap
    if (existing.length >= MAX_ACTIVATIONS) {
        return json({ error: "DEVICE_LIMIT" }, 403);
    }

    // Register new device
    await supabase
        .from("license_activations")
        .insert({ license_id: license.id, fingerprint });

    return json({ ok: true, email: license.email });
});

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}
