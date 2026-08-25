import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timer, Square } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// TaskTimerChip — a persistent "you are timing a task right now" indicator
// on the TopBar. Renders nothing when no timer is running. The task
// module (TaskDetailModal) fires a `hrms-task-timer-changed` event on
// start/stop so this chip reflects the state immediately without waiting
// for the next poll.

interface RunningTimer {
  id: string;
  task_id: string;
  task_title: string;
  started_at: string;
  project_id: string | null;
}

// External hook so TaskDetailModal can call it after start/stop and any
// other surface can push a "check the timer now" signal.
export function notifyTaskTimerChanged() {
  try { window.dispatchEvent(new Event('hrms-task-timer-changed')); } catch { /* SSR safety */ }
}

function formatElapsed(startedAtMs: number, now: number): string {
  const s = Math.max(0, Math.floor((now - startedAtMs) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

export default function TaskTimerChip() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stopping, setStopping] = useState(false);
  const startedAtMs = timer?.started_at ? new Date(timer.started_at).getTime() : 0;

  const refresh = useCallback(() => {
    if (!user?.id) return;
    api.getRunningTimer()
      .then(r => setTimer(r as RunningTimer | null))
      .catch(() => { /* the endpoint is best-effort — swallow so the chip doesn't spam errors */ });
  }, [user?.id]);

  // Poll every 15s, and refresh immediately when the tab regains focus
  // (people flip away, come back, expect the state to be current).
  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 15_000);
    const onFocus = () => refresh();
    const onVisibility = () => { if (!document.hidden) refresh(); };
    const onExternal = () => refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('hrms-task-timer-changed', onExternal);
    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('hrms-task-timer-changed', onExternal);
    };
  }, [refresh]);

  // Live seconds tick — only when a timer is active, otherwise no reason to re-render.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!timer) { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } return; }
    setNow(Date.now());
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); tickRef.current = null; };
  }, [timer?.id]);

  if (!timer) return null;

  const open = () => navigate(`/tasks?task=${timer.task_id}`);
  const stop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (stopping) return;
    setStopping(true);
    try {
      await api.stopTaskTimer(timer.task_id);
      setTimer(null);
    } catch { /* if stop fails, keep the chip so the user notices and can retry from the task */ }
    finally { setStopping(false); }
  };

  return (
    <button
      onClick={open}
      title={`Timing "${timer.task_title}" — click to open`}
      className="inline-flex items-center gap-1.5 h-9 pl-2.5 pr-1 rounded-full text-xs sm:text-sm font-semibold border border-warning/40 bg-warning-container/40 text-warning hover:bg-warning-container/60 transition-colors"
    >
      <Timer size={12} className="animate-pulse" />
      <span className="hidden md:inline max-w-[140px] truncate">{timer.task_title}</span>
      <span className="font-mono tabular-nums text-[11px] sm:text-xs px-1.5 py-0.5 rounded bg-warning/15 border border-warning/30">
        {formatElapsed(startedAtMs, now)}
      </span>
      <span onClick={stop as any}
        title="Stop timer"
        className="p-1 rounded-full hover:bg-warning/20 text-warning/80 hover:text-warning">
        <Square size={11} className="fill-current" />
      </span>
    </button>
  );
}
