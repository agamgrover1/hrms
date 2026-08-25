import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Timer, Check, AlertTriangle, ExternalLink } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../Toaster';
import { formatHoursHuman } from '../../lib/taskMeta';

// SyncTimersModal — reads /api/hour-log-days/suggestions and lets the
// employee bulk-apply their task-timer hours into hour_log_days, so
// they don't have to retype the same numbers on the weekly grid.
//
// Only "actionable" rows are enabled — a row is unactionable when:
//   * there's no assignment for that (employee, project, month), or
//   * the day is already approved (writing would reset it to pending), or
//   * the timer total already equals what's on the hour log.
//
// After apply, the caller reloads its own data via onApplied().

interface Suggestion {
  project_id: string;
  project_name: string;
  project_client: string | null;
  log_date: string;
  timer_hours: number;
  entry_count: number;
  task_titles: string[];
  existing_hours: number | null;
  existing_id: string | null;
  existing_status: 'pending' | 'submitted' | 'approved' | 'rejected' | 'on_hold' | null;
  assignment_id: string | null;
  actionable: boolean;
  delta_hours: number;
}

interface Props {
  employeeId: string;
  employeeName?: string;
  month: number;      // 1..12
  year: number;
  onClose: () => void;
  onApplied?: () => void;
}

export default function SyncTimersModal({ employeeId, employeeName, month, year, onClose, onApplied }: Props) {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());   // key = project_id|log_date

  const load = () => {
    setLoading(true);
    api.getHourLogSuggestions({ employee_id: employeeId, month, year })
      .then(r => {
        setRows(r.suggestions ?? []);
        // Default-select every actionable row so the common "just pull
        // everything my timer captured" case is one click.
        setPicked(new Set(r.suggestions.filter(s => s.actionable).map(s => `${s.project_id}|${s.log_date}`)));
      })
      .catch(e => toast.error('Could not load suggestions', e?.body?.error ?? e?.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [employeeId, month, year]);

  const grouped = useMemo(() => {
    const map = new Map<string, { project_id: string; project_name: string; project_client: string | null; items: Suggestion[]; total_timer: number }>();
    for (const r of rows) {
      const g = map.get(r.project_id) ?? { project_id: r.project_id, project_name: r.project_name, project_client: r.project_client, items: [], total_timer: 0 };
      g.items.push(r);
      g.total_timer += r.timer_hours;
      map.set(r.project_id, g);
    }
    return Array.from(map.values()).sort((a, b) => a.project_name.localeCompare(b.project_name));
  }, [rows]);

  const keyOf = (r: Suggestion) => `${r.project_id}|${r.log_date}`;
  const toggle = (r: Suggestion) => {
    if (!r.actionable) return;
    setPicked(prev => {
      const next = new Set(prev);
      const k = keyOf(r);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const toggleAllForProject = (project_id: string, on: boolean) => {
    setPicked(prev => {
      const next = new Set(prev);
      for (const r of rows) {
        if (r.project_id === project_id && r.actionable) {
          const k = keyOf(r);
          if (on) next.add(k); else next.delete(k);
        }
      }
      return next;
    });
  };

  const actionableCount = rows.filter(r => r.actionable).length;
  const pickedTotal = useMemo(() => {
    let sum = 0;
    for (const r of rows) if (picked.has(keyOf(r)) && r.actionable) sum += r.timer_hours;
    return sum;
  }, [rows, picked]);

  const apply = async () => {
    if (!picked.size) return;
    const items = rows.filter(r => picked.has(keyOf(r)) && r.actionable && r.assignment_id);
    if (!items.length) { toast.error('Nothing to apply'); return; }
    setApplying(true);
    let ok = 0, fail = 0;
    for (const r of items) {
      try {
        await api.upsertHourLogDay({
          assignment_id: r.assignment_id!,
          log_date: r.log_date,
          hours: r.timer_hours,
          notes: `Synced from task timer${r.entry_count > 1 ? ` (${r.entry_count} entries)` : ''}`,
          employee_id: employeeId,
          employee_name: employeeName,
        });
        ok++;
      } catch { fail++; }
    }
    setApplying(false);
    if (fail === 0) toast.success('Hours synced', `${ok} entr${ok === 1 ? 'y' : 'ies'} written to your hour log.`);
    else toast.error(`${ok} synced, ${fail} failed`, 'Retry from the modal to try the failures again.');
    onApplied?.();
    if (fail === 0) onClose(); else load();
  };

  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onMouseDown={onClose}>
      <div className="bg-surface rounded-xl-2 w-full max-w-3xl shadow-elev-4 border border-outline my-8" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
          <div>
            <h2 className="text-lg font-display font-bold text-on-surface flex items-center gap-2">
              <Timer size={18} className="text-accent" /> Sync from task timers
            </h2>
            <p className="text-xs text-on-surface-muted mt-0.5">
              Pull your task-timer hours into your weekly log for <b>{monthLabel}</b>.
              Review, deselect anything you don't want, then apply.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-on-surface-muted"><X size={16} /></button>
        </div>

        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <div className="p-10 text-center text-sm text-on-surface-muted"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading task-timer data…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center">
              <Timer size={28} className="mx-auto text-on-surface-subtle mb-2" />
              <p className="text-sm text-on-surface-muted">No task-timer entries for {monthLabel}.</p>
              <p className="text-[11px] text-on-surface-subtle mt-1">Start a timer on a task, or use "Log" from a task's Time section, and it'll appear here.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map(g => {
                const actionableInProject = g.items.filter(i => i.actionable);
                const allPicked = actionableInProject.length > 0 && actionableInProject.every(i => picked.has(keyOf(i)));
                return (
                  <div key={g.project_id} className="border border-outline rounded-xl-2 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-surface-2/50 border-b border-outline">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface truncate">{g.project_name}</p>
                        {g.project_client && <p className="text-[10px] text-on-surface-muted truncate">{g.project_client}</p>}
                      </div>
                      <span className="text-[11px] font-mono text-on-surface-muted">{formatHoursHuman(g.total_timer)} from timer</span>
                      {actionableInProject.length > 0 && (
                        <button onClick={() => toggleAllForProject(g.project_id, !allPicked)}
                          className="text-[11px] font-semibold text-accent hover:underline">
                          {allPicked ? 'Deselect all' : 'Select all'}
                        </button>
                      )}
                    </div>
                    <div className="divide-y divide-outline">
                      {g.items.map(r => {
                        const k = keyOf(r);
                        const isPicked = picked.has(k);
                        const noAssignment = r.assignment_id == null;
                        const isApproved = r.existing_status === 'approved';
                        const noChange = r.existing_hours != null && Math.abs(r.timer_hours - r.existing_hours) < 0.005;
                        return (
                          <label key={k} className={`flex items-center gap-3 px-3 py-2 ${r.actionable ? 'hover:bg-surface-2/50 cursor-pointer' : 'opacity-70'}`}>
                            <input type="checkbox" checked={isPicked} disabled={!r.actionable}
                              onChange={() => toggle(r)}
                              className="rounded border-outline" />
                            <div className="w-16 flex-shrink-0 text-[11px] font-mono text-on-surface-muted">
                              {new Date(r.log_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' })}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-on-surface truncate">
                                <span className="font-mono font-semibold">{formatHoursHuman(r.timer_hours)}</span>
                                <span className="text-on-surface-subtle"> from </span>
                                <span className="text-on-surface-muted">{r.entry_count} entr{r.entry_count === 1 ? 'y' : 'ies'}</span>
                                {r.existing_hours != null && (
                                  <> · <span className="text-on-surface-subtle">log has</span> <span className="font-mono">{formatHoursHuman(r.existing_hours)}</span></>
                                )}
                              </p>
                              {r.task_titles.length > 0 && (
                                <p className="text-[10px] text-on-surface-subtle truncate mt-0.5">
                                  {r.task_titles.slice(0, 3).join(' · ')}{r.task_titles.length > 3 ? ` +${r.task_titles.length - 3} more` : ''}
                                </p>
                              )}
                            </div>
                            {noAssignment && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-warning bg-warning-container/40 border border-warning/30 px-2 py-0.5 rounded">
                                <AlertTriangle size={10} /> No plan for this project this month
                              </span>
                            )}
                            {isApproved && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success bg-success-container/40 border border-success/30 px-2 py-0.5 rounded">
                                <Check size={10} /> Already approved
                              </span>
                            )}
                            {!noAssignment && !isApproved && noChange && (
                              <span className="text-[10px] text-on-surface-subtle">Up to date</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] text-on-surface-subtle italic px-1">
                Selected entries overwrite the hour-log value for that day. Approved days are skipped so the review chain stays intact.
                Days without a project plan need an assignment first —
                <a href="/hours/allocation" className="text-accent hover:underline inline-flex items-center gap-0.5 ml-1">
                  add one <ExternalLink size={9} />
                </a>.
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-outline flex items-center gap-2">
          <p className="text-xs text-on-surface-muted">
            {picked.size} of {actionableCount} selected · <b>{formatHoursHuman(pickedTotal)}</b> total
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-on-surface-muted hover:text-on-surface">Cancel</button>
            <button onClick={apply} disabled={applying || picked.size === 0}
              className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-accent text-on-accent text-sm font-semibold disabled:opacity-60">
              {applying && <Loader2 size={12} className="animate-spin" />}
              Apply {picked.size} to hour log
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
