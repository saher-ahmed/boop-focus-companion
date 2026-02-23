console.log('[boop] background.js loaded');

// ── Helpers ────────────────────────────────────────────────────────────────

function getDomain(url) {
  if (!url) return null;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;
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

// ── Drift check (runs every 1 minute) ─────────────────────────────────────

async function checkDrift() {
  console.log('[boop] checkDrift() called');

  const data = await chrome.storage.local.get(['task', 'focusSite', 'leftAt', 'paused']);
  console.log('[boop] storage:', data);

  if (!data.task || !data.focusSite) {
    console.log('[boop] no active session, skipping');
    return;
  }

  if (data.paused) {
    console.log('[boop] session is paused, skipping');
    return;
  }

  // Query active tab
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
    if (!tabs || tabs.length === 0) {
      console.log('[boop] no active tab found');
      return;
    }

    const tab = tabs[0];
    const currentDomain = getDomain(tab.url);
    console.log('[boop] active tab domain:', currentDomain, '| focus domain:', data.focusSite);

    if (isSameSite(currentDomain, data.focusSite)) {
      // Back on focus site — clear leftAt if it was set
      console.log('[boop] on focus site — on track');
      if (data.leftAt) {
        await chrome.storage.local.set({ leftAt: null });
        console.log('[boop] cleared leftAt');
      }
      return;
    }

    // On a different site
    if (!data.leftAt) {
      // First time we notice they've left — record the timestamp
      const now = Date.now();
      await chrome.storage.local.set({ leftAt: now });
      console.log('[boop] left focus site, recorded leftAt:', now);
      return;
    }

    // They were already away — check how long
    const minsAway = (Date.now() - data.leftAt) / 60000;
    console.log('[boop] away for', minsAway.toFixed(2), 'minutes');

    if (minsAway < 2) {
      console.log('[boop] under 2-minute threshold, no notification yet');
      return;
    }

    // Send notification
    const minsDisplay = Math.floor(minsAway);
    const title = 'Boop!';
    const message = `You have been away from ${data.focusSite} for ${minsDisplay} minute${minsDisplay !== 1 ? 's' : ''}. You were working on: ${data.task}`;
    console.log('[boop] sending notification — title:', title, '| message:', message);

    chrome.notifications.create('boop-drift', {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title,
      message,
    }, (id) => {
      if (chrome.runtime.lastError) {
        console.log('[boop] notification error:', chrome.runtime.lastError.message);
      } else {
        console.log('[boop] notification sent, id:', id);
      }
    });
  });
}

// ── Alarm listener ────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('[boop] alarm fired:', alarm.name);
  if (alarm.name === 'drift-check') {
    checkDrift();
  }
  if (alarm.name === 'boop-sprint') {
    handleSprintDone();
  }
});

// ── Sprint done ────────────────────────────────────────────────────────────

async function handleSprintDone() {
  console.log('[boop] sprint done');
  const data = await chrome.storage.local.get(['task', 'sprintMins', 'sprintCount']);
  if (!data.task) return;

  const newCount = (data.sprintCount || 0) + 1;
  await chrome.storage.local.set({ sprintCount: newCount });

  chrome.notifications.create('boop-sprint', {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: `Sprint ${newCount} done! 🎉`,
    message: `${data.sprintMins || 20} min on "${data.task}". Keep going?`,
    buttons: [{ title: '▶ Another sprint' }, { title: '☕ Take a break' }],
    requireInteraction: true,
    priority: 2,
  }, (id) => {
    if (chrome.runtime.lastError) {
      console.log('[boop] sprint notification error:', chrome.runtime.lastError.message);
    } else {
      console.log('[boop] sprint notification sent, id:', id);
    }
  });
}

// ── Sprint notification buttons ────────────────────────────────────────────

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIndex) => {
  console.log('[boop] button clicked — notif:', notifId, 'btn:', btnIndex);
  if (notifId !== 'boop-sprint') return;

  chrome.notifications.clear('boop-sprint');

  if (btnIndex === 0) {
    const { sprintMins = 20 } = await chrome.storage.local.get('sprintMins');
    const sprintEndTime = Date.now() + sprintMins * 60000;
    await chrome.storage.local.set({ sprintEndTime });
    chrome.alarms.create('boop-sprint', { delayInMinutes: sprintMins });
    console.log('[boop] another sprint started:', sprintMins, 'min');
  } else {
    await chrome.storage.local.set({ paused: true, pausedAt: Date.now() });
    console.log('[boop] taking a break — session paused');
  }
});

// ── Messages from popup ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  console.log('[boop] message received:', msg.type);

  if (msg.type === 'startFocus') {
    const { focusSite, sprintMins = 20 } = msg;
    console.log('[boop] startFocus — site:', focusSite, 'sprint:', sprintMins, 'min');

    // Clear any existing alarms and notifications
    chrome.alarms.clear('drift-check');
    chrome.alarms.clear('boop-sprint');
    chrome.notifications.clear('boop-drift');

    // Start the drift-check alarm (every 1 minute)
    chrome.alarms.create('drift-check', { periodInMinutes: 1 });
    console.log('[boop] drift-check alarm created (every 1 min)');

    // Start the sprint alarm
    chrome.alarms.create('boop-sprint', { delayInMinutes: sprintMins });
    console.log('[boop] sprint alarm created:', sprintMins, 'min');

    // Reset drift state
    chrome.storage.local.set({ leftAt: null }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'stopFocus') {
    console.log('[boop] stopFocus');
    chrome.alarms.clear('drift-check');
    chrome.alarms.clear('boop-sprint');
    chrome.notifications.clear('boop-drift');
    chrome.notifications.clear('boop-sprint');
    chrome.storage.local.remove(
      ['focusSite', 'leftAt', 'sprintMins', 'sprintEndTime', 'sprintCount', 'paused', 'pausedAt'],
      () => { sendResponse({ ok: true }); }
    );
    return true;
  }
});

// ── Restore alarms on Chrome restart ──────────────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  console.log('[boop] onStartup fired');
  const data = await chrome.storage.local.get(['task', 'sprintEndTime', 'paused']);
  console.log('[boop] onStartup storage:', data);

  if (!data.task) {
    console.log('[boop] no active session on startup');
    return;
  }

  // Restore drift-check alarm
  chrome.alarms.create('drift-check', { periodInMinutes: 1 });
  console.log('[boop] restored drift-check alarm');

  // Restore sprint alarm if time remains and not paused
  if (data.sprintEndTime && !data.paused) {
    const remaining = (data.sprintEndTime - Date.now()) / 60000;
    if (remaining > 0) {
      chrome.alarms.create('boop-sprint', { delayInMinutes: remaining });
      console.log('[boop] restored sprint alarm, remaining:', remaining.toFixed(2), 'min');
    }
  }
});
