// main.js — orchestrator: shadow DOM, UI wiring, prompt storage

const ROOT_ID    = 'upwork-wizard-root';
const PANEL_WIDTH = '380px';

const AI_PROMPT = `You are a keyword intelligence assistant helping a Flutter and Supabase freelancer optimize their Upwork profile. The overview is already written and will not change. Your job is to analyze top-ranking Upwork profiles and extract everything useful for two sections: Portfolio and Other Experiences.

Maintain four datasets across all profiles. Never reset unless I say RESET.

DATASET 1 — CORE 30
The 30 highest-value keywords across all profiles. Weighted by position: title = 3, overview = 2, skills = 2, portfolio = 1. Positions 1 and 2 are permanently locked:
Flutter
Supabase
Positions 3 to 30 are re-ranked after every new profile.

DATASET 2 — LOOSE 1000
Every keyword, tool, framework, platform, integration, and service phrase discovered. Deduplicated and continuously growing. Output format is all keywords merged together separated by commas only with no category divisions.

DATASET 3 — PORTFOLIO INTELLIGENCE
Track two things from portfolio sections:
Project title patterns: how top freelancers name their portfolio pieces
Description patterns: how they describe what was built, what tech was used, and what outcome was achieved
Store real examples and extract the sentence structures behind them.

DATASET 4 — OTHER EXPERIENCE INTELLIGENCE
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

WHEN I SAY GENERATE
Produce all output in the following structured format exactly. Use the block tags and field prefixes precisely as shown — no deviations, no extra commentary between blocks.

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
- All generated content must be written specifically for a Flutter and Supabase developer targeting founders and small business owners.

MY PROFILE CONTEXT
I am a Flutter and Supabase developer targeting founders and small business owners. My positioning: one developer owning the full build including Flutter frontend, Supabase backend, PostgreSQL database, authentication, real-time features, webhooks, and API integrations. I build Android apps, Flutter web apps, and offline apps. I do not build iOS. My description is locked and will not change. Everything generated must align with this positioning.`;

// ──────────────────────────────────────────────────────────────
// Shadow DOM setup
// ──────────────────────────────────────────────────────────────
function createShadowHost() {
    if (document.getElementById(ROOT_ID)) return null;

    const host = document.createElement('div');
    host.id = ROOT_ID;
    host.style.cssText = `
        position: fixed;
        top: 15px;
        left: 15px;
        z-index: 2147483647;
        width: ${PANEL_WIDTH};
    `;

    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    return shadow;
}

async function loadAsset(url) {
    try {
        return await fetch(url).then(r => r.text());
    } catch (_) { return ''; }
}

async function mountUI(shadow) {
    const [css, html] = await Promise.all([
        loadAsset(chrome.runtime.getURL('style.css')),
        loadAsset(chrome.runtime.getURL('ui.html'))
    ]);

    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    shadow.appendChild(wrapper);
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

    const theme = THEME[type] || THEME.warning;
    box.style.display        = 'block';
    box.style.background     = theme.bg;
    box.style.color          = theme.color;
    box.style.borderTopColor = theme.border;

    msg.innerHTML = Array.isArray(text) ? text.join('<br>') : text;
}

// ──────────────────────────────────────────────────────────────
// Wire up all UI controls
// ──────────────────────────────────────────────────────────────
function setupUI(shadow) {
    let parsedData = null;

    const n = (text, type) => notify(shadow, text, type);

    // Close status
    shadow.querySelector('#status-close').onclick = () => {
        shadow.querySelector('#status-box').style.display = 'none';
    };

    // Copy prompt
    shadow.querySelector('#act-copy-prompt').onclick = () => {
        navigator.clipboard.writeText(AI_PROMPT).then(() => {
            n('✅ Prompt copied to clipboard. Paste it into your AI to get started.', 'success');
        }).catch(() => {
            n('Copy failed — please allow clipboard access.', 'error');
        });
    };

    // Parse
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

        if (parsedData.errors.length) {
            n(parsedData.errors, 'warning');
        } else {
            n('Output parsed successfully. Choose an action below.', 'success');
        }

        const hasData = parsedData.employment.length || parsedData.otherExp.length;
        shadow.querySelector('#action-section').style.display = hasData ? 'block' : 'none';
    };

    // ── Run Other Experiences ──
    // Checks for a saved interrupted job first. Only fires when user clicks.
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
                    { otherExp: saved.entries, employment: [] },
                    (text, type) => n(text, type),
                    () => setRunningState(shadow, false),
                    saved.index
                );
                return;
            }

            await discardSavedJob();
        }

        if (!parsedData) { n('Parse the output first.', 'error'); return; }
        setRunningState(shadow, true);
        runOtherExperiences(parsedData, (text, type) => n(text, type), () => setRunningState(shadow, false));
    };

    // ── Run Employment History ──
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
                    (text, type) => n(text, type),
                    () => setRunningState(shadow, false),
                    saved.index
                );
                return;
            }

            await discardSavedJob();
        }

        if (!parsedData) { n('Parse the output first.', 'error'); return; }
        setRunningState(shadow, true);
        runEmploymentHistory(parsedData, (text, type) => n(text, type), () => setRunningState(shadow, false));
    };

    // Stop
    shadow.querySelector('#act-stop').onclick = () => {
        stopAutomation();
        n('Automation stopped. Progress saved — click the run button to resume.', 'warning');
        setRunningState(shadow, false);
    };
}
 
function setRunningState(shadow, running) {
    shadow.querySelector('#watch-note').style.display = running ? 'block' : 'none';
    shadow.querySelector('#act-stop').style.display   = running ? 'block' : 'none';
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
async function main() {
    const shadow = createShadowHost();
    if (!shadow) return;

    await mountUI(shadow);
    setupUI(shadow);
    // Nothing auto-runs here. All automation starts from user button clicks only.
}

main();
