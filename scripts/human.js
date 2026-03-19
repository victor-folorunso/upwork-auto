// human.js — human-like timing and interaction utilities

function randomDelay(min, max) {
    return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

// Find the nearest scrollable ancestor of an element.
// Used to scroll the modal container instead of the window when inside a modal.
function getScrollParent(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        const overflow = style.overflow + style.overflowY;
        if (/auto|scroll/.test(overflow) && node.scrollHeight > node.clientHeight) {
            return node;
        }
        node = node.parentElement;
    }
    return null; // fall back to window scroll
}

// Scroll toward an element incrementally using ease-in-out.
// Scrolls the nearest scrollable container — not the window — if inside a modal.
async function humanScroll(el) {
    const scrollParent = getScrollParent(el);

    if (scrollParent) {
        // Scroll within the modal/container
        const parentRect = scrollParent.getBoundingClientRect();
        const elRect     = el.getBoundingClientRect();
        const offset     = elRect.top - parentRect.top - (scrollParent.clientHeight / 2);
        const startY     = scrollParent.scrollTop;
        const targetY    = startY + offset;
        const distance   = targetY - startY;
        const steps      = 6 + Math.floor(Math.random() * 4);

        for (let i = 1; i <= steps; i++) {
            const p = i / steps;
            const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            scrollParent.scrollTop = startY + distance * eased;
            await randomDelay(30, 70);
        }
    } else {
        // No modal — scroll the page normally
        const targetY  = el.getBoundingClientRect().top + window.scrollY - (window.innerHeight / 2);
        const startY   = window.scrollY;
        const distance = targetY - startY;
        const steps    = 8 + Math.floor(Math.random() * 6);

        for (let i = 1; i <= steps; i++) {
            const p = i / steps;
            const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            window.scrollTo({ top: startY + distance * eased, behavior: 'instant' });
            await randomDelay(40, 90);
        }
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

    // Clear first
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

    // Brief pause after finishing — like lifting fingers off keyboard
    await randomDelay(200, 500);
}

// Click an element after scrolling to it naturally
async function humanClick(el) {
    await humanScroll(el);
    await randomDelay(120, 350);
    el.click();
    await randomDelay(180, 500);
}
