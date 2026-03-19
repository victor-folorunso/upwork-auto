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

// ──────────────────────────────────────────────────────────────
// SELECTORS — fill in after web inspect
// ──────────────────────────────────────────────────────────────
const SEL = {
    otherExpItems:           '[data-test="other-experience-item"]',       // TODO
    otherExpAddBtn:          '[data-test="add-other-experience-btn"]',    // TODO
    otherExpDeleteBtn:       '[data-test="delete-other-experience-btn"]', // TODO
    otherExpTitleInput:      '[data-test="other-exp-title-input"]',       // TODO
    otherExpDescInput:       '[data-test="other-exp-desc-input"]',        // TODO
    otherExpSaveBtn:         '[data-test="other-exp-save-btn"]',          // TODO
    otherExpConfirmDelete:   '[data-test="confirm-delete-btn"]',          // TODO

    employmentItems:         '[data-test="employment-item"]',             // TODO
    employmentAddBtn:        '[data-test="add-employment-btn"]',          // TODO
    employmentDeleteBtn:     '[data-test="delete-employment-btn"]',       // TODO
    employmentCompanyInput:  '[data-test="employment-company-input"]',    // TODO
    employmentLocationInput: '[data-test="employment-location-input"]',   // TODO
    employmentTitleInput:    '[data-test="employment-title-input"]',      // TODO
    employmentDescInput:     '[data-test="employment-desc-input"]',       // TODO
    employmentSaveBtn:       '[data-test="employment-save-btn"]',         // TODO
    employmentConfirmDelete: '[data-test="confirm-delete-btn"]',          // TODO
};

// ──────────────────────────────────────────────────────────────
// Count existing entries
// ──────────────────────────────────────────────────────────────
function countOtherExperiences()  { return document.querySelectorAll(SEL.otherExpItems).length; }
function countEmploymentEntries() { return document.querySelectorAll(SEL.employmentItems).length; }

// ──────────────────────────────────────────────────────────────
// Delete all — other experiences
// ──────────────────────────────────────────────────────────────
async function deleteAllOtherExperiences(notify) {
    notify('Deleting existing other experience entries...', 'warning');
    while (true) {
        await safeDelay(600, 1200);
        const btn = document.querySelector(SEL.otherExpDeleteBtn);
        if (!btn) break;
        await humanClick(btn);
        await safeDelay(400, 800);
        const confirm = document.querySelector(SEL.otherExpConfirmDelete);
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
        const btn = document.querySelector(SEL.employmentDeleteBtn);
        if (!btn) break;
        await humanClick(btn);
        await safeDelay(400, 800);
        const confirm = document.querySelector(SEL.employmentConfirmDelete);
        if (confirm) { await humanClick(confirm); await safeDelay(600, 1200); }
    }
    notify('Existing entries cleared.', 'warning');
}

// ──────────────────────────────────────────────────────────────
// Add single other experience entry
// ──────────────────────────────────────────────────────────────
async function addOneOtherExperience(entry) {
    const addBtn = await waitForEl(SEL.otherExpAddBtn);
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

    const locationInput = await waitForEl(SEL.employmentLocationInput);
    await humanType(locationInput, entry.location);
    await safeDelay(300, 600);

    const titleInput = await waitForEl(SEL.employmentTitleInput);
    await humanType(titleInput, entry.title);
    await safeDelay(300, 600);

    const descInput = await waitForEl(SEL.employmentDescInput);
    await humanType(descInput, entry.description);
    await safeDelay(400, 900);

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
        // Only delete if starting fresh (not resuming)
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
            // Save progress before each entry so a refresh can resume here
            await saveJobState({ type: 'other_exp', index: i, entries: parsedData.otherExp });

            await safeDelay(500, 1200);
            await addOneOtherExperience(parsedData.otherExp[i]);
            notify(`Other Experience: ${i + 1} / ${total} added`, 'success');
        }

        await clearJobState();
        notify(`✅ Done — ${total} other experience entries added.`, 'success');

    } catch (e) {
        // Do NOT clear job state on error/abort — preserve it for resume
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
// Returns { type, index, entries } or null
// ──────────────────────────────────────────────────────────────
async function checkForSavedJob() {
    return await loadJobState();
}

async function discardSavedJob() {
    await clearJobState();
}

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
