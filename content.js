(function () {
    console.log('[focboost] content.js active');

    let overlayInjected = false;

    function getDomain(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch {
            return null;
        }
    }

    function checkBlock() {
        chrome.runtime.sendMessage({ type: 'getState' }, (state) => {
            if (!state || !state.isActive || state.isPaused || state.sprintDone) {
                removeOverlay();
                return;
            }

            const currentDomain = getDomain(window.location.href);
            const isBlocked = state.blockedSites.some(site =>
                currentDomain === site || currentDomain.endsWith('.' + site)
            );

            if (isBlocked && !overlayInjected) {
                injectOverlay(state);
            } else if (!isBlocked && overlayInjected) {
                removeOverlay();
            }
        });
    }

    function injectOverlay(state) {
        if (document.getElementById('focboost-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'focboost-overlay';
        overlay.innerHTML = `
      <div class="focboost-card">
        <h1 class="focboost-title">Take a breath.</h1>
        <p class="focboost-text">You committed to <strong>${state.task}</strong>.</p>
        <p class="focboost-muted">Your focus score will decrease if you proceed.</p>
        <div class="focboost-actions">
          <button id="focboost-back" class="focboost-btn focboost-btn-primary">Return to work</button>
          <button id="focboost-proceed" class="focboost-btn focboost-btn-secondary">Log distraction & proceed</button>
        </div>
      </div>
    `;

        document.documentElement.appendChild(overlay);
        overlayInjected = true;

        document.getElementById('focboost-back').onclick = () => {
            window.history.back();
            if (document.referrer === "") {
                window.close();
            }
        };

        document.getElementById('focboost-proceed').onclick = () => {
            chrome.runtime.sendMessage({ type: 'logDistraction' }, () => {
                removeOverlay();
            });
        };
    }

    function removeOverlay() {
        const overlay = document.getElementById('focboost-overlay');
        if (overlay) overlay.remove();
        overlayInjected = false;
    }

    // Initial check
    checkBlock();

    // Listen for navigation changes (SPAs)
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            checkBlock();
        }
    }).observe(document, { subtree: true, childList: true });

    // Periodic check for state changes (e.g. session end)
    setInterval(checkBlock, 2000);

})();
