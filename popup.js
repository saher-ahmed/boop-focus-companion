// ── DOM refs ───────────────────────────────────────────────────────────────
const setupView      = document.getElementById('setup-view');
const activeView     = document.getElementById('active-view');
// Setup
const taskInput      = document.getElementById('task-input');
const startBtn       = document.getElementById('start-btn');
// Active
const activeTaskName = document.getElementById('active-task-name');
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
let tickInterval = null;
let startTime    = null;

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

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  showView(setupView);
  taskInput.value = '';
  startBtn.disabled = true;
  setTimeout(() => taskInput.focus(), 60);
}

function showActive(task, ts, parked = []) {
  startTime = ts;
  activeTaskName.textContent = task;
  switchInput.value = '';
  switchBtn.disabled = true;
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

  chrome.storage.local.set({ task, startTime: ts, parked: [] }, () => {
    chrome.runtime.sendMessage({ type: 'startFocus' }, () => {
      startBtn.textContent = 'Start Focus';
      showActive(task, ts, []);
    });
  });
}

function switchTask() {
  const newTask = switchInput.value.trim();
  if (!newTask) return;

  chrome.storage.local.get(['task', 'startTime', 'parked'], (data) => {
    const parked = [...(data.parked || [])];

    // Park the current task with its elapsed time
    if (data.task) {
      const elapsed = Date.now() - (data.startTime || Date.now());
      parked.push({ name: data.task, elapsed });
    }

    const ts = Date.now();
    chrome.storage.local.set({ task: newTask, startTime: ts, parked }, () => {
      chrome.runtime.sendMessage({ type: 'startFocus' }, () => {
        showActive(newTask, ts, parked);
      });
    });
  });
}

function resumeParked(index) {
  chrome.storage.local.get(['task', 'startTime', 'parked'], (data) => {
    const parked = [...(data.parked || [])];
    const target = parked[index];
    if (!target) return;

    // Remove target from parked list
    parked.splice(index, 1);

    // Park the currently active task
    if (data.task) {
      const elapsed = Date.now() - (data.startTime || Date.now());
      parked.push({ name: data.task, elapsed });
    }

    // Adjust startTime so the timer continues from where the task was parked
    const ts = Date.now() - target.elapsed;

    chrome.storage.local.set({ task: target.name, startTime: ts, parked }, () => {
      chrome.runtime.sendMessage({ type: 'startFocus' }, () => {
        showActive(target.name, ts, parked);
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
  chrome.storage.local.remove(['task', 'startTime', 'parked'], () => {
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
chrome.storage.local.get(['task', 'startTime', 'parked'], ({ task, startTime: ts, parked = [] }) => {
  if (task && ts) {
    showActive(task, ts, parked);
  } else {
    showSetup();
  }
});
