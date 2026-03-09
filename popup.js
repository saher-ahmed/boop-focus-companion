console.log('[focboost] popup.js loaded');

// ── Constants ──────────────────────────────────────────────────────────────
const PLACEHOLDERS = [
  "Finishing the pitch deck...",
  "Drafting the weekly report...",
  "Reviewing pull requests...",
  "Polishing landing page copy...",
  "Writing project specs..."
];

// ── State ──────────────────────────────────────────────────────────────────
let currentDifficulty = 'Medium';
let currentDuration = 20;
let sessionTimer = null;

// ── Elements ───────────────────────────────────────────────────────────────
const views = {
  home: document.getElementById('home-view'),
  commitment: document.getElementById('commitment-view'),
  timer: document.getElementById('timer-view'),
  result: document.getElementById('result-view'),
  weekly: document.getElementById('weekly-view'),
  settings: document.getElementById('settings-view')
};

const homeElements = {
  taskInput: document.getElementById('task-input'),
  difficultyPills: document.querySelectorAll('#difficulty-pills .pill-btn'),
  durationPills: document.querySelectorAll('#duration-pills .pill-btn'),
  customDuration: document.getElementById('custom-duration'),
  startBtn: document.getElementById('start-btn'),
  recentList: document.getElementById('recent-sessions-list'),
  settingsTrigger: document.getElementById('settings-trigger')
};

const commitmentElements = {
  task: document.getElementById('commitment-task'),
  duration: document.getElementById('commitment-duration'),
  check: document.getElementById('commitment-check'),
  confirmBtn: document.getElementById('confirm-commitment-btn')
};

const timerElements = {
  taskLabel: document.getElementById('active-task-label'),
  countdown: document.getElementById('timer-countdown'),
  status: document.getElementById('timer-status'),
  ring: document.getElementById('timer-ring-progress'),
  pauseResumeBtn: document.getElementById('pause-resume-btn'),
  endSessionBtn: document.getElementById('end-session-btn'),
  distractionBtn: document.getElementById('distraction-btn'),
  distractionCnt: document.getElementById('distraction-count')
};

const weeklyElements = {
  totalTime: document.getElementById('total-focus-time'),
  avgScore: document.getElementById('avg-focus-score'),
  chart: document.getElementById('weekly-chart'),
  trend: document.getElementById('weekly-trend'),
  backBtn: document.getElementById('weekly-back-btn')
};

const settingsElements = {
  blockedList: document.getElementById('settings-blocked-list'),
  addInput: document.getElementById('add-site-input'),
  addBtn: document.getElementById('add-site-btn'),
  backBtn: document.getElementById('settings-back-btn'),
  notifToggle: document.getElementById('notifications-toggle'),
  autopauseToggle: document.getElementById('autopause-toggle')
};

// ── Initialization ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initPlaceholders();
  initPills();
  initRecentSessions();
  initCommitment();

  // Check current state
  chrome.runtime.sendMessage({ type: 'getState' }, (state) => {
    if (state && state.isActive && !state.sprintDone) {
      showView('timer');
      startTimerLoop();
    } else {
      showView('home');
    }
  });

  // Action listeners
  timerElements.pauseResumeBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'getState' }, (state) => {
      chrome.runtime.sendMessage({ type: state.isPaused ? 'resumeFocus' : 'pauseFocus' });
    });
  });

  timerElements.endSessionBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'stopFocus' });
  });

  timerElements.distractionBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'logDistraction' });
  });

  document.getElementById('done-btn').addEventListener('click', () => {
    showView('home');
  });

  document.getElementById('view-weekly-btn').addEventListener('click', () => {
    renderWeeklyInsights();
    showView('weekly');
  });

  weeklyElements.backBtn.addEventListener('click', () => {
    showView('result');
  });

  homeElements.settingsTrigger.addEventListener('click', () => {
    initSettings();
    showView('settings');
  });

  settingsElements.backBtn.addEventListener('click', () => {
    showView('home');
  });
});

// ... inside renderWeeklyInsights function ...
async function renderWeeklyInsights() {
  const data = await chrome.storage.local.get(['history']);
  const history = data.history || [];

  // Last 7 days
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekSessions = history.filter(s => new Date(s.endTime) > weekAgo);

  // Stats
  const totalMins = weekSessions.reduce((acc, s) => acc + (s.duration || 0), 0);
  const avgScore = weekSessions.length > 0
    ? Math.round(weekSessions.reduce((acc, s) => acc + (s.finalScore || 0), 0) / weekSessions.length)
    : 0;

  weeklyElements.totalTime.textContent = `${Math.floor(totalMins / 60)}h ${totalMins % 60}m`;
  weeklyElements.avgScore.textContent = avgScore;

  // Chart
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dailyScores = [0, 0, 0, 0, 0, 0, 0];
  const dailyCounts = [0, 0, 0, 0, 0, 0, 0];

  weekSessions.forEach(s => {
    const d = new Date(s.endTime);
    // getDay() returns 0 for Sunday, 1 for Monday... 
    // We want 0 for Monday (1), 6 for Sunday (0)
    let idx = d.getDay() - 1;
    if (idx === -1) idx = 6;
    dailyScores[idx] += (s.finalScore || 0);
    dailyCounts[idx] += 1;
  });

  weeklyElements.chart.innerHTML = '';
  const todayIdx = (new Date().getDay() - 1 + 7) % 7;

  dailyScores.forEach((total, i) => {
    const avg = dailyCounts[i] > 0 ? total / dailyCounts[i] : 0;
    const bar = document.createElement('div');
    bar.className = 'chart-bar' + (i === todayIdx ? ' today' : '');
    bar.style.height = `${avg}%`;
    weeklyElements.chart.appendChild(bar);
  });

  // Trend
  if (weekSessions.length > 2) {
    const firstHalf = weekSessions.slice(0, Math.floor(weekSessions.length / 2));
    const secondHalf = weekSessions.slice(Math.floor(weekSessions.length / 2));
    const avg1 = firstHalf.reduce((a, s) => a + s.finalScore, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((a, s) => a + s.finalScore, 0) / secondHalf.length;

    if (avg2 > avg1) {
      weeklyElements.trend.textContent = "Your focus is improving! Great momentum.";
    } else {
      weeklyElements.trend.textContent = "Focus slightly dipped. Try shorter sprints.";
    }
  } else {
    weeklyElements.trend.textContent = "Complete more sessions to see focus trends.";
  }
}

// ── View Management ────────────────────────────────────────────────────────
function showView(viewId) {
  Object.keys(views).forEach(v => {
    if (views[v]) {
      views[v].hidden = (v !== viewId);
    }
  });
}

// ── Home Screen Logic ──────────────────────────────────────────────────────
function initPlaceholders() {
  let i = 0;
  setInterval(() => {
    i = (i + 1) % PLACEHOLDERS.length;
    if (homeElements.taskInput) {
      homeElements.taskInput.placeholder = PLACEHOLDERS[i];
    }
  }, 4000);
}

function initPills() {
  // Difficulty
  homeElements.difficultyPills.forEach(pill => {
    pill.addEventListener('click', () => {
      homeElements.difficultyPills.forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      currentDifficulty = pill.dataset.value;
    });
  });

  // Duration
  homeElements.durationPills.forEach(pill => {
    pill.addEventListener('click', () => {
      homeElements.durationPills.forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      currentDuration = parseInt(pill.dataset.value);
      homeElements.customDuration.value = '';
      validateStart();
    });
  });

  homeElements.customDuration.addEventListener('input', () => {
    homeElements.durationPills.forEach(p => p.classList.remove('selected'));
    currentDuration = parseInt(homeElements.customDuration.value) || 0;
    validateStart();
  });

  homeElements.taskInput.addEventListener('input', validateStart);
}

function validateStart() {
  const task = homeElements.taskInput.value.trim();
  homeElements.startBtn.disabled = !(task.length > 0 && currentDuration > 0);
}

homeElements.startBtn.addEventListener('click', () => {
  commitmentElements.task.textContent = homeElements.taskInput.value.trim();
  commitmentElements.duration.textContent = currentDuration;
  commitmentElements.check.checked = false;
  commitmentElements.confirmBtn.disabled = true;
  showView('commitment');
});

// ── Commitment Logic ───────────────────────────────────────────────────────
function initCommitment() {
  commitmentElements.check.addEventListener('change', () => {
    commitmentElements.confirmBtn.disabled = !commitmentElements.check.checked;
  });

  commitmentElements.confirmBtn.addEventListener('click', () => {
    const task = homeElements.taskInput.value.trim();
    chrome.runtime.sendMessage({
      type: 'startFocus',
      task,
      difficulty: currentDifficulty,
      duration: currentDuration,
      blockedSites: ['youtube.com', 'twitter.com', 'facebook.com', 'reddit.com']
    }, () => {
      showView('timer');
      startTimerLoop();
    });
  });
}

// ── Timer Loop ─────────────────────────────────────────────────────────────
function startTimerLoop() {
  if (sessionTimer) clearInterval(sessionTimer);

  sessionTimer = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'getState' }, (state) => {
      if (!state || !state.isActive || state.sprintDone) {
        clearInterval(sessionTimer);
        if (state && state.sprintDone) showResult(state);
        return;
      }
      updateTimerUI(state);
    });
  }, 1000);
}

function updateTimerUI(state) {
  timerElements.taskLabel.textContent = state.task;

  const now = Date.now();
  const total = state.endTime - state.startTime;
  const remaining = Math.max(0, state.endTime - now);

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  timerElements.countdown.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

  const progress = 1 - (remaining / total);
  const offset = 502.4 * progress;
  timerElements.ring.style.strokeDashoffset = offset;

  timerElements.pauseResumeBtn.textContent = state.isPaused ? 'Resume' : 'Pause';
  timerElements.distractionCnt.textContent = state.distractions || 0;
}

// ── Result View ────────────────────────────────────────────────────────────
function showResult(state) {
  showView('result');
  document.getElementById('score-badge').textContent = state.finalScore || 100;
  document.getElementById('session-summary').textContent = `${state.duration} min · ${state.distractions || 0} distractions · ${state.pauses || 0} pauses`;

  const checklist = document.getElementById('post-commitment-list');
  checklist.innerHTML = '';

  const items = [
    "I stayed on the task",
    "I didn't open distracting sites",
    "I kept my breathing steady"
  ];

  items.forEach(text => {
    const label = document.createElement('label');
    label.className = 'check-item';
    label.innerHTML = `
      <input type="checkbox" />
      <span>${text}</span>
    `;
    checklist.appendChild(label);
  });

  saveToHistory(state);
}

// ── History & Recent Sessions ──────────────────────────────────────────────
async function initRecentSessions() {
  const data = await chrome.storage.local.get(['history']);
  const history = data.history || [];

  homeElements.recentList.innerHTML = '';
  if (history.length === 0) {
    homeElements.recentList.innerHTML = '<p class="recent-meta" style="text-align:center; padding: 20px 0;">No sessions yet.</p>';
    return;
  }

  history.slice(-3).reverse().forEach(session => {
    const row = document.createElement('div');
    row.className = 'recent-row';
    row.innerHTML = `
      <div class="recent-main">
        <p class="recent-task">${session.task}</p>
        <p class="recent-meta">${new Date(session.endTime).toLocaleDateString()} · ${session.duration}m</p>
      </div>
      <div class="recent-score">${session.finalScore}</div>
    `;
    homeElements.recentList.appendChild(row);
  });
}

async function initSettings() {
  const data = await chrome.storage.local.get(['blockedSites', 'settings']);
  let blocked = data.blockedSites || ['youtube.com', 'twitter.com', 'facebook.com', 'reddit.com'];
  let settings = data.settings || { notifications: true, autopause: true };

  renderBlockedTags(blocked);

  settingsElements.notifToggle.checked = settings.notifications;
  settingsElements.autopauseToggle.checked = settings.autopause;

  settingsElements.addBtn.onclick = async () => {
    const site = settingsElements.addInput.value.trim().toLowerCase();
    if (site && !blocked.includes(site)) {
      blocked.push(site);
      await chrome.storage.local.set({ blockedSites: blocked });
      renderBlockedTags(blocked);
      settingsElements.addInput.value = '';
    }
  };

  settingsElements.notifToggle.onchange = () => saveSettings();
  settingsElements.autopauseToggle.onchange = () => saveSettings();

  function saveSettings() {
    chrome.storage.local.set({
      settings: {
        notifications: settingsElements.notifToggle.checked,
        autopause: settingsElements.autopauseToggle.checked
      }
    });
  }
}

function renderBlockedTags(blocked) {
  settingsElements.blockedList.innerHTML = '';
  blocked.forEach(site => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `
      <span>${site}</span>
      <span class="tag-remove" data-site="${site}">&times;</span>
    `;
    tag.querySelector('.tag-remove').onclick = async () => {
      const newBlocked = blocked.filter(s => s !== site);
      await chrome.storage.local.set({ blockedSites: newBlocked });
      renderBlockedTags(newBlocked);
    };
    settingsElements.blockedList.appendChild(tag);
  });
}

async function saveToHistory(state) {
  const data = await chrome.storage.local.get(['history']);
  const history = data.history || [];
  if (history.length > 0 && history[history.length - 1].task === state.task && history[history.length - 1].endTime > Date.now() - 5000) return;

  history.push({
    task: state.task,
    endTime: Date.now(),
    duration: state.duration,
    finalScore: state.finalScore
  });
  if (history.length > 50) history.shift();
  await chrome.storage.local.set({ history });
  initRecentSessions();
}
