    shadow.querySelector('#dash-prompt-save').onclick = async () => {
        const btn = shadow.querySelector('#dash-prompt-save');
        btn.disabled = true; btn.textContent = 'Saving...';
        // Save null if unchanged from default — so future default updates
        // automatically reach users who haven't customized their prompt
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
        // Save null directly — no need to click Save after reset
        const result = await saveCustomPrompt(profile.id, null);
        btn.disabled = false; btn.textContent = 'Reset to default';
        const el = shadow.querySelector('#prompt-save-msg');
        el.style.display = 'block';
        el.className = `pw-msg ${result.ok ? 'success' : 'error'}`;
        el.textContent = result.ok ? '✅ Reset to default and saved.' : result.error;
    };