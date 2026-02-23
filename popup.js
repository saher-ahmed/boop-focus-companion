// ── DOM refs ───────────────────────────────────────────────────────────────
const setupView    = document.getElementById('setup-view');
const activeView   = document.getElementById('active-view');
const completeView = document.getElementById('complete-view');
// Setup
const taskInput  = document.getElementById('task-input');
const startBtn   = document.getElementById('start-btn');
const sprintBtns = document.querySelectorAll('.sprint-btn');
// Active
const statusPill     = document.getElementById('status-pill');
const statusText     = document.getElementById('status-text');
const activeTaskName = document.getElementById('active-task-name');
const focusDomainEl  = document.getElementById('focus-domain');
const timerDisplay   = document.getElementById('timer-display');
const endBtn         = document.getElementById('end-btn');
// Complete
const completeSummary = document.getElementById('complete-summary');
const anotherBtn      = document.getElementById('another-btn');
const doneBtn         = document.getElementById('done-btn');

// ── State ──────────────────────────────────────────────────────────────────
let selectedSprint   = 20;
let currentFocusSite = null;
let tickInterval     = null;

// ── Formatting ────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

function formatMS(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

// ── Domain helpers ─────────────────────────────────────────────────────────
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

function getCurrentDomain() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs.length ? getDomain(tabs[0].url) : null);
    });
  });
}

// ── Sprint picker ──────────────────────────────────────────────────────────
sprintBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    sprintBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedSprint = parseInt(btn.dataset.mins);
  });
});

// ── View helpers ───────────────────────────────────────────────────────────
function showView(el) {
  [setupView, activeView, completeView].forEach(v => {
    v.hidden = true;
    v.classList.remove('animate');
  });
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('animate'));
}

// ── Tick ───────────────────────────────────────────────────────────────────
function tick() {
  chrome.storage.local.get(['sprintEndTime', 'autoPaused', 'autoPausedAt', 'sprintDone'], (data) => {
    if (data.sprintDone) {
      stopTick();
      showComplete();
      return;
    }

    // Update timer
    if (data.autoPaused && data.autoPausedAt && data.sprintEndTime) {
      // Show frozen time remaining at the moment of auto-pause
      timerDisplay.textContent = formatMS(data.sprintEndTime - data.autoPausedAt);
      timerDisplay.classList.add('paused');
    } else if (data.sprintEndTime) {
      timerDisplay.textContent = formatMS(data.sprintEndTime - Date.now());
      timerDisplay.classList.remove('paused');
    }

    // Update status pill via live tab query
    if (!currentFocusSite) {
      statusPill.className = 'status-pill status-on-track';
      statusText.textContent = 'Focusing';
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const domain = tabs && tabs.length ? getDomain(tabs[0].url) : null;
      if (isSameSite(domain, currentFocusSite)) {
        statusPill.className = 'status-pill status-on-track';
        statusText.textContent = 'Focusing';
      } else {
        statusPill.className = 'status-pill status-drifted';
        statusText.textContent = 'You wandered off';
      }
    });
  });
}

function startTick() {
  stopTick();
  tick();
  tickInterval = setInterval(tick, 1000);
}

function stopTick() {
  if (tickInterval !== null) { clearInterval(tickInterval); tickInterval = null; }
}

// ── Setup view ─────────────────────────────────────────────────────────────
function showSetup() {
  stopTick();
  currentFocusSite = null;
  taskInput.value = '';
  startBtn.disabled = true;
  showView(setupView);
  setTimeout(() => taskInput.focus(), 60);
}

// ── Active view ────────────────────────────────────────────────────────────
function showActive(task, domain) {
  currentFocusSite = domain || null;
  activeTaskName.textContent = task;
  if (domain) {
    focusDomainEl.textContent = `on ${domain}`;
    focusDomainEl.hidden = false;
  } else {
    focusDomainEl.hidden = true;
  }
  timerDisplay.textContent = '--:--';
  timerDisplay.classList.remove('paused');
  showView(activeView);
  startTick();
}

// ── Complete view ──────────────────────────────────────────────────────────
function showComplete() {
  stopTick();
  chrome.storage.local.get(['task', 'sprintMins'], ({ task, sprintMins = 20 }) => {
    completeSummary.textContent = `${sprintMins} minutes on "${task}"`;
    selectedSprint = sprintMins;
  });
  showView(completeView);
}

// ── Session actions ────────────────────────────────────────────────────────
function beginSession() {
  const task = taskInput.value.trim();
  if (!task) return;

  startBtn.disabled = true;
  startBtn.textContent = 'Starting…';

  getCurrentDomain().then((domain) => {
    const ts = Date.now();
    chrome.storage.local.set({
      task,
      focusSite: domain,
      sprintMins: selectedSprint,
      sprintEndTime: ts + selectedSprint * 60000,
      startTime: ts,
      sprintDone: false,
      leftAt: null,
      lastNudgeAt: null,
      autoPaused: false,
      autoPausedAt: null,
    }, () => {
      chrome.runtime.sendMessage({ type: 'startFocus', focusSite: domain, sprintMins: selectedSprint }, () => {
        startBtn.textContent = 'Start focusing';
        showActive(task, domain);
      });
    });
  });
}

function endSession() {
  stopTick();
  chrome.storage.local.remove(
    ['task', 'focusSite', 'sprintMins', 'sprintEndTime', 'startTime',
     'leftAt', 'lastNudgeAt', 'autoPaused', 'autoPausedAt', 'sprintDone'],
    () => {
      chrome.runtime.sendMessage({ type: 'stopFocus' }, () => showSetup());
    }
  );
}

function anotherSprint() {
  chrome.storage.local.get(['task', 'focusSite', 'sprintMins'], ({ task, focusSite, sprintMins = 20 }) => {
    selectedSprint = sprintMins;
    const ts = Date.now();
    chrome.storage.local.set({
      sprintEndTime: ts + sprintMins * 60000,
      sprintDone: false,
      leftAt: null,
      lastNudgeAt: null,
      autoPaused: false,
      autoPausedAt: null,
    }, () => {
      chrome.runtime.sendMessage({ type: 'restartSprint', sprintMins }, () => {
        showActive(task, focusSite || null);
      });
    });
  });
}

// ── Event listeners ────────────────────────────────────────────────────────
taskInput.addEventListener('input', () => {
  startBtn.disabled = taskInput.value.trim().length === 0;
});
taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !startBtn.disabled) beginSession();
});
startBtn.addEventListener('click', beginSession);
endBtn.addEventListener('click', endSession);
anotherBtn.addEventListener('click', anotherSprint);
doneBtn.addEventListener('click', endSession);

// ── Boot: restore state ────────────────────────────────────────────────────
chrome.storage.local.get(
  ['task', 'focusSite', 'sprintDone'],
  ({ task, focusSite, sprintDone }) => {
    if (!task) {
      showSetup();
    } else if (sprintDone) {
      showComplete();
    } else {
      showActive(task, focusSite || null);
    }
  }
);
