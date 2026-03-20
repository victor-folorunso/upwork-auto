// popup.js — runs in the extension toolbar popup
// Sends a message to the active Upwork tab to show the auth/wizard panel

document.getElementById('open-btn').onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes('upwork.com')) {
        // Not on Upwork — open it
        chrome.tabs.create({ url: 'https://www.upwork.com' });
        window.close();
        return;
    }

    // Tell the content script to show the wizard panel
    chrome.tabs.sendMessage(tab.id, { type: 'WIZARD_SHOW' }, () => {
        // Ignore errors if content script isn't ready yet
        if (chrome.runtime.lastError) {}
    });

    window.close();
};

// Update button label based on whether we're on Upwork
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.url?.includes('upwork.com')) {
        document.getElementById('open-btn').textContent = 'Show Wizard';
        document.getElementById('note').textContent = 'Click to show the Wizard panel on this page.';
    }
});
