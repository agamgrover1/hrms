'use strict';

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SETUP_ALARM') {
    setupDailyReminder(msg.shiftStart);
  }
  if (msg.type === 'CLEAR_ALARM') {
    chrome.alarms.clearAll();
  }
});

// ── Set up a daily alarm at shift start time ──────────────────────────────────
function setupDailyReminder(shiftStart) {
  chrome.alarms.clear('clockInReminder', () => {
    const [h, m] = (shiftStart || '09:00').split(':').map(Number);

    // Calculate next occurrence of shift start in IST, converted to local time
    const now        = new Date();
    // IST offset: UTC+5:30
    const IST_OFFSET = 5.5 * 60; // minutes
    // Current UTC minutes since epoch
    const nowUTC     = now.getTime();

    // Build target time in IST today
    const todayIST   = new Date(nowUTC + IST_OFFSET * 60 * 1000);
    todayIST.setUTCHours(h, m, 0, 0);

    // If shift start has already passed today, schedule for tomorrow
    let fireAt = todayIST.getTime() - IST_OFFSET * 60 * 1000; // back to UTC ms
    if (fireAt <= nowUTC) {
      fireAt += 24 * 60 * 60 * 1000; // +1 day
    }

    chrome.alarms.create('clockInReminder', {
      when:        fireAt,
      periodInMinutes: 24 * 60, // repeat daily
    });
  });
}

// ── Handle the alarm firing ───────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'clockInReminder') return;

  // Only notify if user is logged in
  const stored = await chrome.storage.local.get(['employee']);
  if (!stored.employee) return;

  // Check if already clocked in today
  try {
    const res  = await fetch(`https://hr.digitalleapmarketing.com/api/attendance/today?employee_id=${stored.employee.id}`);
    const data = await res.json();

    if (data.is_clocked_in || data.is_clocked_out || data.has_biometric) return; // already handled

    const isWfh = data.wfh_today;
    const msg   = isWfh
      ? 'You have an approved WFH today — please clock in to start recording your hours.'
      : 'Your shift has started. Open the Digital Leap HRMS extension to clock in.';

    chrome.notifications.create('shiftReminder', {
      type:    'basic',
      iconUrl: 'https://hr.digitalleapmarketing.com/favicon.png',
      title:   isWfh ? '🏠 WFH Reminder — Clock In' : '⏰ Shift Start Reminder',
      message: msg,
      priority: 2,
    });
  } catch {
    // Silently ignore network errors
  }
});

// ── On install: restore alarm if user is already logged in ────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['employee']);
  if (stored.employee) {
    // Default to day shift 9:00 — will be corrected next time popup opens
    setupDailyReminder('09:00');
  }
});
