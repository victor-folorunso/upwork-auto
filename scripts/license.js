// license.js — trial management, license validation, paywall gate
//
// Flow:
//   1. On first install, record install_date in chrome.storage.
//   2. On every load, check if trial is still valid (30 days).
//   3. If trial expired, check for a stored license key.
//   4. If license key exists, validate it against Supabase.
//   5. If invalid/missing, show the paywall and block the main UI.

const LICENSE_CONFIG = {
    supabaseUrl:        'https://YOUR_PROJECT.supabase.co',  // TODO: replace
    validateEndpoint:   'https://YOUR_PROJECT.supabase.co/functions/v1/validate-license',
    webhookEndpoint:    'https://YOUR_PROJECT.supabase.co/functions/v1/flutterwave-webhook',
    flutterwavePayLink: 'https://flutterwave.com/pay/YOUR_LINK',  // TODO: replace
    priceNaira:         1000,
    trialDays:          30,
};

// ── Machine fingerprint ───────────────────────────────────────
// Not a true device ID (browser extension sandbox prevents that),
// but stable enough to identify a specific browser install.
// Combines: user agent + language + screen resolution + timezone + CPU cores.
function getFingerprint() {
    const raw = [
        navigator.userAgent,
        navigator.language,
        `${screen.width}x${screen.height}`,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.hardwareConcurrency ?? 0,
    ].join('|');

    // Simple hash (djb2) — good enough for fingerprinting, not cryptographic
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

// ── Storage helpers ───────────────────────────────────────────
function getLicenseStorage() {
    return new Promise(resolve => {
        chrome.storage.local.get(['install_date', 'license_key', 'license_valid_until'], resolve);
    });
}

function setLicenseStorage(data) {
    return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ── Trial check ───────────────────────────────────────────────
async function ensureInstallDate() {
    const { install_date } = await getLicenseStorage();
    if (!install_date) {
        await setLicenseStorage({ install_date: Date.now() });
    }
}

function isTrialValid(installDate) {
    const trialMs = LICENSE_CONFIG.trialDays * 24 * 60 * 60 * 1000;
    return Date.now() - installDate < trialMs;
}

function trialDaysRemaining(installDate) {
    const trialMs = LICENSE_CONFIG.trialDays * 24 * 60 * 60 * 1000;
    const remaining = Math.ceil((installDate + trialMs - Date.now()) / (24 * 60 * 60 * 1000));
    return Math.max(0, remaining);
}

// ── Remote license validation ─────────────────────────────────
async function validateLicenseRemote(licenseKey) {
    try {
        const res = await fetch(LICENSE_CONFIG.validateEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                license_key: licenseKey,
                fingerprint: getFingerprint()
            })
        });
        const data = await res.json();
        if (res.ok && data.ok) return { valid: true };
        return { valid: false, error: data.error ?? 'UNKNOWN' };
    } catch (_) {
        // Network failure — fail open (don't block user if Supabase is down)
        return { valid: true, offline: true };
    }
}

// ── Cache validated license for 24h to avoid hitting Supabase every load ──
async function isLicenseCachedValid() {
    const { license_valid_until } = await getLicenseStorage();
    return license_valid_until && Date.now() < license_valid_until;
}

async function cacheLicenseValid() {
    const until = Date.now() + 24 * 60 * 60 * 1000;  // 24 hours
    await setLicenseStorage({ license_valid_until: until });
}

// ── Main gate — call this before mounting the main UI ─────────
// Returns: { allowed: true } or { allowed: false, reason, daysLeft? }
async function checkLicenseGate() {
    await ensureInstallDate();
    const { install_date, license_key } = await getLicenseStorage();

    // 1. Valid trial
    if (isTrialValid(install_date)) {
        return { allowed: true, trial: true, daysLeft: trialDaysRemaining(install_date) };
    }

    // 2. No license key stored
    if (!license_key) {
        return { allowed: false, reason: 'TRIAL_EXPIRED' };
    }

    // 3. License cached as valid (skip remote call)
    if (await isLicenseCachedValid()) {
        return { allowed: true, trial: false };
    }

    // 4. Validate remotely
    const result = await validateLicenseRemote(license_key);
    if (result.valid) {
        await cacheLicenseValid();
        return { allowed: true, trial: false };
    }

    // Invalid key
    await setLicenseStorage({ license_key: null, license_valid_until: null });
    return { allowed: false, reason: result.error };
}

// ── Activate a license key entered by the user ────────────────
async function activateLicenseKey(key) {
    const result = await validateLicenseRemote(key.trim().toUpperCase());
    if (result.valid) {
        await setLicenseStorage({ license_key: key.trim().toUpperCase() });
        await cacheLicenseValid();
        return { ok: true };
    }
    return { ok: false, error: result.error };
}

// ── Redeem MAVERIC100 free coupon (no payment needed) ─────────
async function redeemFreeCoupon(email, coupon) {
    try {
        const res = await fetch(LICENSE_CONFIG.webhookEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'coupon_redeem', email, coupon })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            return { ok: true, license_key: data.license_key };
        }
        return { ok: false, error: data.error ?? 'UNKNOWN' };
    } catch (_) {
        return { ok: false, error: 'NETWORK_ERROR' };
    }
}

// ── Build Flutterwave payment URL with coupon embedded ────────
// tx_ref format: wizard_<timestamp>_<coupon_or_none>
// The webhook reads the coupon from tx_ref to apply the discount.
function buildPaymentUrl(email, coupon) {
    const txRef = `wizard_${Date.now()}_${coupon ? coupon.toUpperCase() : 'none'}`;
    const base = LICENSE_CONFIG.flutterwavePayLink;
    // Flutterwave hosted payment links accept ?customer_email and ?tx_ref as query params
    return `${base}?customer_email=${encodeURIComponent(email)}&tx_ref=${txRef}`;
}
