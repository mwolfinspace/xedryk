/* Progressive enhancement for the Xedryk landing page.
   - small letter animations (skipped when reduced motion is preferred)
   - one shared 18+ gate for every link except the Coding zone
*/
(() => {
    'use strict';

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------------- Jump-word animation ---------------- */
    function setupJumpWord(container) {
        if (prefersReducedMotion) return;

        // Animate the coloured words, leaving the coloured separators intact.
        const words = [...container.querySelectorAll(':scope > span:not(.sep)')];
        if (!words.length) return;

        const letters = [];
        words.forEach((word) => {
            const color = word.style.color || 'inherit';
            const text = word.textContent || '';
            word.textContent = '';
            [...text].forEach((char) => {
                if (!char.trim()) {
                    word.appendChild(document.createTextNode(char));
                    return;
                }
                const letter = document.createElement('span');
                letter.className = 'jump-letter';
                letter.style.color = color;
                letter.textContent = char;
                word.appendChild(letter);
                letters.push(letter);
            });
        });

        if (!letters.length) return;
        let current = 0;

        const step = () => {
            if (document.hidden) {
                window.setTimeout(step, 500);
                return;
            }
            letters.forEach((letter) => letter.classList.remove('is-bouncing'));
            // Force a reflow so re-adding the class restarts the animation.
            void letters[current].offsetWidth;
            letters[current].classList.add('is-bouncing');
            current = (current + 1) % letters.length;
            window.setTimeout(step, 320);
        };

        window.setTimeout(step, 350);
    }

    /* ---------------- Colour-change animation ---------------- */
    function setupColorChange(element) {
        if (prefersReducedMotion) return;

        const text = element.textContent || '';
        element.textContent = '';
        const spans = [];

        [...text].forEach((char) => {
            if (!char.trim()) {
                element.appendChild(document.createTextNode(' '));
                return;
            }
            const span = document.createElement('span');
            span.className = 'color-letter';
            span.textContent = char;
            element.appendChild(span);
            spans.push(span);
        });

        if (!spans.length) return;

        let timer = null;
        const randomColor = () => {
            const hex = Math.floor(Math.random() * 0xffffff)
                .toString(16)
                .padStart(6, '0');
            return `#${hex}`;
        };
        const start = () => {
            if (timer) return;
            const paint = () => spans.forEach((span) => {
                span.style.color = randomColor();
            });
            paint();
            timer = window.setInterval(paint, 600);
        };
        const stop = () => {
            if (timer) window.clearInterval(timer);
            timer = null;
            spans.forEach((span) => {
                span.style.color = '';
            });
        };

        element.addEventListener('pointerenter', start);
        element.addEventListener('pointerleave', stop);
        element.addEventListener('focusin', start);
        element.addEventListener('focusout', stop);
    }

    document.querySelectorAll('.jump-word').forEach(setupJumpWord);
    document.querySelectorAll('.color-change').forEach(setupColorChange);

    /* ---------------- 18+ link gate ---------------- */
    const gate = document.getElementById('age-gate');
    if (!gate) return;

    const targetLabel = document.getElementById('age-gate-target');
    const continueButton = document.getElementById('age-gate-continue');
    const cancelButton = document.getElementById('age-gate-cancel');
    if (!targetLabel || !continueButton || !cancelButton) return;

    let pendingLink = null;
    let lastFocused = null;

    const labelFor = (link) => (
        link.querySelector('.button-text')?.textContent ||
        link.getAttribute('aria-label') ||
        link.getAttribute('title') ||
        link.textContent ||
        link.hostname ||
        'this link'
    ).trim();

    function openGate(link) {
        pendingLink = link;
        lastFocused = document.activeElement;
        targetLabel.textContent = labelFor(link);
        gate.hidden = false;
        document.body.classList.add('age-gate-open');
        continueButton.focus();
    }

    function closeGate() {
        gate.hidden = true;
        document.body.classList.remove('age-gate-open');
        pendingLink = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
        lastFocused = null;
    }

    function followPendingLink() {
        if (!pendingLink) return;
        const { href, target } = pendingLink;
        const sameTab = !target || target === '_self' || href.startsWith('mailto:');
        closeGate();
        if (sameTab) {
            window.location.href = href;
        } else {
            window.open(href, target, 'noopener,noreferrer');
        }
    }

    document.addEventListener('click', (event) => {
        if (typeof event.target.closest !== 'function') return;
        const link = event.target.closest('a[href]');
        if (!link) return;
        if (link.closest('.coding-zone') || link.hasAttribute('data-age-gate-allow')) return;
        if (!link.href || link.href.startsWith('#')) return;

        event.preventDefault();
        openGate(link);
    });

    continueButton.addEventListener('click', followPendingLink);
    gate.addEventListener('click', (event) => {
        if (event.target.hasAttribute('data-age-gate-close')) closeGate();
    });

    document.addEventListener('keydown', (event) => {
        if (gate.hidden) return;
        if (event.key === 'Escape') {
            closeGate();
        } else if (event.key === 'Tab') {
            if (event.shiftKey && document.activeElement === continueButton) {
                event.preventDefault();
                cancelButton.focus();
            } else if (!event.shiftKey && document.activeElement === cancelButton) {
                event.preventDefault();
                continueButton.focus();
            }
        }
    });
})();
