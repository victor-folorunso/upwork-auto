// main.js — orchestrator: shadow DOM, UI wiring, auth gate, overlays

const ROOT_ID    = 'upwork-wizard-root';
const PANEL_WIDTH = '380px';

// ──────────────────────────────────────────────────────────────
// Shadow DOM + asset loader
// ──────────────────────────────────────────────────────────────
function createShadowHost() {
    if (document.getElementById(ROOT_ID)) return null;
    const host = document.createElement('div');
    host.id = ROOT_ID;
    // Bottom-right so it doesn't block Upwork's top-left CAPTCHA checkbox
    host.style.cssText = `
        position: fixed;
        bottom: 15px; right: 15px;
        z-index: 2147483647;
        width: ${PANEL_WIDTH};
    `;
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    return shadow;
}

// Expand host to full viewport so overlay backdrops can fill the screen
function expandHostForOverlay() {
    const host = document.getElementById(ROOT_ID);
    if (host) host.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        width: 100vw;
        pointer-events: none;
    `;
}

// Shrink host back to sidebar (bottom-right)
function shrinkHostToSidebar() {
    const host = document.getElementById(ROOT_ID);
    if (host) host.style.cssText = `
        position: fixed;
        bottom: 15px; right: 15px;
        z-index: 2147483647;
        width: ${PANEL_WIDTH};
        pointer-events: auto;
    `;
}

async function loadAsset(url) {
    try { return await fetch(url).then(r => r.text()); }
    catch (_) { return ''; }
}

async function injectCSS(shadow) {
    const css = await loadAsset(chrome.runtime.getURL('style.css'));
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
}

async function appendHTML(shadow, file) {
    const html = await loadAsset(chrome.runtime.getURL(file));
    const div = document.createElement('div');
    div.innerHTML = html;
    shadow.appendChild(div);
    return div;
}

// ──────────────────────────────────────────────────────────────
// Notify (main sidebar status box)
// ──────────────────────────────────────────────────────────────
const THEME = {
    success: { bg: '#112911', color: '#72f272', border: '#1e4a1e' },
    warning: { bg: '#292911', color: '#f2f272', border: '#4a4a1e' },
    error:   { bg: '#2d1a1a', color: '#ff6b6b', border: '#4a2020' }
};

function notify(shadow, text, type = 'success') {
    const box = shadow.querySelector('#status-box');
    const msg = shadow.querySelector('#status-msg');
    if (!box || !msg) return;
    const t = THEME[type] || THEME.warning;
    box.style.cssText = `display:block; background:${t.bg}; color:${t.color}; border-top-color:${t.border};`;
    msg.innerHTML = Array.isArray(text) ? text.join('<br>') : text;
}

// ──────────────────────────────────────────────────────────────
// Overlay open / close helpers
// ──────────────────────────────────────────────────────────────
function showOverlay(shadow, id) {
    expandHostForOverlay();
    const el = shadow.querySelector(`#${id}`);
    if (el) {
        el.style.display = 'flex';
        el.style.pointerEvents = 'auto';
    }
}

function hideOverlay(shadow, id) {
    const el = shadow.querySelector(`#${id}`);
    if (el) el.style.display = 'none';

    const anyOpen = ['#auth-backdrop', '#dashboard-backdrop'].some(sel => {
        const o = shadow.querySelector(sel);
        return o && o.style.display !== 'none';
    });
    if (!anyOpen) shrinkHostToSidebar();
}

// ──────────────────────────────────────────────────────────────
// Auth overlay
// ──────────────────────────────────────────────────────────────
function setupAuthOverlay(shadow, onSuccess) {
    function showView(id) {
        shadow.querySelectorAll('.auth-view').forEach(v => v.style.display = 'none');
        shadow.querySelector(`#${id}`).style.display = 'block';
    }

    function msg(id, text, type) {
        const el = shadow.querySelector(`#${id}`);
        el.textContent = text;
        el.className = `pw-msg ${type}`;
        el.style.display = 'block';
    }

    function setLoading(btnId, loading, label) {
        const btn = shadow.querySelector(`#${btnId}`);
        btn.disabled = loading;
        btn.textContent = loading ? 'Please wait...' : label;
    }

    shadow.querySelector('#go-login').onclick             = e => { e.preventDefault(); showView('auth-view-login'); };
    shadow.querySelector('#go-signup').onclick            = e => { e.preventDefault(); showView('auth-view-signup'); };
    shadow.querySelector('#go-forgot').onclick            = e => { e.preventDefault(); showView('auth-view-forgot'); };
    shadow.querySelector('#go-login-from-forgot').onclick = e => { e.preventDefault(); showView('auth-view-login'); };

    // ── Sign up ──
    shadow.querySelector('#su-btn').onclick = async () => {
        const email    = shadow.querySelector('#su-email').value.trim();
        const password = shadow.querySelector('#su-password').value;
        const confirm  = shadow.querySelector('#su-confirm').value;

        if (!email || !password) return msg('su-msg', 'Fill in all fields.', 'error');
        if (password.length < 8)  return msg('su-msg', 'Password must be at least 8 characters.', 'error');
        if (password !== confirm)  return msg('su-msg', 'Passwords do not match.', 'error');

        setLoading('su-btn', true, 'Create Account');
        const result = await wizardSignUp(email, password);
        setLoading('su-btn', false, 'Create Account');

        if (!result.ok) return msg('su-msg', result.error, 'error');
        msg('su-msg', '✅ Account created! Check your email to confirm, then log in.', 'success');
        setTimeout(() => showView('auth-view-login'), 2000);
    };

    // ── Log in ──
    shadow.querySelector('#li-btn').onclick = async () => {
        const email    = shadow.querySelector('#li-email').value.trim();
        const password = shadow.querySelector('#li-password').value;

        if (!email || !password) return msg('li-msg', 'Fill in all fields.', 'error');

        setLoading('li-btn', true, 'Log In');
        const result = await wizardSignIn(email, password);
        setLoading('li-btn', false, 'Log In');

        if (!result.ok) return msg('li-msg', result.error, 'error');

        const gate = await wizardGate();
        handleGate(shadow, gate, onSuccess);
    };

    // ── Forgot password ──
    shadow.querySelector('#fp-btn').onclick = async () => {
        const email = shadow.querySelector('#fp-email').value.trim();
        if (!email) return msg('fp-msg', 'Enter your email.', 'error');

        setLoading('fp-btn', true, 'Send Reset Link');
        const result = await wizardForgotPassword(email);
        setLoading('fp-btn', false, 'Send Reset Link');

        if (!result.ok) return msg('fp-msg', result.error, 'error');
        msg('fp-msg', '✅ Reset link sent. Check your email.', 'success');
    };

    // ── Device mismatch ──
    shadow.querySelector('#device-switch-btn').onclick = async () => {
        const session = await getSession();
        if (!session) return;
        setLoading('device-switch-btn', true, 'Remove other device & use this one');
        await removeDevice(session.user.id);
        const gate = await wizardGate();
        setLoading('device-switch-btn', false, 'Remove other device & use this one');
        handleGate(shadow, gate, onSuccess);
    };

    shadow.querySelector('#device-logout-btn').onclick = async () => {
        await wizardSignOut();
        showView('auth-view-login');
    };
}

function showAuthOverlay(shadow, initialView, profile, onSuccess) {
    showOverlay(shadow, 'auth-backdrop');
    shadow.querySelectorAll('.auth-view').forEach(v => v.style.display = 'none');
    shadow.querySelector(`#${initialView}`).style.display = 'block';

    if (initialView === 'auth-view-device' && profile?.device) {
        const d = profile.device;
        const since = d.first_seen ? new Date(d.first_seen).toLocaleDateString() : 'unknown';
        shadow.querySelector('#device-info-box').innerHTML =
            `<strong>Registered device</strong><br>First seen: ${since}<br>` +
            `Last seen: ${new Date(d.last_seen).toLocaleDateString()}<br>` +
            `<small style="word-break:break-all">${(d.user_agent ?? '').substring(0, 80)}...</small>`;
    }
}

function hideAuthOverlay(shadow) {
    hideOverlay(shadow, 'auth-backdrop');
}

// ──────────────────────────────────────────────────────────────
// Dashboard overlay
// ──────────────────────────────────────────────────────────────
function setupDashboardOverlay(shadow, profile, subscription) {

    shadow.querySelector('#dashboard-close').onclick = () => {
        hideOverlay(shadow, 'dashboard-backdrop');
    };

    shadow.querySelectorAll('.dash-tab').forEach(tab => {
        tab.onclick = () => {
            shadow.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
            shadow.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
            tab.classList.add('active');
            shadow.querySelector(`#dash-tab-${tab.dataset.tab}`).style.display = 'flex';
        };
    });

    // ── Prompt tab ──
    const customPromptEl = shadow.querySelector('#dash-custom-prompt');
    const lockedFormatEl = shadow.querySelector('#dash-locked-format');

    customPromptEl.value       = profile.custom_prompt || DEFAULT_CUSTOM_PROMPT;
    lockedFormatEl.textContent = LOCKED_FORMAT;

    shadow.querySelector('#dash-prompt-save').onclick = async () => {
        const btn = shadow.querySelector('#dash-prompt-save');
        btn.disabled = true; btn.textContent = 'Saving...';
        const result = await saveCustomPrompt(profile.id, customPromptEl.value.trim());
        btn.disabled = false; btn.textContent = 'Save Prompt';
        const el = shadow.querySelector('#prompt-save-msg');
        el.style.display = 'block';
        el.className = `pw-msg ${result.ok ? 'success' : 'error'}`;
        el.textContent = result.ok ? '✅ Prompt saved.' : result.error;
    };

    shadow.querySelector('#dash-prompt-reset').onclick = () => {
        customPromptEl.value = DEFAULT_CUSTOM_PROMPT;
        const el = shadow.querySelector('#prompt-save-msg');
        el.style.display = 'block';
        el.className = 'pw-msg warning';
        el.textContent = 'Reset to default — click Save to apply.';
    };

    // ── Subscription tab ──
    const statusMap = {
        trial:   { icon: '🕐', label: 'Free Trial',   detail: `${subscription.daysLeft ?? 0} days remaining` },
        active:  { icon: '✅', label: 'Active',        detail: `Renews in ${subscription.daysLeft ?? 0} days` },
        free:    { icon: '🎁', label: 'Free (Coupon)', detail: 'Lifetime access — no payment needed' },
        expired: { icon: '🔒', label: 'Expired',       detail: 'Subscribe to continue using the wizard' },
    };
    const s = statusMap[subscription.status] || statusMap.expired;
    shadow.querySelector('#sub-status-icon').textContent   = s.icon;
    shadow.querySelector('#sub-status-label').textContent  = s.label;
    shadow.querySelector('#sub-status-detail').textContent = s.detail;

    shadow.querySelector('#sub-upgrade-section').style.display =
        (subscription.status === 'trial' || subscription.status === 'expired') ? 'block' : 'none';
    shadow.querySelector('#sub-renew-section').style.display =
        subscription.status === 'active' ? 'block' : 'none';

    let appliedCoupon = null;

    shadow.querySelector('#sub-apply-coupon').onclick = () => {
        const code  = shadow.querySelector('#sub-coupon').value.trim().toUpperCase();
        const msgEl = shadow.querySelector('#sub-coupon-msg');
        msgEl.style.display = 'block';
        if (code === 'MAVERIC100') {
            appliedCoupon = code;
            shadow.querySelector('#sub-pay-btn').textContent = '🎉 Get Free Access';
            msgEl.className = 'pw-msg success';
            msgEl.textContent = '100% off — no payment needed!';
        } else if (code === 'MAVERIC50') {
            appliedCoupon = code;
            shadow.querySelector('#sub-pay-btn').textContent = 'Pay ₦500 with Flutterwave';
            msgEl.className = 'pw-msg success';
            msgEl.textContent = '50% off applied — pay ₦500.';
        } else {
            appliedCoupon = null;
            msgEl.className = 'pw-msg error';
            msgEl.textContent = 'Invalid coupon code.';
        }
    };

    async function handlePayClick(btnId, isRenew = false) {
        const btn = shadow.querySelector(`#${btnId}`);
        if (!isRenew && appliedCoupon === 'MAVERIC100') {
            btn.disabled = true; btn.textContent = 'Processing...';
            const result = await redeemFreeCoupon(profile.id, 'MAVERIC100');
            btn.disabled = false;
            const msgEl = shadow.querySelector('#sub-coupon-msg');
            msgEl.style.display = 'block';
            if (result.ok) {
                msgEl.className = 'pw-msg success';
                msgEl.textContent = '✅ Free access activated! Reloading...';
                setTimeout(() => location.reload(), 1500);
            } else {
                btn.textContent = '🎉 Get Free Access';
                const errMap = {
                    COUPON_EXHAUSTED:   'Coupon has reached its limit.',
                    ALREADY_SUBSCRIBED: 'Already subscribed.',
                    NETWORK_ERROR:      'Network error. Try again.',
                };
                msgEl.className = 'pw-msg error';
                msgEl.textContent = errMap[result.error] ?? 'Something went wrong.';
            }
            return;
        }
        window.open(buildPaymentUrl(profile.id, appliedCoupon), '_blank');
    }

    shadow.querySelector('#sub-pay-btn').onclick  = () => handlePayClick('sub-pay-btn');
    shadow.querySelector('#sub-renew-btn').onclick = () => handlePayClick('sub-renew-btn', true);

    shadow.querySelector('#sub-refresh-btn').onclick = async () => {
        const btn = shadow.querySelector('#sub-refresh-btn');
        btn.disabled = true; btn.textContent = 'Refreshing...';
        await clearStatusCache();
        location.reload();
    };

    // ── Account tab ──
    shadow.querySelector('#acct-email').textContent = profile.email;
    shadow.querySelector('#acct-since').textContent =
        profile.install_date ? new Date(profile.install_date).toLocaleDateString() : '—';

    const deviceInfo = shadow.querySelector('#acct-device-info');
    if (profile.device) {
        const d = profile.device;
        deviceInfo.innerHTML =
            `First seen: ${new Date(d.first_seen).toLocaleDateString()}<br>` +
            `Last seen: ${new Date(d.last_seen).toLocaleDateString()}<br>` +
            `<small style="word-break:break-all;color:#555">${(d.user_agent ?? '').substring(0, 60)}...</small>`;
    } else {
        deviceInfo.textContent = 'No device registered yet.';
        shadow.querySelector('#acct-remove-device').style.display = 'none';
    }

    shadow.querySelector('#acct-remove-device').onclick = async () => {
        const btn = shadow.querySelector('#acct-remove-device');
        btn.disabled = true; btn.textContent = 'Removing...';
        await removeDevice(profile.id);
        deviceInfo.textContent = 'Device removed. It will re-register on next load.';
        btn.style.display = 'none';
        const msgEl = shadow.querySelector('#acct-msg');
        msgEl.style.display = 'block';
        msgEl.className = 'pw-msg success';
        msgEl.textContent = '✅ Device removed.';
    };

    shadow.querySelector('#acct-logout-btn').onclick = async () => {
        await wizardSignOut();
        location.reload();
    };
}

function openDashboard(shadow, profile, subscription) {
    showOverlay(shadow, 'dashboard-backdrop');
    shadow.querySelectorAll('.dash-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    shadow.querySelectorAll('.dash-panel').forEach((p, i) => p.style.display = i === 0 ? 'flex' : 'none');
}

// ──────────────────────────────────────────────────────────────
// Main UI (sidebar)
// ──────────────────────────────────────────────────────────────
function setupMainUI(shadow, profile, subscription) {
    let parsedData = null;
    const n = (text, type) => notify(shadow, text, type);

    if (subscription.status === 'trial') {
        shadow.querySelector('#trial-days-left').textContent = subscription.daysLeft ?? 0;
        shadow.querySelector('#trial-note').style.display = 'block';
        shadow.querySelector('#trial-upgrade-link').onclick = e => {
            e.preventDefault();
            openDashboard(shadow, profile, subscription);
            setTimeout(() => shadow.querySelector('[data-tab="subscription"]').click(), 50);
        };
    }

    shadow.querySelector('#status-close').onclick = () => {
        shadow.querySelector('#status-box').style.display = 'none';
    };

    shadow.querySelector('#act-open-dashboard').onclick = () => {
        openDashboard(shadow, profile, subscription);
    };

    shadow.querySelector('#act-copy-prompt').onclick = async () => {
        const freshProfile = await loadProfile(profile.id);
        const fullPrompt = buildFullPrompt(freshProfile?.custom_prompt ?? null);
        navigator.clipboard.writeText(fullPrompt).then(() => {
            n('✅ Prompt copied to clipboard.', 'success');
        }).catch(() => {
            n('Copy failed. Please allow clipboard access.', 'error');
        });
    };

    shadow.querySelector('#act-parse').onclick = () => {
        const raw = shadow.querySelector('#in-ai-output').value.trim();
        if (!raw) { n('Paste the AI output first.', 'error'); return; }

        parsedData = parseAIOutput(raw);

        shadow.querySelector('#sum-employment').innerHTML =
            `Employment entries: <span>${parsedData.employment.length}</span>`;
        shadow.querySelector('#sum-other-exp').innerHTML =
            `Other Experience entries: <span>${parsedData.otherExp.length}</span>`;
        shadow.querySelector('#sum-loose1000').innerHTML =
            `Keywords (Loose 1000): <span>${parsedData.loose1000 ? '✓ found' : '✗ not found'}</span>`;

        shadow.querySelector('#parse-summary').classList.add('visible');
        if (parsedData.errors.length) n(parsedData.errors, 'warning');
        else n('Output parsed successfully. Choose an action below.', 'success');

        const hasData = parsedData.employment.length || parsedData.otherExp.length;
        shadow.querySelector('#action-section').style.display = hasData ? 'block' : 'none';
    };

    shadow.querySelector('#act-run-other-exp').onclick = async () => {
        if (AUTO.running) { n('Automation is already running.', 'warning'); return; }

        const saved = await checkForSavedJob();
        if (saved && saved.type === 'other_exp') {
            const resume = confirm(
                `A previous Other Experiences run was interrupted at entry ${saved.index + 1}.\n\n` +
                `OK  → Resume from entry ${saved.index + 1}\n` +
                `Cancel → Discard and start fresh`
            );
            if (resume) {
                setRunningState(shadow, true);
                runOtherExperiences(
                    { otherExp: saved.entries, employment: [], loose1000: saved.loose1000 || '' },
                    (t, tp) => n(t, tp), () => setRunningState(shadow, false), saved.index, false
                );
                return;
            }
            await discardSavedJob();
        }

        if (!parsedData) { n('Parse the output first.', 'error'); return; }

        let shouldDelete = false;
        const existingCount = countOtherExperiences();
        if (existingCount > 0) {
            shouldDelete = confirm(
                `There are ${existingCount} existing Other Experience entries on your profile.\n\n` +
                `OK  → Delete all ${existingCount} entries, then add new ones\n` +
                `Cancel → Keep existing entries and just add new ones`
            );
        }
        setRunningState(shadow, true);
        runOtherExperiences(parsedData, (t, tp) => n(t, tp), () => setRunningState(shadow, false), 0, shouldDelete);
    };

    shadow.querySelector('#act-run-employment').onclick = async () => {
        if (AUTO.running) { n('Automation is already running.', 'warning'); return; }

        const saved = await checkForSavedJob();
        if (saved && saved.type === 'employment') {
            const resume = confirm(
                `A previous Employment run was interrupted at entry ${saved.index + 1}.\n\n` +
                `OK  → Resume from entry ${saved.index + 1}\n` +
                `Cancel → Discard and start fresh`
            );
            if (resume) {
                setRunningState(shadow, true);
                runEmploymentHistory(
                    { employment: saved.entries, otherExp: [] },
                    (t, tp) => n(t, tp), () => setRunningState(shadow, false), saved.index, false
                );
                return;
            }
            await discardSavedJob();
        }

        if (!parsedData) { n('Parse the output first.', 'error'); return; }

        let shouldDelete = false;
        const existingCount = countEmploymentEntries();
        if (existingCount > 0) {
            shouldDelete = confirm(
                `There are ${existingCount} existing Employment History entries on your profile.\n\n` +
                `OK  → Delete all ${existingCount} entries, then add new ones\n` +
                `Cancel → Keep existing entries and just add new ones`
            );
        }
        setRunningState(shadow, true);
        runEmploymentHistory(parsedData, (t, tp) => n(t, tp), () => setRunningState(shadow, false), 0, shouldDelete);
    };

    shadow.querySelector('#act-stop').onclick = () => {
        stopAutomation();
        n('Automation stopped. Progress saved. Click the run button to resume.', 'warning');
        setRunningState(shadow, false);
    };
}

function setRunningState(shadow, running) {
    shadow.querySelector('#watch-note').style.display = running ? 'block' : 'none';
    shadow.querySelector('#act-stop').style.display   = running ? 'block' : 'none';
    ['#act-run-other-exp', '#act-run-employment'].forEach(sel => {
        const btn = shadow.querySelector(sel);
        btn.disabled      = running;
        btn.style.opacity = running ? '0.45' : '';
        btn.style.cursor  = running ? 'not-allowed' : '';
    });
}

// ──────────────────────────────────────────────────────────────
// Gate handler
// ──────────────────────────────────────────────────────────────
async function handleGate(shadow, gate, onSuccess) {
    hideAuthOverlay(shadow);

    if (gate.state === 'no_session') {
        showAuthOverlay(shadow, 'auth-view-signup', null, onSuccess);
        return;
    }

    if (gate.state === 'device_mismatch') {
        showAuthOverlay(shadow, 'auth-view-device', gate.profile, onSuccess);
        return;
    }

    shrinkHostToSidebar();

    const uiRoot = shadow.querySelector('#ui-root');
    uiRoot.style.display = 'block';

    if (gate.state === 'upgrade_required') {
        shadow.querySelector('#expired-note').style.display = 'block';
        shadow.querySelector('#expired-upgrade-link').onclick = e => {
            e.preventDefault();
            openDashboard(shadow, gate.profile, gate.subscription);
            setTimeout(() => shadow.querySelector('[data-tab="subscription"]').click(), 50);
        };
        ['#act-run-other-exp', '#act-run-employment'].forEach(sel => {
            const btn = shadow.querySelector(sel);
            btn.disabled = true;
            btn.style.opacity = '0.4';
            btn.title = 'Subscription required';
        });
        setupMainUI(shadow, gate.profile, gate.subscription);
        setupDashboardOverlay(shadow, gate.profile, gate.subscription);
        return;
    }

    // state === 'ok'
    setupMainUI(shadow, gate.profile, gate.subscription);
    setupDashboardOverlay(shadow, gate.profile, gate.subscription);
    if (onSuccess) onSuccess();
}

// ──────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────
async function main() {
    const shadow = createShadowHost();
    if (!shadow) return;

    await injectCSS(shadow);

    await appendHTML(shadow, 'overlay-auth.html');
    await appendHTML(shadow, 'overlay-dashboard.html');

    const uiWrapper = await appendHTML(shadow, 'ui.html');
    uiWrapper.id = 'ui-root';
    uiWrapper.style.display = 'none';

    setupAuthOverlay(shadow, null);

    const gate = await wizardGate();
    await handleGate(shadow, gate, null);
}

main();
