// auth.js — Supabase auth, session management, device binding,
//           subscription checks, prompt storage.
//           Uses OTP email verification — no redirect links.

const WIZARD_CONFIG = {
    supabaseUrl:       'https://bszdgbpftqdmlnpqqzmq.supabase.co',
    supabaseAnonKey:   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzemRnYnBmdHFkbWxucHFxem1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMDM2NzYsImV4cCI6MjA4OTU3OTY3Nn0.X9C8Hgr76BsV7XOrXnVCuIrM3e4s6e48T2jpgp8Ey0w',
    webhookEndpoint:   'https://bszdgbpftqdmlnpqqzmq.supabase.co/functions/v1/flutterwave-webhook',
    verifyEndpoint:    'https://bszdgbpftqdmlnpqqzmq.supabase.co/functions/v1/verify-payment',
    initiateEndpoint:  'https://bszdgbpftqdmlnpqqzmq.supabase.co/functions/v1/initiate-payment',
};

// ── Supabase client ───────────────────────────────────────────
const _supabase = supabase.createClient(
    WIZARD_CONFIG.supabaseUrl,
    WIZARD_CONFIG.supabaseAnonKey,
    {
        auth: {
            persistSession: true,
            storage: {
                getItem:    (key) => new Promise(r => chrome.storage.local.get(key, d => r(d[key] ?? null))),
                setItem:    (key, val) => new Promise(r => chrome.storage.local.set({ [key]: val }, r)),
                removeItem: (key) => new Promise(r => chrome.storage.local.remove(key, r)),
            }
        }
    }
);

// ── Machine fingerprint ───────────────────────────────────────
function getFingerprint() {
    const raw = [
        navigator.userAgent,
        navigator.language,
        `${screen.width}x${screen.height}x${screen.colorDepth}`,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.hardwareConcurrency ?? 0,
        navigator.platform ?? '',
    ].join('|');
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

// ── Chrome storage helpers ────────────────────────────────────
function csGet(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function csSet(data) { return new Promise(r => chrome.storage.local.set(data, r)); }

// ── Session cache (24h) ───────────────────────────────────────
async function getCachedStatus() {
    const { wz_status_cache } = await csGet('wz_status_cache');
    if (!wz_status_cache) return null;
    if (Date.now() > wz_status_cache.expires) return null;
    return wz_status_cache;
}

async function setCachedStatus(status, extra = {}) {
    await csSet({
        wz_status_cache: {
            status, ...extra,
            expires: Date.now() + 24 * 60 * 60 * 1000
        }
    });
}

async function clearStatusCache() {
    await csSet({ wz_status_cache: null });
}

// ── Auth: sign up (sends OTP, does NOT auto-confirm) ──────────
async function wizardSignUp(email, password) {
    const { data, error } = await _supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: undefined },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, email };
}

// ── Auth: verify signup OTP ───────────────────────────────────
async function wizardVerifySignupOtp(email, token) {
    const { data, error } = await _supabase.auth.verifyOtp({
        email, token, type: 'signup',
    });
    if (error) return { ok: false, error: error.message };
    await clearStatusCache();
    return { ok: true, session: data.session };
}

// ── Auth: sign in ─────────────────────────────────────────────
async function wizardSignIn(email, password) {
    const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    await clearStatusCache();
    return { ok: true, user: data.user, session: data.session };
}

// ── Auth: sign out ────────────────────────────────────────────
async function wizardSignOut() {
    await _supabase.auth.signOut();
    await clearStatusCache();
}

// ── Auth: forgot password — sends OTP ────────────────────────
async function wizardForgotPassword(email) {
    const { error } = await _supabase.auth.resetPasswordForEmail(email);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

// ── Auth: verify password reset OTP ──────────────────────────
async function wizardVerifyRecoveryOtp(email, token) {
    const { data, error } = await _supabase.auth.verifyOtp({
        email, token, type: 'recovery',
    });
    if (error) return { ok: false, error: error.message };
    await clearStatusCache();
    return { ok: true, session: data.session };
}

// ── Auth: set new password ────────────────────────────────────
async function wizardUpdatePassword(newPassword) {
    const { error } = await _supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

// ── Get current session (with auto-refresh) ──────────────────
// Refreshes token if it expires within the next 5 minutes.
async function getSession() {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) return null;

    const expiresAt = session.expires_at ?? 0;
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt - now < 300) {
        const { data: refreshed } = await _supabase.auth.refreshSession();
        return refreshed?.session ?? null;
    }

    return session;
}

// ── Load user profile ─────────────────────────────────────────
async function loadProfile(userId) {
    const { data, error } = await _supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();
    if (error) return null;
    return data;
}

// ── Device binding ────────────────────────────────────────────
async function verifyDevice(userId, profile) {
    const fp = getFingerprint();
    const existingDevice = profile.device;

    if (!existingDevice) {
        await _supabase.from('user_profiles').update({
            device: {
                fingerprint: fp,
                user_agent:  navigator.userAgent,
                first_seen:  new Date().toISOString(),
                last_seen:   new Date().toISOString(),
            }
        }).eq('id', userId);
        return { ok: true, newDevice: true };
    }

    if (existingDevice.fingerprint === fp) {
        await _supabase.from('user_profiles')
            .update({ device: { ...existingDevice, last_seen: new Date().toISOString() } })
            .eq('id', userId);
        return { ok: true };
    }

    return { ok: false, error: 'DEVICE_MISMATCH' };
}

async function removeDevice(userId) {
    await _supabase.from('user_profiles').update({ device: null }).eq('id', userId);
    await clearStatusCache();
    // Sign out globally — boots the other device immediately
    await _supabase.auth.signOut({ scope: 'global' });
}

// ── Subscription check ────────────────────────────────────────
// Only two statuses: 'active' (paid) or 'expired' (must pay).
function evalSubscription(profile) {
    const { subscription_status, subscription_expires_at } = profile;

    if (subscription_status === 'active') {
        const expires = new Date(subscription_expires_at);
        if (expires > new Date()) {
            return { allowed: true, status: 'active', daysLeft: Math.ceil((expires - Date.now()) / 86400000) };
        }
        // Expired — update DB silently
        _supabase.from('user_profiles').update({ subscription_status: 'expired' }).eq('id', profile.id);
        return { allowed: false, status: 'expired' };
    }

    return { allowed: false, status: 'expired' };
}

// ── Main gate ─────────────────────────────────────────────────
async function wizardGate() {
    const cached = await getCachedStatus();
    if (cached && cached.status === 'ok') {
        return { state: 'ok', fromCache: true, subscription: cached.subscription, profile: cached.profile };
    }

    const session = await getSession();
    if (!session) return { state: 'no_session' };

    const profile = await loadProfile(session.user.id);
    if (!profile) return { state: 'no_session' };

    const deviceCheck = await verifyDevice(session.user.id, profile);
    if (!deviceCheck.ok) return { state: 'device_mismatch', profile };

    const subscription = evalSubscription(profile);
    if (subscription.allowed) {
        await setCachedStatus('ok', { subscription, profile });
        return { state: 'ok', profile, subscription };
    }

    return { state: 'upgrade_required', profile, subscription };
}

// ── Prompt helpers ────────────────────────────────────────────
const LOCKED_FORMAT = `WHEN I SAY GENERATE
Produce all output in the following structured format exactly. Use the block tags and field prefixes precisely as shown. No deviations, no extra commentary between blocks.

[BLOCK:CORE_30]
Flutter, Supabase, ...
[/BLOCK:CORE_30]

[BLOCK:EMPLOYMENT]
[ENTRY]
Company::Company Name
Location::City, Country
Title::Job Title
Description::Full description text including the 30 keywords, max 1000 characters total
[/ENTRY]
[/BLOCK:EMPLOYMENT]

[BLOCK:OTHER_EXP]
[ENTRY]
Title::Entry title, max 70 characters
Description::Entry description, max 300 characters
[/ENTRY]
[/BLOCK:OTHER_EXP]

[BLOCK:LOOSE_1000]
Flutter, Supabase, ...
[/BLOCK:LOOSE_1000]

Produce all 10 employment entries inside one [BLOCK:EMPLOYMENT] block and all 100 other experience entries inside one [BLOCK:OTHER_EXP] block. Do not add any text, headers, or commentary outside the blocks.

Rules that still apply inside the blocks:
- Employment: Company Name, City/Country (use mostly United States, United Kingdom, or Canada, occasionally other countries), Job Title, and Description. Description = narrative + 2 blank lines + 30 keywords, total 1000 characters max. If too long, shorten the narrative until the 30 keywords fit within the limit.
- Other Experience: title max 70 characters, description max 300 characters.
- All generated content must be written specifically for a Flutter and Supabase developer targeting founders and small business owners.`;

const DEFAULT_CUSTOM_PROMPT = `You are a keyword intelligence assistant helping a Flutter and Supabase freelancer optimize their Upwork profile. The overview is already written and will not change. Your job is to analyze top-ranking Upwork profiles and extract everything useful for two sections: Portfolio and Other Experiences.

Maintain four datasets across all profiles. Never reset unless I say RESET.

DATASET 1.  CORE 30
The 30 highest-value keywords across all profiles. Weighted by position: title = 3, overview = 2, skills = 2, portfolio = 1. Positions 1 and 2 are permanently locked:
Flutter
Supabase
Positions 3 to 30 are re-ranked after every new profile.

DATASET 2.  LOOSE 1000
Every keyword, tool, framework, platform, integration, and service phrase discovered. Deduplicated and continuously growing. Output format is all keywords merged together separated by commas only with no category divisions.

DATASET 3.  PORTFOLIO INTELLIGENCE
Track two things from portfolio sections:
Project title patterns: how top freelancers name their portfolio pieces
Description patterns: how they describe what was built, what tech was used, and what outcome was achieved
Store real examples and extract the sentence structures behind them.

DATASET 4.  OTHER EXPERIENCE INTELLIGENCE
Track two things from Other Experience sections:
Entry title patterns: how top freelancers label their experience entries
Description patterns: how they describe responsibilities and deliverables using searchable language
Store real examples and extract the writing patterns behind them.

DUPLICATE PREVENTION
Before analyzing each profile, note the username or profile name. If the same username appears again in a future paste, flag it as a duplicate. Do not re-run the full analysis or re-weight the CORE 30. However, scan the profile for any keywords, tools, frameworks, or service phrases not yet present in DATASET 2 (LOOSE 1000) and add only those new terms. This ensures no duplicate weighting while still capturing any profile updates.

ANALYSIS PROCESS
For each profile, extract signals from: title, overview, skills, portfolio, project catalog, other experiences, and tools. Update all four datasets and recalculate CORE 30. Reply only with "Digested" after each profile. Show no other output until GENERATE is said.

EVERY 10 PROFILES
On the 10th profile of each batch, instead of saying "Digested", output:
5 new Upwork profile search queries to find more top-ranking Flutter and Supabase freelancers worth analyzing
These queries should be based on patterns and keywords discovered so far, targeting angles not yet well represented in the dataset

MY PROFILE CONTEXT
I am a Flutter and Supabase developer targeting founders and small business owners. My positioning: one developer owning the full build including Flutter frontend, Supabase backend, PostgreSQL database, authentication, real-time features, webhooks, and API integrations. I build Android apps, Flutter web apps, and offline apps. I do not build iOS. My description is locked and will not change. Everything generated must align with this positioning.`;

function buildFullPrompt(customPrompt) {
    const base = (customPrompt || DEFAULT_CUSTOM_PROMPT).trimEnd();
    return `${base}\n\n${LOCKED_FORMAT}`;
}

async function saveCustomPrompt(userId, customPrompt) {
    const { error } = await _supabase
        .from('user_profiles')
        .update({ custom_prompt: customPrompt })
        .eq('id', userId);
    if (error) return { ok: false, error: error.message };
    await clearStatusCache();
    return { ok: true };
}

// ── tx_ref builder ────────────────────────────────────────────
function buildTxRef(userId, coupon) {
    return `wizard_${userId}_${Date.now()}_${coupon ? coupon.toUpperCase() : 'none'}`;
}

// ── Initiate payment — creates Flutterwave hosted checkout link ──
async function initiatePayment(userId, email, coupon) {
    const amount = couponAmount(coupon);
    const txRef  = buildTxRef(userId, coupon);

    const session = await getSession();
    if (!session) return { ok: false, error: 'NO_SESSION' };

    try {
        const res = await fetch(WIZARD_CONFIG.initiateEndpoint, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ tx_ref: txRef, amount, email }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return { ok: false, error: data.message ?? data.error ?? 'FLW_ERROR' };
        return { ok: true, txRef, ...data };
    } catch (_) {
        return { ok: false, error: 'NETWORK_ERROR' };
    }
}

// ── Compute discounted amount from coupon code ────────────────
function couponAmount(coupon) {
    if (!coupon) return 1000;
    switch (coupon.toUpperCase()) {
        case 'MAVERIC50':  return 500;
        case 'MAVERIC75':  return 250;
        case 'MAVERIC90':  return 100;
        case 'MAVERIC100': return 0;
        default:           return 1000;
    }
}

// ── Free coupon redemption (100% off — gives 30 days active) ──
// Used when couponAmount() returns 0 — no Flutterwave needed.
async function redeemFreeCoupon(userId, coupon) {
    const session = await getSession();
    if (!session) return { ok: false, error: 'NO_SESSION' };

    try {
        const res = await fetch(WIZARD_CONFIG.webhookEndpoint, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ type: 'coupon_redeem', user_id: userId, coupon })
        });
        const data = await res.json();
        if (res.ok && data.ok) { await clearStatusCache(); return { ok: true }; }
        return { ok: false, error: data.error ?? 'UNKNOWN' };
    } catch (_) {
        return { ok: false, error: 'NETWORK_ERROR' };
    }
}

// ── Payment polling ───────────────────────────────────────────
// getSession() is called on every iteration so the token is always
// fresh regardless of how long polling runs.
const POLL_INTERVAL_MS = 8000;
const POLL_TIMEOUT_MS  = 600000;

let _pollCancelled = false;

function cancelPoll() { _pollCancelled = true; }

async function pollPayment(txRef, onTick) {
    _pollCancelled = false;
    const started = Date.now();

    while (Date.now() - started < POLL_TIMEOUT_MS) {
        if (_pollCancelled) return { ok: false, error: 'CANCELLED' };

        try {
            const session = await getSession();
            if (!session) return { ok: false, error: 'NO_SESSION' };

            const res = await fetch(WIZARD_CONFIG.verifyEndpoint, {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ tx_ref: txRef }),
            });

            const data = await res.json();

            if (data.ok) {
                await clearStatusCache();
                return { ok: true };
            }

            // Auth errors are retried — getSession() will refresh the token
            if (data.error && data.error !== 'INVALID_AUTH' && data.error !== 'NO_SESSION') {
                return { ok: false, error: data.error };
            }

        } catch (_) {
            // Network blip — keep trying
        }

        if (onTick) onTick(Math.floor((Date.now() - started) / 1000));
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    return { ok: false, error: 'TIMEOUT' };
}

// ── Send message (contact form) ───────────────────────────────
async function sendMessage(userId, email, body) {
    const { error } = await _supabase
        .from('messages')
        .insert({ user_id: userId, email, body });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}
