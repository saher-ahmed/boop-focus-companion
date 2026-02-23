// ── Constants ──────────────────────────────────────────────────────────────
const ALARM_SPRINT      = 'boop-sprint';
const ALARM_DRIFT_CHECK = 'boop-drift-check';   // periodic poll, replaces event-based approach
const NOTIF_SPRINT      = 'boop-sprint';
const NOTIF_DRIFT       = 'boop-drift';

// ── Domain helpers ─────────────────────────────────────────────────────────
function getDomain(url) {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isSameSite(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith('.' + b) || b.endsWith('.' + a);
}

// ── Alarm handler ──────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('[boop] alarm fired:', alarm.name);

  // ── Sprint alarm ──────────────────────────────────────────────────────
  if (alarm.name === ALARM_SPRINT) {
    const { task, sprintMins = 20, sprintCount = 0 } = await chrome.storage.local.get(['task', 'sprintMins', 'sprintCount']);
    console.log('[boop] sprint alarm — task:', task, 'sprintMins:', sprintMins, 'sprintCount:', sprintCount);
    if (!task) { console.log('[boop] no active task, skipping sprint notification'); return; }

    const newCount = sprintCount + 1;
    await chrome.storage.local.set({ sprintCount: newCount });
    chrome.notifications.create(NOTIF_SPRINT, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: `Sprint ${newCount} done! 🎉`,
      message: `${sprintMins} min on "${task}". Keep going?`,
      buttons: [{ title: '▶ Another sprint' }, { title: '☕ Take a break' }],
      requireInteraction: true,
      priority: 2,
    });
    return;
  }

  // ── Drift-check alarm (polls active tab every 30 s) ───────────────────
  if (alarm.name === ALARM_DRIFT_CHECK) {
    const { task, focusSite, driftStart, paused } = await chrome.storage.local.get([
      'task', 'focusSite', 'driftStart', 'paused',
    ]);
    console.log('[boop] drift-check — task:', task, '| focusSite:', focusSite, '| driftStart:', driftStart, '| paused:', paused);

    if (!task || !focusSite || paused) {
      console.log('[boop] no active session or paused — skipping drift check');
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs || !tabs.length) {
        console.log('[boop] no active tab found');
        return;
      }

      const currentDomain = getDomain(tabs[0].url);
      console.log('[boop] current domain:', currentDomain, '| focus domain:', focusSite);

      if (isSameSite(currentDomain, focusSite)) {
        console.log('[boop] on focus site — clearing drift state');
        if (driftStart) {
          await chrome.storage.local.set({ driftStart: null });
          chrome.notifications.clear(NOTIF_DRIFT);
        }
        return;
      }

      // User is on a different site
      if (!driftStart) {
        console.log('[boop] left focus site — starting drift timer');
        await chrome.storage.local.set({ driftStart: Date.now() });
        return;
      }

      const minsAway = (Date.now() - driftStart) / 60000;
      console.log('[boop] drifting for', minsAway.toFixed(1), 'min');

      if (minsAway < 2) {
        console.log('[boop] under 2-min threshold, no notification yet');
        return;
      }

      console.log('[boop] threshold crossed — creating drift notification');
      chrome.notifications.create(NOTIF_DRIFT, {
        type:    'basic',
        iconUrl: 'icons/icon48.png',
        title:   'Hey, you drifted 👀',
        message: `Away from ${focusSite} for ${Math.floor(minsAway)} min. Task: "${task}"`,
      }, (notifId) => {
        if (chrome.runtime.lastError) {
          console.log('[boop] notification error:', chrome.runtime.lastError.message);
        } else {
          console.log('[boop] notification created, id:', notifId);
        }
      });
    });
  }
});

// ── Notification button handler ────────────────────────────────────────────
chrome.notifications.onButtonClicked.addListener(async (notifId, btnIndex) => {
  console.log('[boop] notification button clicked — notifId:', notifId, 'btnIndex:', btnIndex);

  if (notifId !== NOTIF_SPRINT) return;

  chrome.notifications.clear(NOTIF_SPRINT);

  if (btnIndex === 0) {
    // Another sprint
    const { sprintMins = 20 } = await chrome.storage.local.get('sprintMins');
    const sprintEndTime = Date.now() + sprintMins * 60000;
    await chrome.storage.local.set({ sprintEndTime });
    chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: sprintMins });
    console.log('[boop] starting another sprint:', sprintMins, 'min');
  } else {
    // Take a break — pause
    await chrome.storage.local.set({ paused: true, pausedAt: Date.now() });
    console.log('[boop] pausing for break');
  }
});

// ── Messages from popup ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'startFocus') {
    const focusSite = msg.focusSite || null;
    const sprintMins = msg.sprintMins || 20;
    console.log('[boop] startFocus — focusSite:', focusSite, 'sprintMins:', sprintMins);

    Promise.all([
      chrome.alarms.clear(ALARM_SPRINT),
      chrome.alarms.clear(ALARM_DRIFT_CHECK),
    ]).then(() => {
      chrome.notifications.clear(NOTIF_DRIFT);
      chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: sprintMins });
      chrome.alarms.create(ALARM_DRIFT_CHECK, { periodInMinutes: 0.5 });
      console.log('[boop] alarms created — sprint:', sprintMins, 'min | drift-check: every 30s');
      const updates = { driftStart: null };
      if (focusSite !== undefined) updates.focusSite = focusSite;
      return chrome.storage.local.set(updates);
    }).then(() => {
      sendResponse({ ok: true });
    });

    return true;
  }

  if (msg.type === 'stopFocus') {
    console.log('[boop] stopFocus');
    chrome.alarms.clear(ALARM_SPRINT);
    chrome.alarms.clear(ALARM_DRIFT_CHECK);
    chrome.notifications.clear(NOTIF_SPRINT);
    chrome.notifications.clear(NOTIF_DRIFT);
    chrome.storage.local.remove(
      ['focusSite', 'driftStart', 'sprintMins', 'sprintEndTime', 'sprintCount', 'paused', 'pausedAt'],
      () => { sendResponse({ ok: true }); }
    );
    return true;
  }
});

// ── Restore alarms after Chrome restart ───────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  const { task, sprintEndTime } = await chrome.storage.local.get(['task', 'sprintEndTime']);
  console.log('[boop] onStartup — task:', task, 'sprintEndTime:', sprintEndTime);
  if (!task) return;

  if (sprintEndTime) {
    const remaining = sprintEndTime - Date.now();
    if (remaining > 0) {
      chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: remaining / 60000 });
      console.log('[boop] restored sprint alarm, remaining:', (remaining / 60000).toFixed(1), 'min');
    }
  }

  chrome.alarms.create(ALARM_DRIFT_CHECK, { periodInMinutes: 0.5 });
  console.log('[boop] restored drift-check alarm');
});
