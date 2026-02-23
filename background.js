console.log('[boop] background.js loaded');

// ── Constants ──────────────────────────────────────────────────────────────
const ALARM_CHECK  = 'boop-check';   // fires every 30s
const ALARM_SPRINT = 'boop-sprint';

const DRIFT_THRESHOLD_MS = 2 * 60 * 1000;  // notify after 2 min away
const NUDGE_INTERVAL_MS  = 5 * 60 * 1000;  // repeat nudge every 5 min

// ── Helpers ────────────────────────────────────────────────────────────────
function getDomain(url) {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isSameSite(a, b) {
  if (!a || !b) return false;
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

// ── Drift check ────────────────────────────────────────────────────────────
async function checkDrift() {
  console.log('[boop] checkDrift called');

  const data = await chrome.storage.local.get([
    'task', 'focusSite', 'leftAt', 'lastNudgeAt',
    'autoPaused', 'autoPausedAt', 'sprintEndTime', 'sprintDone',
  ]);
  console.log('[boop] storage:', JSON.stringify(data));

  if (!data.task || !data.focusSite || data.sprintDone) {
    console.log('[boop] no active session or sprint done, skipping');
    return;
  }

  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch (e) {
    console.log('[boop] tabs query error:', e);
    return;
  }

  if (!tabs || !tabs.length) {
    console.log('[boop] no active tab found');
    return;
  }

  const domain = getDomain(tabs[0].url);
  console.log('[boop] active domain:', domain, '| focus site:', data.focusSite);

  // ── On focus site ─────────────────────────────────────────────────────────
  if (isSameSite(domain, data.focusSite)) {
    console.log('[boop] on focus site — on track');

    const updates = {};
    let needUpdate = false;

    if (data.leftAt)      { updates.leftAt = null;      needUpdate = true; }
    if (data.lastNudgeAt) { updates.lastNudgeAt = null; needUpdate = true; }

    if (data.autoPaused && data.autoPausedAt && data.sprintEndTime) {
      const awayMs = Date.now() - data.autoPausedAt;
      const newEnd = data.sprintEndTime + awayMs;
      const remainingMins = (newEnd - Date.now()) / 60000;
      console.log('[boop] auto-resuming sprint — away for', (awayMs / 60000).toFixed(2), 'min, remaining:', remainingMins.toFixed(2), 'min');

      updates.autoPaused    = false;
      updates.autoPausedAt  = null;
      updates.sprintEndTime = newEnd;
      needUpdate = true;

      if (remainingMins > 0) {
        chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: remainingMins });
        console.log('[boop] sprint alarm recreated, delay:', remainingMins.toFixed(2), 'min');
      }
    }

    if (needUpdate) await chrome.storage.local.set(updates);
    chrome.notifications.clear('boop-drift');
    console.log('[boop] drift state cleared on return');
    return;
  }

  // ── On different site ─────────────────────────────────────────────────────
  console.log('[boop] on different site');
  const now = Date.now();

  if (!data.leftAt) {
    // First detection of departure
    console.log('[boop] first departure — recording leftAt, auto-pausing sprint');
    await chrome.storage.local.set({
      leftAt:       now,
      autoPaused:   true,
      autoPausedAt: now,
    });
    chrome.alarms.clear(ALARM_SPRINT);
    return;
  }

  const awayMs = now - data.leftAt;
  console.log('[boop] away for', (awayMs / 60000).toFixed(2), 'min | threshold:', (DRIFT_THRESHOLD_MS / 60000), 'min');

  if (awayMs < DRIFT_THRESHOLD_MS) {
    console.log('[boop] under threshold, no nudge yet');
    return;
  }

  // Check nudge interval
  const lastNudge = data.lastNudgeAt || 0;
  const timeSinceNudge = now - lastNudge;

  if (lastNudge > 0 && timeSinceNudge < NUDGE_INTERVAL_MS) {
    console.log('[boop] nudge cooldown active, next in', ((NUDGE_INTERVAL_MS - timeSinceNudge) / 60000).toFixed(2), 'min');
    return;
  }

  // Send drift notification
  const message = `You wandered off! You were working on: ${data.task}. Get back to ${data.focusSite}?`;
  console.log('[boop] sending drift notification:', message);

  chrome.notifications.create('boop-drift', {
    type:     'basic',
    iconUrl:  'icons/icon48.png',
    title:    'Boop!',
    message,
  }, (id) => {
    if (chrome.runtime.lastError) {
      console.log('[boop] notification error:', chrome.runtime.lastError.message);
    } else {
      console.log('[boop] drift notification sent, id:', id);
    }
  });

  await chrome.storage.local.set({ lastNudgeAt: now });
}

// ── Sprint done ────────────────────────────────────────────────────────────
async function handleSprintDone() {
  console.log('[boop] sprint done');
  const data = await chrome.storage.local.get(['task', 'sprintMins']);
  if (!data.task) return;

  await chrome.storage.local.set({ sprintDone: true });

  const mins = data.sprintMins || 20;
  chrome.notifications.create('boop-sprint', {
    type:    'basic',
    iconUrl: 'icons/icon48.png',
    title:   'Sprint complete! 🎉',
    message: `Nice! ${mins} minutes done on "${data.task}". Open Boop to go again.`,
  }, (id) => {
    if (chrome.runtime.lastError) {
      console.log('[boop] sprint notification error:', chrome.runtime.lastError.message);
    } else {
      console.log('[boop] sprint notification sent, id:', id);
    }
  });
}

// ── Alarm listener ─────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('[boop] alarm fired:', alarm.name);
  if (alarm.name === ALARM_CHECK)  checkDrift();
  if (alarm.name === ALARM_SPRINT) handleSprintDone();
});

// ── Messages from popup ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  console.log('[boop] message received:', msg.type);

  if (msg.type === 'startFocus') {
    const { focusSite, sprintMins = 20 } = msg;
    console.log('[boop] startFocus — site:', focusSite, 'sprint:', sprintMins, 'min');

    chrome.alarms.clear(ALARM_CHECK);
    chrome.alarms.clear(ALARM_SPRINT);
    chrome.notifications.clear('boop-drift');
    chrome.notifications.clear('boop-sprint');

    chrome.alarms.create(ALARM_CHECK,  { periodInMinutes: 0.5 });
    chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: sprintMins });
    console.log('[boop] alarms created — check: 0.5min interval, sprint:', sprintMins, 'min');

    chrome.storage.local.set({
      leftAt: null, lastNudgeAt: null,
      autoPaused: false, autoPausedAt: null,
      sprintDone: false,
    }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'restartSprint') {
    const { sprintMins = 20 } = msg;
    console.log('[boop] restartSprint —', sprintMins, 'min');

    chrome.alarms.clear(ALARM_SPRINT);
    chrome.notifications.clear('boop-sprint');

    const sprintEndTime = Date.now() + sprintMins * 60000;
    chrome.storage.local.set({
      sprintEndTime,
      sprintDone:   false,
      leftAt:       null,
      lastNudgeAt:  null,
      autoPaused:   false,
      autoPausedAt: null,
    }, () => {
      chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: sprintMins });
      console.log('[boop] sprint restarted:', sprintMins, 'min');
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'stopFocus') {
    console.log('[boop] stopFocus');
    chrome.alarms.clear(ALARM_CHECK);
    chrome.alarms.clear(ALARM_SPRINT);
    chrome.notifications.clear('boop-drift');
    chrome.notifications.clear('boop-sprint');
    chrome.storage.local.remove(
      ['task', 'focusSite', 'sprintMins', 'sprintEndTime', 'startTime',
       'leftAt', 'lastNudgeAt', 'autoPaused', 'autoPausedAt', 'sprintDone'],
      () => sendResponse({ ok: true })
    );
    return true;
  }
});

// ── Restore alarms on Chrome restart ──────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  console.log('[boop] onStartup fired');
  const data = await chrome.storage.local.get(['task', 'sprintEndTime', 'autoPaused', 'sprintDone']);
  console.log('[boop] onStartup storage:', data);

  if (!data.task) {
    console.log('[boop] no active session on startup');
    return;
  }

  chrome.alarms.create(ALARM_CHECK, { periodInMinutes: 0.5 });
  console.log('[boop] restored check alarm');

  if (data.sprintEndTime && !data.autoPaused && !data.sprintDone) {
    const remaining = (data.sprintEndTime - Date.now()) / 60000;
    if (remaining > 0) {
      chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: remaining });
      console.log('[boop] restored sprint alarm, remaining:', remaining.toFixed(2), 'min');
    }
  }
});
