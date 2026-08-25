import { useEffect, useState } from 'react';
import { X, Loader2, Check, AlertTriangle, Timer } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../Toaster';
import { formatHoursHuman } from '../../lib/taskMeta';

// Global "log this to your weekly hour sheet?" prompt. Any timer-stop
// site (task detail modal, TopBar chip, board card Stop pill) fires
// the `hrms-timer-stopped` window event with the enriched entry
// returned by POST /api/tasks/:id/timer/stop, and this overlay picks
// it up + renders one lightweight modal so the employee decides on
// the spot instead of remembering to sync later.
//
// A single fire is bounded to a single decision — dismissing without
// answering counts as "skip" so we never write behind their back.

export interface TimerStopEventDetail {
  entry_id: string;
  task_id: string;
  task_title: string | null;
  project_id: string | null;
  project_name: string | null;
  project_client: string | null;
  assignment_id: string | null;
  log_date: string;
  hours: number;
  employee_id: string;
  employee_name?: string | null;
}

export function firePromptForStoppedTimer(detail: TimerStopEventDetail) {
  try { window.dispatchEvent(new CustomEvent('hrms-timer-stopped', { detail })); } catch { /* SSR */ }
}

export default function TimerStopPrompt() {
  const [detail, setDetail] = useState<TimerStopEventDetail | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onStopped = (e: Event) => {
      const d = (e as CustomEvent<TimerStopEventDetail>).detail;
      // Only bother the user for meaningful stops — a stray < 1-min
      // start/stop and non-project tasks shouldn't yield a modal.
      if (!d) return;
      if (!d.project_id) return;
      if (Number(d.hours) < 0.02) return;   // ~1 minute
      setDetail(d);
    };
    window.addEventListener('hrms-timer-stopped', onStopped as EventListener);
    return () => window.removeEventListener('hrms-timer-stopped', onStopped as EventListener);
  }, []);

  if (!detail) return null;

  const close = () => setDetail(null);
  const skip = () => { setDetail(null); };
  const log = async () => {
    if (!detail.assignment_id) {
      toast.error('No plan for this project this month', 'Add an assignment on /hours/allocation first.');
      return;
    }
    setSaving(true);
    try {
      await api.upsertHourLogDay({
        assignment_id: detail.assignment_id,
        log_date: detail.log_date,
        hours: detail.hours,
        notes: `Timer on "${detail.task_title ?? 'task'}"`,
        employee_id: detail.employee_id,
        employee_name: detail.employee_name ?? undefined,
      });
      toast.success('Logged to hour sheet', `${formatHoursHuman(detail.hours)} on ${detail.project_name ?? 'project'}`);
      setDetail(null);
    } catch (e: any) {
      toast.error('Could not log to hour sheet', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  const dateLabel = new Date(detail.log_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4" onMouseDown={close}>
      <div className="bg-surface rounded-xl-2 w-full max-w-md shadow-elev-4 border border-outline" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-accent/10 grid place-items-center">
              <Timer size={16} className="text-accent" />
            </div>
            <div>
              <h2 className="text-sm font-display font-bold text-on-surface">Timer stopped</h2>
              <p className="text-[11px] text-on-surface-muted">Log this to your weekly hour sheet?</p>
            </div>
          </div>
          <button onClick={close} className="p-1 rounded hover:bg-surface-2 text-on-surface-muted"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3">
          <div className="rounded-lg border border-outline bg-surface-2/50 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-on-surface truncate">{detail.task_title ?? 'Task'}</p>
              <span className="font-mono text-sm font-bold text-accent tabular-nums shrink-0">{formatHoursHuman(detail.hours)}</span>
            </div>
            <p className="text-[11px] text-on-surface-muted mt-1">
              <span className="font-semibold">{detail.project_name ?? '(no project)'}</span>
              {detail.project_client && <> · {detail.project_client}</>}
              <> · </>
              <span className="font-mono">{dateLabel}</span>
            </p>
          </div>

          {!detail.assignment_id && (
            <div className="rounded-lg border border-warning/30 bg-warning-container/40 p-2.5 flex items-start gap-2">
              <AlertTriangle size={13} className="text-warning shrink-0 mt-0.5" />
              <p className="text-[11px] text-warning">
                You don't have a plan for <b>{detail.project_name ?? 'this project'}</b> this month, so this can't be
                added to your hour sheet yet.
                {' '}<a href="/hours/allocation" className="underline">Add one</a> and stop a fresh timer, or skip and log
                manually later.
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-outline flex items-center justify-end gap-2">
          <button onClick={skip} disabled={saving}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-on-surface-muted hover:text-on-surface hover:bg-surface-2">
            Skip
          </button>
          <button onClick={log} disabled={saving || !detail.assignment_id}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-on-accent text-sm font-semibold disabled:opacity-60">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Log to hour sheet
          </button>
        </div>
      </div>
    </div>
  );
}
