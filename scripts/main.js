// main.js — orchestrator: shadow DOM, UI wiring, auth gate, overlays

const ROOT_ID     = 'upwork-wizard-root';
const PANEL_WIDTH = 'min(380px, calc(100vw - 30px))';

// Upwork shows 3 entries and hides the rest behind "Show more (N)".
// Both sections cap at 97 hidden + 3 visible = 100 total.
// The delete prompt only fires at 97+ (UPWORK_SECTION_LIMIT - 3).
const UPWORK_SECTION_LIMIT      = 100;
const UPWORK_SECTION_NEAR_FULL  = UPWORK_SECTION_LIMIT - 3;  // 97

// ──────────────────────────────────────────────────────────────
// Shadow DOM + asset loader
// ──────────────────────────────────────────────────────────────
function createShadowHost() {
    if (document.getElementById(ROOT_ID)) return null;
    const host = document.createElement('div');
    host.id = ROOT_ID;
    host.style.cssText = `
        position: fixed;
        bottom: 15px; right: 15px;
        z-index: 2147483647;
        width: ${PANEL_WIDTH};
        pointer-events: auto;
    `;
    const shadow = host.attachShadow({ mode: 'closed' });
    document.body.appendChild(host);
    return shadow;
}

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
// Notify
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
// Dashboard overlay helpers
// ──────────────────────────────────────────────────────────────
function showDashboardOverlay(shadow) {
    expandHostForOverlay();
    const el = shadow.querySelector('#dashboard-backdrop');
    if (el) { el.style.display = 'flex'; el.style.pointerEvents = 'auto'; }
}

function hideDashboardOverlay(shadow) {
    const el = shadow.querySelector('#dashboard-backdrop');
    if (el) el.style.display = 'none';
    shrinkHostToSidebar();
}

// ──────────────────────────────────────────────────────────────
// Auth card helpers
// ──────────────────────────────────────────────────────────────
function showAuthCard(shadow, initialView, profile) {
    const card = shadow.querySelector('#auth-backdrop');
    const pill = shadow.querySelector('#wz-pill');
    if (card) card.style.display = 'block';
    if (pill) pill.style.display = 'none';

    shadow.querySelectorAll('.auth-view').forEach(v => v.style.display = 'none');
    const view = shadow.querySelector(`#${initialView}`);
    if (view) view.style.display = 'block';

    if (initialView === 'auth-view-device' && profile?.device) {
        const d = profile.device;
        shadow.querySelector('#device-info-box').innerHTML =
            `<strong>Registered device</strong><br>` +
            `First seen: ${new Date(d.first_seen).toLocaleDateString()}<br>` +
            `Last seen: ${new Date(d.last_seen).toLocaleDateString()}<br>` +
            `<small style="word-break:break-all">${(d.user_agent ?? '').substring(0, 80)}...</small>`;
    }
}

function hideAuthCard(shadow) {
    const card = shadow.querySelector('#auth-backdrop');
    if (card) card.style.display = 'none';
}

function showPill(shadow) {
    const pill = shadow.querySelector('#wz-pill');
    if (pill) pill.style.display = 'block';
}

function hidePill(shadow) {
    const pill = shadow.querySelector('#wz-pill');
    if (pill) pill.style.display = 'none';
}

// ──────────────────────────────────────────────────────────────
// Coupon UI helper
// ──────────────────────────────────────────────────────────────
function applyCouponUI(code, msgEl, payBtn, defaultLabel) {
    const discountMap = {
        'MAVERIC50':  { label: 'Pay ₦500',              text: '50% off applied. Pay ₦500.' },
        'MAVERIC75':  { label: 'Pay ₦250',              text: '75% off applied. Pay ₦250.' },
        'MAVERIC90':  { label: 'Pay ₦100',              text: '90% off applied. Pay ₦100.' },
        'MAVERIC100': { label: '🎉 Activate Free Month', text: '100% off. No payment needed!' },
    };
    const discount = discountMap[code];
    if (discount) {
        payBtn.textContent = discount.label;
        msgEl.className = 'pw-msg success';
        msgEl.textContent = discount.text;
        return code;
    } else {
        payBtn.textContent = defaultLabel;
        msgEl.className = 'pw-msg error';
        msgEl.textContent = 'Invalid coupon code.';
        return null;
    }
}

// ── Human-readable coupon error messages ─────────────────────
function couponErrText(code) {
    const map = {
        COUPON_EXHAUSTED:    'This coupon has reached its usage limit.',
        COUPON_ALREADY_USED: 'You have already used this coupon.',
        COUPON_INVALID:      'Invalid coupon code.',
        NOT_FREE_COUPON:     'This coupon cannot be used here.',
        MISSING_AUTH:        'Authentication required. Please refresh the page.',
        INVALID_AUTH:        'Session expired. Please refresh the page.',
        USER_MISMATCH:       'Authentication error. Please refresh the page.',
        NO_SESSION:          'Session expired. Please refresh the page.',
        NETWORK_ERROR:       'Network error. Try again.',
    };
    return map[code] ?? `Error: ${code}`;
}

// ──────────────────────────────────────────────────────────────
// Auth overlay wiring — includes OTP flows
// ──────────────────────────────────────────────────────────────
function setupAuthOverlay(shadow, onSuccess) {
    let _pendingEmail = '';

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

    function clearMsg(id) {
        const el = shadow.querySelector(`#${id}`);
        el.style.display = 'none';
        el.textContent = '';
    }

    function setLoading(btnId, loading, label) {
        const btn = shadow.querySelector(`#${btnId}`);
        btn.disabled = loading;
        btn.textContent = loading ? 'Please wait...' : label;
    }

    shadow.querySelector('#auth-cancel-btn').onclick = () => { hideAuthCard(shadow); showPill(shadow); };
    shadow.querySelector('#wz-pill').onclick = () => { hidePill(shadow); showAuthCard(shadow, 'auth-view-signup', null); };

    shadow.querySelector('#go-login').onclick             = e => { e.preventDefault(); clearMsg('su-msg'); showView('auth-view-login'); };
    shadow.querySelector('#go-signup').onclick            = e => { e.preventDefault(); clearMsg('li-msg'); showView('auth-view-signup'); };
    shadow.querySelector('#go-forgot').onclick            = e => { e.preventDefault(); clearMsg('li-msg'); showView('auth-view-forgot'); };
    shadow.querySelector('#go-login-from-forgot').onclick = e => { e.preventDefault(); clearMsg('fp-msg'); showView('auth-view-login'); };
    shadow.querySelector('#otp-back-signup').onclick      = e => { e.preventDefault(); showView('auth-view-signup'); };
    shadow.querySelector('#otp-back-reset').onclick       = e => { e.preventDefault(); showView('auth-view-forgot'); };

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
        _pendingEmail = email;
        shadow.querySelector('#otp-email-display').textContent = email;
        clearMsg('otp-signup-msg');
        shadow.querySelector('#otp-signup-code').value = '';
        showView('auth-view-otp-signup');
    };

    shadow.querySelector('#otp-signup-btn').onclick = async () => {
        const token = shadow.querySelector('#otp-signup-code').value.trim();
        if (token.length !== 6) return msg('otp-signup-msg', 'Enter the 6-digit code from your email.', 'error');
        setLoading('otp-signup-btn', true, 'Verify & Activate');
        const result = await wizardVerifySignupOtp(_pendingEmail, token);
        setLoading('otp-signup-btn', false, 'Verify & Activate');
        if (!result.ok) return msg('otp-signup-msg', result.error, 'error');
        handleGate(shadow, await wizardGate(), onSuccess);
    };

    shadow.querySelector('#otp-signup-code').oninput = (e) => {
        if (e.target.value.length === 6) shadow.querySelector('#otp-signup-btn').click();
    };

    shadow.querySelector('#otp-resend-btn').onclick = async (e) => {
        e.preventDefault();
        msg('otp-signup-msg', 'Resending...', 'warning');
        await wizardSignUp(_pendingEmail, shadow.querySelector('#su-password').value);
        msg('otp-signup-msg', '✅ New code sent. Check your email.', 'success');
    };

    shadow.querySelector('#li-btn').onclick = async () => {
        const email    = shadow.querySelector('#li-email').value.trim();
        const password = shadow.querySelector('#li-password').value;
        if (!email || !password) return msg('li-msg', 'Fill in all fields.', 'error');
        setLoading('li-btn', true, 'Log In');
        const result = await wizardSignIn(email, password);
        setLoading('li-btn', false, 'Log In');
        if (!result.ok) return msg('li-msg', result.error, 'error');
        handleGate(shadow, await wizardGate(), onSuccess);
    };

    shadow.querySelector('#fp-btn').onclick = async () => {
        const email = shadow.querySelector('#fp-email').value.trim();
        if (!email) return msg('fp-msg', 'Enter your email.', 'error');
        setLoading('fp-btn', true, 'Send Reset Code');
        const result = await wizardForgotPassword(email);
        setLoading('fp-btn', false, 'Send Reset Code');
        if (!result.ok) return msg('fp-msg', result.error, 'error');
        _pendingEmail = email;
        clearMsg('otp-reset-msg');
        shadow.querySelector('#otp-reset-code').value = '';
        shadow.querySelector('#otp-reset-password').value = '';
        showView('auth-view-otp-reset');
    };

    shadow.querySelector('#otp-reset-btn').onclick = async () => {
        const token    = shadow.querySelector('#otp-reset-code').value.trim();
        const password = shadow.querySelector('#otp-reset-password').value;
        if (token.length !== 6)  return msg('otp-reset-msg', 'Enter the 6-digit code from your email.', 'error');
        if (password.length < 8) return msg('otp-reset-msg', 'New password must be at least 8 characters.', 'error');
        setLoading('otp-reset-btn', true, 'Set New Password');
        const verify = await wizardVerifyRecoveryOtp(_pendingEmail, token);
        if (!verify.ok) { setLoading('otp-reset-btn', false, 'Set New Password'); return msg('otp-reset-msg', verify.error, 'error'); }
        const update = await wizardUpdatePassword(password);
        setLoading('otp-reset-btn', false, 'Set New Password');
        if (!update.ok) return msg('otp-reset-msg', update.error, 'error');
        msg('otp-reset-msg', '✅ Password updated! Logging you in...', 'success');
        setTimeout(async () => handleGate(shadow, await wizardGate(), onSuccess), 1200);
    };

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

// ──────────────────────────────────────────────────────────────
// Dashboard overlay wiring
// ──────────────────────────────────────────────────────────────
function setupDashboardOverlay(shadow, profile, subscription) {

    shadow.querySelector('#dashboard-close').onclick = () => hideDashboardOverlay(shadow);

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
        const val = customPromptEl.value.trim();
        const toSave = (val === DEFAULT_CUSTOM_PROMPT.trim()) ? null : val;
        const result = await saveCustomPrompt(profile.id, toSave);
        btn.disabled = false; btn.textContent = 'Save Prompt';
        const el = shadow.querySelector('#prompt-save-msg');
        el.style.display = 'block';
        el.className = `pw-msg ${result.ok ? 'success' : 'error'}`;
        el.textContent = result.ok ? '✅ Prompt saved.' : result.error;
    };

    shadow.querySelector('#dash-prompt-reset').onclick = async () => {
        customPromptEl.value = DEFAULT_CUSTOM_PROMPT;
        const btn = shadow.querySelector('#dash-prompt-reset');
        btn.disabled = true; btn.textContent = 'Resetting...';
        const result = await saveCustomPrompt(profile.id, null);
        btn.disabled = false; btn.textContent = 'Reset to default';
        const el = shadow.querySelector('#prompt-save-msg');
        el.style.display = 'block';
        el.className = `pw-msg ${result.ok ? 'success' : 'error'}`;
        el.textContent = result.ok ? '✅ Reset to default and saved.' : result.error;
    };

    // ── Subscription tab ──
    const statusMap = {
        active:  { icon: '✅', label: 'Active',  detail: `Renews in ${subscription.daysLeft ?? 0} days` },
        expired: { icon: '🔒', label: 'Expired', detail: 'Subscribe to continue using the wizard' },
    };
    const s = statusMap[subscription.status] || statusMap.expired;
    shadow.querySelector('#sub-status-icon').textContent   = s.icon;
    shadow.querySelector('#sub-status-label').textContent  = s.label;
    shadow.querySelector('#sub-status-detail').textContent = s.detail;

    const isExpired = subscription.status === 'expired';
    shadow.querySelector('#sub-upgrade-section').style.display = isExpired ? 'block' : 'none';
    shadow.querySelector('#sub-renew-section').style.display   = isExpired ? 'none'  : 'block';

    let upgradeAppliedCoupon = null;
    shadow.querySelector('#sub-apply-coupon').onclick = () => {
        const code  = shadow.querySelector('#sub-coupon').value.trim().toUpperCase();
        const msgEl = shadow.querySelector('#sub-coupon-msg');
        msgEl.style.display = 'block';
        upgradeAppliedCoupon = applyCouponUI(code, msgEl, shadow.querySelector('#sub-pay-btn'), 'Pay ₦1,000');
    };

    let renewAppliedCoupon = null;
    shadow.querySelector('#sub-renew-apply-coupon').onclick = () => {
        const code  = shadow.querySelector('#sub-renew-coupon').value.trim().toUpperCase();
        const msgEl = shadow.querySelector('#sub-renew-coupon-msg');
        msgEl.style.display = 'block';
        renewAppliedCoupon = applyCouponUI(code, msgEl, shadow.querySelector('#sub-renew-btn'), 'Renew: Pay ₦1,000');
    };

    async function handlePayClick(btnId, msgElId, getCoupon, defaultLabel) {
        const btn           = shadow.querySelector(`#${btnId}`);
        const msgEl         = shadow.querySelector(`#${msgElId}`);
        const appliedCoupon = getCoupon();

        if (appliedCoupon === 'MAVERIC100') {
            btn.disabled = true; btn.textContent = 'Processing...';
            const result = await redeemFreeCoupon(profile.id, 'MAVERIC100');
            btn.disabled = false;
            msgEl.style.display = 'block';
            if (result.ok) {
                msgEl.className = 'pw-msg success';
                msgEl.textContent = '✅ Month activated! Reloading...';
                setTimeout(() => location.reload(), 1500);
            } else {
                btn.textContent = '🎉 Activate Free Month';
                msgEl.className = 'pw-msg error';
                msgEl.textContent = couponErrText(result.error);
            }
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Opening payment...';
        msgEl.style.display = 'block';
        msgEl.className = 'pw-msg warning';
        msgEl.textContent = '⏳ Creating your payment session...';

        const initiated = await initiatePayment(profile.id, profile.email, appliedCoupon);

        if (!initiated.ok) {
            btn.disabled = false;
            btn.textContent = defaultLabel;
            msgEl.className = 'pw-msg error';
            msgEl.textContent = `Could not create payment: ${initiated.error}`;
            return;
        }

        window.open(initiated.payment_link, '_blank');
        msgEl.className = 'pw-msg warning';
        msgEl.textContent = '⏳ Waiting for payment confirmation...';

        const cancelBtnSel = btnId === 'sub-pay-btn' ? '#sub-cancel-poll' : '#sub-cancel-poll-renew';
        const cancelBtn = shadow.querySelector(cancelBtnSel);
        if (cancelBtn) cancelBtn.style.display = 'inline-block';

        const result = await pollPayment(initiated.txRef, (secs) => {
            msgEl.textContent = `⏳ Waiting for payment... (${secs}s)`;
        });

        if (cancelBtn) cancelBtn.style.display = 'none';
        btn.disabled = false;
        btn.textContent = defaultLabel;

        if (result.ok) {
            msgEl.className = 'pw-msg success';
            msgEl.textContent = '✅ Payment confirmed! Activating...';
            setTimeout(() => location.reload(), 1200);
        } else if (result.error === 'CANCELLED') {
            msgEl.className = 'pw-msg warning';
            msgEl.textContent = 'Stopped checking. Click Refresh status after you pay.';
        } else if (result.error === 'TIMEOUT') {
            msgEl.className = 'pw-msg warning';
            msgEl.textContent = 'Timed out. Click Refresh status if you already paid.';
        } else {
            msgEl.className = 'pw-msg error';
            msgEl.textContent = `Payment check failed: ${result.error}`;
        }
    }

    shadow.querySelector('#sub-pay-btn').onclick   = () => handlePayClick('sub-pay-btn',  'sub-coupon-msg',       () => upgradeAppliedCoupon, 'Pay ₦1,000');
    shadow.querySelector('#sub-renew-btn').onclick  = () => handlePayClick('sub-renew-btn', 'sub-renew-coupon-msg', () => renewAppliedCoupon,   'Renew: Pay ₦1,000');

    shadow.querySelector('#sub-cancel-poll').onclick       = () => cancelPoll();
    shadow.querySelector('#sub-cancel-poll-renew').onclick = () => cancelPoll();

    shadow.querySelector('#sub-refresh-btn').onclick = async () => {
        const btn = shadow.querySelector('#sub-refresh-btn');
        btn.disabled = true; btn.textContent = 'Refreshing...';
        await clearStatusCache();
        location.reload();
    };

    // ── Account tab ──
    shadow.querySelector('#acct-email').textContent = profile.email;
    shadow.querySelector('#acct-since').textContent =
        profile.install_date ? new Date(profile.install_date).toLocaleDateString() : 'Unknown';

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
        msgEl.textContent = '✅ Device removed. You are now logged out everywhere.';
    };

    shadow.querySelector('#acct-logout-btn').onclick = async () => {
        await wizardSignOut();
        location.reload();
    };

    // ── Contact tab ──
    shadow.querySelector('#contact-send-btn').onclick = async () => {
        const btn    = shadow.querySelector('#contact-send-btn');
        const msgEl  = shadow.querySelector('#contact-msg');
        const bodyEl = shadow.querySelector('#contact-body');
        const text   = bodyEl.value.trim();

        if (text.length < 10) {
            msgEl.style.display = 'block';
            msgEl.className = 'pw-msg error';
            msgEl.textContent = 'Message must be at least 10 characters.';
            return;
        }

        btn.disabled = true; btn.textContent = 'Sending...';
        const result = await sendMessage(profile.id, profile.email, text);
        btn.disabled = false; btn.textContent = 'Send Message';

        msgEl.style.display = 'block';
        if (result.ok) {
            msgEl.className = 'pw-msg success';
            msgEl.textContent = "✅ Message sent. You'll hear back via email.";
            bodyEl.value = '';
        } else {
            msgEl.className = 'pw-msg error';
            msgEl.textContent = `Failed to send: ${result.error}`;
        }
    };
}

function openDashboard(shadow, profile, subscription) {
    showDashboardOverlay(shadow);
    shadow.querySelectorAll('.dash-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    shadow.querySelectorAll('.dash-panel').forEach((p, i) => p.style.display = i === 0 ? 'flex' : 'none');
}

// ──────────────────────────────────────────────────────────────
// Main UI
// ──────────────────────────────────────────────────────────────
function setupMainUI(shadow, profile, subscription) {
    let parsedData = null;
    const n = (text, type) => notify(shadow, text, type);

    shadow.querySelector('#status-close').onclick = () => {
        shadow.querySelector('#status-box').style.display = 'none';
    };

    shadow.querySelector('#act-open-dashboard').onclick = () => openDashboard(shadow, profile, subscription);

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
        shadow.querySelector('#sum-employment').innerHTML  = `Employment entries: <span>${parsedData.employment.length}</span>`;
        shadow.querySelector('#sum-other-exp').innerHTML   = `Other Experience entries: <span>${parsedData.otherExp.length}</span>`;
        shadow.querySelector('#sum-loose1000').innerHTML   = `Keywords (Loose 1000): <span>${parsedData.loose1000 ? '✓ found' : '✗ not found'}</span>`;
        shadow.querySelector('#parse-summary').classList.add('visible');
        if (parsedData.errors.length) n(parsedData.errors, 'warning');
        else n('Output parsed successfully. Choose an action below.', 'success');
        shadow.querySelector('#action-section').style.display =
            (parsedData.employment.length || parsedData.otherExp.length) ? 'block' : 'none';
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
                runOtherExperiences({ otherExp: saved.entries, employment: [], loose1000: saved.loose1000 || '' }, (t, tp) => n(t, tp), () => setRunningState(shadow, false), saved.index, false);
                return;
            }
            await discardSavedJob();
        }

        if (!parsedData) { n('Parse the output first.', 'error'); return; }

        // Only prompt when the section is at or near Upwork's limit (97+).
        // Below that, just run — no point interrupting the user.
        const ec = countOtherExperiences();
        let shouldDelete = false;

        if (ec >= UPWORK_SECTION_NEAR_FULL) {
            const atLimit = ec >= UPWORK_SECTION_LIMIT;
            const limitLine = atLimit
                ? `⚠️ Your profile is at the limit of ${UPWORK_SECTION_LIMIT} entries. You must delete before adding new ones.`
                : `⚠️ Your profile is nearly full (${ec}/${UPWORK_SECTION_LIMIT}). Adding more without deleting may hit the limit mid-run.`;

            shouldDelete = confirm(
                `${limitLine}\n\n` +
                `OK  → Delete all ${ec} existing entries, then add new ones\n` +
                `Cancel → Keep existing entries and just add new ones`
            );

            if (!shouldDelete && atLimit) {
                n(`Profile is full (${ec}/${UPWORK_SECTION_LIMIT}). Delete existing entries first.`, 'error');
                return;
            }
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
                runEmploymentHistory({ employment: saved.entries, otherExp: [] }, (t, tp) => n(t, tp), () => setRunningState(shadow, false), saved.index, false);
                return;
            }
            await discardSavedJob();
        }

        if (!parsedData) { n('Parse the output first.', 'error'); return; }

        const ec = countEmploymentEntries();
        let shouldDelete = false;

        if (ec >= UPWORK_SECTION_NEAR_FULL) {
            const atLimit = ec >= UPWORK_SECTION_LIMIT;
            const limitLine = atLimit
                ? `⚠️ Your profile is at the limit of ${UPWORK_SECTION_LIMIT} entries. You must delete before adding new ones.`
                : `⚠️ Your profile is nearly full (${ec}/${UPWORK_SECTION_LIMIT}). Adding more without deleting may hit the limit mid-run.`;

            shouldDelete = confirm(
                `${limitLine}\n\n` +
                `OK  → Delete all ${ec} existing entries, then add new ones\n` +
                `Cancel → Keep existing entries and just add new ones`
            );

            if (!shouldDelete && atLimit) {
                n(`Profile is full (${ec}/${UPWORK_SECTION_LIMIT}). Delete existing entries first.`, 'error');
                return;
            }
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
        btn.disabled = running; btn.style.opacity = running ? '0.45' : ''; btn.style.cursor = running ? 'not-allowed' : '';
    });
}

// ──────────────────────────────────────────────────────────────
// Gate handler
// ──────────────────────────────────────────────────────────────
async function handleGate(shadow, gate, onSuccess) {
    hideAuthCard(shadow);
    hidePill(shadow);

    if (gate.state === 'no_session') {
        showAuthCard(shadow, 'auth-view-signup', null);
        return;
    }
    if (gate.state === 'device_mismatch') {
        showAuthCard(shadow, 'auth-view-device', gate.profile);
        return;
    }

    shrinkHostToSidebar();
    shadow.querySelector('#ui-root').style.display = 'block';

    if (gate.state === 'upgrade_required') {
        shadow.querySelector('#expired-note').style.display = 'block';
        shadow.querySelector('#expired-upgrade-link').onclick = e => {
            e.preventDefault();
            openDashboard(shadow, gate.profile, gate.subscription);
            setTimeout(() => shadow.querySelector('[data-tab="subscription"]').click(), 50);
        };
        ['#act-run-other-exp', '#act-run-employment'].forEach(sel => {
            const btn = shadow.querySelector(sel);
            btn.disabled = true; btn.style.opacity = '0.4'; btn.title = 'Subscription required';
        });
        setupMainUI(shadow, gate.profile, gate.subscription);
        setupDashboardOverlay(shadow, gate.profile, gate.subscription);
        return;
    }

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

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type !== 'WIZARD_SHOW') return;
        if (shadow.querySelector('#ui-root')?.style.display !== 'none') return;
        hidePill(shadow);
        showAuthCard(shadow, 'auth-view-signup', null);
    });

    const gate = await wizardGate();
    await handleGate(shadow, gate, null);
}

main();
