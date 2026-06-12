'use strict';

const API = 'https://hr.digitalleapmarketing.com/api';
let timerInterval  = null;
let totalInterval  = null;
let currentData    = null;

const $ = id => document.getElementById(id);

// Fetch with 10-second timeout — prevents popup from hanging on slow/down server
function apiFetch(url, opts = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  show('loadingView');
  const stored = await chrome.storage.local.get(['user', 'employee']);
  if (!stored.user || !stored.employee) { showLogin(); return; }
  await loadDashboard(stored.employee);
}

// ── View helpers ──────────────────────────────────────────────────────────────
function show(id) {
  ['loadingView','loginView','mainView'].forEach(v => $(v).classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function showSub(id) {
  ['notClockedView','clockedInView','onBreakView'].forEach(v => $(v).classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function setErr(id, msg) {
  $(id).classList.toggle('hidden', !msg);
  $(id).textContent = msg || '';
}

// ── Login ─────────────────────────────────────────────────────────────────────
function showLogin() {
  show('loginView'); $('logoutBtn').classList.add('hidden'); setErr('loginError','');
}

$('loginBtn').addEventListener('click', async () => {
  const email = $('emailInput').value.trim().toLowerCase(); // normalise — backend uses LOWER(email)
  const pwd   = $('passwordInput').value;
  if (!email || !pwd) { setErr('loginError', 'Enter your email and password.'); return; }
  $('loginBtn').textContent = 'Signing in…'; $('loginBtn').disabled = true; setErr('loginError','');
  try {
    const authRes = await apiFetch(`${API}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password: pwd }) });
    const auth    = await authRes.json();
    if (!authRes.ok) throw new Error(auth.error || 'Invalid credentials');

    const empsRes = await apiFetch(`${API}/employees`);
    const emps    = await empsRes.json();
    const employee = emps.find(e => e.employee_id === auth.user.employee_id_ref);
    if (!employee) throw new Error('No employee record linked to this account. Contact HR.');

    await chrome.storage.local.set({ user: auth.user, employee });
    await loadDashboard(employee);
  } catch (e) {
    setErr('loginError', e.name === 'AbortError' ? 'Request timed out. Check your connection.' : e.message);
  }
  finally { $('loginBtn').textContent = 'Sign In →'; $('loginBtn').disabled = false; }
});
$('passwordInput').addEventListener('keydown', e => { if (e.key==='Enter') $('loginBtn').click(); });
$('emailInput').addEventListener('keydown',    e => { if (e.key==='Enter') $('passwordInput').focus(); });

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard(employee) {
  show('mainView'); $('logoutBtn').classList.remove('hidden'); setErr('mainError','');
  $('empName').textContent = employee.name;
  $('empCode').textContent = employee.employee_id;
  try {
    const res  = await apiFetch(`${API}/attendance/today?employee_id=${employee.id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load status');
    currentData = data;
    render(data, employee);
    // Set up shift-start reminder (separate from activity alarm which starts on clock-in)
    chrome.runtime.sendMessage({ type:'SETUP_ALARM', shiftStart: data.shift_start });
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Request timed out. Check your connection.' : e.message;
    setErr('mainError', msg);
    showSub('notClockedView');
    // Logout button remains visible so user can sign out if there's an auth issue
  }
}

function render(data, employee) {
  stopTimers();
  const sessions = data.sessions || [];
  const active   = data.active_session;

  // Badge
  const badge = $('dayBadge');
  badge.textContent = data.wfh_today ? '🏠 WFH' : '🏢 Office';
  badge.className   = 'badge ' + (data.wfh_today ? 'badge-wfh' : 'badge-office');

  // "Biometric is locking the extension" only applies while the biometric
  // session is still OPEN. Once the employee biometric-clocks-out, the
  // check_out field is set and the day is unsealed for an extension session
  // (e.g. they went home and want to continue working). The bug before this
  // fix was that any day with a biometric record killed the entire UI for
  // the rest of the day.
  const bioActive = data.has_biometric && !data.check_out;

  // Notices
  $('wfhNotice').classList.toggle('hidden', !data.wfh_today || sessions.length > 0 || bioActive);
  $('bioNotice').classList.toggle('hidden', !bioActive);
  $('shiftInfo').textContent = (data.shift === 'night' ? '🌙 Night Shift' : '☀️ Day Shift') + ` · ${fmt12(data.shift_start)} – ${fmt12(data.shift_end)}`;
  $('shiftInfo').classList.toggle('hidden', bioActive);

  // Total hours bar
  const hasSessions = sessions.length > 0 || active;
  $('totalBar').classList.toggle('hidden', !hasSessions && !bioActive);
  if (hasSessions || bioActive) {
    renderTotalBar(data, active);
  }

  // Overtime detection: total > shift duration
  if (hasSessions) {
    const [sh, sm] = (data.shift_start||'09:00').split(':').map(Number);
    const [eh, em] = (data.shift_end  ||'18:00').split(':').map(Number);
    // Handle night shift crossing midnight (e.g. 18:30 → 03:30)
    const shiftMin = (eh*60+em) >= (sh*60+sm)
      ? (eh*60+em) - (sh*60+sm)
      : (24*60 - (sh*60+sm)) + (eh*60+em);
    const totalMin = data.total_minutes + (active ? runningMinutes(active.clock_in) : 0);
    $('otNotice').classList.toggle('hidden', totalMin < shiftMin);
  } else {
    $('otNotice').classList.add('hidden');
  }

  // Session list
  renderSessionList(sessions, active);

  // Sub-view. Only block the extension UI while the biometric session is
  // STILL OPEN. After biometric-clock-out (check_out is set), the bottom
  // section should show "Start Work" so the employee can begin a second
  // (extension-tracked) block from home — what the user described.
  if (bioActive) {
    $('sessionsWrap').classList.add('hidden');
    showSub('notClockedView'); // hide buttons, show nothing useful
    $('notClockedView').classList.add('hidden'); // actually hide all
    return;
  }
  if (active) {
    showSub('clockedInView');
    $('sessionStartTime').textContent = fmt12(active.clock_in);
    startSessionTimer(active.clock_in, data.shift_start, data.shift_end, data.total_minutes);
    startTotalTimer(data.total_minutes, active.clock_in, data.shift_start, data.shift_end, data);
  } else if (sessions.length > 0) {
    showSub('onBreakView');
  } else {
    showSub('notClockedView');
    $('clockInBtn').textContent = '⏱ Start Work';
  }
}

function renderTotalBar(data, active) {
  const updateTotal = () => {
    const runMin = active ? runningMinutes(active.clock_in) : 0;
    const total  = data.total_minutes + runMin;
    $('totalVal').textContent = fmtMinutes(total);
    // Extension tag
    const extMin = data.extension_minutes + (active && active.source==='wfh_extension' ? runMin : 0);
    if (extMin > 0) {
      $('extTag').classList.remove('hidden');
      $('extTag').textContent = `${fmtMinutes(extMin)} ext.`;
    } else {
      $('extTag').classList.add('hidden');
    }
    // Activity bar — show when any session has activity data
    const activeMin   = data.active_minutes || 0;
    const totalWorked = data.total_minutes + runMin;
    const score = totalWorked > 0
      ? Math.min(100, Math.round(((activeMin + (active ? runningMinutes(active.clock_in) : 0)) / totalWorked) * 100))
      : 0;
    const hasActivityData = activeMin > 0 || totalWorked >= 2; // show after 2+ minutes of session data
    $('activityWrap').classList.toggle('hidden', !hasActivityData);
    if (hasActivityData) {
      const color = score >= 70 ? '#15803d' : score >= 40 ? '#d97706' : '#dc2626';
      $('activityPct').textContent = `${score}% active`;
      $('activityPct').style.color = color;
      $('activityBarFill').style.width = `${score}%`;
      $('activityBarFill').style.background = color;
    }
  };
  updateTotal();
}

function renderSessionList(sessions, active) {
  const wrap = $('sessionsWrap');
  const list = $('sessionsList');
  const all  = [...sessions, ...(active ? [active] : [])];
  if (!all.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  list.innerHTML = '';
  all.forEach((s, i) => {
    const isActive = !s.clock_out;
    const dur = isActive ? `${fmtMinutes(runningMinutes(s.clock_in))} ●` : fmtMinutes(Number(s.duration_minutes));
    const srcLabel = s.source === 'wfh_extension' ? 'ext' : s.source === 'biometric' ? 'bio' : '';
    const row = document.createElement('div');
    row.className = 'session-row' + (isActive ? ' session-active' : '');
    row.innerHTML = `
      <div>
        <div class="session-times">${fmt12(s.clock_in)} – ${s.clock_out ? fmt12(s.clock_out) : '—'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:7px">
        <span class="session-dur">${dur}</span>
        ${srcLabel ? `<span class="session-src ${srcLabel}">${srcLabel}</span>` : ''}
      </div>`;
    list.appendChild(row);
  });
}

// ── Clock In ─────────────────────────────────────────────────────────────────
async function doClockin(btnEl, resuming) {
  const stored = await chrome.storage.local.get(['employee']);
  if (!stored.employee) return;
  btnEl.disabled = true; btnEl.textContent = resuming ? 'Resuming…' : 'Starting…';
  setErr('mainError','');
  try {
    const res  = await apiFetch(`${API}/attendance/clock-in`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ employee_id: stored.employee.id, source: 'wfh_extension' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to clock in');
    // Notify background to start activity polling now that we're clocked in
    chrome.runtime.sendMessage({ type: 'CLOCKED_IN', shiftStart: currentData?.shift_start });
    await loadDashboard(stored.employee);
  } catch (e) {
    setErr('mainError', e.name === 'AbortError' ? 'Request timed out. Try again.' : e.message);
  }
  finally { btnEl.disabled = false; btnEl.textContent = resuming ? '▶ Resume Work / Clock In' : '⏱ Start Work'; }
}

$('clockInBtn').addEventListener('click', e => doClockin($('clockInBtn'), false));
$('resumeBtn').addEventListener('click',  e => doClockin($('resumeBtn'), true));

// ── Clock Out ─────────────────────────────────────────────────────────────────
$('clockOutBtn').addEventListener('click', async () => {
  const stored = await chrome.storage.local.get(['employee']);
  if (!stored.employee) return;
  $('clockOutBtn').disabled = true; $('clockOutBtn').textContent = 'Clocking out…';
  setErr('mainError','');
  try {
    const res  = await apiFetch(`${API}/attendance/clock-out`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ employee_id: stored.employee.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to clock out');
    // Notify background to stop activity polling — session is closed
    chrome.runtime.sendMessage({ type: 'CLOCKED_OUT' });
    await loadDashboard(stored.employee);
  } catch (e) {
    setErr('mainError', e.name === 'AbortError' ? 'Request timed out. Try again.' : e.message);
  }
  finally { $('clockOutBtn').disabled = false; $('clockOutBtn').textContent = '⏸ Clock Out / Take Break'; }
});

// ── Timers ────────────────────────────────────────────────────────────────────
function startSessionTimer(clockIn, shiftStart, shiftEnd, completedMinutes) {
  function tick() {
    const mins = runningMinutes(clockIn);
    const h = Math.floor(mins / 60), m = mins % 60;
    const s = Math.floor((runningSeconds(clockIn)) % 60);
    $('timerDisplay').textContent = `${h}:${pad(m)}:${pad(s)}`;

    // Colour red when total time exceeds shift duration (handles night shift crossing midnight)
    const [eh, em] = (shiftEnd  ||'18:00').split(':').map(Number);
    const [sh, sm] = (shiftStart||'09:00').split(':').map(Number);
    const shiftMin = (eh*60+em) >= (sh*60+sm)
      ? (eh*60+em) - (sh*60+sm)
      : (24*60 - (sh*60+sm)) + (eh*60+em);
    $('timerDisplay').classList.toggle('timer-ot', completedMinutes + mins > shiftMin);
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function startTotalTimer(completedMin, clockIn, shiftStart, shiftEnd, data) {
  function tick() {
    const runMin = runningMinutes(clockIn);
    const total  = completedMin + runMin;
    $('totalVal').textContent = fmtMinutes(total);

    const extMin = data.extension_minutes + (clockIn && data.active_session?.source === 'wfh_extension' ? runMin : 0);
    if (extMin > 0) { $('extTag').classList.remove('hidden'); $('extTag').textContent = `${fmtMinutes(extMin)} ext.`; }

    // Overtime detection — handle night shift crossing midnight
    const [sh, sm] = (shiftStart||'09:00').split(':').map(Number);
    const [eh, em] = (shiftEnd  ||'18:00').split(':').map(Number);
    const shiftMin = (eh*60+em) >= (sh*60+sm)
      ? (eh*60+em) - (sh*60+sm)
      : (24*60 - (sh*60+sm)) + (eh*60+em);
    $('otNotice').classList.toggle('hidden', total < shiftMin);
    const badge = $('dayBadge');
    if (total >= shiftMin && !data.wfh_today) { badge.textContent = '⏰ Overtime'; badge.className = 'badge badge-ot'; }
  }
  tick();
  totalInterval = setInterval(tick, 10000); // update every 10s
}

function stopTimers() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (totalInterval) { clearInterval(totalInterval); totalInterval = null; }
}

// ── Logout ────────────────────────────────────────────────────────────────────
$('logoutBtn').addEventListener('click', async () => {
  stopTimers();
  await chrome.storage.local.clear();
  chrome.runtime.sendMessage({ type:'CLEAR_ALARM' });
  showLogin();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function runningSeconds(clockIn) {
  if (!clockIn) return 0;
  const [h, m] = clockIn.split(':').map(Number);
  const nowIST  = new Date(Date.now() + 330*60*1000); // UTC → IST
  const nowSecs = nowIST.getUTCHours()*3600 + nowIST.getUTCMinutes()*60 + nowIST.getUTCSeconds();
  const inSecs  = h*3600 + m*60;
  // Handle midnight crossover: night shift session started before midnight,
  // employee opens extension after midnight — nowSecs < inSecs
  return nowSecs >= inSecs ? nowSecs - inSecs : (24*3600 - inSecs) + nowSecs;
}
function runningMinutes(clockIn) { return Math.floor(runningSeconds(clockIn) / 60); }
function fmtMinutes(min) {
  const h = Math.floor(min/60), m = min%60;
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}
function fmt12(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${h%12||12}:${pad(m)} ${h>=12?'PM':'AM'}`;
}
function pad(n) { return String(n).padStart(2,'0'); }

init();
