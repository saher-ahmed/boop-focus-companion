# boop. · Developer Handoff
**Chrome Extension Redesign**
Prepared by Panze Studio · March 2026

---

## Context & Why We're Redesigning

The current version of boop. is a basic focus timer. It does one thing — lets you set a task name, pick a duration (5, 10, 15, or 20 minutes), and hit Start. That's it. No session feedback, no understanding of how focused you actually were, no way to manage what sites you visit during a session. It works, but it doesn't deliver on the product's own promise — being a gentle focus companion.

After a proper UX review, here is what we found missing:

- The extension has no active timer screen. Once you start, the popup just closes. There's no way to know how much time is left without reopening it.
- There's no feedback after a session ends. You finish and nothing happens. No score, no summary, no sense of accomplishment.
- The extension does nothing to prevent distraction. If you open Instagram mid-session, boop. has zero awareness of it.
- There's no difficulty context. Not all tasks are equal. A 20-minute deep work block is very different from a 20-minute admin task, and the tool should know the difference.
- There's no behavioral layer. Good focus tools build habits. The current version has no commitment, no streak, no weekly insight — nothing that makes you want to come back.

So we're rebuilding it. Same brand identity — clean, calm, purple-accented, minimal. But now with a proper feature set that makes boop. actually useful for serious focus work.

---

## Design Direction

Before you write a single line of code, internalize this: the design language for this extension is minimal, clean, and focused. That's it. Here's what that means in practice.

**What to do**

- White backgrounds. Light grey for secondary surfaces. Purple (#7C6FF7) as the only accent color.
- Clean sans-serif typography. DM Sans is the typeface. DM Mono for the timer countdown only.
- Flat UI. No card shadows on primary containers. Subtle border or background tint to separate sections.
- Pill-shaped buttons for option selectors (duration, difficulty). Rounded rectangles for primary CTAs.
- Transitions between screens: simple fade-in only. Keep it under 200ms.
- Spacing does the heavy lifting. Use generous padding and breathing room between elements.

**What not to do**

- No gradients. Anywhere. Not on buttons, not on backgrounds, not on the timer ring. Flat only.
- No box shadows on layout elements. If something needs separation, use a 1px border or a light fill.
- No glassmorphism, blur effects, or layered transparency on UI elements.
- No decorative icons or illustrations. Emoji are fine where used intentionally (sparingly). No icon packs.
- No animations just for the sake of it. Every motion should have a purpose.

> Think Linear, Raycast, or Notion — tool-like precision. Not Duolingo, not Headspace. Those are great products, but that's not this.

---

## Screens & What to Build

### 1. Home Screen

This is what the user sees when they open the extension popup. The layout is straightforward top-to-bottom.

Top bar: Left side shows the boop. wordmark and the tagline "gentle focus companion" below it in muted grey. Right side has a single settings gear icon — small, muted, no label. This is the only way to get to Settings. Position it top-right, aligned to the popup edge. This was missing from the old design and matters a lot for discoverability without cluttering the interface.

Below that: a text input asking "What are you working on?" with a rotating placeholder (e.g. "Finishing the pitch deck...", "Reviewing the PRD..."). Then a row of difficulty pills — Easy, Medium, Hard, Deep Work. Only one can be selected at a time. Then a duration row — 5, 10, 15, 20 min pills, plus a small custom text input for anything else. Then a full-width "Start focusing" CTA button, disabled until the user has entered a task and selected a difficulty.

Below the CTA: a thin divider, then a Recent Sessions section. Each row shows the timestamp, difficulty level, duration, and the session's focus score on the right. This replaces the current "2 sprints · 100/100 · 10 min" format which is confusing.

> Note: The old design had no difficulty selector and no focus score. Both are new.

---

### 2. Commitment Contract Screen

This appears after the user taps "Start focusing" — before the timer actually begins. It's a short checklist of commitments the user selects before the session. Examples: "I will not check social media", "I will not open unrelated tabs", "I will silence my phone", "I will not check email or Slack".

The user checks whichever ones apply. These are saved and shown again at the end of the session as a self-report check-in. Two buttons at the bottom: Back and "I'm committed →" to proceed to the timer.

> Note: This screen did not exist in the old design. It creates a behavioral contract that makes the session feel intentional, not mechanical.

---

### 3. Active Timer Screen

This is the screen that was completely missing from the old design. Once a session starts, the popup now shows a proper timer view instead of closing.

The centerpiece is a circular SVG progress ring — a thin ring that drains as time passes. Inside the ring, a monospace countdown (MM:SS) and a small label showing "remaining" or "paused". The task name sits above the ring in a small muted label. Below the ring, two side-by-side buttons: Pause/Resume and End Session. Below those, a single "I got distracted" button — tapping it increments a counter shown on the button itself. No shame, no lecture. Just a tap to log it.

At the bottom of the screen, a small flat card shows which sites are currently being blocked. It lists the site names as small tags. This gives the user confidence that the blocker is active.

> Note: The distraction count and pause count feed directly into the Focus Score calculation at the end of the session.

---

### 4. Site Blocker Overlay

This is a content script that gets injected into any tab the user navigates to while a session is active, if that site is on their blocked list. It covers the entire page.

The overlay is dark — near-black background with a blur applied to whatever is behind it. Centered on screen: the boop. target icon, a calm heading ("It's your time to focus on life growth. Don't dive into the distraction."), the name of the blocked site they tried to visit, their current task name pulled from the active session, and a small progress bar showing how much time is left.

Two buttons at the bottom: "Go back" closes the overlay and does nothing. "Log distraction & proceed" logs the visit as a distraction and lets them through. This is intentional — we're not hard-blocking. We're adding a speed bump and a moment of awareness. That matches the "gentle" brand tone.

> Note: Do not hard-block navigation. The overlay should always offer a way through. The goal is awareness, not punishment.

---

### 5. Post-Session Screen

Shown automatically when the timer finishes (or when the user ends early). This screen gives the session meaning.

Center of the screen: a circular score badge showing the Focus Score from 0 to 100. Color-coded — purple for 85 and above, amber for 65 to 84, red below 65. Below the badge, a one-line summary showing duration, distraction count, and pause count.

Score formula: Start at 100. Subtract 8 for each distraction logged. Subtract 5 for each pause. Add 5 bonus if difficulty was Deep Work. Clamp the result between 20 and 100.

Below the score: a checklist of the commitments the user made at the start of the session. They self-report which ones they kept. This closes the behavioral loop. At the bottom: two buttons — Weekly View and Done.

---

### 6. Weekly View Screen

A simple bar chart showing the user's daily focus scores for the current week. Each bar is color-coded using the same purple / amber / red system. Days with no sessions show a faint empty bar.

Below the chart: a small insights card showing three data points — most distracted time window, strongest focus window, and top distraction source. These are derived from session history stored locally. Two buttons: Back and New Session.

> Note: Keep this view clean. One chart, three insights. Resist the urge to add more data. Clarity over completeness.

---

### 7. Settings Screen

Accessible only via the gear icon on the Home screen top-right. This screen has one job: let the user control which sites get blocked during sessions.

The top section shows a list of suggested distraction sites — Facebook, Instagram, TikTok, Twitter / X, YouTube, Reddit. Each has an icon, the site name, the URL, and a toggle switch on the right. Toggles are on by default for Instagram, Facebook, and TikTok. The user can turn any of them off.

Below that: a custom URL input field and an Add button. The user types a domain (e.g. news.ycombinator.com) and it gets added to the list as a removable tag. Tapping the tag removes it.

At the bottom: a short explanation note ("Blocked sites will show a focus reminder when visited during an active session") and a Save & Back button.

---

## Technical Notes

**Storage**

- All session data — scores, distractions, history, blocked sites list — must be persisted using chrome.storage.local.
- The blocked sites list from Settings must be immediately available to the content script when a session is active. Sync it via chrome.storage.onChanged listener in the content script.

**Site Blocking**

- Use a content script injected on all URLs (match: all_urls) that checks the current hostname against the blocked list on every page load.
- When a match is found and a session is active, inject the overlay as a DOM element over the page. Do not use chrome.declarativeNetRequest for this — that would hard-block and we want a soft overlay.
- The content script needs access to active session state (is a session running, what's the task name, how much time is left). Use chrome.storage or chrome.runtime.sendMessage to get this from the background service worker.

**Timer**

- Run the timer countdown in the background service worker, not in the popup. This keeps the session alive even when the popup closes.
- The popup reads current timer state from chrome.storage when it opens and subscribes to updates via chrome.storage.onChanged.

**Manifest**

- Manifest V3. Permissions needed: storage, alarms, scripting, tabs, and host_permissions for all_urls (for the content script overlay).

---

That's the full scope of the redesign. If something in this doc is unclear, ask before building — it's faster than rebuilding. If you need the interactive React prototype as a reference, we have that too. Reach out to the team.

Panze Studio · panze.co
