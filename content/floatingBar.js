(function () {
    let host, shadow, bar;
    let isDragging = false;
    let startX, startY, initialX, initialY;

    console.log('[focboost] floatingBar.js loaded');

    // ── Initialization ─────────────────────────────────────────────────────────
    function init() {
        chrome.storage.local.get(['focboostState', 'floatingBarEnabled', 'floatingBarPosition'], (data) => {
            const state = data.focboostState;
            const enabled = data.floatingBarEnabled !== false;

            if (state && state.isActive && !state.sprintDone && enabled) {
                console.log('[focboost] Session active, checking for bar injection');
                chrome.storage.session.get('barDismissed', (sessionData) => {
                    if (!sessionData.barDismissed) {
                        injectBar(state, data.floatingBarPosition);
                    } else {
                        console.log('[focboost] Bar dismissed for this session');
                    }
                });
            } else {
                console.log('[focboost] Session inactive or bar disabled', { state: !!state, enabled });
            }
        });
    }

    // ── Injection ─────────────────────────────────────────────────────────────
    function injectBar(state, savedPosition) {
        if (document.getElementById('boop-floating-host')) return;
        if (!document.body) {
            console.warn('[focboost] document.body not found, retrying in 100ms');
            setTimeout(() => injectBar(state, savedPosition), 100);
            return;
        }

        console.log('[focboost] Injecting floating bar');
        host = document.createElement('div');
        host.id = 'boop-floating-host';
        document.body.appendChild(host);

        shadow = host.attachShadow({ mode: 'closed' });

        // Styles
        const style = document.createElement('style');
        style.textContent = `
      :host {
        position: fixed;
        z-index: 2147483647;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        transition: opacity 0.2s ease, transform 0.2s ease;
        font-family: 'DM Sans', sans-serif;
        user-select: none;
      }
      .bar-container {
        display: flex;
        align-items: center;
        background: #FFFFFF;
        border: 1px solid #E5E7EB;
        border-radius: 999px;
        padding: 8px 16px;
        height: 44px;
        box-sizing: border-box;
        gap: 12px;
        min-width: 280px;
        max-width: 360px;
        cursor: grab;
      }
      .bar-container:active { cursor: grabbing; }
      
      .logo-mark {
        width: 12px;
        height: 12px;
        background: #7C6FF7;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .task-name {
        font-size: 14px;
        font-weight: 500;
        color: #111827;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 140px;
      }
      .timer-display {
        font-family: 'DM Mono', monospace;
        font-size: 14px;
        color: #6B7280;
        min-width: 45px;
      }
      .controls {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
      }
      .btn {
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6B7280;
        transition: color 0.1s;
      }
      .btn:hover { color: #111827; }
      .btn.active { color: #7C6FF7; }
      
      .separator {
        width: 1px;
        height: 20px;
        background: #E5E7EB;
        margin: 0 4px;
      }
      
      @keyframes slideUp {
        from { transform: translate(-50%, 20px); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
      }
      .animate-in { animation: slideUp 0.2s ease forwards; }
    `;
        shadow.appendChild(style);

        bar = document.createElement('div');
        bar.className = 'bar-container animate-in';
        updateBarContent(state);
        shadow.appendChild(bar);

        if (savedPosition) {
            host.style.left = savedPosition.left;
            host.style.top = savedPosition.top; // Use top/left direct if top exists
            if (savedPosition.bottom && !savedPosition.top) {
                host.style.bottom = savedPosition.bottom;
            }
            host.style.transform = 'none';
        }

        setupDrag();
        setupListeners();
    }

    function updateBarContent(state) {
        if (!bar) return;
        const remaining = Math.max(0, state.endTime - Date.now());
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

        bar.innerHTML = `
      <div class="logo-mark"></div>
      <div class="task-name" title="${state.task}">${state.task}</div>
      <div class="timer-display">${state.isPaused ? 'PAUSED' : timeStr}</div>
      <div class="controls">
        <button class="btn pause-btn ${state.isPaused ? 'active' : ''}">
          ${state.isPaused ?
                `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>` :
                `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`}
        </button>
        <button class="btn distraction-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"/><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M10 16c.5 1 1.5 1.5 2 1.5s1.5-.5 2-1.5"/></svg>
        </button>
        <div class="separator"></div>
        <button class="btn dismiss-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    `;

        bar.querySelector('.pause-btn').onclick = (e) => {
            e.stopPropagation();
            chrome.runtime.sendMessage({ type: state.isPaused ? 'resumeFocus' : 'pauseFocus' });
        };

        bar.querySelector('.distraction-btn').onclick = (e) => {
            e.stopPropagation();
            chrome.runtime.sendMessage({ type: 'logDistraction' });
        };

        bar.querySelector('.dismiss-btn').onclick = (e) => {
            e.stopPropagation();
            dismissBar();
        };
    }

    function dismissBar() {
        if (!bar) return;
        bar.style.opacity = '0';
        bar.style.transform = 'translateY(10px)';
        setTimeout(() => {
            if (host) {
                host.remove();
                host = null;
                bar = null;
            }
            chrome.storage.session.set({ barDismissed: true });
        }, 150);
    }

    // ── Draggable Implementation ───────────────────────────────────────────────
    function setupDrag() {
        if (!bar) return;
        bar.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = host.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            bar.style.cursor = 'grabbing';
            host.style.transition = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            const newLeft = initialX + dx;
            const newTop = initialY + dy;

            host.style.left = `${newLeft}px`;
            host.style.top = `${newTop}px`;
            host.style.bottom = 'auto';
            host.style.transform = 'none';
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            bar.style.cursor = 'grab';
            host.style.transition = 'opacity 0.2s ease, transform 0.2s ease';

            const rect = host.getBoundingClientRect();
            const pos = {
                left: host.style.left,
                top: host.style.top,
                bottom: `${window.innerHeight - rect.bottom}px`
            };
            chrome.storage.local.set({ floatingBarPosition: pos });
        });
    }

    // ── Listeners ─────────────────────────────────────────────────────────────
    function setupListeners() {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                if (changes.focboostState) {
                    const newState = changes.focboostState.newValue;
                    if (newState && newState.isActive && !newState.sprintDone) {
                        chrome.storage.local.get(['floatingBarEnabled'], (data) => {
                            if (data.floatingBarEnabled !== false) {
                                if (!host) {
                                    chrome.storage.session.get('barDismissed', (sessionData) => {
                                        if (!sessionData.barDismissed) {
                                            injectBar(newState);
                                        }
                                    });
                                } else {
                                    updateBarContent(newState);
                                }
                            }
                        });
                    } else {
                        if (host) {
                            host.remove();
                            host = null;
                            bar = null;
                        }
                    }
                }
                if (changes.floatingBarEnabled && changes.floatingBarEnabled.newValue === false) {
                    if (host) {
                        host.remove();
                        host = null;
                        bar = null;
                    }
                }
            }
            if (area === 'session' && changes.barDismissed) {
                if (changes.barDismissed.newValue === true && host) {
                    host.remove();
                    host = null;
                    bar = null;
                }
            }
        });

        setInterval(() => {
            if (!bar) return;
            chrome.storage.local.get(['focboostState'], (data) => {
                const state = data.focboostState;
                if (state && state.isActive && !state.isPaused && !state.sprintDone) {
                    updateBarContent(state);
                } else if (state && (state.sprintDone || !state.isActive)) {
                    if (host) {
                        host.remove();
                        host = null;
                        bar = null;
                    }
                }
            });
        }, 1000);
    }

    init();
})();
