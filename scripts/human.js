// human.js — human-like timing and interaction utilities

function randomDelay(min, max) {
    return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

// Check if an element is already fully visible in the viewport
function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
        rect.top    >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.left   >= 0 &&
        rect.right  <= (window.innerWidth  || document.documentElement.clientWidth)
    );
}

// Scroll toward an element only if it isn't already visible.
// Scrolls the page — not the modal (modal fields are always in viewport).
async function humanScroll(el) {
    if (isInViewport(el)) return; // already visible — skip scroll entirely

    const targetY  = el.getBoundingClientRect().top + window.scrollY - (window.innerHeight / 2);
    const startY   = window.scrollY;
    const distance = targetY - startY;
    const steps    = 8 + Math.floor(Math.random() * 6);

    for (let i = 1; i <= steps; i++) {
        const p     = i / steps;
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        window.scrollTo({ top: startY + distance * eased, behavior: 'instant' });
        await randomDelay(40, 90);
    }

    await randomDelay(80, 200);
}

// Dispatch a React/framework-compatible input event on a field
function triggerInputEvent(el, value) {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

    if (descriptor && descriptor.set) {
        descriptor.set.call(el, value);
    } else {
        el.value = value;
    }

    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Type into a field character by character.
// Fast enough to feel like a quick human typist, with occasional natural pauses.
async function humanType(el, text) {
    await humanScroll(el);
    el.focus();
    await randomDelay(60, 150);

    triggerInputEvent(el, '');

    let current = '';

    for (const char of text) {
        current += char;
        triggerInputEvent(el, current);

        const r = Math.random();
        if (r < 0.03) {
            await randomDelay(250, 500); // rare thinking pause
        } else if (r < 0.10) {
            await randomDelay(60, 130);  // occasional brief pause
        } else {
            await randomDelay(8, 25);    // fast typist baseline
        }
    }

    await randomDelay(200, 500);
}

// Click an element, scrolling to it first only if needed
async function humanClick(el) {
    await humanScroll(el);
    await randomDelay(120, 350);
    el.click();
    await randomDelay(180, 500);
}
