# boop. · Floating Focus Bar
**New Feature Spec — Developer Handoff**
Prepared by Panze Studio · March 2026

---

## Is This Possible?

Yes, fully. This is exactly how Grammarly, Loom, and Vimeo's extensions work. Chrome extensions can inject a content script into every webpage the user visits, and that script can create any DOM element and float it on top of the page. The element lives outside the page's own DOM tree — the website has no control over it, can't hide it, can't style it. It's ours.

This is a well-established Chrome extension pattern. Nothing experimental or risky about it.

---

## What It Is

When the user starts a focus session in boop., a small floating bar appears at the bottom of every webpage they visit — similar to how Grammarly shows its floating icon, or how Loom shows its recording toolbar. The bar stays visible as the user browses. It's a persistent reminder that a session is active, and it gives them quick controls without needing to open the extension popup.

The user has two ways to deal with it if they don't want it right now:

- **Close it for this session** — an X button on the bar dismisses it until the current session ends. Next session, it comes back.
- **Turn it off permanently** — a toggle in Settings disables the floating bar entirely across all sessions.

---

## What the Bar Looks Like

The bar is a compact horizontal pill — not a full toolbar, not a big card. Think of it like a slim status strip. It floats fixed at the bottom-center of the viewport. It should feel like it belongs to the browser, not the page.

**Content inside the bar (left to right):**

- The boop. dot logo mark — small, purple, acts as a visual anchor
- The task name the user entered — truncated with ellipsis if too long, max ~24 characters shown
- A live countdown timer in monospace — MM:SS, same as the popup timer screen
- A small pause icon button — tapping it pauses/resumes the session
- A "distracted" icon button — a small emoji or icon the user taps to log a distraction, same as the popup button
- A thin separator line
- An X button — closes the bar for this session only

**Visual style — follow the same design rules as the rest of boop.:**

- White background, 1px light border, no shadow, no gradient
- Border radius: fully rounded pill shape (border-radius: 999px)
- Font: DM Sans for task name, DM Mono for countdown
- Accent color: #7C6FF7 for the logo mark and active state indicators
- Height: approximately 44px. Compact but tap-friendly.
- Width: auto, based on content — roughly 280px to 340px max
- Position: fixed, bottom: 24px, horizontally centered (left: 50%, transform: translateX(-50%))

The bar should not be intrusive. It should feel like a gentle ambient indicator, not a popup demanding attention.

---

## Behavior Details

**Appears when:** The user starts a focus session from the popup. The bar shows up on the current tab immediately, and on every subsequent tab they open or switch to while the session is active.

**Disappears when:**
- The session ends (timer hits zero or user clicks End in the popup)
- The user clicks the X button on the bar (dismissed for this session only)
- The "Show floating bar" toggle is turned off in Settings

**Dismissed state:** If the user clicks X, store a flag in chrome.storage.session (not .local — this should reset each new session). When the content script loads on any page, it checks this flag before injecting the bar. If dismissed, skip rendering. When a new session starts, clear the flag so the bar shows again.

**Pause state:** When the user taps the pause button on the bar, it pauses the session timer — same as pausing from the popup. The bar should visually indicate the paused state: the countdown stops, a small "paused" label appears next to the timer, and the pause icon changes to a play icon.

**Draggable:** Make the bar draggable. The user should be able to click and drag it to reposition it anywhere on the screen — top, sides, wherever. Save the last position to chrome.storage.local so it stays where they put it across pages. Default position is bottom-center.

**Page conflicts:** Some pages have their own fixed bottom bars (YouTube controls, chat widgets, cookie banners). The bar should sit above these by using a very high z-index (try z-index: 2147483647, which is the max integer value for z-index). This is the same approach Grammarly uses.

**Transition:** When the bar appears, animate it in — slide up from the bottom over 200ms with a fade. When dismissed, fade out over 150ms then remove from DOM. Keep it smooth but not showy.

---

## Technical Implementation

### How Content Scripts Work for This

A content script is a JavaScript file that Chrome injects into web pages on your behalf. It runs in an isolated context — it can read and modify the page's DOM, but it has its own scope separate from the page's JavaScript. This is what makes it safe and reliable for injecting UI elements.

You'll declare the content script in manifest.json and it will automatically run on every page the user visits.

### Shadow DOM — Use It

Inject the floating bar inside a Shadow DOM. This is critical. Here's why: if you inject a plain div into the page, the page's own CSS can accidentally style it — fonts, colors, spacing could all get overridden. Shadow DOM gives the bar an encapsulated style scope. Nothing on the page can touch it.

```js
// In your content script
const host = document.createElement('div');
host.id = 'boop-floating-host';
document.body.appendChild(host);

const shadow = host.attachShadow({ mode: 'closed' });

// Now inject your bar HTML and styles into shadow
const bar = document.createElement('div');
bar.innerHTML = `/* your bar markup */`;
shadow.appendChild(bar);
```

Using mode: 'closed' means the page's JavaScript cannot access the shadow root either. Clean isolation.

### Manifest V3 Setup

In your manifest.json, you need two things:

First, declare the content script:

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["content/floatingBar.js"],
    "css": [],
    "run_at": "document_idle"
  }
]
```

No CSS entry needed since styles go inside the Shadow DOM. run_at: document_idle means it waits until the page has loaded before injecting — avoids layout conflicts.

Second, make sure your permissions include storage and scripting (you likely already have these from the site blocker feature).

### Communication Between Bar and Background

The floating bar needs to know:

- Is a session currently active?
- What is the task name?
- How much time is left?
- Is the session paused?

And it needs to send back:

- User tapped pause
- User logged a distraction
- User dismissed the bar

Use chrome.runtime.sendMessage and chrome.runtime.onMessage for actions (pause, distraction log, dismiss). Use chrome.storage.onChanged to listen for timer updates in real time so the countdown stays in sync.

Example — listening for timer updates in the content script:

```js
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.sessionTimeLeft) {
    updateCountdown(changes.sessionTimeLeft.newValue);
  }
  if (area === 'local' && changes.sessionActive) {
    if (!changes.sessionActive.newValue) {
      removeBar(); // session ended
    }
  }
});
```

Example — sending a pause action from the bar:

```js
pauseButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'togglePause' });
});
```

### Keeping the Countdown in Sync

The background service worker owns the timer. Every second, it decrements the counter and writes the new value to chrome.storage.local. The content script listens to storage changes and updates the countdown display accordingly. This way the bar always shows accurate time even if it was just injected on a new page mid-session.

Do not run a separate timer in the content script. One source of truth — the background worker.

### Handling the Dismissed State

Use chrome.storage.session for the dismissed flag. session storage in Chrome MV3 persists only until the browser session ends — which is close enough to "until the extension is restarted." But more importantly, you should clear it explicitly whenever a new session starts.

```js
// When a new session starts (in background worker)
chrome.storage.session.set({ barDismissed: false });

// When user clicks X on the bar (in content script)
chrome.storage.session.set({ barDismissed: true });

// When content script loads on a page (check before rendering)
chrome.storage.session.get('barDismissed', (result) => {
  if (!result.barDismissed) {
    injectBar();
  }
});
```

### Injecting on New Tabs Mid-Session

There's a subtle problem: content scripts run when a page loads, but if the user opens a new tab after a session has started, the content script on that new page needs to know a session is already active. It can't rely on receiving a "session started" message because that message was sent before this tab existed.

Solve this by having the content script proactively check chrome.storage.local on load:

```js
// At the top of floatingBar.js, on every page load
chrome.storage.local.get(['sessionActive', 'sessionTask', 'sessionTimeLeft', 'sessionPaused'], (data) => {
  if (data.sessionActive) {
    chrome.storage.session.get('barDismissed', (result) => {
      if (!result.barDismissed) {
        injectBar(data);
      }
    });
  }
});
```

This makes the bar self-healing — it always knows the current state regardless of when the tab was opened.

---

## Settings Toggle

In the Settings screen, add a new toggle in a section above the site blocking list. Label it "Show floating focus bar" with a short description below: "A small bar floats on every page while your session is active."

Toggle is on by default.

When turned off, write floatingBarEnabled: false to chrome.storage.local. The content script checks this flag on load. If false, it skips rendering entirely — not just dismissed, but fully disabled.

When turned back on, the bar will appear on the next session start.

---

## Edge Cases to Handle

**The bar on the boop. popup itself:** The popup is not a web page, so content scripts don't run there. No issue.

**The bar on chrome:// pages:** Chrome does not allow content scripts on chrome:// URLs (chrome://newtab, chrome://settings, etc.). This is a Chrome restriction, not a bug. The bar simply won't appear on those pages — that's fine and expected.

**The bar on pages with strict Content Security Policy:** Some pages (like certain banking or enterprise apps) have strict CSPs that block injected scripts. In practice, Shadow DOM injection via a Chrome extension content script bypasses most of these restrictions because it runs at the extension privilege level, not the page level. But test on a few strict CSP pages to confirm.

**The bar on full-screen video:** If the user enters full-screen mode (YouTube, Netflix), the floating bar may or may not appear depending on the browser's full-screen behavior. This is acceptable — don't fight the full-screen API. The bar can disappear in true full-screen mode.

**Very long task names:** Cap the displayed task name at 24 characters with an ellipsis. Show the full name in a tooltip on hover.

---

## Summary

This is a content script feature using Shadow DOM injection. The bar floats over every page, stays in sync with the background timer via chrome.storage, and gives the user quick access to pause, log distractions, and dismiss — without opening the popup. It's dismissible per session and fully disableable from Settings. The implementation follows the exact same pattern used by Grammarly, Loom, and every other serious Chrome extension that overlays UI on web pages.

Build the content script as floatingBar.js, keep it isolated with Shadow DOM, and make sure it reads session state on load rather than waiting for messages. That's the key to making it work reliably across tab switches and new tabs.

---

Reach out if anything needs clarification before you start.

Panze Studio · panze.co
