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

let ticker = null;

// ── Helpers ────────────────────────────────────────────────────────────────
function calculateScore(distractions, pauses, difficulty) {
  let score = 100;
  score -= (distractions * 8);
  score -= (pauses * 5);
  if (difficulty === 'Deep Work') score += 5;
  return Math.max(20, Math.min(100, score));
}

async function saveState() {
  const timeLeft = state.endTime ? Math.round(Math.max(0, (state.endTime - Date.now()) / 1000)) : 0;
  await chrome.storage.local.set({
    focboostState: state,
    sessionActive: state.isActive,
    sessionTask: state.task,
    sessionTimeLeft: timeLeft,
    sessionPaused: state.isPaused
  });
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

  await saveState();
  chrome.alarms.clearAll();

  if (state.settings?.notifications) {
    chrome.notifications.create('focboost-sprint', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Session complete! 🎉',
      message: `Your focus score: ${score}/100. Check your results in Focboost.`,
    });
  }

  stopTicker();
}

function startTicker() {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    if (state.isActive && !state.isPaused) {
      saveState();
    }
  }, 1000);
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

// ── Boot ───────────────────────────────────────────────────────────────────
// Initialize
(async () => {
  await loadState();
  if (state.isActive && !state.isPaused) {
    startTicker();
  }
})();

chrome.runtime.onInstalled.addListener(() => {
  console.log('[focboost] Extension installed/updated');
  // Initialize storage if needed
  chrome.storage.local.get(['blockedSites'], (data) => {
    if (!data.blockedSites) {
      chrome.storage.local.set({ blockedSites: ['facebook.com', 'twitter.com', 'instagram.com', 'youtube.com', 'reddit.com'] });
    }
  });
});

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
        chrome.storage.session.set({ barDismissed: false });
        chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: message.duration });
        startTicker();

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

    case 'togglePause':
    case 'pauseFocus':
    case 'resumeFocus':
      if (state.isActive) {
        const shouldPause = message.type === 'pauseFocus' || (message.type === 'togglePause' && !state.isPaused);

        if (!shouldPause && state.isPaused) {
          // Resume
          const pauseDuration = Date.now() - state.pauseStartTime;
          state.isPaused = false;
          state.endTime += pauseDuration;
          state.pauseStartTime = null;
          const remainingMs = Math.max(0, state.endTime - Date.now());
          chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: remainingMs / 60000 });
          startTicker();
        } else if (shouldPause && !state.isPaused) {
          // Pause
          state.isPaused = true;
          state.pauses++;
          state.pauseStartTime = Date.now();
          chrome.alarms.clear(ALARM_SPRINT);
          stopTicker();
        }
        saveState();
      }
      sendResponse({ paused: state.isPaused, isActive: state.isActive });
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
          stopTicker();
        }
        saveState();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
      break;
  }
  return true; // Keep message channel open for async responses if needed
});

// ── Alarms ─────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SPRINT) {
    handleSprintDone();
  }
});

// Sync ticker if session already active on boot
if (state.isActive && !state.isPaused) {
  startTicker();
}
