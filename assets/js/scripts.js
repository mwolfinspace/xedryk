document.addEventListener('DOMContentLoaded', function () {
    // --- Jump Word Animation ---
    const jumpWordContainers = document.querySelectorAll('.jump-word');

    jumpWordContainers.forEach(container => {
        const h2 = container.querySelector('h2');
        if (!h2) return; // Skip if no h2 found

        const originalSpans = Array.from(h2.querySelectorAll('span')); // Get original spans
        let newHtml = '';

        originalSpans.forEach((span) => {
            const color = span.style.color || 'inherit'; // Use existing color or inherit
            const text = span.textContent || '';
            // Split text into letters/characters
            text.split('').forEach(letter => {
                 // Only wrap non-space characters in spans for animation
                 if (letter.trim()) {
                    newHtml += `<span style="color: ${color}; display: inline-block; animation-duration: 0.3s; animation-timing-function: ease-in-out; animation-iteration-count: infinite; animation-play-state: paused;">${letter}</span>`;
                 } else {
                    newHtml += letter; // Keep spaces as actual spaces
                 }
            });
            // Add a non-breaking space AFTER processing each original span's content
            newHtml += '&nbsp;';
        });

        // Replace h2 content, trim trailing space
        h2.innerHTML = newHtml.trim();

        const letterSpans = h2.querySelectorAll('span'); // Select only spans generated for letters
        if (letterSpans.length === 0) return; // Skip animation if no letter spans

        let currentIndex = 0;
        let animationTimeout; // Store timeout ID

        function animateLetters() {
             // Clear previous timeout if exists
            if (animationTimeout) clearTimeout(animationTimeout);

            if (currentIndex < letterSpans.length) {
                const span = letterSpans[currentIndex];
                span.style.animationName = 'bounce';
                span.style.animationPlayState = 'running';

                // Use setTimeout to reset state after animation completes
                animationTimeout = setTimeout(() => {
                    // Check if the span still exists before trying to modify it
                    if (letterSpans[currentIndex]) {
                        letterSpans[currentIndex].style.animationPlayState = 'paused';
                        letterSpans[currentIndex].style.animationName = 'none'; // Remove animation name
                    }
                    currentIndex++;
                     // Schedule next animation frame
                    requestAnimationFrame(animateLetters);
                 }, 300); // Match animation duration (0.3s)

            } else {
                currentIndex = 0; // Reset and repeat
                // Schedule next animation frame
                requestAnimationFrame(animateLetters);
            }
        }

        // Ensure bounce keyframes are defined (moved outside loop if multiple elements)
        // Define bounce keyframes dynamically if not in CSS
        // Check if keyframes exist (simple check)
        let bounceExists = false;
        try {
            for (const sheet of document.styleSheets) {
                if (bounceExists) break;
                // Check rules safely
                const rules = sheet.cssRules || sheet.rules;
                if (!rules) continue;
                for (const rule of rules) {
                    if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === 'bounce') {
                        bounceExists = true;
                        break;
                    }
                }
            }
        } catch (e) {
             console.warn("Could not access CSS rules, likely due to CORS. Assuming keyframes exist or will be added.", e);
             // Assume it exists or rely on CSS file - Alternatively, unconditionally add it if errors are acceptable.
             // bounceExists = true; // Uncomment to suppress dynamic add on error.
        }


        if (!bounceExists) {
             console.log("Adding bounce keyframes dynamically.");
             const styleSheet = document.styleSheets[0] || document.head.appendChild(document.createElement('style')).sheet;
             try {
                styleSheet.insertRule(`
                    @keyframes bounce {
                        0%, 100% { transform: translateY(0); }
                        50% { transform: translateY(-10px); }
                    }
                `, styleSheet.cssRules ? styleSheet.cssRules.length : 0);
             } catch (e) {
                 console.error("Could not insert keyframes rule:", e);
             }
        }

        requestAnimationFrame(animateLetters); // Start the animation using requestAnimationFrame
    });

    // --- Color Change Animation ---
    const colorChangeElements = document.querySelectorAll('.color-change');

    colorChangeElements.forEach(element => {
        const h2 = element.querySelector('h2');
        if (!h2) return;

        const originalText = h2.textContent || '';
        // Wrap only non-whitespace characters in spans
        h2.innerHTML = originalText.split('').map(char => {
            return char.trim() ? `<span>${char}</span>` : char;
        }).join('');


        const letterSpans = h2.querySelectorAll('span'); // Only target spans
        if (letterSpans.length === 0) return;

        let intervalId = null;

        const changeColors = () => {
            letterSpans.forEach(span => {
                // Ensure transition is applied if not in CSS
                // span.style.transition = 'color 0.3s ease';
                span.style.color = getRandomColor();
            });
        };

        const resetColors = () => {
             if (intervalId) {
                 clearInterval(intervalId);
                 intervalId = null;
             }
             // Reset to default text color (or could store originals if needed)
             letterSpans.forEach(span => {
                span.style.color = ''; // Reset to CSS default
             });
        };

        element.addEventListener('mouseover', () => {
            if (!intervalId) { // Prevent multiple intervals
                changeColors(); // Initial change
                intervalId = setInterval(changeColors, 1000);
            }
        });

        element.addEventListener('mouseout', resetColors);
    });

    // --- Utility Function ---
    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    // --- 18+ content warning gate ---
    // Every link except those inside the Coding zone asks for confirmation first.
    const ageGate = document.getElementById('age-gate');
    if (ageGate) {
        const targetLabel = document.getElementById('age-gate-target');
        const continueBtn = document.getElementById('age-gate-continue');
        const cancelBtn = document.getElementById('age-gate-cancel');
        let pendingLink = null;
        let lastFocused = null;

        function openAgeGate(link) {
            pendingLink = link;
            lastFocused = document.activeElement;

            const label = (link.querySelector('.button-text')?.textContent
                || link.getAttribute('title')
                || link.getAttribute('aria-label')
                || link.textContent
                || link.hostname).trim();
            targetLabel.textContent = label || link.hostname;

            ageGate.hidden = false;
            document.body.classList.add('age-gate-open');
            continueBtn.focus();
        }

        function closeAgeGate() {
            ageGate.hidden = true;
            document.body.classList.remove('age-gate-open');
            pendingLink = null;
            if (lastFocused && typeof lastFocused.focus === 'function') {
                lastFocused.focus();
            }
        }

        function followPendingLink() {
            if (!pendingLink) return;
            const href = pendingLink.href;
            const target = pendingLink.target;
            const navigateHere = !target || target === '_self' || href.startsWith('mailto:');
            closeAgeGate();
            if (navigateHere) {
                window.location.href = href;
            } else {
                window.open(href, target, 'noopener,noreferrer');
            }
        }

        document.addEventListener('click', function (event) {
            if (typeof event.target.closest !== 'function') return;
            const link = event.target.closest('a[href]');
            if (!link) return;
            if (link.closest('.coding-zone') || link.hasAttribute('data-age-gate-allow')) return;
            if (!link.href || link.href.startsWith('#')) return;

            event.preventDefault();
            openAgeGate(link);
        });

        continueBtn.addEventListener('click', followPendingLink);

        ageGate.addEventListener('click', function (event) {
            if (event.target.hasAttribute('data-age-gate-close')) {
                closeAgeGate();
            }
        });

        document.addEventListener('keydown', function (event) {
            if (ageGate.hidden) return;
            if (event.key === 'Escape') {
                closeAgeGate();
            } else if (event.key === 'Tab') {
                const first = continueBtn;
                const last = cancelBtn;
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });
    }
});