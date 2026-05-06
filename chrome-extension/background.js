'use strict';

const API = 'https://hr.digitalleapmarketing.com/api';

// ── Fetch with timeout ────────────────────────────────────────────────────────
function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── In-memory activity state ──────────────────────────────────────────────────
let hadActivityThisMinute = false;

// ── Message handlers ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'USER_ACTIVITY') {
    hadActivityThisMinute = true;
  }
  if (msg.type === 'CLOCKED_IN') {
    // Only start activity polling AFTER a successful clock-in
    setupActivityAlarm();
    setupDailyReminder(msg.shiftStart);
  }
  if (msg.type === 'CLOCKED_OUT' || msg.type === 'CLEAR_ALARM') {
    // Stop activity polling when clocked out or logged out
    chrome.alarms.clear('activityPoll');
    hadActivityThisMinute = false;
  }
  if (msg.type === 'SETUP_ALARM') {
    // Legacy: just set up the daily reminder (no activity alarm here)
    setupDailyReminder(msg.shiftStart);
  }
});

// ── Activity polling alarm ────────────────────────────────────────────────────
function setupActivityAlarm() {
  chrome.alarms.get('activityPoll', (existing) => {
    if (!existing) {
      chrome.alarms.create('activityPoll', { periodInMinutes: 1 });
    }
  });
}

// ── Daily shift-start reminder ────────────────────────────────────────────────
function setupDailyReminder(shiftStart) {
  chrome.alarms.clear('clockInReminder', () => {
    const [h, m] = (shiftStart || '09:00').split(':').map(Number);
    const IST_OFFSET = 5.5 * 60;
    const nowUTC   = Date.now();
    const todayIST = new Date(nowUTC + IST_OFFSET * 60 * 1000);
    todayIST.setUTCHours(h, m, 0, 0);
    let fireAt = todayIST.getTime() - IST_OFFSET * 60 * 1000;
    if (fireAt <= nowUTC) fireAt += 24 * 60 * 60 * 1000;
    chrome.alarms.create('clockInReminder', { when: fireAt, periodInMinutes: 24 * 60 });
  });
}

// ── Alarm dispatcher ──────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'activityPoll')   { await handleActivityPoll(); return; }
  if (alarm.name === 'clockInReminder'){ await handleShiftReminder(); }
});

// ── Activity poll handler ─────────────────────────────────────────────────────
async function handleActivityPoll() {
  const stored = await chrome.storage.local.get(['employee']);
  if (!stored.employee) {
    // Not logged in — no activity to track, stop the alarm
    chrome.alarms.clear('activityPoll');
    return;
  }

  // Check system idle state (covers activity in non-browser apps too)
  const idleState = await new Promise(resolve => chrome.idle.queryState(60, resolve));
  const isActive  = hadActivityThisMinute || idleState === 'active';
  hadActivityThisMinute = false; // reset for next minute

  // Verify there is actually an open session before reporting activity
  // (avoids reporting activity after clock-out if alarm fires late)
  try {
    const res  = await fetchWithTimeout(`${API}/attendance/today?employee_id=${stored.employee.id}`);
    const data = await res.json();
    if (!data.has_active_session) {
      // No open session — stop polling to avoid unnecessary API calls
      chrome.alarms.clear('activityPoll');
      return;
    }
    // Report activity
    await fetchWithTimeout(`${API}/attendance/activity`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ employee_id: stored.employee.id, active: isActive }),
    });
  } catch {
    // Network error or timeout — non-fatal, data will be slightly under-counted
  }
}

// ── Shift-start reminder handler ──────────────────────────────────────────────
async function handleShiftReminder() {
  const stored = await chrome.storage.local.get(['employee']);
  if (!stored.employee) return;
  try {
    const res  = await fetchWithTimeout(`${API}/attendance/today?employee_id=${stored.employee.id}`);
    const data = await res.json();
    if (data.is_clocked_in || data.is_clocked_out || data.has_biometric) return;
    const isWfh = data.wfh_today;
    chrome.notifications.create('shiftReminder', {
      type:     'basic',
      iconUrl:  'https://hr.digitalleapmarketing.com/favicon.png',
      title:    isWfh ? '🏠 WFH Reminder — Clock In' : '⏰ Shift Start Reminder',
      message:  isWfh
        ? 'You have an approved WFH today — please clock in to start recording your hours.'
        : 'Your shift has started. Open the Digital Leap HRMS extension to clock in.',
      priority: 2,
    });
  } catch { /* network error — skip notification */ }
}

// ── On install / startup ──────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['employee']);
  if (stored.employee) {
    setupDailyReminder('09:00');
    // Only restart activity alarm if there might be an active session
    // (handles extension update/reinstall mid-session)
    setupActivityAlarm();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get(['employee']);
  if (stored.employee) {
    // Restart activity alarm on browser startup (service worker gets killed on restart)
    setupActivityAlarm();
  }
});
