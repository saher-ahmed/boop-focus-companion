// ── DOM refs ───────────────────────────────────────────────────────────────
const onboardView   = document.getElementById('onboard-view');
const onboardStep1  = document.getElementById('onboard-step-1');
const onboardStep2  = document.getElementById('onboard-step-2');
const onboardStep3  = document.getElementById('onboard-step-3');
const onboardNext1  = document.getElementById('onboard-next-1');
const onboardNext2  = document.getElementById('onboard-next-2');
const onboardFinish = document.getElementById('onboard-finish');
const setupView    = document.getElementById('setup-view');
const activeView   = document.getElementById('active-view');
const completeView = document.getElementById('complete-view');
const idleView     = document.getElementById('idle-view');
// Setup
const taskInput  = document.getElementById('task-input');
const startBtn   = document.getElementById('start-btn');
const sprintBtns = document.querySelectorAll('.sprint-btn');
// Active
const welcomeBack     = document.getElementById('welcome-back');
const welcomeBackText = document.getElementById('welcome-back-text');
const statusPill      = document.getElementById('status-pill');
const statusText      = document.getElementById('status-text');
const activeTaskName  = document.getElementById('active-task-name');
const focusDomainEl   = document.getElementById('focus-domain');
const timerDisplay    = document.getElementById('timer-display');
const sprintLabel     = document.getElementById('sprint-label');
const endBtn          = document.getElementById('end-btn');
// Complete
const completeHeading = document.getElementById('complete-heading');
const completeSubtext = document.getElementById('complete-subtext');
const completeSummary = document.getElementById('complete-summary');
const anotherBtn      = document.getElementById('another-btn');
const doneBtn         = document.getElementById('done-btn');
// Idle
const newSessionBtn   = document.getElementById('new-session-btn');
// Setup extras
const recentSessions  = document.getElementById('recent-sessions');
const resetBtn        = document.getElementById('reset-btn');

// ── State ──────────────────────────────────────────────────────────────────
let selectedSprint      = 20;
let currentFocusSite    = null;
let tickInterval        = null;
let lastTickWasDrifted  = false;   // for detecting drifted→focused transition
let welcomeBackTimer    = null;    // auto-hide timer for the banner

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
  [onboardView, setupView, activeView, completeView, idleView].forEach(v => {
    v.hidden = true;
    v.classList.remove('animate');
  });
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('animate'));
}

// ── Welcome-back banner (Bug 3) ────────────────────────────────────────────
function showWelcomeBack(leftAt) {
  const awayMs   = Date.now() - leftAt;
  const awayMins = Math.max(1, Math.round(awayMs / 60000));
  const label    = awayMins === 1 ? '1 minute' : `${awayMins} minutes`;
  welcomeBackText.textContent = `Welcome back! You were away for ${label}.`;
  welcomeBack.hidden = false;
  if (welcomeBackTimer) clearTimeout(welcomeBackTimer);
  welcomeBackTimer = setTimeout(() => { welcomeBack.hidden = true; }, 5000);
}

// ── Tick ───────────────────────────────────────────────────────────────────
// Bug 1 fix: query the active tab FIRST, then decide timer state and status
// together, so we can freeze the timer immediately on the same tick drift starts.
function tick() {
  chrome.storage.local.get(
    ['sprintEndTime', 'autoPaused', 'autoPausedAt', 'sprintDone', 'leftAt', 'totalDriftMs'],
    (data) => {
      if (data.sprintDone) {
        stopTick();
        showComplete();
        return;
      }

      // No focus site — always "focusing", timer just counts down
      if (!currentFocusSite) {
        if (data.sprintEndTime) {
          timerDisplay.textContent = formatMS(data.sprintEndTime - Date.now());
          timerDisplay.classList.remove('paused');
        }
        statusPill.className = 'status-pill status-on-track';
        statusText.textContent = 'Focusing';
        return;
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const domain = tabs && tabs.length ? getDomain(tabs[0].url) : null;
        const onSite = isSameSite(domain, currentFocusSite);

        if (onSite) {
          // ── On focus site ────────────────────────────────────────────────

          // Bug 3: detect the moment of returning from drift
          if (lastTickWasDrifted && data.leftAt) {
            showWelcomeBack(data.leftAt);
          }
          lastTickWasDrifted = false;

          statusPill.className = 'status-pill status-on-track';
          statusText.textContent = 'Focusing';
          timerDisplay.classList.remove('paused');

          // If autoPaused is still set we just returned from a drift. Extend
          // sprintEndTime immediately rather than waiting for the background
          // alarm (which only fires every 30s).
          if (data.autoPaused && data.autoPausedAt && data.sprintEndTime) {
            const now      = Date.now();
            const awayMs   = now - data.autoPausedAt;
            const newEnd   = data.sprintEndTime + awayMs;
            const remaining = (newEnd - now) / 60000;

            chrome.storage.local.set({
              autoPaused:   false,
              autoPausedAt: null,
              leftAt:       null,
              lastNudgeAt:  null,
              sprintEndTime: newEnd,
              totalDriftMs: (data.totalDriftMs || 0) + awayMs,
            });
            if (remaining > 0) {
              chrome.alarms.create('boop-sprint', { delayInMinutes: remaining });
            }
            chrome.notifications.clear('boop-drift');
            timerDisplay.textContent = formatMS(newEnd - now);
          } else if (data.sprintEndTime) {
            timerDisplay.textContent = formatMS(data.sprintEndTime - Date.now());
          }
        } else {
          // ── Drifting ─────────────────────────────────────────────────────
          lastTickWasDrifted = true;
          statusPill.className = 'status-pill status-drifted';
          statusText.textContent = 'You wandered off';

          if (!data.autoPaused) {
            // Bug 1: first tick detecting drift — immediately pause without
            // waiting for the 30-second background alarm.
            const now = Date.now();
            chrome.storage.local.set({
              autoPaused:   true,
              autoPausedAt: now,
              leftAt:       data.leftAt || now,
            });
            if (data.sprintEndTime) {
              timerDisplay.textContent = formatMS(data.sprintEndTime - now);
            }
          } else if (data.autoPausedAt && data.sprintEndTime) {
            // Already paused — keep displaying the frozen time
            timerDisplay.textContent = formatMS(data.sprintEndTime - data.autoPausedAt);
          }
          timerDisplay.classList.add('paused');
        }
      });
    }
  );
}

function startTick() {
  stopTick();
  lastTickWasDrifted = false;
  tick();
  tickInterval = setInterval(tick, 1000);
}

function stopTick() {
  if (tickInterval !== null) { clearInterval(tickInterval); tickInterval = null; }
}

// ── Onboarding ─────────────────────────────────────────────────────────────
function showOnboarding() {
  onboardStep1.hidden = false;
  onboardStep2.hidden = true;
  onboardStep3.hidden = true;
  showView(onboardView);
}

onboardNext1.addEventListener('click', () => {
  onboardStep1.hidden = true;
  onboardStep2.hidden = false;
});

onboardNext2.addEventListener('click', () => {
  onboardStep2.hidden = true;
  onboardStep3.hidden = false;
});

onboardFinish.addEventListener('click', () => {
  const finish = () => chrome.storage.local.set({ onboardingComplete: true }, showSetup);
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().finally(finish);
  } else {
    finish();
  }
});

// ── Recent sessions ────────────────────────────────────────────────────────
function formatSessionDate(ts) {
  const d     = new Date(ts);
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day   = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const time  = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (day === today)               return `Today, ${time}`;
  if (day === today - 86400000)    return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderRecentSessions() {
  chrome.storage.local.get(['sessionHistory'], ({ sessionHistory }) => {
    const history = Array.isArray(sessionHistory) ? sessionHistory : [];
    const recent  = history.slice(-3).reverse();

    if (recent.length === 0) { recentSessions.hidden = true; return; }

    recentSessions.hidden = false;
    recentSessions.innerHTML = '';

    const label = document.createElement('p');
    label.className   = 'recent-sessions-label';
    label.textContent = 'Recent sessions';
    recentSessions.appendChild(label);

    recent.forEach(entry => {
      const row      = document.createElement('div');
      row.className  = 'recent-session-row';

      const dateEl      = document.createElement('span');
      dateEl.className  = 'recent-session-date';
      dateEl.textContent = formatSessionDate(entry.date);

      const statsEl      = document.createElement('span');
      statsEl.className  = 'recent-session-stats';
      const sprintLabel  = entry.sprints === 1 ? '1 sprint' : `${entry.sprints} sprints`;
      const totalMins    = (entry.focusMins || 0) + (entry.driftMins || 0);
      statsEl.textContent = `${sprintLabel} · ${entry.score}/100 · ${totalMins} min`;

      row.appendChild(dateEl);
      row.appendChild(statsEl);
      recentSessions.appendChild(row);
    });
  });
}

// ── Setup view ─────────────────────────────────────────────────────────────
function showSetup() {
  stopTick();
  currentFocusSite = null;
  taskInput.value = '';
  startBtn.disabled = true;
  renderRecentSessions();
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
  welcomeBack.hidden = true;
  timerDisplay.textContent = '--:--';
  timerDisplay.classList.remove('paused');
  sprintLabel.textContent = 'Sprint 1';
  showView(activeView);
  startTick();
  chrome.storage.local.get(['sprintNumber'], ({ sprintNumber = 1 }) => {
    sprintLabel.textContent = `Sprint ${sprintNumber}`;
  });
}

// ── Complete view ──────────────────────────────────────────────────────────
function showComplete() {
  stopTick();
  chrome.storage.local.get(
    ['sprintMins', 'sessionSprintCount', 'sprintCounted', 'totalDriftMs',
     'sessionDriftMs', 'sessionFocusMs'],
    (data) => {
      const sprintMins = data.sprintMins || 20;
      let count       = data.sessionSprintCount || 0;
      let sessDriftMs = data.sessionDriftMs     || 0;
      let sessFocusMs = data.sessionFocusMs     || 0;

      if (!data.sprintCounted) {
        // Fold this sprint into the session running totals (runs once per sprint)
        const sprintMs      = sprintMins * 60000;
        const sprintDriftMs = Math.min(data.totalDriftMs || 0, sprintMs);
        const sprintFocusMs = sprintMs - sprintDriftMs;

        count       += 1;
        sessDriftMs += sprintDriftMs;
        sessFocusMs += sprintFocusMs;

        chrome.storage.local.set({
          sessionSprintCount: count,
          sessionDriftMs:     sessDriftMs,
          sessionFocusMs:     sessFocusMs,
          sprintCounted:      true,
        });
      }

      // Session-level score and display
      const totalMs     = sessFocusMs + sessDriftMs;
      const score       = totalMs > 0 ? Math.round(sessFocusMs / totalMs * 100) : 100;
      const focusMins   = Math.round(sessFocusMs / 60000);
      const driftMins   = Math.round(sessDriftMs / 60000);
      const sprintLabel = count === 1 ? '1 sprint' : `${count} sprints`;

      let heading;
      if (score >= 80)      { heading = 'Nice work!'; }
      else if (score >= 50) { heading = 'Not bad!'; }
      else                  { heading = 'Tough session.'; }

      completeHeading.textContent = heading;
      completeSubtext.textContent = `You did ${sprintLabel}. Overall focus: ${score}/100.`;
      completeSummary.textContent = `Focused: ${focusMins} min / Drifted: ${driftMins} min`;
      selectedSprint = sprintMins;
    }
  );
  showView(completeView);
}

// ── Idle view ──────────────────────────────────────────────────────────────
function showIdle() {
  stopTick();
  showView(idleView);
}

// ── Session actions ────────────────────────────────────────────────────────
function beginSession() {
  const task = taskInput.value.trim();
  if (!task) return;

  startBtn.disabled = true;
  startBtn.textContent = 'Starting…';

  getCurrentDomain().then((domain) => {
    const ts = Date.now();

    // The data to write for the fresh session — every key, nothing left ambiguous
    const freshData = {
      task,
      focusSite:          domain,
      sprintMins:         selectedSprint,
      sprintEndTime:      ts + selectedSprint * 60000,
      startTime:          ts,
      sprintDone:         false,
      leftAt:             null,
      lastNudgeAt:        null,
      autoPaused:         false,
      autoPausedAt:       null,
      totalDriftMs:       0,
      driftThresholdMs:   selectedSprint * 6000,
      sprintNumber:       1,
      sessionSprintCount: 0,
      sessionTotalMins:   0,
      sessionDriftMs:     0,
      sessionFocusMs:     0,
      sprintCounted:      false,
    };

    const launch = () => {
      chrome.storage.local.set(freshData, () => {
        chrome.runtime.sendMessage(
          { type: 'startFocus', focusSite: domain, sprintMins: selectedSprint },
          () => { startBtn.textContent = 'Start focusing'; showActive(task, domain); }
        );
      });
    };

    // Read previous session state BEFORE overwriting. If a meaningful session
    // exists (had a task and at least one sprint's worth of data), save it to
    // history first so it isn't silently lost.
    chrome.storage.local.get(
      ['task', 'sessionSprintCount', 'sessionDriftMs', 'sessionFocusMs',
       'sessionHistory', 'sprintCounted', 'totalDriftMs', 'sprintMins',
       'autoPaused', 'autoPausedAt'],
      (prev) => {
        const hadSession = prev.task &&
          ((prev.sessionSprintCount || 0) > 0 || (prev.sessionFocusMs || 0) > 0);

        if (!hadSession) { launch(); return; }

        // Fold in any in-progress sprint that hasn't been counted yet
        let focusMs = prev.sessionFocusMs || 0;
        let driftMs = prev.sessionDriftMs || 0;

        if (!prev.sprintCounted && prev.sprintMins) {
          const sprintMs   = prev.sprintMins * 60000;
          let sprintDrift  = prev.totalDriftMs || 0;
          if (prev.autoPaused && prev.autoPausedAt) {
            sprintDrift += Date.now() - prev.autoPausedAt;
          }
          sprintDrift  = Math.min(sprintDrift, sprintMs);
          driftMs     += sprintDrift;
          focusMs     += sprintMs - sprintDrift;
        }

        const total = focusMs + driftMs;
        const score = total > 0 ? Math.round(focusMs / total * 100) : 100;
        const entry = {
          date:      Date.now(),
          task:      prev.task,
          sprints:   prev.sessionSprintCount || 0,
          focusMins: Math.round(focusMs / 60000),
          driftMins: Math.round(driftMs / 60000),
          score,
        };

        const history = Array.isArray(prev.sessionHistory) ? prev.sessionHistory : [];
        history.push(entry);
        if (history.length > 50) history.splice(0, history.length - 50);

        chrome.storage.local.set({ sessionHistory: history }, launch);
      }
    );
  });
}

function endSession() {
  // Stop alarms. If currently drifting, capture that drift in totalDriftMs
  // before showing the complete screen so the feedback is accurate.
  stopTick();
  chrome.alarms.clear('boop-check');
  chrome.alarms.clear('boop-sprint');
  chrome.notifications.clear('boop-drift');
  chrome.notifications.clear('boop-sprint');

  chrome.storage.local.get(['autoPaused', 'autoPausedAt', 'totalDriftMs'], (data) => {
    const updates = { sprintDone: true };
    if (data.autoPaused && data.autoPausedAt) {
      updates.totalDriftMs = (data.totalDriftMs || 0) + (Date.now() - data.autoPausedAt);
    }
    chrome.storage.local.set(updates, showComplete);
  });
}

function takeBreak() {
  // Read session totals, write a history entry, then clear session keys.
  // sessionHistory is intentionally kept — it persists across sessions.
  chrome.storage.local.get(
    ['task', 'sessionSprintCount', 'sessionDriftMs', 'sessionFocusMs', 'sessionHistory'],
    (data) => {
      const focusMs = data.sessionFocusMs || 0;
      const driftMs = data.sessionDriftMs || 0;
      const total   = focusMs + driftMs;
      const score   = total > 0 ? Math.round(focusMs / total * 100) : 100;

      const entry = {
        date:      Date.now(),
        task:      data.task || '',
        sprints:   data.sessionSprintCount || 0,
        focusMins: Math.round(focusMs / 60000),
        driftMins: Math.round(driftMs / 60000),
        score,
      };

      const history = Array.isArray(data.sessionHistory) ? data.sessionHistory : [];
      history.push(entry);
      if (history.length > 50) history.splice(0, history.length - 50);

      chrome.storage.local.set({ sessionHistory: history }, () => {
        chrome.storage.local.remove(
          ['task', 'focusSite', 'sprintMins', 'sprintEndTime', 'startTime',
           'leftAt', 'lastNudgeAt', 'autoPaused', 'autoPausedAt', 'sprintDone',
           'totalDriftMs', 'driftThresholdMs', 'sprintNumber',
           'sessionDriftMs', 'sessionFocusMs',
           'sessionSprintCount', 'sessionTotalMins', 'sprintCounted'],
          showIdle
        );
      });
    }
  );
}

function anotherSprint() {
  chrome.storage.local.get(['task', 'focusSite', 'sprintMins', 'sprintNumber'], ({ task, focusSite, sprintMins = 20, sprintNumber = 1 }) => {
    selectedSprint = sprintMins;
    const ts = Date.now();
    chrome.storage.local.set({
      sprintEndTime:    ts + sprintMins * 60000,
      sprintDone:       false,
      leftAt:           null,
      lastNudgeAt:      null,
      autoPaused:       false,
      autoPausedAt:     null,
      totalDriftMs:     0,
      driftThresholdMs: sprintMins * 6000,
      sprintNumber:     sprintNumber + 1,
      sprintCounted:    false,
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
doneBtn.addEventListener('click', takeBreak);
newSessionBtn.addEventListener('click', showSetup);
resetBtn.addEventListener('click', () => {
  if (window.confirm('Clear all Boop data?')) {
    chrome.storage.local.clear(() => window.location.reload());
  }
});

// ── Boot: restore state ────────────────────────────────────────────────────
chrome.storage.local.get(
  ['task', 'focusSite', 'sprintDone', 'onboardingComplete'],
  ({ task, focusSite, sprintDone, onboardingComplete }) => {
    if (!onboardingComplete) {
      showOnboarding();
    } else if (!task) {
      showSetup();
    } else if (sprintDone) {
      showComplete();
    } else {
      showActive(task, focusSite || null);
    }
  }
);
