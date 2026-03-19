// automator.js — Upwork DOM automation with CAPTCHA guard, human-like behavior, and resume support

// ──────────────────────────────────────────────────────────────
// CAPTCHA detection
// ──────────────────────────────────────────────────────────────
const CAPTCHA_SIGNALS = [
    '[data-qa="captcha"]',
    '.cf-challenge-running',
    '#challenge-form',
    '[class*="captcha"]',
    '[id*="captcha"]',
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]'
];

function isCaptchaVisible() {
    if (CAPTCHA_SIGNALS.some(sel => document.querySelector(sel))) return true;
    const bodyText = (document.body?.innerText || '').toLowerCase();
    return bodyText.includes('verify you are human') || bodyText.includes('are you a robot');
}

// ──────────────────────────────────────────────────────────────
// Automation state (in-memory only — never auto-runs on load)
// ──────────────────────────────────────────────────────────────
const AUTO = { running: false, aborted: false };

function startAutomation()  { AUTO.running = true;  AUTO.aborted = false; }
function stopAutomation()   { AUTO.running = false; AUTO.aborted = true;  }

async function safeDelay(min, max) {
    if (AUTO.aborted) throw new Error('ABORTED');
    if (isCaptchaVisible()) { stopAutomation(); throw new Error('CAPTCHA'); }
    await randomDelay(min, max);
    if (AUTO.aborted) throw new Error('ABORTED');
    if (isCaptchaVisible()) { stopAutomation(); throw new Error('CAPTCHA'); }
}

// ──────────────────────────────────────────────────────────────
// Resume state — saved to chrome.storage so refresh-safe
// Only written when a job is actively running.
// Never read on page load — only read when user clicks a run button.
// ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'wizard_job';

function saveJobState(state) {
    return new Promise(r => chrome.storage.local.set({ [STORAGE_KEY]: state }, r));
}

function loadJobState() {
    return new Promise(r => chrome.storage.local.get(STORAGE_KEY, res => r(res[STORAGE_KEY] || null)));
}

function clearJobState() {
    return new Promise(r => chrome.storage.local.remove(STORAGE_KEY, r));
}

// ──────────────────────────────────────────────────────────────
// DOM helpers
// ──────────────────────────────────────────────────────────────
function waitForEl(selector, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);

        const observer = new MutationObserver(() => {
            const found = document.querySelector(selector);
            if (found) { observer.disconnect(); resolve(found); }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout waiting for: ${selector}`)); }, timeout);
    });
}

// Select a <select> option by matching visible text (case-insensitive, partial match)
async function humanSelect(selectEl, targetText) {
    const target = targetText.trim().toLowerCase();
    const option = Array.from(selectEl.options).find(o =>
        o.text.toLowerCase().includes(target) || o.value.toLowerCase().includes(target)
    );
    if (!option) throw new Error(`Option not found in select: "${targetText}"`);

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    if (nativeSetter) {
        nativeSetter.call(selectEl, option.value);
    } else {
        selectEl.value = option.value;
    }

    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    await randomDelay(200, 500);
}

// ──────────────────────────────────────────────────────────────
// SELECTORS
// ──────────────────────────────────────────────────────────────
const SEL = {
    // ── Other Experiences ──────────────────────────────────────
    otherExpAddBtn:        'button[aria-label="Add other experiences"]',
    otherExpAddBtnAlt:     'button[aria-label="Add an experience"]',
    otherExpTitleInput:    'input#other-experience-subject',
    otherExpDescInput:     'textarea#other-experience-description',
    otherExpSaveBtn:       '.air3-modal-footer button.air3-btn-primary',

    otherExpItems:         null,  // TODO: wrapper element per entry (for count check)
    otherExpDeleteBtn:     null,  // TODO: delete button per entry
    otherExpConfirmDelete: null,  // TODO: confirm button on delete modal

    // ── Employment History ─────────────────────────────────────
    employmentAddBtn:        'button[aria-label="Add employment history"]',
    employmentCompanyInput:  'input#company',
    employmentCityInput:     'input#city',
    employmentCountrySelect: 'select#country',
    employmentMonthFrom:     'select#month-from',
    employmentYearFrom:      'select#year-from',
    employmentDescInput:     'textarea#description',

    employmentTitleInput:    null,  // TODO: job title input (not in extracted HTML yet)
    employmentSaveBtn:       null,  // TODO: save button inside employment modal
    employmentItems:         null,  // TODO: wrapper element per entry (for count check)
    employmentDeleteBtn:     'button[aria-label*="Delete"][aria-label*="Employment history item"]',
    employmentConfirmDelete: null,  // TODO: confirm button on delete modal
    employmentEditBtn:       'button[aria-label*="Edit"][aria-label*="Employment history item"]', // future use

    // ── Saved for future use ───────────────────────────────────
    // certificateDeleteBtn: 'button[aria-label*="Delete certificate"]',
    // showMoreBtn:          'button[data-testid="show-more"]',
};

// ──────────────────────────────────────────────────────────────
// Split "City, Country" string into parts
// e.g. "Austin, United States" → { city: "Austin", country: "United States" }
// ──────────────────────────────────────────────────────────────
function splitLocation(locationStr) {
    const idx = locationStr.lastIndexOf(',');
    if (idx === -1) return { city: locationStr.trim(), country: '' };
    return {
        city:    locationStr.substring(0, idx).trim(),
        country: locationStr.substring(idx + 1).trim()
    };
}

// ──────────────────────────────────────────────────────────────
// Count existing entries
// ──────────────────────────────────────────────────────────────
function countOtherExperiences() {
    if (!SEL.otherExpItems) return 0;
    return document.querySelectorAll(SEL.otherExpItems).length;
}

function countEmploymentEntries() {
    if (!SEL.employmentItems) return 0;
    return document.querySelectorAll(SEL.employmentItems).length;
}

// ──────────────────────────────────────────────────────────────
// Get the Other Exp add button (tries main label, falls back to alt)
// ──────────────────────────────────────────────────────────────
function getOtherExpAddBtn() {
    return document.querySelector(SEL.otherExpAddBtn)
        || document.querySelector(SEL.otherExpAddBtnAlt);
}

// ──────────────────────────────────────────────────────────────
// Delete all — other experiences
// ──────────────────────────────────────────────────────────────
async function deleteAllOtherExperiences(notify) {
    notify('Deleting existing other experience entries...', 'warning');
    while (true) {
        await safeDelay(600, 1200);
        const btn = SEL.otherExpDeleteBtn ? document.querySelector(SEL.otherExpDeleteBtn) : null;
        if (!btn) break;
        await humanClick(btn);
        await safeDelay(400, 800);
        const confirm = SEL.otherExpConfirmDelete ? document.querySelector(SEL.otherExpConfirmDelete) : null;
        if (confirm) { await humanClick(confirm); await safeDelay(600, 1200); }
    }
    notify('Existing entries cleared.', 'warning');
}

// ──────────────────────────────────────────────────────────────
// Delete all — employment history
// ──────────────────────────────────────────────────────────────
async function deleteAllEmploymentEntries(notify) {
    notify('Deleting existing employment entries...', 'warning');
    while (true) {
        await safeDelay(600, 1200);
        const btn = SEL.employmentDeleteBtn ? document.querySelector(SEL.employmentDeleteBtn) : null;
        if (!btn) break;
        await humanClick(btn);
        await safeDelay(400, 800);
        const confirm = SEL.employmentConfirmDelete ? document.querySelector(SEL.employmentConfirmDelete) : null;
        if (confirm) { await humanClick(confirm); await safeDelay(600, 1200); }
    }
    notify('Existing entries cleared.', 'warning');
}

// ──────────────────────────────────────────────────────────────
// Add single other experience entry
// ──────────────────────────────────────────────────────────────
async function addOneOtherExperience(entry) {
    const addBtn = getOtherExpAddBtn();
    if (!addBtn) throw new Error('Could not find the Add Other Experience button on this page');
    await humanClick(addBtn);
    await safeDelay(600, 1200);

    const titleInput = await waitForEl(SEL.otherExpTitleInput);
    await humanType(titleInput, entry.title);
    await safeDelay(300, 700);

    const descInput = await waitForEl(SEL.otherExpDescInput);
    await humanType(descInput, entry.description);
    await safeDelay(400, 900);

    const saveBtn = await waitForEl(SEL.otherExpSaveBtn);
    await humanClick(saveBtn);
    await safeDelay(700, 1400);
}

// ──────────────────────────────────────────────────────────────
// Add single employment entry
// ──────────────────────────────────────────────────────────────
async function addOneEmploymentEntry(entry) {
    const addBtn = await waitForEl(SEL.employmentAddBtn);
    await humanClick(addBtn);
    await safeDelay(600, 1200);

    const companyInput = await waitForEl(SEL.employmentCompanyInput);
    await humanType(companyInput, entry.company);
    await safeDelay(300, 600);

    const { city, country } = splitLocation(entry.location);

    const cityInput = await waitForEl(SEL.employmentCityInput);
    await humanType(cityInput, city);
    await safeDelay(300, 600);

    const countrySelect = await waitForEl(SEL.employmentCountrySelect);
    await humanSelect(countrySelect, country);
    await safeDelay(300, 600);

    // Job title — TODO when selector is confirmed
    if (SEL.employmentTitleInput) {
        const titleInput = await waitForEl(SEL.employmentTitleInput);
        await humanType(titleInput, entry.title);
        await safeDelay(300, 600);
    }

    // Month/year — use Jan + current year as safe defaults if not in data
    const monthSelect = document.querySelector(SEL.employmentMonthFrom);
    if (monthSelect) { await humanSelect(monthSelect, 'Jan'); await safeDelay(200, 400); }

    const yearSelect = document.querySelector(SEL.employmentYearFrom);
    if (yearSelect) {
        const currentYear = String(new Date().getFullYear());
        await humanSelect(yearSelect, currentYear);
        await safeDelay(200, 400);
    }

    const descInput = await waitForEl(SEL.employmentDescInput);
    await humanType(descInput, entry.description);
    await safeDelay(400, 900);

    if (!SEL.employmentSaveBtn) throw new Error('employmentSaveBtn selector not set yet — TODO');
    const saveBtn = await waitForEl(SEL.employmentSaveBtn);
    await humanClick(saveBtn);
    await safeDelay(700, 1400);
}

// ──────────────────────────────────────────────────────────────
// Run: Other Experiences (with resume support)
// ──────────────────────────────────────────────────────────────
async function runOtherExperiences(parsedData, notify, onDone, resumeFromIndex = 0) {
    if (!parsedData.otherExp.length) {
        notify('No other experience entries found in parsed data.', 'error');
        return;
    }

    startAutomation();

    try {
        if (resumeFromIndex === 0) {
            const existing = countOtherExperiences();
            if (existing >= 100) {
                await deleteAllOtherExperiences(notify);
                await safeDelay(800, 1500);
            }
        } else {
            notify(`Resuming from entry ${resumeFromIndex + 1}...`, 'warning');
        }

        const total = parsedData.otherExp.length;

        for (let i = resumeFromIndex; i < total; i++) {
            await saveJobState({ type: 'other_exp', index: i, entries: parsedData.otherExp });
            await safeDelay(500, 1200);
            await addOneOtherExperience(parsedData.otherExp[i]);
            notify(`Other Experience: ${i + 1} / ${total} added`, 'success');
        }

        await clearJobState();
        notify(`✅ Done — ${total} other experience entries added.`, 'success');

    } catch (e) {
        handleAutomationError(e, notify);
    } finally {
        AUTO.running = false;
        if (onDone) onDone();
    }
}

// ──────────────────────────────────────────────────────────────
// Run: Employment History (with resume support)
// ──────────────────────────────────────────────────────────────
async function runEmploymentHistory(parsedData, notify, onDone, resumeFromIndex = 0) {
    if (!parsedData.employment.length) {
        notify('No employment entries found in parsed data.', 'error');
        return;
    }

    startAutomation();

    try {
        if (resumeFromIndex === 0) {
            const existing = countEmploymentEntries();
            if (existing >= 10) {
                await deleteAllEmploymentEntries(notify);
                await safeDelay(800, 1500);
            }
        } else {
            notify(`Resuming from entry ${resumeFromIndex + 1}...`, 'warning');
        }

        const total = parsedData.employment.length;

        for (let i = resumeFromIndex; i < total; i++) {
            await saveJobState({ type: 'employment', index: i, entries: parsedData.employment });
            await safeDelay(500, 1200);
            await addOneEmploymentEntry(parsedData.employment[i]);
            notify(`Employment: ${i + 1} / ${total} added`, 'success');
        }

        await clearJobState();
        notify(`✅ Done — ${total} employment entries added.`, 'success');

    } catch (e) {
        handleAutomationError(e, notify);
    } finally {
        AUTO.running = false;
        if (onDone) onDone();
    }
}

// ──────────────────────────────────────────────────────────────
// Check for a saved job — called only when user clicks a run button
// ──────────────────────────────────────────────────────────────
async function checkForSavedJob() { return await loadJobState(); }
async function discardSavedJob()  { await clearJobState(); }

// ──────────────────────────────────────────────────────────────
// Error handler
// ──────────────────────────────────────────────────────────────
function handleAutomationError(e, notify) {
    if (e.message === 'CAPTCHA') {
        notify('⚠️ Upwork asked you to verify you are human. Automation paused. Complete the check, then click the run button again to resume.', 'error');
    } else if (e.message === 'ABORTED') {
        // user clicked stop — silent, already notified
    } else {
        notify(`Error: ${e.message}`, 'error');
    }
}
