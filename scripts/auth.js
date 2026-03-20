// auth.js — Supabase auth, session management, device binding,
//           subscription checks, prompt storage.
//
// Loaded before main.js. Exposes a global WizardAuth object.
// Uses the Supabase JS client loaded via the manifest.

const WIZARD_CONFIG = {
    supabaseUrl:        'https://bszdgbpftqdmlnpqqzmq.supabase.co',  
    supabaseAnonKey:    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzemRnYnBmdHFkbWxucHFxem1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMDM2NzYsImV4cCI6MjA4OTU3OTY3Nn0.X9C8Hgr76BsV7XOrXnVCuIrM3e4s6e48T2jpgp8Ey0w',                    
    webhookEndpoint:    'https://bszdgbpftqdmlnpqqzmq.supabase.co/functions/v1/flutterwave-webhook',
    flutterwavePayLink: 'https://flutterwave.com/pay/YOUR_LINK', // TODO: replace
    trialDays:          30,
};

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_11WzNWVH9IB3pJbRnkWegA_GfNzimCL

// ── Supabase client ───────────────────────────────────────────
// supabase-js is loaded as a content script (see manifest.json)
const _supabase = supabase.createClient(
    WIZARD_CONFIG.supabaseUrl,
    WIZARD_CONFIG.supabaseAnonKey,
    {
        auth: {
            persistSession: true,
            storage: {
                // Store session in chrome.storage.local so it
                // survives page navigations within Upwork
                getItem: (key) => new Promise(r =>
                    chrome.storage.local.get(key, d => r(d[key] ?? null))),
                setItem: (key, val) => new Promise(r =>
                    chrome.storage.local.set({ [key]: val }, r)),
                removeItem: (key) => new Promise(r =>
                    chrome.storage.local.remove(key, r)),
            }
        }
    }
);

// ── Machine fingerprint ───────────────────────────────────────
// Stable within one browser install. Combines browser signals
// into a short hex hash. Not cryptographic — abuse prevention only.
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
function csGet(keys) {
    return new Promise(r => chrome.storage.local.get(keys, r));
}
function csSet(data) {
    return new Promise(r => chrome.storage.local.set(data, r));
}

// ── Session cache (24h) ───────────────────────────────────────
// Avoids hitting Supabase on every Upwork page load.
async function getCachedStatus() {
    const { wz_status_cache } = await csGet('wz_status_cache');
    if (!wz_status_cache) return null;
    if (Date.now() > wz_status_cache.expires) return null;
    return wz_status_cache;
}

async function setCachedStatus(status, extra = {}) {
    await csSet({
        wz_status_cache: {
            status,
            ...extra,
            expires: Date.now() + 24 * 60 * 60 * 1000
        }
    });
}

async function clearStatusCache() {
    await csSet({ wz_status_cache: null });
}

// ── Auth: sign up ─────────────────────────────────────────────
async function wizardSignUp(email, password) {
    const { data, error } = await _supabase.auth.signUp({ email, password });
    if (error) return { ok: false, error: error.message };
    // Profile row is created automatically by the DB trigger (05_on_signup_trigger.sql)
    return { ok: true, user: data.user };
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

// ── Auth: forgot password ─────────────────────────────────────
async function wizardForgotPassword(email) {
    const { error } = await _supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://www.upwork.com'  // Upwork is where they'll be
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

// ── Get current session ───────────────────────────────────────
async function getSession() {
    const { data } = await _supabase.auth.getSession();
    return data?.session ?? null;
}

// ── Load user profile from Supabase ──────────────────────────
async function loadProfile(userId) {
    const { data, error } = await _supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();
    if (error) return null;
    return data;
}

// ── Register / verify device ──────────────────────────────────
// Returns: { ok: true } | { ok: false, error: 'DEVICE_MISMATCH' }
async function verifyDevice(userId, profile) {
    const fp = getFingerprint();
    const existingDevice = profile.device;

    if (!existingDevice) {
        // First login — register this device
        await _supabase
            .from('user_profiles')
            .update({
                device: {
                    fingerprint: fp,
                    user_agent:  navigator.userAgent,
                    first_seen:  new Date().toISOString(),
                    last_seen:   new Date().toISOString(),
                }
            })
            .eq('id', userId);
        return { ok: true, newDevice: true };
    }

    if (existingDevice.fingerprint === fp) {
        // Known device — update last_seen
        await _supabase
            .from('user_profiles')
            .update({ device: { ...existingDevice, last_seen: new Date().toISOString() } })
            .eq('id', userId);
        return { ok: true };
    }

    // Different fingerprint — block
    return { ok: false, error: 'DEVICE_MISMATCH' };
}

// ── Remove device (from dashboard) ───────────────────────────
async function removeDevice(userId) {
    await _supabase
        .from('user_profiles')
        .update({ device: null })
        .eq('id', userId);
    await clearStatusCache();
}

// ── Check subscription status ─────────────────────────────────
// Returns: { allowed, status, daysLeft? }
function evalSubscription(profile) {
    const { subscription_status, subscription_expires_at } = profile;

    if (subscription_status === 'free') {
        return { allowed: true, status: 'free' };
    }

    if (subscription_status === 'active') {
        const expires = new Date(subscription_expires_at);
        if (expires > new Date()) {
            const daysLeft = Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000));
            return { allowed: true, status: 'active', daysLeft };
        }
        // Expired — update DB lazily
        _supabase.from('user_profiles')
            .update({ subscription_status: 'expired' })
            .eq('id', profile.id);
        return { allowed: false, status: 'expired' };
    }

    if (subscription_status === 'trial') {
        const expires = new Date(subscription_expires_at);
        if (expires > new Date()) {
            const daysLeft = Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000));
            return { allowed: true, status: 'trial', daysLeft };
        }
        _supabase.from('user_profiles')
            .update({ subscription_status: 'expired' })
            .eq('id', profile.id);
        return { allowed: false, status: 'expired' };
    }

    return { allowed: false, status: 'expired' };
}

// ── Main gate — called by main.js on every load ───────────────
// Returns one of:
//   { state: 'no_session' }
//   { state: 'device_mismatch' }
//   { state: 'ok', profile, subscription }
//   { state: 'upgrade_required', profile }
async function wizardGate() {
    // 1. Check cache first
    const cached = await getCachedStatus();
    if (cached && cached.status === 'ok') {
        return { state: 'ok', fromCache: true, subscription: cached.subscription, profile: cached.profile };
    }

    // 2. Get session
    const session = await getSession();
    if (!session) return { state: 'no_session' };

    // 3. Load profile
    const profile = await loadProfile(session.user.id);
    if (!profile) return { state: 'no_session' };  // profile missing — treat as logged out

    // 4. Verify device
    const deviceCheck = await verifyDevice(session.user.id, profile);
    if (!deviceCheck.ok) return { state: 'device_mismatch', profile };

    // 5. Check subscription
    const subscription = evalSubscription(profile);

    if (subscription.allowed) {
        await setCachedStatus('ok', { subscription, profile });
        return { state: 'ok', profile, subscription };
    }

    return { state: 'upgrade_required', profile, subscription };
}

// ── Prompt helpers ────────────────────────────────────────────
// The prompt is split into two parts:
//   1. custom_prompt — user-editable, stored in Supabase
//   2. LOCKED_FORMAT — output format block, hardcoded in client
//
// Full prompt = custom_prompt + '\n\n' + LOCKED_FORMAT

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

// ── Payment URL builder ───────────────────────────────────────
// tx_ref: wizard_<userId>_<timestamp>_<coupon_or_none>
function buildPaymentUrl(userId, coupon) {
    const txRef = `wizard_${userId}_${Date.now()}_${coupon ? coupon.toUpperCase() : 'none'}`;
    return `${WIZARD_CONFIG.flutterwavePayLink}?tx_ref=${txRef}`;
}

// ── Coupon redemption (MAVERIC100 free) ───────────────────────
async function redeemFreeCoupon(userId, coupon) {
    try {
        const res = await fetch(WIZARD_CONFIG.webhookEndpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ type: 'coupon_redeem', user_id: userId, coupon })
        });
        const data = await res.json();
        if (res.ok && data.ok) { await clearStatusCache(); return { ok: true }; }
        return { ok: false, error: data.error ?? 'UNKNOWN' };
    } catch (_) {
        return { ok: false, error: 'NETWORK_ERROR' };
    }
}
