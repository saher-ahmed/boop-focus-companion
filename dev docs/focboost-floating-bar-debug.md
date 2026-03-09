# focboost · Floating Bar — Debug Directive
**From: Panze Studio**
**Priority: Critical**

---

"I rewrote the script" is not a fix. A fix is when the feature works. Right now it doesn't, so let's stop rewriting and start diagnosing properly. Here is a structured checklist. Go through every single point in order. Don't skip ahead.

---

## Step 1 — Confirm the Content Script Is Even Loading

Open any webpage (not chrome://, not the extension popup). Open DevTools → Console. Look for the [focboost] debug messages you said you added.

If you see NO messages at all, the content script is not loading. That means the problem is in manifest.json, not in the script logic. Go to Step 2.

If you DO see messages, the script is loading but the bar isn't rendering. Skip to Step 3.

---

## Step 2 — If the Content Script Is Not Loading At All

This is a manifest problem. Check all of the following:

**2a. Check your manifest.json content_scripts declaration.**

It must look exactly like this:

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["content/floatingBar.js"],
    "run_at": "document_idle"
  }
]
```

Common mistakes:
- The file path is wrong. If your file is at the root level and not in a content/ folder, the path should be "floatingBar.js" not "content/floatingBar.js". The path must exactly match where the file actually lives in your extension directory.
- The matches field is missing or misspelled. It must be the string "less-than-sign all_urls greater-than-sign" with angle brackets.
- There is a JSON syntax error somewhere in manifest.json causing the whole file to fail silently. Paste your manifest.json into jsonlint.com and validate it.

**2b. After fixing manifest.json, reload the extension properly.**

Go to chrome://extensions. Turn the extension off and back on. Do not just hit the refresh icon — fully disable and re-enable. Then open a new tab to a regular webpage and check the console again.

---

## Step 3 — If the Script Loads But the Bar Doesn't Appear

The script is running but something in the logic is stopping the bar from rendering. Check each of these:

**3a. Is sessionActive actually being set to true when a session starts?**

This is the most common root cause. The content script checks chrome.storage.local for sessionActive on page load. If the background worker is not writing sessionActive: true to storage when a session starts, the content script will never render the bar — no matter how good the script is.

In the background worker, confirm this line exists and runs when a session starts:

```js
chrome.storage.local.set({
  sessionActive: true,
  sessionTask: taskName,
  sessionTimeLeft: durationInSeconds,
  sessionPaused: false
});
```

To verify this is actually happening: open DevTools on any page → Application tab → Storage → Extension Storage → find your extension. Start a session from the popup. Watch if sessionActive appears and flips to true in real time. If it doesn't, the bug is entirely in the background worker, not the content script.

**3b. Is the content script reading storage correctly?**

The content script must check storage on load. Confirm this code runs at the top level of floatingBar.js — not inside an event listener, not inside a function that gets called later. It must run immediately when the script loads:

```js
chrome.storage.local.get(
  ['sessionActive', 'sessionTask', 'sessionTimeLeft', 'sessionPaused'],
  (data) => {
    console.log('[focboost] storage check on load:', data);
    if (data.sessionActive) {
      // check dismissed state then inject bar
    }
  }
);
```

That console.log will tell you exactly what the content script sees when it loads. Share that output.

**3c. Is the bar being injected into Shadow DOM correctly?**

If the host element is created but the shadow root is not attached before appending the bar, nothing will show. Confirm the sequence is exactly:

```js
const host = document.createElement('div');
host.id = 'focboost-floating-host';
host.style.cssText = `
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483647;
  all: initial;
`;
document.body.appendChild(host);

const shadow = host.attachShadow({ mode: 'closed' });
// NOW inject bar markup into shadow, not into host directly
shadow.innerHTML = `<div>...</div>`;
```

The critical mistake people make here: they append content to host instead of to shadow. If you do host.innerHTML = ... the Shadow DOM encapsulation breaks and the bar may not render or may get obliterated by the page's CSS reset.

**3d. Does the bar have explicit position and size styles inside the Shadow DOM?**

Styles inside Shadow DOM do not inherit from anywhere. You must declare everything. The bar div inside the shadow must have at minimum:

```css
display: flex;
align-items: center;
background: #ffffff;
border: 1px solid #e0ddf6;
border-radius: 999px;
padding: 0 16px;
height: 44px;
font-family: 'DM Sans', sans-serif;
font-size: 13px;
color: #333;
white-space: nowrap;
```

If any of these are missing, especially display and background, the element may exist in the DOM but be invisible.

**3e. Is document.body available when the script runs?**

With run_at: "document_idle" this should always be fine. But if someone changed it to "document_start", document.body may not exist yet. Confirm run_at is "document_idle" in manifest.json.

---

## Step 4 — The Fastest Way to Confirm What's Broken

Do this right now. Open any webpage. Open DevTools console. Paste this and run it:

```js
chrome.storage.local.get(null, (data) => console.log('[focboost debug] full storage:', data));
```

This dumps everything in the extension's local storage. Share the output. It will immediately tell us whether sessionActive is being set correctly and what data the content script has access to.

Then also run:

```js
document.getElementById('focboost-floating-host')
```

If it returns null, the host element was never injected. If it returns an element, the host exists — the bug is inside the Shadow DOM. Knowing which one of these is true cuts the remaining debug time in half.

---

## What to Send Back

Do not send another message saying "I fixed it and rewrote the script." Send back:

1. The console output of the full storage dump from Step 4
2. Whether document.getElementById('focboost-floating-host') returns null or an element
3. Your current manifest.json content_scripts block
4. The first 30 lines of floatingBar.js showing how and where it reads storage and injects the host element

With those four things, the exact bug will be identifiable in under 5 minutes.

---
