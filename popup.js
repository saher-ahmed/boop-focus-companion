// ── DOM refs ───────────────────────────────────────────────────────────────
const setupView      = document.getElementById('setup-view');
const activeView     = document.getElementById('active-view');
// Setup
const taskInput      = document.getElementById('task-input');
const startBtn       = document.getElementById('start-btn');
const sprintBtns     = document.querySelectorAll('.sprint-btn');
const detectedSiteEl = document.getElementById('detected-site');
// Active
const driftPill      = document.getElementById('drift-pill');
const driftText      = document.getElementById('drift-text');
const activeTaskName = document.getElementById('active-task-name');
const focusSiteDisp  = document.getElementById('focus-site-display');
const timerCard      = document.getElementById('timer-card');
const sessionTimer   = document.getElementById('session-timer');
const sprintCounter  = document.getElementById('sprint-counter');
const switchInput    = document.getElementById('switch-input');
const switchBtn      = document.getElementById('switch-btn');
const pauseBtn       = document.getElementById('pause-btn');
const endBtn         = document.getElementById('end-btn');
// Parked
const parkedSection  = document.getElementById('parked-section');
const parkedCount    = document.getElementById('parked-count');
const parkedList     = document.getElementById('parked-list');

// ── Alarm constants (for popup-side alarm management) ──────────────────────
const ALARM_SPRINT      = 'boop-sprint';
const ALARM_DRIFT_CHECK = 'boop-drift-check';

// ── State ──────────────────────────────────────────────────────────────────
let tickInterval     = null;
let currentFocusSite = null;
let selectedSprint   = 20;
let isPaused         = false;
let detectedDomain   = null;

// ── Formatting ────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

function formatMS(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

function formatElapsed(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1)  return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDriftTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${pad(sec)}`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function getCurrentDomain() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) { resolve(null); return; }
      resolve(getDomain(tabs[0].url));
    });
  });
}

function showDetectedSite(domain) {
  detectedDomain = domain;
  if (domain) {
    detectedSiteEl.textContent = `focusing on ${domain}`;
    detectedSiteEl.hidden = false;
  } else {
    detectedSiteEl.hidden = true;
  }
}

// ── Sprint picker ──────────────────────────────────────────────────────────
sprintBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    sprintBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedSprint = parseInt(btn.dataset.mins);
  });
});

// ── Drift pill ─────────────────────────────────────────────────────────────
// isOnFocusSite: live result from tab query (not lagged storage value)
function updateDriftPill(leftAt, paused, isOnFocusSite) {
  if (paused) {
    driftPill.className = 'drift-pill drift-paused';
    driftText.textContent = 'Paused';
    return;
  }
  if (!currentFocusSite) {
    driftPill.className = 'drift-pill drift-on-track';
    driftText.textContent = 'Focusing';
    return;
  }
  if (!isOnFocusSite) {
    driftPill.className = 'drift-pill drift-away';
    const elapsed = leftAt ? Date.now() - leftAt : 0;
    driftText.textContent = elapsed > 4000
      ? `Away · ${formatDriftTime(elapsed)}`
      : `Away from ${currentFocusSite}`;
    return;
  }
  driftPill.className = 'drift-pill drift-on-track';
  driftText.textContent = 'On track';
}

// ── Tick ───────────────────────────────────────────────────────────────────
function tick() {
  chrome.storage.local.get(['sprintEndTime', 'sprintCount', 'paused', 'leftAt'], (data) => {
    const paused = data.paused ?? false;

    // Sprint countdown
    if (!paused && data.sprintEndTime) {
      sessionTimer.textContent = formatMS(data.sprintEndTime - Date.now());
    }

    // Timer card paused visual state
    if (paused) {
      timerCard.classList.add('paused');
      pauseBtn.textContent = '▶';
      sprintCounter.textContent = 'Paused';
    } else {
      timerCard.classList.remove('paused');
      pauseBtn.textContent = '⏸';
      const displayCount = (data.sprintCount || 0) + 1;
      sprintCounter.textContent = `Sprint ${displayCount}`;
    }

    // Live tab query drives the drift pill (not the lagged leftAt value alone)
    if (paused || !currentFocusSite) {
      updateDriftPill(data.leftAt ?? null, paused, true);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const domain = tabs && tabs.length ? getDomain(tabs[0].url) : null;
      updateDriftPill(data.leftAt ?? null, false, isSameSite(domain, currentFocusSite));
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

// ── Pause / Resume ─────────────────────────────────────────────────────────
function pauseSession() {
  chrome.storage.local.set({ paused: true, pausedAt: Date.now() }, () => {
    chrome.alarms.clear(ALARM_SPRINT);
    chrome.alarms.clear(ALARM_DRIFT_CHECK);
    isPaused = true;
    pauseBtn.textContent = '▶';
    timerCard.classList.add('paused');
    sprintCounter.textContent = 'Paused';
    driftPill.className = 'drift-pill drift-paused';
    driftText.textContent = 'Paused';
  });
}

function resumeSession() {
  chrome.storage.local.get(['sprintEndTime', 'pausedAt'], ({ sprintEndTime, pausedAt }) => {
    const remaining = Math.max(0, sprintEndTime - pausedAt);
    const newEnd = Date.now() + remaining;
    chrome.storage.local.set({ paused: false, pausedAt: null, sprintEndTime: newEnd, leftAt: null }, () => {
      chrome.alarms.create(ALARM_SPRINT, { delayInMinutes: remaining / 60000 });
      chrome.alarms.create(ALARM_DRIFT_CHECK, { periodInMinutes: 0.5 });
      isPaused = false;
      pauseBtn.textContent = '⏸';
      timerCard.classList.remove('paused');
    });
  });
}

pauseBtn.addEventListener('click', () => isPaused ? resumeSession() : pauseSession());

// ── Parked tasks rendering ─────────────────────────────────────────────────
function renderParked(parked = []) {
  if (!parked.length) {
    parkedSection.hidden = true;
    return;
  }

  parkedSection.hidden = false;
  parkedCount.textContent = parked.length;
  parkedList.innerHTML = '';

  parked.forEach((item, index) => {
    const pill = document.createElement('div');
    pill.className = 'parked-pill';
    pill.title = item.name;
    pill.innerHTML = `
      <span class="parked-pill-name">${escapeHtml(item.name)}</span>
      <span class="parked-pill-time">${formatElapsed(item.elapsed)}</span>
      <span class="parked-dismiss" title="Dismiss">✕</span>
    `;

    pill.addEventListener('click', (e) => {
      if (e.target.closest('.parked-dismiss')) return;
      resumeParked(index);
    });

    pill.querySelector('.parked-dismiss').addEventListener('click', (e) => {
      e.stopPropagation();
      dismissParked(index);
    });

    parkedList.appendChild(pill);
  });
}

// ── View transitions ───────────────────────────────────────────────────────
function showView(el) {
  [setupView, activeView].forEach(v => {
    v.hidden = true;
    v.classList.remove('animate');
  });
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('animate'));
}

function showSetup() {
  stopTick();
  currentFocusSite = null;
  isPaused = false;
  detectedDomain = null;
  detectedSiteEl.hidden = true;
  showView(setupView);
  taskInput.value = '';
  startBtn.disabled = true;
  setTimeout(() => taskInput.focus(), 60);
  getCurrentDomain().then(showDetectedSite);
}

function showActive(task, parked = [], focusSite = null, paused = false) {
  currentFocusSite = focusSite || null;
  activeTaskName.textContent = task;
  switchInput.value = '';
  switchBtn.disabled = true;
  isPaused = paused;
  pauseBtn.textContent = paused ? '▶' : '⏸';
  if (paused) timerCard.classList.add('paused');
  else timerCard.classList.remove('paused');

  if (focusSite) {
    focusSiteDisp.textContent = `Focusing on ${focusSite}`;
    focusSiteDisp.hidden = false;
  } else {
    focusSiteDisp.hidden = true;
  }

  showView(activeView);
  renderParked(parked);
  startTick();
}

// ── Session actions ────────────────────────────────────────────────────────
function beginSession() {
  const task = taskInput.value.trim();
  if (!task) return;

  const ts = Date.now();
  startBtn.disabled = true;
  startBtn.textContent = 'Starting…';

  const domain = detectedDomain;

  chrome.storage.local.set({
    task,
    startTime: ts,
    parked: [],
    focusSite: domain,
    leftAt: null,
    sprintMins: selectedSprint,
    sprintEndTime: ts + selectedSprint * 60000,
    sprintCount: 0,
    paused: false,
    pausedAt: null,
  }, () => {
    chrome.runtime.sendMessage({ type: 'startFocus', focusSite: domain, sprintMins: selectedSprint }, () => {
      startBtn.textContent = 'Start Focus';
      showActive(task, [], domain, false);
    });
  });
}

async function switchTask() {
  const newTask = switchInput.value.trim();
  if (!newTask) return;

  const domain = await getCurrentDomain();

  chrome.storage.local.get(['task', 'startTime', 'parked'], (data) => {
    const parked = [...(data.parked || [])];

    if (data.task) {
      const elapsed = Date.now() - (data.startTime || Date.now());
      parked.push({ name: data.task, elapsed });
    }

    const ts = Date.now();
    chrome.storage.local.set({
      task: newTask,
      startTime: ts,
      parked,
      focusSite: domain,
      leftAt: null,
      sprintMins: selectedSprint,
      sprintEndTime: ts + selectedSprint * 60000,
      sprintCount: 0,
      paused: false,
      pausedAt: null,
    }, () => {
      chrome.runtime.sendMessage({ type: 'startFocus', focusSite: domain, sprintMins: selectedSprint }, () => {
        showActive(newTask, parked, domain, false);
      });
    });
  });
}

async function resumeParked(index) {
  const domain = await getCurrentDomain();

  chrome.storage.local.get(['task', 'startTime', 'parked'], (data) => {
    const parked = [...(data.parked || [])];
    const target = parked[index];
    if (!target) return;

    parked.splice(index, 1);

    if (data.task) {
      const elapsed = Date.now() - (data.startTime || Date.now());
      parked.push({ name: data.task, elapsed });
    }

    const ts = Date.now();
    chrome.storage.local.set({
      task: target.name,
      startTime: ts,
      parked,
      focusSite: domain,
      leftAt: null,
      sprintMins: selectedSprint,
      sprintEndTime: ts + selectedSprint * 60000,
      sprintCount: 0,
      paused: false,
      pausedAt: null,
    }, () => {
      chrome.runtime.sendMessage({ type: 'startFocus', focusSite: domain, sprintMins: selectedSprint }, () => {
        showActive(target.name, parked, domain, false);
      });
    });
  });
}

function dismissParked(index) {
  chrome.storage.local.get('parked', ({ parked = [] }) => {
    parked.splice(index, 1);
    chrome.storage.local.set({ parked }, () => renderParked(parked));
  });
}

function endSession() {
  stopTick();
  chrome.storage.local.remove(
    ['task', 'startTime', 'parked', 'focusSite', 'leftAt', 'sprintMins', 'sprintEndTime', 'sprintCount', 'paused', 'pausedAt'],
    () => {
      chrome.runtime.sendMessage({ type: 'stopFocus' }, () => showSetup());
    }
  );
}

// ── Event listeners ────────────────────────────────────────────────────────
taskInput.addEventListener('input', () => {
  startBtn.disabled = taskInput.value.trim().length === 0;
});
taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !startBtn.disabled) beginSession();
});
startBtn.addEventListener('click', beginSession);

switchInput.addEventListener('input', () => {
  switchBtn.disabled = switchInput.value.trim().length === 0;
});
switchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !switchBtn.disabled) switchTask();
});
switchBtn.addEventListener('click', switchTask);

endBtn.addEventListener('click', endSession);

// ── Boot: restore state ────────────────────────────────────────────────────
chrome.storage.local.get(
  ['task', 'startTime', 'parked', 'focusSite', 'openSetupOnLoad', 'paused', 'sprintCount', 'sprintEndTime'],
  ({ task, startTime: ts, parked = [], focusSite, openSetupOnLoad, paused, sprintCount, sprintEndTime }) => {
    if (openSetupOnLoad) {
      chrome.storage.local.remove('openSetupOnLoad');
      showSetup();
      renderParked(parked);
    } else if (task && ts) {
      showActive(task, parked, focusSite || null, paused || false);
    } else {
      showSetup();
    }
  }
);
