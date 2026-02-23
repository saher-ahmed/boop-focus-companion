// ── Constants ──────────────────────────────────────────────────────────────
const ALARM_CHECKIN     = 'boop-checkin';
const ALARM_DRIFT_ALERT = 'boop-drift-alert';
const ALARM_DRIFT_NUDGE = 'boop-drift-nudge';
const NOTIF_CHECKIN     = 'boop-checkin';
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
  // Check if one is a subdomain of the other
  return a.endsWith('.' + b) || b.endsWith('.' + a);
}

// ── Tab monitoring ─────────────────────────────────────────────────────────
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    handleTabChange(tab.url);
  });
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, _tab) => {
  if (changeInfo.url) {
    handleTabChange(changeInfo.url);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (chrome.runtime.lastError || !tabs.length) return;
    handleTabChange(tabs[0].url);
  });
});

async function handleTabChange(url) {
  const domain = getDomain(url);
  const { task, focusSite, driftStart } = await chrome.storage.local.get(['task', 'focusSite', 'driftStart']);

  if (!task || !focusSite) return;

  if (isSameSite(domain, focusSite)) {
    // Back on focus site — clear drift state
    await chrome.storage.local.set({ driftStart: null });
    chrome.alarms.clear(ALARM_DRIFT_ALERT);
    chrome.alarms.clear(ALARM_DRIFT_NUDGE);
    chrome.notifications.clear(NOTIF_DRIFT);
  } else if (driftStart === null || driftStart === undefined) {
    // Left focus site for the first time
    await chrome.storage.local.set({ driftStart: Date.now() });
    chrome.alarms.create(ALARM_DRIFT_ALERT, { delayInMinutes: 2 });
  }
  // If driftStart is already set, we're already tracking — do nothing
}

// ── Drift notification ─────────────────────────────────────────────────────
async function sendDriftNotification() {
  const { task, focusSite, driftStart } = await chrome.storage.local.get(['task', 'focusSite', 'driftStart']);
  if (!task || !focusSite || !driftStart) return;

  const minsAway = Math.max(1, Math.floor((Date.now() - driftStart) / 60000));

  chrome.notifications.create(NOTIF_DRIFT, {
    type:    'basic',
    iconUrl: 'icons/icon48.png',
    title:   'Drift detected 👀',
    message: `You've been away from ${focusSite} for ${minsAway} min. Working on "${task}".`,
    buttons: [
      { title: '↩ Go back' },
      { title: '↪ I switched tasks' },
    ],
    requireInteraction: true,
    priority: 2,
  });
}

// ── Alarm handler ──────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_CHECKIN) {
    const { task } = await chrome.storage.local.get('task');
    if (!task) return;
    chrome.notifications.create(NOTIF_CHECKIN, {
      type:    'basic',
      iconUrl: 'icons/icon48.png',
      title:   'Hey, quick check-in 👋',
      message: `You said you were working on "${task}". Still on track?`,
      priority: 1,
    });
    return;
  }

  if (alarm.name === ALARM_DRIFT_ALERT) {
    await sendDriftNotification();
    chrome.alarms.create(ALARM_DRIFT_NUDGE, { periodInMinutes: 5 });
    return;
  }

  if (alarm.name === ALARM_DRIFT_NUDGE) {
    await sendDriftNotification();
  }
});

// ── Notification button handler ────────────────────────────────────────────
chrome.notifications.onButtonClicked.addListener(async (notifId, btnIndex) => {
  if (notifId !== NOTIF_DRIFT) return;

  chrome.notifications.clear(NOTIF_DRIFT);

  if (btnIndex === 0) {
    // "Go back" — find or open the focus site tab
    const { focusSite } = await chrome.storage.local.get('focusSite');
    if (!focusSite) return;

    const tabs = await chrome.tabs.query({});
    const match = tabs.find(t => isSameSite(getDomain(t.url), focusSite));

    if (match) {
      await chrome.tabs.update(match.id, { active: true });
      await chrome.windows.update(match.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: `https://${focusSite}` });
    }
  } else if (btnIndex === 1) {
    // "I switched tasks" — park current task, go to setup
    const { task, startTime, parked = [] } = await chrome.storage.local.get(['task', 'startTime', 'parked']);

    const updatedParked = [...parked];
    if (task) {
      const elapsed = Date.now() - (startTime || Date.now());
      updatedParked.push({ name: task, elapsed });
    }

    chrome.alarms.clear(ALARM_CHECKIN);
    chrome.alarms.clear(ALARM_DRIFT_ALERT);
    chrome.alarms.clear(ALARM_DRIFT_NUDGE);
    chrome.notifications.clear(NOTIF_CHECKIN);

    await chrome.storage.local.set({ parked: updatedParked, openSetupOnLoad: true });
    await chrome.storage.local.remove(['task', 'startTime', 'focusSite', 'driftStart']);

    try {
      await chrome.action.openPopup();
    } catch (_) {
      // openPopup may not be available in all contexts
    }
  }
});

// ── Messages from popup ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'startFocus') {
    const focusSite = msg.focusSite || null;

    Promise.all([
      chrome.alarms.clear(ALARM_CHECKIN),
      chrome.alarms.clear(ALARM_DRIFT_ALERT),
      chrome.alarms.clear(ALARM_DRIFT_NUDGE),
    ]).then(() => {
      chrome.notifications.clear(NOTIF_DRIFT);
      chrome.alarms.create(ALARM_CHECKIN, {
        delayInMinutes:  15,
        periodInMinutes: 15,
      });
      const updates = { driftStart: null };
      if (focusSite !== undefined) updates.focusSite = focusSite;
      return chrome.storage.local.set(updates);
    }).then(() => {
      sendResponse({ ok: true });
    });

    return true;
  }

  if (msg.type === 'stopFocus') {
    chrome.alarms.clear(ALARM_CHECKIN);
    chrome.alarms.clear(ALARM_DRIFT_ALERT);
    chrome.alarms.clear(ALARM_DRIFT_NUDGE);
    chrome.notifications.clear(NOTIF_CHECKIN);
    chrome.notifications.clear(NOTIF_DRIFT);
    chrome.storage.local.remove(['focusSite', 'driftStart'], () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

// ── Restore alarm after Chrome restart ────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  const { task } = await chrome.storage.local.get('task');
  if (!task) return;

  const alarm = await chrome.alarms.get(ALARM_CHECKIN);
  if (!alarm) {
    chrome.alarms.create(ALARM_CHECKIN, {
      delayInMinutes:  15,
      periodInMinutes: 15,
    });
  }
});
