import { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { toast } from '../Toaster';

// Compact clock in / clock out control that lives in the TopBar so it
// follows the user across every page. Shows a live HH:MM:SS timer while
// clocked in, respects the office geofence via the same evaluateGeofence
// backend helper used by MyPortal, and stays hidden for users without an
// underlying employee record.
export default function ClockWidget() {
  const { user } = useAuth();
  const [empDbId, setEmpDbId] = useState<string>('');
  const [openSession, setOpenSession] = useState<{ id: string; clock_in: string } | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [busy, setBusy] = useState<'in' | 'out' | null>(null);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const empRef = user?.employee_id_ref;

  // Resolve the internal employee id once from the human code stored on
  // the auth user. Falls back silently for admins / users without an
  // employees row — the widget then renders nothing.
  useEffect(() => {
    if (!empRef) { setLoaded(true); return; }
    let cancelled = false;
    api.getEmployeesSlim().then(list => {
      if (cancelled) return;
      const match = (list ?? []).find((e: any) => e.employee_id === empRef);
      if (match?.id) setEmpDbId(match.id);
      setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, [empRef]);

  // Fetch today's sessions for the resolved employee and pick the still-
  // open one (clock_out IS NULL) as the current session. Runs on mount,
  // on window focus, and after every successful clock action.
  const refetch = () => {
    if (!empDbId) return;
    const today = istDate();
    api.getAttendanceSessions(empDbId, today)
      .then(rows => {
        const open = (rows ?? []).find((s: any) => !s.clock_out);
        setOpenSession(open ? { id: open.id, clock_in: open.clock_in } : null);
      })
      .catch(() => {});
  };

  useEffect(() => { refetch(); }, [empDbId]);

  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [empDbId]);

  // Elapsed-time ticker — only runs while a session is open. Clears when
  // the employee clocks out so we don't leak intervals.
  useEffect(() => {
    if (!openSession) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setElapsedSec(0);
      return;
    }
    const tick = () => setElapsedSec(elapsedFromIstHHMM(openSession.clock_in));
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };
  }, [openSession?.id]);

  const readGeo = (): Promise<{ lat?: number; lng?: number; accuracy?: number }> => {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve({});
      const timer = setTimeout(() => resolve({}), 10_000);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); },
        () => { clearTimeout(timer); resolve({}); },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
      );
    });
  };

  const clockIn = async () => {
    if (!empDbId || busy) return;
    setBusy('in');
    try {
      const geo = await readGeo();
      const res: any = await api.clockIn(empDbId, geo);
      const note = res?.geo_status === 'wfh_exempt' ? ' (WFH day)' : res?.geo_status === 'inside' ? ' (at office)' : '';
      toast.success('Clocked in', `Marked ${res?.status ?? 'present'} at ${res?.time ?? 'now'}${note}.`);
      refetch();
    } catch (e: any) {
      toast.error('Clock-in blocked', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy(null); }
  };

  const clockOut = async () => {
    if (!empDbId || busy) return;
    setBusy('out');
    try {
      const geo = await readGeo();
      await api.clockOut(empDbId, { lat: geo.lat, lng: geo.lng });
      toast.success('Clocked out', formatDuration(elapsedSec));
      refetch();
    } catch (e: any) {
      toast.error('Clock-out blocked', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy(null); }
  };

  if (!loaded || !empDbId) return null;

  const isOpen = !!openSession;
  const label = isOpen ? formatDuration(elapsedSec) : 'Clock In';

  return (
    <button
      onClick={isOpen ? clockOut : clockIn}
      disabled={!!busy}
      title={isOpen ? `Clocked in at ${openSession!.clock_in} — click to clock out` : 'Clock in for today'}
      className={
        'inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-full text-xs sm:text-sm font-semibold border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ' +
        (isOpen
          ? 'bg-danger-container/40 border-danger/40 text-danger hover:bg-danger-container/60'
          : 'bg-success-container/40 border-success/40 text-success hover:bg-success-container/60')
      }
    >
      {isOpen ? <Square size={12} className="fill-current" /> : <Play size={12} className="fill-current" />}
      {isOpen ? (
        <>
          <span className="hidden sm:inline">On the clock</span>
          <span className="font-mono tabular-nums text-[11px] sm:text-xs px-1.5 py-0.5 rounded bg-danger/10 border border-danger/30">{label}</span>
        </>
      ) : (
        <span>{busy === 'in' ? 'Starting…' : label}</span>
      )}
    </button>
  );
}

// IST wall-clock helpers. Clock-in / clock-out times are stored as
// naive HH:MM strings in IST, so the elapsed calculation has to compare
// against IST-current, not the browser's local time.
function istDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function istHms(): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0');
  return { h: get('hour'), m: get('minute'), s: get('second') };
}
function elapsedFromIstHHMM(clockIn: string): number {
  if (!clockIn) return 0;
  const [ih, im] = clockIn.split(':').map(Number);
  const now = istHms();
  const nowSec = now.h * 3600 + now.m * 60 + now.s;
  const inSec = ih * 3600 + (im || 0) * 60;
  let diff = nowSec - inSec;
  if (diff < 0) diff += 24 * 3600; // night shift crossed midnight
  return diff;
}
function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
