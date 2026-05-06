'use strict';

const API = 'https://hr.digitalleapmarketing.com/api';

// ── In-memory activity state ──────────────────────────────────────────────────
// Tracks whether the user had any interaction since the last 1-min poll.
// Persisted per-poll via chrome.storage.session (cleared on browser restart).
let hadActivityThisMinute = false;

// ── Message handlers ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'USER_ACTIVITY') {
    // Content script saw an interaction — flag this minute as active
    hadActivityThisMinute = true;
  }
  if (msg.type === 'SETUP_ALARM') {
    setupDailyReminder(msg.shiftStart);
    // Start the activity polling alarm (every minute, while extension is in use)
    setupActivityAlarm();
  }
  if (msg.type === 'CLEAR_ALARM') {
    chrome.alarms.clearAll();
    hadActivityThisMinute = false;
  }
});

// ── Activity polling alarm (every 1 minute) ───────────────────────────────────
function setupActivityAlarm() {
  chrome.alarms.get('activityPoll', (existing) => {
    if (!existing) {
      chrome.alarms.create('activityPoll', { periodInMinutes: 1 });
    }
  });
}

// ── Daily shift-start reminder alarm ─────────────────────────────────────────
function setupDailyReminder(shiftStart) {
  chrome.alarms.clear('clockInReminder', () => {
    const [h, m] = (shiftStart || '09:00').split(':').map(Number);
    const IST_OFFSET = 5.5 * 60; // minutes
    const nowUTC     = Date.now();
    const todayIST   = new Date(nowUTC + IST_OFFSET * 60 * 1000);
    todayIST.setUTCHours(h, m, 0, 0);
    let fireAt = todayIST.getTime() - IST_OFFSET * 60 * 1000;
    if (fireAt <= nowUTC) fireAt += 24 * 60 * 60 * 1000;
    chrome.alarms.create('clockInReminder', {
      when: fireAt,
      periodInMinutes: 24 * 60,
    });
  });
}

// ── Alarm dispatcher ──────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {

  if (alarm.name === 'activityPoll') {
    await handleActivityPoll();
    return;
  }

  if (alarm.name === 'clockInReminder') {
    await handleShiftReminder();
  }
});

// ── Handle 1-minute activity poll ────────────────────────────────────────────
async function handleActivityPoll() {
  const stored = await chrome.storage.local.get(['employee']);
  if (!stored.employee) return; // not logged in

  // Also check using the idle API for system-level inactivity
  // (covers cases where user is in another app, not just browser-idle)
  const idleState = await new Promise(resolve =>
    chrome.idle.queryState(60, resolve) // 60s threshold
  );
  // Combine: active if either browser events were detected OR system is active
  const isActive = hadActivityThisMinute || idleState === 'active';

  // Reset flag for next minute
  hadActivityThisMinute = false;

  try {
    await fetch(`${API}/attendance/activity`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ employee_id: stored.employee.id, active: isActive }),
    });
  } catch {
    // Network error — non-fatal, data will be slightly under-counted
  }
}

// ── Handle shift-start reminder ───────────────────────────────────────────────
async function handleShiftReminder() {
  const stored = await chrome.storage.local.get(['employee']);
  if (!stored.employee) return;
  try {
    const res  = await fetch(`${API}/attendance/today?employee_id=${stored.employee.id}`);
    const data = await res.json();
    if (data.is_clocked_in || data.is_clocked_out || data.has_biometric) return;
    const isWfh = data.wfh_today;
    chrome.notifications.create('shiftReminder', {
      type:    'basic',
      iconUrl: 'https://hr.digitalleapmarketing.com/favicon.png',
      title:   isWfh ? '🏠 WFH Reminder — Clock In' : '⏰ Shift Start Reminder',
      message: isWfh
        ? 'You have an approved WFH today — please clock in to start recording your hours.'
        : 'Your shift has started. Open the Digital Leap HRMS extension to clock in.',
      priority: 2,
    });
  } catch { /* ignore */ }
}

// ── On install / startup ──────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['employee']);
  if (stored.employee) {
    setupDailyReminder('09:00');
    setupActivityAlarm();
  }
});

// Also restart activity alarm on browser startup (service worker may have been killed)
chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get(['employee']);
  if (stored.employee) setupActivityAlarm();
});
