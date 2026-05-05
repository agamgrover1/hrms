'use strict';

const API = 'https://hr.digitalleapmarketing.com/api';
let timerInterval = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  show('loadingView');
  const stored = await chrome.storage.local.get(['user', 'employee']);
  if (!stored.user || !stored.employee) {
    showLogin();
    return;
  }
  await loadDashboard(stored.user, stored.employee);
}

// ── Show / hide helpers ───────────────────────────────────────────────────────
function show(viewId) {
  ['loadingView','loginView','mainView'].forEach(id => $(id).classList.add('hidden'));
  $(viewId).classList.remove('hidden');
}
function showSub(viewId) {
  ['notClockedView','clockedInView','clockedOutView'].forEach(id => $(id).classList.add('hidden'));
  $(viewId).classList.remove('hidden');
}
function setError(id, msg) {
  $(id).classList.toggle('hidden', !msg);
  if (msg) $(id.replace('Error','ErrorMsg')).textContent = msg;
}

// ── Login ─────────────────────────────────────────────────────────────────────
function showLogin() {
  show('loginView');
  $('logoutBtn').classList.add('hidden');
  setError('loginError', '');
}

$('loginBtn').addEventListener('click', async () => {
  const email    = $('emailInput').value.trim();
  const password = $('passwordInput').value;
  if (!email || !password) { setError('loginError', 'Enter your email and password.'); return; }

  $('loginBtn').textContent = 'Signing in…';
  $('loginBtn').disabled = true;
  setError('loginError', '');

  try {
    // 1. Authenticate
    const authRes  = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const authData = await authRes.json();
    if (!authRes.ok) throw new Error(authData.error || 'Invalid credentials');
    const user = authData.user;

    // 2. Employees list → find this user's employee record
    const empsRes  = await fetch(`${API}/employees`);
    const emps     = await empsRes.json();
    const employee = emps.find(e => e.employee_id === user.employee_id_ref);
    if (!employee) throw new Error('No employee record linked to this account. Contact HR.');

    // 3. Persist + setup alarm
    await chrome.storage.local.set({ user, employee });
    chrome.runtime.sendMessage({ type: 'SETUP_ALARM', shiftStart: null, employeeId: employee.id });

    await loadDashboard(user, employee);
  } catch (err) {
    setError('loginError', err.message);
  } finally {
    $('loginBtn').textContent = 'Sign In →';
    $('loginBtn').disabled = false;
  }
});

// Enter key on password triggers login
$('passwordInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
$('emailInput').addEventListener('keydown',    e => { if (e.key === 'Enter') $('passwordInput').focus(); });

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard(user, employee) {
  show('mainView');
  $('logoutBtn').classList.remove('hidden');
  setError('mainError', '');

  // Employee chip
  $('empName').textContent = employee.name;
  $('empCode').textContent = employee.employee_id;

  try {
    const res  = await fetch(`${API}/attendance/today?employee_id=${employee.id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load today\'s data');

    renderDashboard(data, employee);

    // Set up background alarm with the shift start time
    chrome.runtime.sendMessage({ type: 'SETUP_ALARM', shiftStart: data.shift_start, employeeId: employee.id });

  } catch (err) {
    setError('mainError', err.message);
    showSub('notClockedView'); // fallback to clock-in UI
  }
}

function renderDashboard(data, employee) {
  // Day type badge
  const badge = $('dayBadge');
  if (data.wfh_today) {
    badge.textContent = '🏠 WFH';
    badge.className   = 'badge badge-wfh';
  } else {
    badge.textContent = '🏢 Office';
    badge.className   = 'badge badge-office';
  }

  // WFH mandatory notice
  $('wfhNotice').classList.toggle('hidden', !data.wfh_today || data.is_clocked_in || data.is_clocked_out || data.has_biometric);

  // Biometric notice
  $('bioNotice').classList.toggle('hidden', !data.has_biometric);

  // Shift info
  const shiftName = data.shift === 'night' ? '🌙 Night Shift' : '☀️ Day Shift';
  $('shiftText').textContent = `${shiftName} · ${fmt12(data.shift_start)} – ${fmt12(data.shift_end)}`;
  $('shiftInfo').classList.toggle('hidden', data.has_biometric);

  // ── View states ──
  if (data.has_biometric) {
    // Biometric already punched — show notice only
    showSub('clockedOutView');
    $('summaryIn').textContent  = data.check_in ? fmt12(data.check_in) : '—';
    $('summaryOut').textContent = data.check_out ? fmt12(data.check_out) : '—';
    $('summaryHours').textContent = data.total_hours != null ? `${parseFloat(data.total_hours).toFixed(1)}h` : '—';
    return;
  }

  if (data.is_clocked_out) {
    showSub('clockedOutView');
    $('summaryIn').textContent    = fmt12(data.check_in);
    $('summaryOut').textContent   = fmt12(data.check_out);
    $('summaryHours').textContent = data.total_hours != null ? `${parseFloat(data.total_hours).toFixed(1)}h` : '—';
    return;
  }

  if (data.is_clocked_in) {
    showClockedIn(data.check_in);
    return;
  }

  // Not clocked in yet
  showSub('notClockedView');
}

function showClockedIn(checkInTime) {
  showSub('clockedInView');
  $('clockInTime').textContent = fmt12(checkInTime);
  startTimer(checkInTime);
}

// ── Clock In / Out ────────────────────────────────────────────────────────────
$('clockInBtn').addEventListener('click', async () => {
  const stored = await chrome.storage.local.get(['employee']);
  if (!stored.employee) return;

  $('clockInBtn').disabled    = true;
  $('clockInBtn').textContent = 'Clocking in…';
  setError('mainError', '');

  try {
    const res  = await fetch(`${API}/attendance/clock-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: stored.employee.id, source: 'wfh_extension' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to clock in');
    showClockedIn(data.check_in);
  } catch (err) {
    setError('mainError', err.message);
  } finally {
    $('clockInBtn').disabled    = false;
    $('clockInBtn').textContent = '⏱ Clock In';
  }
});

$('clockOutBtn').addEventListener('click', async () => {
  const stored = await chrome.storage.local.get(['employee']);
  if (!stored.employee) return;

  $('clockOutBtn').disabled    = true;
  $('clockOutBtn').textContent = 'Clocking out…';
  setError('mainError', '');

  try {
    const res  = await fetch(`${API}/attendance/clock-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: stored.employee.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to clock out');

    stopTimer();
    showSub('clockedOutView');
    $('summaryIn').textContent    = fmt12(data.check_in);
    $('summaryOut').textContent   = fmt12(data.check_out);
    $('summaryHours').textContent = data.total_hours != null ? `${parseFloat(data.total_hours).toFixed(1)}h` : '—';
    $('wfhNotice').classList.add('hidden');
  } catch (err) {
    setError('mainError', err.message);
  } finally {
    $('clockOutBtn').disabled    = false;
    $('clockOutBtn').textContent = '⏹ Clock Out';
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
$('logoutBtn').addEventListener('click', async () => {
  stopTimer();
  await chrome.storage.local.clear();
  chrome.runtime.sendMessage({ type: 'CLEAR_ALARM' });
  showLogin();
});

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer(checkInTime) {
  stopTimer();
  function tick() {
    const now   = new Date();
    // Parse check_in "HH:MM" or "HH:MM:SS" in today's date (IST-aware)
    const [h, m, s] = (checkInTime || '00:00').split(':').map(Number);
    const inMs  = ((h * 3600) + (m * 60) + (s || 0)) * 1000;
    // Current time in seconds since midnight IST
    const nowIST  = new Date(now.getTime() + 330 * 60 * 1000); // +5:30
    const nowMs   = ((nowIST.getUTCHours() * 3600) + (nowIST.getUTCMinutes() * 60) + nowIST.getUTCSeconds()) * 1000;
    const elapsedMs = Math.max(0, nowMs - inMs);
    const hh  = Math.floor(elapsedMs / 3600000);
    const mm  = Math.floor((elapsedMs % 3600000) / 60000);
    const ss  = Math.floor((elapsedMs % 60000) / 1000);
    $('timerDisplay').textContent = `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt12(time) {
  if (!time) return '—';
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
