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

// Type into a typeahead-fake input and pick the first dropdown option if one appears.
// Falls back gracefully if no dropdown appears — just leaves the typed value.
async function typeAndPickFirst(input, text) {
    await humanType(input, text);
    await randomDelay(400, 800);

    // Look for a visible dropdown menu item near this input
    const menu = document.querySelector('.air3-menu-list [role="option"], .air3-menu-list li');
    if (menu) {
        await humanClick(menu);
        await randomDelay(200, 400);
    }
    // If no dropdown appears, the typed value stays — acceptable for title/company
}

// Click a custom air3-dropdown toggle and pick the option whose text matches value
async function pickDropdownOption(toggleSelector, value) {
    const toggle = document.querySelector(toggleSelector);
    if (!toggle) return; // skip silently if not found

    await humanClick(toggle);
    await randomDelay(400, 800);

    // Options appear in a ul after clicking — find by text content
    const options = Array.from(document.querySelectorAll('[role="option"], .air3-menu-list li'));
    const target  = options.find(o => o.textContent.trim().toLowerCase().includes(value.toLowerCase()));

    if (target) {
        await humanClick(target);
        await randomDelay(200, 400);
    } else {
        // Close the dropdown without selecting — value stays as default
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

    otherExpItems:         null,  // TODO: wrapper element per entry (for count check)
    otherExpDeleteBtn:     null,  // TODO: delete button per entry
    otherExpConfirmDelete: null,  // TODO: confirm button on delete modal

    // ── Employment History ─────────────────────────────────────
    employmentAddBtn:         'button[aria-label="Add employment history"]',
    employmentCompanyInput:   'input.air3-typeahead-input-main',       // typeahead, type + pick
    employmentCityInput:      'input#city',                             // plain input
    employmentCountryInput:   'input[aria-labelledby="countryLabel"]',  // fake typeahead, type + pick
    employmentTitleInput:     'input[aria-labelledby="jobTitleLabel"]', // fake typeahead, type + pick
    employmentMonthToggle:    '#startMonth [data-test="dropdown-toggle"]',
    employmentYearToggle:     '#startYear  [data-test="dropdown-toggle"]',
    employmentDescInput:      'textarea#description',
    employmentSaveBtn:        '.air3-modal-footer button.air3-btn-primary',

    employmentItems:          null,  // TODO: wrapper element per entry (for count check)
    employmentDeleteBtn:      'button[aria-label*="Delete"][aria-label*="Employment history item"]',
    employmentConfirmDelete:  null,  // TODO: confirm button on delete modal
    employmentEditBtn:        'button[aria-label*="Edit"][aria-label*="Employment history item"]', // future use

    // ── Saved for future use ──────────────────────────────────
    // certificateDeleteBtn: 'button[aria-label*="Delete certificate"]',
    // showMoreBtn:          'button[data-testid="show-more"]',
};

// ──────────────────────────────────────────────────────────────
// Build the full Other Experience description
// ──────────────────────────────────────────────────────────────
function buildOtherExpDescription(description, loose1000) {
    if (!loose1000 || !loose1000.trim()) return description;
    return `${description}\n\n\n${loose1000.trim()}`;
}

// ──────────────────────────────────────────────────────────────
// Split "City, Country" string
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
        const confirmBtn = SEL.otherExpConfirmDelete ? document.querySelector(SEL.otherExpConfirmDelete) : null;
        if (confirmBtn) { await humanClick(confirmBtn); await safeDelay(600, 1200); }
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
        const confirmBtn = SEL.employmentConfirmDelete ? document.querySelector(SEL.employmentConfirmDelete) : null;
        if (confirmBtn) { await humanClick(confirmBtn); await safeDelay(600, 1200); }
    }
    notify('Existing entries cleared.', 'warning');
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
    await humanType(descInput, fullDescription);
    await safeDelay(400, 900);

    const saveBtn = await waitForEl(SEL.otherExpSaveBtn);
    await humanClick(saveBtn);
    await safeDelay(700, 1400);
}

// ──────────────────────────────────────────────────────────────
// Add single employment entry
// ──────────────────────────────────────────────────────────────
async function addOneEmploymentEntry(entry) {
    // Open the modal
    const addBtn = await waitForEl(SEL.employmentAddBtn);
    await humanClick(addBtn);
    await safeDelay(800, 1500);

    // Company — typeahead: type and pick first suggestion if any
    const companyInput = await waitForEl(SEL.employmentCompanyInput);
    await typeAndPickFirst(companyInput, entry.company);
    await safeDelay(300, 600);

    // City — plain input
    const cityInput = await waitForEl(SEL.employmentCityInput);
    await humanType(cityInput, entry.city || splitLocation(entry.location).city);
    await safeDelay(300, 600);

    // Country — fake typeahead: type and pick first suggestion
    const countryInput = await waitForEl(SEL.employmentCountryInput);
    const { country } = splitLocation(entry.location);
    await typeAndPickFirst(countryInput, country);
    await safeDelay(300, 600);

    // Job Title — fake typeahead: type and pick first suggestion
    const titleInput = await waitForEl(SEL.employmentTitleInput);
    await typeAndPickFirst(titleInput, entry.title);
    await safeDelay(300, 600);

    // Month — custom dropdown: click toggle, pick option
    await pickDropdownOption(SEL.employmentMonthToggle, 'Jan');
    await safeDelay(300, 600);

    // Year — custom dropdown: click toggle, pick current year
    const currentYear = String(new Date().getFullYear());
    await pickDropdownOption(SEL.employmentYearToggle, currentYear);
    await safeDelay(300, 600);

    // Description
    const descInput = await waitForEl(SEL.employmentDescInput);
    await humanType(descInput, entry.description);
    await safeDelay(400, 900);

    // Save
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

    const loose1000 = parsedData.loose1000 || '';
    if (!loose1000.trim()) {
        notify('Warning: No Loose 1000 keywords found — descriptions will be saved without keyword block.', 'warning');
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
            await saveJobState({ type: 'other_exp', index: i, entries: parsedData.otherExp, loose1000 });
            await safeDelay(500, 1200);
            await addOneOtherExperience(parsedData.otherExp[i], loose1000);
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
