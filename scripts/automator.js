// automator.js.  Upwork DOM automation with CAPTCHA guard, human-like behavior, and resume support

// ──────────────────────────────────────────────────────────────
// CAPTCHA detection
// ──────────────────────────────────────────────────────────────
function isCaptchaVisible() {
    return !!document.querySelector('.up-challenge-container');
}

let _captchaObserver = null;

function startCaptchaWatch() {
    if (_captchaObserver) return;
    _captchaObserver = new MutationObserver(() => {
        if (isCaptchaVisible() && AUTO.running) {
            stopAutomation();
            AUTO.captchaHit = true;
        }
    });
    _captchaObserver.observe(document.body, { childList: true, subtree: true });
}

function stopCaptchaWatch() {
    if (_captchaObserver) {
        _captchaObserver.disconnect();
        _captchaObserver = null;
    }
}

// ──────────────────────────────────────────────────────────────
// Automation state
// ──────────────────────────────────────────────────────────────
const AUTO = { running: false, aborted: false, captchaHit: false };

function startAutomation() {
    AUTO.running    = true;
    AUTO.aborted    = false;
    AUTO.captchaHit = false;
    startCaptchaWatch();
}

function stopAutomation() {
    AUTO.running = false;
    AUTO.aborted = true;
    stopCaptchaWatch();
}

async function safeDelay(min, max) {
    if (AUTO.aborted) throw new Error(AUTO.captchaHit ? 'CAPTCHA' : 'ABORTED');
    if (isCaptchaVisible()) { stopAutomation(); throw new Error('CAPTCHA'); }
    await randomDelay(min, max);
    if (AUTO.aborted) throw new Error(AUTO.captchaHit ? 'CAPTCHA' : 'ABORTED');
    if (isCaptchaVisible()) { stopAutomation(); throw new Error('CAPTCHA'); }
}

// ──────────────────────────────────────────────────────────────
// Resume state
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
function waitForEl(selector, timeout = 15000) {
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

// Wait for the save to complete after clicking the save button.
//
// The problem with checking "is overlay gone?" immediately is a race:
// the overlay may not have appeared yet, so we see "gone" and proceed
// while it's actually about to appear. The correct sequence is:
//   1. Wait for the overlay to APPEAR (proves the save started)
//   2. Wait for the overlay to DISAPPEAR (proves the save finished)
//
// If the overlay never appears within 2 seconds the save was instant
// and we move on. This covers both fast and slow network conditions.
async function waitForSaveComplete() {
    const OVERLAY_SEL = 'div[data-test="loader-overlay"].is-open';

    // Step 1: wait for overlay to appear (max 2s, silent if it never shows)
    await waitForEl(OVERLAY_SEL, 2000).catch(() => {});

    // Step 2: wait for overlay to be gone
    await new Promise((resolve, reject) => {
        const isGone = () => !document.querySelector(OVERLAY_SEL);
        if (isGone()) return resolve();

        const observer = new MutationObserver(() => {
            if (isGone()) { observer.disconnect(); resolve(); }
        });

        observer.observe(document.body, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['class']
        });
        setTimeout(() => { observer.disconnect(); reject(new Error('Timeout waiting for save overlay to close')); }, 15000);
    });

    // Small buffer after overlay clears before interacting again
    await randomDelay(400, 700);
}

async function typeAndPickFirst(input, text) {
    await humanType(input, text);
    await randomDelay(400, 800);

    const menu = document.querySelector('.air3-menu-list [role="option"], .air3-menu-list li');
    if (menu) {
        await humanClick(menu);
        await randomDelay(200, 400);
    }
}

async function pickDropdownOption(toggleSelector, value) {
    const toggle = document.querySelector(toggleSelector);
    if (!toggle) return;

    await humanClick(toggle);
    await randomDelay(400, 800);

    const options = Array.from(document.querySelectorAll('[role="option"], .air3-menu-list li'));
    const target = options.find(o => o.textContent.trim().toLowerCase().includes(value.toLowerCase()));

    if (target) {
        await humanClick(target);
        await randomDelay(200, 400);
    } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await randomDelay(200, 400);
    }
}

// ──────────────────────────────────────────────────────────────
// SELECTORS
// ──────────────────────────────────────────────────────────────
const SEL = {
    // ── Other Experiences ─────────────────────────────────────
    otherExpAddBtn:        'button[aria-label="Add other experiences"]',
    otherExpAddBtnAlt:     'button[aria-label="Add an experience"]',
    otherExpTitleInput:    'input#other-experience-subject',
    otherExpDescInput:     'textarea#other-experience-description',
    otherExpSaveBtn:       '.air3-modal-footer button.air3-btn-primary',
    otherExpDeleteBtn:     'button[aria-label*="Delete"][aria-label$="Experience item"]',
    otherExpConfirmDelete: '.air3-modal-footer button.air3-btn-primary',

    // ── Employment History ─────────────────────────────────────
    employmentAddBtn:       'button[aria-label="Add employment history"]',
    employmentCompanyInput: 'input.air3-typeahead-input-main',
    employmentCityInput:    'input#city',
    employmentCountryInput: 'input[aria-labelledby="countryLabel"]',
    employmentTitleInput:   'input[aria-labelledby="jobTitleLabel"]',
    employmentMonthToggle:  '#startMonth [data-test="dropdown-toggle"]',
    employmentYearToggle:   '#startYear  [data-test="dropdown-toggle"]',
    employmentDescInput:    'textarea#description',
    employmentSaveBtn:      '.air3-modal-footer button.air3-btn-primary',
    employmentDeleteBtn:    'button[aria-label*="Delete"][aria-label$="Employment history item"]',
    employmentConfirmDelete:'.air3-btn-row-right button.air3-btn-primary',
    employmentEditBtn:      'button[aria-label*="Edit"][aria-label*="Employment history item"]',
};

// ──────────────────────────────────────────────────────────────
// Count existing entries
//
// Both the span and the delete buttons are scoped to the section
// wrapper to prevent cross-contamination between the two sections.
// ──────────────────────────────────────────────────────────────
function _countSection(addBtnSelector, deleteBtnSelector) {
    const addBtn = document.querySelector(addBtnSelector);
    if (!addBtn) return 0;

    const wrapper = addBtn.closest('.air3-card-section');
    if (!wrapper) return 0;

    const span = wrapper.querySelector('span[data-testid="show-more-count"]');

    const hiddenCount  = span
        ? parseInt(span.textContent.trim().replace(/[()]/g, ''), 10) || 0
        : 0;
    const visibleCount = wrapper.querySelectorAll(deleteBtnSelector).length;

    return hiddenCount + visibleCount;
}

function countOtherExperiences() {
    return _countSection(SEL.otherExpAddBtn, SEL.otherExpDeleteBtn);
}

function countEmploymentEntries() {
    return _countSection(SEL.employmentAddBtn, SEL.employmentDeleteBtn);
}

// ──────────────────────────────────────────────────────────────
// Build the full Other Experience description and enforce 4000-char limit
// ──────────────────────────────────────────────────────────────
const OTHER_EXP_TOTAL_LIMIT = 3999;

function buildOtherExpDescription(description, loose1000) {
    const base = loose1000 && loose1000.trim()
        ? `${description}\n\n\n${loose1000.trim()}`
        : description;

    return base.length > OTHER_EXP_TOTAL_LIMIT ? base.substring(0, OTHER_EXP_TOTAL_LIMIT) : base;
}

// ──────────────────────────────────────────────────────────────
// Split "City, Country" string
// ──────────────────────────────────────────────────────────────
function splitLocation(locationStr) {
    const idx = locationStr.lastIndexOf(',');
    if (idx === -1) return { city: locationStr.trim(), country: '' };
    return {
        city:    locationStr.substring(0, idx).trim(),
        country: locationStr.substring(idx + 1).trim()
    };
}

function getOtherExpAddBtn() {
    return document.querySelector(SEL.otherExpAddBtn)
        || document.querySelector(SEL.otherExpAddBtnAlt);
}

// ──────────────────────────────────────────────────────────────
// Delete one other experience entry
// ──────────────────────────────────────────────────────────────
async function deleteOneOtherExperience(notify, index) {
    const btn = document.querySelector(SEL.otherExpDeleteBtn);
    if (!btn) return false;

    await humanClick(btn);
    await safeDelay(400, 800);

    const confirmBtn = await waitForEl(SEL.otherExpConfirmDelete);
    await humanClick(confirmBtn);
    await safeDelay(700, 1400);

    notify(`Deleting other experience entries... ${index} deleted`, 'warning');
    return true;
}

// ──────────────────────────────────────────────────────────────
// Delete one employment entry
// ──────────────────────────────────────────────────────────────
async function deleteOneEmploymentEntry(notify, index) {
    const btn = document.querySelector(SEL.employmentDeleteBtn);
    if (!btn) return false;

    await humanClick(btn);
    await safeDelay(400, 800);

    const confirmBtn = await waitForEl(SEL.employmentConfirmDelete);
    await humanClick(confirmBtn);
    await safeDelay(700, 1400);

    notify(`Deleting employment entries... ${index} deleted`, 'warning');
    return true;
}

// ──────────────────────────────────────────────────────────────
// Delete all other experiences one by one
// ──────────────────────────────────────────────────────────────
async function deleteAllOtherExperiences(notify) {
    notify('Deleting existing other experience entries...', 'warning');
    let i = 1;
    while (true) {
        await safeDelay(600, 1000);
        const more = await deleteOneOtherExperience(notify, i);
        if (!more) break;
        i++;
    }
    notify(`Cleared ${i - 1} other experience entries.`, 'warning');
}

// ──────────────────────────────────────────────────────────────
// Delete all employment entries one by one
// ──────────────────────────────────────────────────────────────
async function deleteAllEmploymentEntries(notify) {
    notify('Deleting existing employment entries...', 'warning');
    let i = 1;
    while (true) {
        await safeDelay(600, 1000);
        const more = await deleteOneEmploymentEntry(notify, i);
        if (!more) break;
        i++;
    }
    notify(`Cleared ${i - 1} employment entries.`, 'warning');
}

// ──────────────────────────────────────────────────────────────
// Add single other experience entry
// ──────────────────────────────────────────────────────────────
async function addOneOtherExperience(entry, loose1000) {
    const addBtn = getOtherExpAddBtn();
    if (!addBtn) throw new Error('Could not find the Add Other Experience button on this page');
    await humanClick(addBtn);
    await safeDelay(600, 1200);

    const titleInput = await waitForEl(SEL.otherExpTitleInput);
    await humanType(titleInput, entry.title);
    await safeDelay(300, 700);

    const fullDescription = buildOtherExpDescription(entry.description, loose1000);
    const descInput = await waitForEl(SEL.otherExpDescInput);
    await humanPaste(descInput, fullDescription);
    await safeDelay(400, 900);

    const saveBtn = await waitForEl(SEL.otherExpSaveBtn);
    await humanClick(saveBtn);
    await waitForSaveComplete();
}

// ──────────────────────────────────────────────────────────────
// Add single employment entry
// ──────────────────────────────────────────────────────────────
async function addOneEmploymentEntry(entry) {
    const addBtn = await waitForEl(SEL.employmentAddBtn);
    await humanClick(addBtn);
    await safeDelay(800, 1500);

    const companyInput = await waitForEl(SEL.employmentCompanyInput);
    await typeAndPickFirst(companyInput, entry.company);
    await safeDelay(300, 600);

    const { city, country } = splitLocation(entry.location);

    const cityInput = await waitForEl(SEL.employmentCityInput);
    await humanType(cityInput, city);
    await safeDelay(300, 600);

    const countryInput = await waitForEl(SEL.employmentCountryInput);
    await typeAndPickFirst(countryInput, country);
    await safeDelay(300, 600);

    // The job title combobox (type="search", role="combobox") does not
    // respond to synthetic React events. nativeInsert uses execCommand
    // which fires genuine browser-level input events that the field
    // cannot ignore.
    const titleInput = await waitForEl(SEL.employmentTitleInput);
    await nativeInsert(titleInput, entry.title);
    await safeDelay(300, 600);

    await pickDropdownOption(SEL.employmentMonthToggle, 'Jan');
    await safeDelay(300, 600);

    const currentYear = String(new Date().getFullYear());
    await pickDropdownOption(SEL.employmentYearToggle, currentYear);
    await safeDelay(300, 600);

    const descInput = await waitForEl(SEL.employmentDescInput);
    await humanPaste(descInput, entry.description);
    await safeDelay(400, 900);

    const saveBtn = await waitForEl(SEL.employmentSaveBtn);
    await humanClick(saveBtn);
    await waitForSaveComplete();
}

// ──────────────────────────────────────────────────────────────
// Run: Other Experiences
// ──────────────────────────────────────────────────────────────
async function runOtherExperiences(parsedData, notify, onDone, resumeFromIndex = 0, shouldDelete = false) {
    if (!parsedData.otherExp.length) {
        notify('No other experience entries found in parsed data.', 'error');
        return;
    }

    const loose1000 = parsedData.loose1000 || '';
    if (!loose1000.trim()) {
        notify('Warning: No Loose 1000 keywords found. Descriptions will be saved without keyword block.', 'warning');
    }

    startAutomation();

    try {
        if (resumeFromIndex === 0 && shouldDelete) {
            await deleteAllOtherExperiences(notify);
            await safeDelay(800, 1500);
        } else if (resumeFromIndex > 0) {
            notify(`Resuming from entry ${resumeFromIndex + 1}...`, 'warning');
        }

        const total = parsedData.otherExp.length;

        for (let i = resumeFromIndex; i < total; i++) {
            await saveJobState({ type: 'other_exp', index: i, entries: parsedData.otherExp, loose1000 });
            await safeDelay(500, 1200);
            await addOneOtherExperience(parsedData.otherExp[i], loose1000);
            notify(`Other Experience: ${i + 1} / ${total} added`, 'success');
        }

        await clearJobState();
        notify(`✅ Done. ${total} other experience entries added.`, 'success');

    } catch (e) {
        handleAutomationError(e, notify);
    } finally {
        AUTO.running = false;
        stopCaptchaWatch();
        if (onDone) onDone();
    }
}

// ──────────────────────────────────────────────────────────────
// Run: Employment History
// ──────────────────────────────────────────────────────────────
async function runEmploymentHistory(parsedData, notify, onDone, resumeFromIndex = 0, shouldDelete = false) {
    if (!parsedData.employment.length) {
        notify('No employment entries found in parsed data.', 'error');
        return;
    }

    startAutomation();

    try {
        if (resumeFromIndex === 0 && shouldDelete) {
            await deleteAllEmploymentEntries(notify);
            await safeDelay(800, 1500);
        } else if (resumeFromIndex > 0) {
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
        notify(`✅ Done. ${total} employment entries added.`, 'success');

    } catch (e) {
        handleAutomationError(e, notify);
    } finally {
        AUTO.running = false;
        stopCaptchaWatch();
        if (onDone) onDone();
    }
}

// ──────────────────────────────────────────────────────────────
// Saved job helpers
// ──────────────────────────────────────────────────────────────
async function checkForSavedJob() { return await loadJobState(); }
async function discardSavedJob()  { await clearJobState(); }

// ──────────────────────────────────────────────────────────────
// Error handler
// ──────────────────────────────────────────────────────────────
function handleAutomationError(e, notify) {
    if (e.message === 'CAPTCHA') {
        notify('⚠️ Upwork is asking you to verify you are human. Automation stopped and progress saved. Complete the challenge, then click the run button to resume.', 'error');
    } else if (e.message === 'ABORTED') {
        // user clicked stop — silent, already notified
    } else {
        notify(`Error: ${e.message}`, 'error');
    }
}
