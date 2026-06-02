import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Clock, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

// Show a sticky amber banner when an employee enters the last 30 minutes of
// their shift WITHOUT having logged any hours for today. Disappears the
// moment they log. Re-evaluates every minute.

const POLL_MS = 60 * 1000;
const WARN_WINDOW_MS = 30 * 60 * 1000; // 30 minutes before shift end

interface ShiftWindow {
  end: Date;          // today's shift-end time as a Date
  warnFrom: Date;     // shift end minus 30 min
}

function parseShiftEnd(endTime: string, startTime: string): ShiftWindow | null {
  // endTime / startTime are 'HH:MM' (24h). For night shifts, end < start ⇒ end is tomorrow.
  const [eh, em] = endTime.split(':').map(Number);
  const [sh, sm] = startTime.split(':').map(Number);
  if (Number.isNaN(eh) || Number.isNaN(em)) return null;
  const now = new Date();
  const end = new Date(now);
  end.setHours(eh, em, 0, 0);
  const start = new Date(now);
  start.setHours(sh || 0, sm || 0, 0, 0);
  // Night shift case: if end is before start (e.g. 03:30 vs 18:30), it's the next day.
  if (end <= start) end.setDate(end.getDate() + 1);
  return { end, warnFrom: new Date(end.getTime() - WARN_WINDOW_MS) };
}

export default function ShiftEndReminder() {
  const { user } = useAuth();
  const location = useLocation();
  const [window, setWindow] = useState<ShiftWindow | null>(null);
  const [hasLoggedToday, setHasLoggedToday] = useState<boolean | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  // Resolve the user's employee record + shift window once per session
  // (or when user changes).
  useEffect(() => {
    if (!user?.employee_id_ref) { setWindow(null); return; }
    let alive = true;
    Promise.all([
      api.getEmployees().catch(() => [] as any[]),
      api.getConfigShifts().catch(() => [] as any[]),
    ]).then(([emps, shifts]) => {
      if (!alive) return;
      const emp = (emps as any[]).find(e => e.employee_id === user.employee_id_ref);
      if (!emp) return;
      const shiftId = emp.shift || 'day';
      const sh = (shifts as any[]).find(s => s.id === shiftId)
        ?? { start_time: '09:00', end_time: '18:00' };
      setWindow(parseShiftEnd(sh.end_time, sh.start_time));
    });
    return () => { alive = false; };
  }, [user?.employee_id_ref]);

  // Re-check the clock every minute, and refetch today's logged status when
  // the user crosses into the warn window OR navigates between pages (cheap
  // hint that they may have just logged).
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window === null ? null : setInterval(tick, POLL_MS);
    return () => { if (id) clearInterval(id); };
  }, [window]);

  // Re-check today's logging status whenever the URL changes (covers the
  // "Log now" → modal → submit flow) and when we enter the warn window.
  useEffect(() => {
    if (!user?.employee_id_ref) { setHasLoggedToday(null); return; }
    let alive = true;
    const today = new Date();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    api.getEmployees()
      .then(emps => (emps as any[]).find(e => e.employee_id === user.employee_id_ref))
      .then(emp => {
        if (!emp) return;
        return api.getHourLogDays({ employee_id: emp.id, month, year });
      })
      .then(days => {
        if (!alive || !days) return;
        const todayStr = today.toISOString().slice(0, 10);
        const hours = (days as any[])
          .filter(d => (d.log_date || '').slice(0, 10) === todayStr)
          .reduce((s, d) => s + Number(d.hours || 0), 0);
        setHasLoggedToday(hours > 0);
      })
      .catch(() => { /* network blip — leave previous state */ });
    return () => { alive = false; };
  }, [user?.employee_id_ref, location.pathname, now]);

  // Gate: only fire for employees + coordinators (they log hours).
  // Admin/HR don't have project hours of their own.
  const role = user?.role ?? '';
  const shouldRun = role === 'employee' || role === 'project_coordinator';

  if (!shouldRun || !window || hasLoggedToday !== false) return null;

  const inWindow = now >= window.warnFrom.getTime() && now <= window.end.getTime();
  if (!inWindow) return null;

  const todayKey = new Date().toISOString().slice(0, 10);
  if (dismissedFor === todayKey) return null;

  const minutesLeft = Math.max(0, Math.round((window.end.getTime() - now) / 60000));

  return (
    <div className="sticky top-0 z-30 bg-warning text-on-accent border-b border-warning shadow-elev-1">
      <div className="px-5 py-2.5 flex items-center gap-3 text-sm">
        <Clock size={16} strokeWidth={2.5} className="shrink-0" />
        <p className="flex-1 font-medium">
          <span className="font-bold">Heads up — </span>
          your shift ends in <span className="num-mono font-bold">{minutesLeft}m</span> and you haven't logged any hours today.
          <span className="hidden sm:inline ml-1 opacity-90">Log them now so reviewers can approve on time.</span>
        </p>
        <Link to="/my?tab=my-hours"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-on-accent text-warning font-bold text-xs hover:opacity-90 transition-opacity">
          Log now →
        </Link>
        <button onClick={() => setDismissedFor(todayKey)}
          title="Dismiss for today"
          className="p-1 rounded hover:bg-on-accent/20 transition-colors">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
