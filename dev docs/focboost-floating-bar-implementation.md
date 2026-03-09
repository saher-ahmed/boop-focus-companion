# focboost · Floating Bar Implementation
**How to Build It — Full Technical Spec**
March 2026

---

## How It Works (Read This First)

This is a content script + Shadow DOM injection. That's the entire mechanism. Vimeo, Grammarly, and Loom all use this exact same pattern. A JavaScript file gets injected into every webpage the user visits. That script creates a DOM element, attaches a Shadow DOM to it, renders the bar UI inside the shadow, and pins it fixed to the viewport. The webpage has zero control over it — can't style it, can't hide it, can't touch it.

Nothing experimental. Nothing risky. This is the standard Chrome extension pattern for floating UI.

---

## Step 1 — manifest.json

Declare the content script so Chrome knows to inject it on every page:

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["floatingBar.js"],
    "run_at": "document_idle"
  }
]
```

`<all_urls>` — runs on every HTTP and HTTPS page the user visits.
`document_idle` — waits until the page DOM is fully ready before injecting. No race conditions.

Make sure your permissions block also includes:

```json
"permissions": ["storage", "scripting", "tabs", "alarms"]
```

After any change to manifest.json, go to chrome://extensions, fully disable the extension, then re-enable it. A simple refresh icon click is not enough — you must toggle it off and on.

---

## Step 2 — Create the Host Element

This goes in floatingBar.js. The host element is the anchor point for the floating bar. Its positioning styles live here — outside the Shadow DOM — so they are completely immune to anything the webpage tries to do.

```js
const host = document.createElement('div');
host.id = 'focboost-host';

Object.assign(host.style, {
  position: 'fixed',
  bottom: '24px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: '2147483647',  // max possible z-index value in any browser
  all: 'initial',        // resets ALL inherited styles from the page
  pointerEvents: 'auto'
});

document.body.appendChild(host);
```

The `all: initial` is not optional. Without it, some pages will bleed their CSS resets into the host element and break the layout. Always include it.

The z-index of 2147483647 is the maximum 32-bit integer value. This is the same value Grammarly uses. It guarantees the bar floats above everything — YouTube controls, chat widgets, cookie banners, all of it.

---

## Step 3 — Attach Shadow DOM and Render the Bar

Attach the shadow root to the host, then inject all markup and styles inside it. This is the key step. Everything inside the shadow is fully isolated — no page CSS can reach it, no page JavaScript can read it.

```js
const shadow = host.attachShadow({ mode: 'closed' });

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
    <span class="task" id="task-label">Loading...</span>
    <span class="timer" id="countdown">--:--</span>
    <button class="btn" id="pause-btn" title="Pause session">⏸</button>
    <button class="btn" id="distract-btn" title="Log distraction">😬</button>
    <div class="divider"></div>
    <button class="btn close" id="close-btn" title="Hide bar">✕</button>
  </div>
`;
```

`mode: 'closed'` means the page's own JavaScript cannot access or modify the shadow root. Fully locked down.

---

## Step 4 — Wire Up Buttons

```js
shadow.getElementById('pause-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'togglePause' }, (response) => {
    const isPaused = response?.paused;
    shadow.getElementById('pause-btn').textContent = isPaused ? '▶' : '⏸';
    shadow.getElementById('countdown').classList.toggle('paused', isPaused);
  });
});

shadow.getElementById('distract-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'logDistraction' });
  // Brief visual feedback
  const btn = shadow.getElementById('distract-btn');
  btn.style.transform = 'scale(1.3)';
  setTimeout(() => btn.style.transform = 'scale(1)', 200);
});

shadow.getElementById('close-btn').addEventListener('click', () => {
  chrome.storage.session.set({ barDismissed: true });
  host.remove();
});
```

---

## Step 5 — Keep the Countdown in Sync

The background service worker owns the timer. It writes the updated time to chrome.storage.local every second. The content script listens to those changes and updates the display. One source of truth — never run a second timer in the content script.

```js
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.sessionTimeLeft) {
    const t = changes.sessionTimeLeft.newValue;
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    const el = shadow.getElementById('countdown');
    if (el) el.textContent = `${mm}:${ss}`;
  }

  if (changes.sessionTask) {
    const el = shadow.getElementById('task-label');
    if (el) el.textContent = changes.sessionTask.newValue;
  }

  if (changes.sessionActive?.newValue === false) {
    host.remove(); // session ended — remove the bar cleanly
  }

  if (changes.floatingBarEnabled?.newValue === false) {
    host.remove(); // user turned off the bar in settings
  }
});
```

---

## Step 6 — Check Session State on Page Load

This is the most important part. When the user opens a new tab while a session is already running, the content script has no way of receiving the original "session started" message — that was sent before this tab existed. So on every page load, the script must proactively read storage to find out if a session is active.

```js
function injectBar(task, timeLeft) {
  // build host, shadow, and wire buttons as shown in Steps 2–5
  shadow.getElementById('task-label').textContent = task || 'Focus session';
  const mm = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const ss = String(timeLeft % 60).padStart(2, '0');
  shadow.getElementById('countdown').textContent = `${mm}:${ss}`;
}

// This runs immediately when the script loads on any page
chrome.storage.local.get(
  ['sessionActive', 'sessionTask', 'sessionTimeLeft', 'floatingBarEnabled'],
  (data) => {
    // If bar is disabled in settings, stop here
    if (data.floatingBarEnabled === false) return;

    // If no active session, stop here
    if (!data.sessionActive) return;

    // Check if the user already dismissed the bar this session
    chrome.storage.session.get('barDismissed', (result) => {
      if (result.barDismissed) return;

      // All checks passed — inject the bar
      injectBar(data.sessionTask, data.sessionTimeLeft);
    });
  }
);
```

---

## Step 7 — Background Worker Must Set These Keys

The content script depends entirely on the background worker writing the correct keys to chrome.storage.local when a session starts. If these keys are not being written, the bar will never appear — no matter how correct the content script is.

When a session starts, the background worker must run:

```js
chrome.storage.local.set({
  sessionActive: true,
  sessionTask: 'The task name the user entered',
  sessionTimeLeft: durationInSeconds,
  sessionPaused: false
});
```

Every second while the timer runs:

```js
chrome.storage.local.set({ sessionTimeLeft: currentSecondsRemaining });
```

When the session ends:

```js
chrome.storage.local.set({ sessionActive: false });
```

When a new session starts, clear the dismissed flag so the bar shows again:

```js
chrome.storage.session.set({ barDismissed: false });
```

---

## Step 8 — Make the Bar Draggable

The user can drag the bar anywhere on screen. Save the last position so it stays there across page loads.

```js
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

const dragHandle = shadow.getElementById('bar');

dragHandle.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('btn')) return; // don't drag when clicking buttons
  isDragging = true;
  dragOffsetX = e.clientX - host.getBoundingClientRect().left;
  dragOffsetY = e.clientY - host.getBoundingClientRect().top;
  host.style.transition = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const x = e.clientX - dragOffsetX;
  const y = e.clientY - dragOffsetY;
  host.style.left = `${x}px`;
  host.style.top = `${y}px`;
  host.style.transform = 'none';
  host.style.bottom = 'auto';
});

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  // Save position for next page load
  chrome.storage.local.set({
    barPositionX: host.style.left,
    barPositionY: host.style.top
  });
});
```

On bar creation, restore the saved position:

```js
chrome.storage.local.get(['barPositionX', 'barPositionY'], (pos) => {
  if (pos.barPositionX && pos.barPositionY) {
    host.style.left = pos.barPositionX;
    host.style.top = pos.barPositionY;
    host.style.transform = 'none';
    host.style.bottom = 'auto';
  }
});
```

---

## Settings Toggle

In the Settings screen, add a toggle labeled "Show floating focus bar" with a sub-label "A small bar floats on every page during active sessions." Default is on.

When toggled off:

```js
chrome.storage.local.set({ floatingBarEnabled: false });
// Also remove from current tab if session is active
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: () => document.getElementById('focboost-host')?.remove()
  });
});
```

When toggled on:

```js
chrome.storage.local.set({ floatingBarEnabled: true });
```

---

## Known Edge Cases

**chrome:// pages** — Chrome does not allow content scripts on chrome:// URLs. The bar will not appear on chrome://newtab or chrome://settings. This is a hard browser restriction, not a bug. Expected behavior.

**Full-screen video** — In true browser full-screen mode (F11 or YouTube full-screen button), the bar may be hidden by the browser. This is acceptable. Do not fight the full-screen API.

**Pages with aggressive CSS resets** — The `all: initial` on the host element and the Shadow DOM isolation together handle this. If a page uses `* { all: revert }` or a nuclear reset, the host's inline styles will still win because inline styles have highest specificity.

**Very long task names** — The CSS already handles this with `max-width: 160px` and `text-overflow: ellipsis`. Also add a `title` attribute to the task label element so the full text shows on hover.

---

## How to Verify It's Working

Before testing the full flow, run this in the browser console on any webpage to confirm the content script is loading and reading storage correctly:

```js
// Paste in DevTools console
chrome.storage.local.get(null, (data) => console.log('[focboost] full storage:', data));
```

Then check:

```js
document.getElementById('focboost-host')
// Should return the host element if the bar is injected
// Returns null if the script never ran or the session check failed
```

If storage shows `sessionActive: false` or the key doesn't exist at all after starting a timer — the bug is in the background worker, not the content script.

---

## Complete floatingBar.js Structure

For clarity, here is the correct top-level execution order of the entire file:

```
1. Define injectBar(task, timeLeft) function
   - Creates host element with fixed positioning
   - Attaches Shadow DOM
   - Injects markup and styles
   - Wires up buttons
   - Restores saved drag position
   - Starts listening to storage changes

2. At top level (runs immediately on every page load):
   - Read chrome.storage.local for sessionActive, sessionTask, sessionTimeLeft, floatingBarEnabled
   - If sessionActive is false or floatingBarEnabled is false → return, do nothing
   - Check chrome.storage.session for barDismissed
   - If barDismissed is true → return, do nothing
   - Call injectBar() with the task and timeLeft from storage
```

That's the entire file. Keep it in this order and nothing will break.

---

If the bar still doesn't appear after following all of this exactly, send back the output of the full storage dump and the result of `document.getElementById('focboost-host')`. That will identify the exact failure point immediately.
