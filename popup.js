// ── DOM refs ───────────────────────────────────────────────────────────────
const setupView      = document.getElementById('setup-view');
const activeView     = document.getElementById('active-view');
// Setup
const taskInput      = document.getElementById('task-input');
const startBtn       = document.getElementById('start-btn');
// Active
const driftPill      = document.getElementById('drift-pill');
const driftText      = document.getElementById('drift-text');
const activeTaskName = document.getElementById('active-task-name');
const focusSiteDisp  = document.getElementById('focus-site-display');
const sessionTimer   = document.getElementById('session-timer');
const checkinCdown   = document.getElementById('checkin-countdown');
const switchInput    = document.getElementById('switch-input');
const switchBtn      = document.getElementById('switch-btn');
const endBtn         = document.getElementById('end-btn');
// Parked
const parkedSection  = document.getElementById('parked-section');
const parkedCount    = document.getElementById('parked-count');
const parkedList     = document.getElementById('parked-list');

// ── State ──────────────────────────────────────────────────────────────────
let tickInterval     = null;
let startTime        = null;
let currentFocusSite = null;

// ── Formatting ────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

function formatHMS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function formatMSCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
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

function getCurrentDomain() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) { resolve(null); return; }
      resolve(getDomain(tabs[0].url));
    });
  });
}

// ── Drift pill ─────────────────────────────────────────────────────────────
function updateDriftPill(driftStart) {
  if (!currentFocusSite) {
    driftPill.className = 'drift-pill drift-on-track';
    driftText.textContent = 'Focusing';
    return;
  }
  if (driftStart) {
    const elapsed = Date.now() - driftStart;
    driftPill.className = 'drift-pill drift-away';
    driftText.textContent = `Away for ${formatDriftTime(elapsed)}`;
  } else {
    driftPill.className = 'drift-pill drift-on-track';
    driftText.textContent = 'On track';
  }
}

// ── Tick ───────────────────────────────────────────────────────────────────
function tick() {
  if (startTime !== null) {
    sessionTimer.textContent = formatHMS(Date.now() - startTime);
  }
  chrome.alarms.get('boop-checkin', (alarm) => {
    if (alarm) {
      checkinCdown.textContent =
        `Next check-in in ${formatMSCountdown(alarm.scheduledTime - Date.now())}`;
    }
  });
  chrome.storage.local.get('driftStart', ({ driftStart }) => {
    updateDriftPill(driftStart ?? null);
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
  startTime = null;
  currentFocusSite = null;
  showView(setupView);
  taskInput.value = '';
  startBtn.disabled = true;
  setTimeout(() => taskInput.focus(), 60);
}

function showActive(task, ts, parked = [], focusSite = null) {
  startTime = ts;
  currentFocusSite = focusSite || null;
  activeTaskName.textContent = task;
  switchInput.value = '';
  switchBtn.disabled = true;

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
async function beginSession() {
  const task = taskInput.value.trim();
  if (!task) return;

  const ts = Date.now();
  startBtn.disabled = true;
  startBtn.textContent = 'Starting…';

  const domain = await getCurrentDomain();

  chrome.storage.local.set({ task, startTime: ts, parked: [], focusSite: domain, driftStart: null }, () => {
    chrome.runtime.sendMessage({ type: 'startFocus', focusSite: domain }, () => {
      startBtn.textContent = 'Start Focus';
      showActive(task, ts, [], domain);
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
    chrome.storage.local.set({ task: newTask, startTime: ts, parked, focusSite: domain, driftStart: null }, () => {
      chrome.runtime.sendMessage({ type: 'startFocus', focusSite: domain }, () => {
        showActive(newTask, ts, parked, domain);
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

    const ts = Date.now() - target.elapsed;

    chrome.storage.local.set({ task: target.name, startTime: ts, parked, focusSite: domain, driftStart: null }, () => {
      chrome.runtime.sendMessage({ type: 'startFocus', focusSite: domain }, () => {
        showActive(target.name, ts, parked, domain);
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
  chrome.storage.local.remove(['task', 'startTime', 'parked', 'focusSite', 'driftStart'], () => {
    chrome.runtime.sendMessage({ type: 'stopFocus' }, () => showSetup());
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
  ['task', 'startTime', 'parked', 'focusSite', 'openSetupOnLoad'],
  ({ task, startTime: ts, parked = [], focusSite, openSetupOnLoad }) => {
    if (openSetupOnLoad) {
      chrome.storage.local.remove('openSetupOnLoad');
      showSetup();
      renderParked(parked);
    } else if (task && ts) {
      showActive(task, ts, parked, focusSite || null);
    } else {
      showSetup();
    }
  }
);
