(function () {
    let host, shadow, bar;
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    console.log('[focboost] floatingBar.js loaded');

    // ── Helpers ─────────────────────────────────────────────────────────────
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Injection ─────────────────────────────────────────────────────────────
    function injectBar(task, timeLeft, isPaused, savedX, savedY) {
        if (document.getElementById('focboost-host')) {
            console.log('[focboost] Bar already exists, skipping injection');
            return;
        }
        if (!document.body) {
            console.warn('[focboost] document.body not found, retrying...');
            setTimeout(() => {
                chrome.storage.local.get(['sessionTask', 'sessionTimeLeft', 'sessionPaused', 'barPositionX', 'barPositionY'], (data) => {
                    injectBar(data.sessionTask, data.sessionTimeLeft, data.sessionPaused, data.barPositionX, data.barPositionY);
                });
            }, 100);
            return;
        }

        console.log('[focboost] Injecting floating bar:', { task, timeLeft, isPaused, savedX, savedY });
        host = document.createElement('div');
        host.id = 'focboost-host';
        Object.assign(host.style, {
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '2147483647',
            all: 'initial',
            pointerEvents: 'auto',
            margin: '0',
            padding: '0'
        });

        if (savedX && savedY) {
            host.style.left = savedX;
            host.style.top = savedY;
            host.style.bottom = 'auto';
            host.style.transform = 'none';
        }

        document.body.appendChild(host);
        shadow = host.attachShadow({ mode: 'closed' });

        const safeTask = escapeHtml(task || 'Focus session');

        shadow.innerHTML = `
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        .bar {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #ffffff;
          border: 1px solid #e0ddf6;
          border-radius: 999px;
          padding: 0 18px;
          height: 44px;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          color: #333333;
          white-space: nowrap;
          cursor: default;
          user-select: none;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
          transition: opacity 0.2s ease, transform 0.2s ease;
        }
        .logo {
          color: #7C6FF7;
          font-weight: 800;
          font-size: 16px;
          line-height: 1;
        }
        .divider {
          width: 1px;
          height: 20px;
          background: #e0ddf6;
          flex-shrink: 0;
        }
        .task {
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #444444;
          font-size: 13px;
        }
        .timer {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          font-weight: 600;
          color: #7C6FF7;
          min-width: 42px;
        }
        .timer.paused {
          color: #aaaaaa;
        }
        .btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px 6px;
          font-size: 15px;
          line-height: 1;
          border-radius: 6px;
          transition: background 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .btn:hover {
          background: #f0eeff;
        }
        .btn.close:hover {
          background: #ffeaea;
        }
        .drag-handle {
          cursor: grab;
          padding: 0 6px 0 0;
          color: #cccccc;
          font-size: 12px;
          letter-spacing: -2px;
        }
        .drag-handle:active {
          cursor: grabbing;
        }
      </style>
      <div class="bar" id="bar">
        <span class="drag-handle">⠿</span>
        <span class="logo">●</span>
        <div class="divider"></div>
        <span class="task" id="task-label" title="${safeTask}">${safeTask}</span>
        <span class="timer ${isPaused ? 'paused' : ''}" id="countdown">--:--</span>
        <button class="btn" id="pause-btn" title="Pause session">${isPaused ? '▶' : '⏸'}</button>
        <button class="btn" id="distract-btn" title="Log distraction">😬</button>
        <div class="divider"></div>
        <button class="btn close" id="close-btn" title="Hide bar">✕</button>
      </div>
    `;

        updateTimerDisplay(timeLeft);

        // Buttons
        shadow.getElementById('pause-btn').addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'togglePause' }, (response) => {
                const paused = response?.paused;
                const btn = shadow.getElementById('pause-btn');
                if (btn) btn.textContent = paused ? '▶' : '⏸';
                const count = shadow.getElementById('countdown');
                if (count) count.classList.toggle('paused', paused);
            });
        });

        shadow.getElementById('distract-btn').addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'logDistraction' });
            const btn = shadow.getElementById('distract-btn');
            btn.style.transform = 'scale(1.3)';
            setTimeout(() => btn.style.transform = 'scale(1)', 200);
        });

        shadow.getElementById('close-btn').addEventListener('click', () => {
            chrome.storage.session.set({ barDismissed: true });
            host.remove();
            host = null;
        });

        // Draggable
        const barEl = shadow.getElementById('bar');
        barEl.addEventListener('mousedown', (e) => {
            if (e.target.closest('.btn')) return;
            isDragging = true;
            const rect = host.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            host.style.transition = 'none';
            // Disable text selection during drag
            document.body.style.userSelect = 'none';
        });
    }

    // Global Listeners for dragging (added once)
    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !host) return;
        const x = e.clientX - dragOffsetX;
        const y = e.clientY - dragOffsetY;

        host.style.left = `${x}px`;
        host.style.top = `${y}px`;
        host.style.bottom = 'auto';
        host.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = '';
        if (host) {
            chrome.storage.local.set({
                barPositionX: host.style.left,
                barPositionY: host.style.top
            });
        }
    });

    function updateTimerDisplay(t) {
        if (t === undefined || t === null || isNaN(t)) {
            return;
        }
        const mm = String(Math.floor(t / 60)).padStart(2, '0');
        const ss = String(t % 60).padStart(2, '0');
        const el = shadow?.getElementById('countdown');
        if (el) el.textContent = `${mm}:${ss}`;
    }

    // ── Initialization ─────────────────────────────────────────────────────────
    function init() {
        console.log('[focboost] init() called');
        try {
            chrome.storage.local.get(
                ['sessionActive', 'sessionTask', 'sessionTimeLeft', 'sessionPaused', 'floatingBarEnabled', 'barPositionX', 'barPositionY'],
                (data) => {
                    if (chrome.runtime.lastError) {
                        console.error('[focboost] Storage error:', chrome.runtime.lastError);
                        return;
                    }
                    console.log('[focboost] Storage data:', data);

                    if (data.floatingBarEnabled === false) {
                        console.log('[focboost] Floating bar disabled in settings');
                        return;
                    }
                    if (!data.sessionActive) {
                        console.log('[focboost] No active session found');
                        return;
                    }

                    chrome.storage.session.get('barDismissed', (result) => {
                        console.log('[focboost] barDismissed state:', result.barDismissed);
                        if (result.barDismissed) return;
                        injectBar(data.sessionTask, data.sessionTimeLeft, data.sessionPaused, data.barPositionX, data.barPositionY);
                    });
                }
            );
        } catch (e) {
            console.error('[focboost] Critical init error:', e);
        }
    }

    init();

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        console.log('[focboost] Storage changed in local:', changes);

        if (changes.sessionTimeLeft && shadow) {
            updateTimerDisplay(changes.sessionTimeLeft.newValue);
        }

        if (changes.sessionTask && shadow) {
            const el = shadow.getElementById('task-label');
            if (el) {
                el.textContent = changes.sessionTask.newValue;
                el.title = changes.sessionTask.newValue;
            }
        }

        if (changes.sessionPaused !== undefined && shadow) {
            const paused = changes.sessionPaused.newValue;
            const btn = shadow.getElementById('pause-btn');
            if (btn) btn.textContent = paused ? '▶' : '⏸';
            const count = shadow.getElementById('countdown');
            if (count) count.classList.toggle('paused', paused);
        }

        if (changes.sessionActive) {
            if (changes.sessionActive.newValue === false && host) {
                console.log('[focboost] Session deactivated, removing bar');
                host.remove();
                host = null;
            } else if (changes.sessionActive.newValue === true && !host) {
                console.log('[focboost] Session activated, injecting bar');
                chrome.storage.local.get(
                    ['sessionTask', 'sessionTimeLeft', 'sessionPaused', 'floatingBarEnabled', 'barPositionX', 'barPositionY'],
                    (data) => {
                        if (data.floatingBarEnabled !== false) {
                            injectBar(data.sessionTask, data.sessionTimeLeft, data.sessionPaused, data.barPositionX, data.barPositionY);
                        }
                    }
                );
            }
        }

        if (changes.floatingBarEnabled !== undefined) {
            if (changes.floatingBarEnabled.newValue === false && host) {
                host.remove();
                host = null;
            } else if (changes.floatingBarEnabled.newValue === true && !host) {
                init();
            }
        }
    });

    // Handle barDismissed session storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'session' && changes.barDismissed) {
            if (changes.barDismissed.newValue === false && !host) {
                init();
            }
        }
    });
})();
