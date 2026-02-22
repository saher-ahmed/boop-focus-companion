const ALARM_NAME = 'boop-checkin';
const NOTIF_ID   = 'boop-checkin';

// ── Alarm fires every 15 minutes ──────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const { task } = await chrome.storage.local.get('task');
  if (!task) return;

  chrome.notifications.create(NOTIF_ID, {
    type:    'basic',
    iconUrl: 'icons/icon48.png',
    title:   'Hey, quick check-in 👋',
    message: `You said you were working on "${task}". Still on track?`,
    priority: 1,
  });
});

// ── Messages from popup ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'startFocus') {
    chrome.alarms.clear(ALARM_NAME, () => {
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes:  15,
        periodInMinutes: 15,
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'stopFocus') {
    chrome.alarms.clear(ALARM_NAME);
    chrome.notifications.clear(NOTIF_ID);
    sendResponse({ ok: true });
    return true;
  }
});

// ── Restore alarm after Chrome restart ────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  const { task } = await chrome.storage.local.get('task');
  if (!task) return;

  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm) {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes:  15,
      periodInMinutes: 15,
    });
  }
});
