// human.js — human-like timing and interaction utilities

function randomDelay(min, max) {
    return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

// Smooth scroll to an element with a small natural overshoot
async function humanScroll(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(250, 600);
    window.scrollBy({ top: (Math.random() - 0.5) * 30, behavior: 'smooth' });
    await randomDelay(150, 350);
}

// Type into a field character by character with natural variance
async function humanType(el, text) {
    el.focus();
    await randomDelay(80, 200);

    // Clear existing value properly so React/Vue state picks it up
    const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

    if (nativeInputSetter) {
        nativeInputSetter.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        el.value = '';
    }

    for (const char of text) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
            el instanceof HTMLTextAreaElement
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype,
            'value'
        )?.set;

        if (nativeSetter) {
            nativeSetter.call(el, el.value + char);
        } else {
            el.value += char;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));

        // Natural typing speed: fast streaks with occasional pauses
        const pauseChance = Math.random();
        if (pauseChance < 0.04) {
            await randomDelay(300, 700); // rare long pause (thinking)
        } else if (pauseChance < 0.12) {
            await randomDelay(100, 200); // short pause
        } else {
            await randomDelay(28, 95);   // normal keystroke
        }
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    await randomDelay(100, 300);
}

// Click an element after scrolling to it and pausing naturally
async function humanClick(el) {
    await humanScroll(el);
    await randomDelay(180, 500);
    el.click();
    await randomDelay(250, 700);
}
