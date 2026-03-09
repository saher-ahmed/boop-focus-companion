console.log('[focboost] background.js loaded');

// ── Constants ──────────────────────────────────────────────────────────────
const ALARM_CHECK = 'focboost-check';
const ALARM_SPRINT = 'focboost-sprint';

// ── State ──────────────────────────────────────────────────────────────────
let state = {
  isActive: false,
  isPaused: false,
  task: '',
  difficulty: 'Medium',
  duration: 25,
  startTime: null,
  endTime: null,
  distractions: 0,
  pauses: 0,
  sprintDone: false,
  finalScore: null,
  blockedSites: [],
  settings: { notifications: true, autopause: true }
};

// ── Helpers ────────────────────────────────────────────────────────────────
function calculateScore(distractions, pauses, difficulty) {
  let score = 100;
  score -= (distractions * 8);
  score -= (pauses * 5);
  if (difficulty === 'Deep Work') score += 5;
  return Math.max(20, Math.min(100, score));
}

async function saveState() {
  await chrome.storage.local.set({ focboostState: state });
}

async function loadState() {
  const data = await chrome.storage.local.get(['focboostState']);
  if (data.focboostState) {
    state = { ...state, ...data.focboostState };
  }
}

async function handleSprintDone() {
  console.log('[focboost] sprint done');
  if (!state.isActive) return;

  const score = calculateScore(state.distractions, state.pauses, state.difficulty);
  state.isActive = false;
  state.sprintDone = true;
  state.finalScore = score;

  saveState();
  chrome.alarms.clearAll();

  if (state.settings?.notifications) {
    chrome.notifications.create('focboost-sprint', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Session complete! 🎉',
      message: `Your focus score: ${score}/100. Check your results in Focboost.`,
    });
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
loadState();

// ── Messages ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[focboost] message received:', message.type);

  switch (message.type) {
    case 'getState':
      sendResponse(state);
      break;

    case 'startFocus':
      chrome.storage.local.get(['blockedSites', 'settings'], (data) => {
        const blocked = data.blockedSites || ['youtube.com', 'twitter.com', 'facebook.com', 'reddit.com'];
        const settings = data.settings || { notifications: true, autopause: true };

        state = {
          isActive: true,
          isPaused: false,
          task: message.task,
          difficulty: message.difficulty,
          duration: message.duration,
          startTime: Date.now(),
          endTime: Date.now() + (message.duration * 60 * 1000),
          distractions: 0,
          pauses: 0,
          sprintDone: false,
          finalScore: null,
          blockedSites: blocked,
          settings: settings
        };

        saveState();
        chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: message.duration });

        if (settings.notifications) {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Focus Started',
            message: `Locked in for ${message.duration} mins on "${message.task}".`
          });
        }
        sendResponse({ success: true });
      });
      return true;

    case 'pauseFocus':
      if (state.isActive && !state.isPaused) {
        state.isPaused = true;
        state.pauses++;
        state.pauseStartTime = Date.now();
        chrome.alarms.clear(ALARM_SPRINT);
        saveState();
      }
      sendResponse({ success: true });
      break;

    case 'resumeFocus':
      if (state.isActive && state.isPaused) {
        const pauseDuration = Date.now() - state.pauseStartTime;
        state.isPaused = false;
        state.endTime += pauseDuration;
        state.pauseStartTime = null;
        const remainingMs = Math.max(0, state.endTime - Date.now());
        chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: remainingMs / 60000 });
        saveState();
      }
      sendResponse({ success: true });
      break;

    case 'stopFocus':
      handleSprintDone();
      sendResponse({ success: true });
      break;

    case 'logDistraction':
      if (state.isActive) {
        state.distractions++;
        if (state.settings?.autopause && !state.isPaused) {
          state.isPaused = true;
          state.pauses++;
          state.pauseStartTime = Date.now();
          chrome.alarms.clear(ALARM_SPRINT);
        }
        saveState();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
      break;
  }
});

// ── Alarms ─────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SPRINT) {
    handleSprintDone();
  }
});
