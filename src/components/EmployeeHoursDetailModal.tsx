import { useEffect, useState } from 'react';
import { X, AlertTriangle, CheckCircle, XCircle, Clock as ClockIcon, Pencil, Save } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Props {
  employeeId: string;
  employeeName: string;
  month: number;
  year: number;
  /** Optional — open scrolled to this week */
  focusWeek?: number;
  onClose: () => void;
}

interface LogRow {
  id: string;
  project_id: string;
  project_name?: string;
  project_client_name?: string | null;
  week_num: number;
  hours_logged: number;
  work_description: string | null;
  status: string;
  rejection_reason: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  w1_hours?: number; w2_hours?: number; w3_hours?: number; w4_hours?: number; w5_hours?: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function allocFor(log: LogRow): number {
  const k = `w${log.week_num}_hours` as keyof LogRow;
  return Number((log as any)[k] ?? 0);
}

export default function EmployeeHoursDetailModal({ employeeId, employeeName, month, year, focusWeek, onClose }: Props) {
  const { user } = useAuth();
  const canEditAny = user?.role === 'admin' || user?.role === 'hr_manager' || user?.role === 'project_coordinator';
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ hours: string; desc: string }>({ hours: '', desc: '' });
  const [saving, setSaving] = useState(false);

  const reload = () => {
    setLoading(true);
    api.getHourLogs({ employee_id: employeeId, month, year })
      .then(d => setLogs(d as LogRow[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, month, year]);

  const startEdit = (log: LogRow) => {
    setEditingId(log.id);
    setEditDraft({ hours: String(log.hours_logged), desc: log.work_description ?? '' });
  };

  const cancelEdit = () => { setEditingId(null); setEditDraft({ hours: '', desc: '' }); };

  const saveEdit = async (log: LogRow) => {
    const h = Number(editDraft.hours);
    if (Number.isNaN(h) || h < 0) return;
    setSaving(true);
    try {
      await api.editHourLog(log.id, {
        hours_logged: h,
        work_description: editDraft.desc,
        actor_role: user?.role,
        // Privileged edit: keep whatever status the log already has (don't reset approved → pending)
        keep_status: canEditAny,
      });
      setEditingId(null);
      reload();
    } catch (err: any) {
      alert(err.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  // Group by week_num, preserve sort order
  const grouped: Record<number, LogRow[]> = {};
  for (const l of logs) (grouped[l.week_num] ||= []).push(l);
  const weeks = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  // Totals for header
  const totalApproved = logs.filter(l => l.status === 'approved').reduce((s, l) => s + Number(l.hours_logged), 0);
  const totalOver = logs.filter(l => l.status === 'approved').reduce((s, l) => s + Math.max(0, Number(l.hours_logged) - allocFor(l)), 0);
  const totalPending = logs.filter(l => l.status === 'pending').reduce((s, l) => s + Number(l.hours_logged), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="relative aurora-bg text-white px-6 py-5 overflow-hidden">
          <div className="absolute inset-0 grain-overlay pointer-events-none" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-white/70">Project hours · {MONTHS[month - 1]} {year}</p>
              <h3 className="font-display text-2xl font-bold tracking-tight mt-1">{employeeName}</h3>
              <div className="flex items-center gap-4 mt-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/55 font-semibold">Approved</p>
                  <p className="num-mono text-xl font-semibold leading-none mt-0.5">{Math.round(totalApproved)}<span className="text-sm text-white/55">h</span></p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/55 font-semibold">Over plan</p>
                  <p className={`num-mono text-xl font-semibold leading-none mt-0.5 ${totalOver > 0 ? 'text-amber-300' : 'text-white/65'}`}>
                    {totalOver > 0 ? '+' : ''}{Math.round(totalOver)}<span className="text-sm text-white/55">h</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/55 font-semibold">Pending</p>
                  <p className="num-mono text-xl font-semibold leading-none mt-0.5">{Math.round(totalPending)}<span className="text-sm text-white/55">h</span></p>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="relative w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/15 flex items-center justify-center transition-colors flex-shrink-0">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-outline border-t-accent rounded-full animate-spin" />
            </div>
          ) : weeks.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <ClockIcon size={28} className="mx-auto text-on-surface-subtle mb-2" />
              <p className="text-sm text-on-surface-muted">No hour logs for {employeeName} in {MONTHS[month - 1]} {year}.</p>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {weeks.map(weekNum => {
                const rows = grouped[weekNum];
                const weekApproved = rows.filter(l => l.status === 'approved').reduce((s, l) => s + Number(l.hours_logged), 0);
                const weekAllocSum = rows.reduce((s, l) => s + allocFor(l), 0);
                const weekOver = Math.max(0, weekApproved - weekAllocSum);
                const isFocus = focusWeek === weekNum;
                return (
                  <div key={weekNum}
                    className={`rounded-xl-2 border overflow-hidden ${isFocus ? 'border-accent shadow-elev-2 ring-2 ring-accent/20' : 'border-outline shadow-elev-1'}`}
                  >
                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-surface-2 border-b border-outline">
                      <div>
                        <p className="font-display text-sm font-bold text-on-surface tracking-tight">Week {weekNum}</p>
                        <p className="text-[11px] text-on-surface-muted mt-0.5">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</p>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.16em] font-semibold text-on-surface-subtle">Allocated</p>
                          <p className="num-mono text-sm font-semibold text-on-surface">{weekAllocSum}h</p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-[0.16em] font-semibold text-on-surface-subtle">Approved</p>
                          <p className="num-mono text-sm font-semibold text-on-surface">{weekApproved}h</p>
                        </div>
                        {weekOver > 0 && (
                          <div className="rounded-md px-2 py-1 bg-warning-container">
                            <p className="text-[9px] uppercase tracking-[0.16em] font-semibold text-warning">Over</p>
                            <p className="num-mono text-sm font-bold text-warning">+{weekOver}h</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="divide-y divide-outline">
                      {rows.map(log => {
                        const alloc = allocFor(log);
                        const over = log.status === 'approved' ? Math.max(0, Number(log.hours_logged) - alloc) : 0;
                        const isEditing = editingId === log.id;
                        return (
                          <div key={log.id} className="px-4 py-3 hover:bg-surface-2/40 transition-colors">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-on-surface truncate">
                                  {log.project_name}{log.project_client_name ? <span className="text-on-surface-muted font-normal"> · {log.project_client_name}</span> : null}
                                </p>
                                {isEditing ? (
                                  <textarea
                                    value={editDraft.desc}
                                    onChange={e => setEditDraft(d => ({ ...d, desc: e.target.value }))}
                                    rows={2}
                                    placeholder="What did the employee work on?"
                                    className="w-full mt-2 bg-surface border border-outline rounded-lg px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                                  />
                                ) : (
                                  <>
                                    {log.work_description && (
                                      <p className="text-xs text-on-surface-muted mt-1 leading-relaxed line-clamp-2">{log.work_description}</p>
                                    )}
                                    {log.status === 'rejected' && log.rejection_reason && (
                                      <p className="text-xs text-danger mt-1 flex items-center gap-1">
                                        <XCircle size={11} /> {log.rejection_reason}
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <div className="text-right">
                                  <p className="text-[9px] uppercase tracking-[0.16em] font-semibold text-on-surface-subtle">Logged / Plan</p>
                                  {isEditing ? (
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <input
                                        type="number" step="0.5" min="0"
                                        value={editDraft.hours}
                                        onChange={e => setEditDraft(d => ({ ...d, hours: e.target.value }))}
                                        className="num-mono w-16 text-sm text-right bg-surface border border-accent rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
                                      />
                                      <span className="text-on-surface-subtle text-sm">/ {alloc}</span>
                                    </div>
                                  ) : (
                                    <p className={`num-mono text-sm font-bold ${over > 0 ? 'text-warning' : 'text-on-surface'}`}>
                                      {log.hours_logged}<span className="text-on-surface-subtle font-normal">/{alloc}</span>
                                      {over > 0 && <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-warning"><AlertTriangle size={10} />+{over}</span>}
                                    </p>
                                  )}
                                </div>
                                <StatusPill status={log.status} />
                                {canEditAny && !isEditing && (
                                  <button onClick={() => startEdit(log)}
                                    title="Edit (admin override)"
                                    className="p-1.5 rounded-md text-on-surface-muted hover:text-accent hover:bg-surface-2 transition-colors">
                                    <Pencil size={13} />
                                  </button>
                                )}
                                {isEditing && (
                                  <div className="flex items-center gap-1">
                                    <button onClick={() => saveEdit(log)} disabled={saving}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50">
                                      <Save size={11} /> {saving ? 'Saving…' : 'Save'}
                                    </button>
                                    <button onClick={cancelEdit}
                                      className="px-2 py-1.5 rounded-md text-xs text-on-surface-muted hover:bg-surface-2 transition-colors">
                                      Cancel
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            {log.reviewed_by_name && !isEditing && (
                              <p className="text-[10px] text-on-surface-subtle mt-1.5">
                                {log.status === 'approved' ? 'Approved' : log.status === 'rejected' ? 'Rejected' : 'Reviewed'} by {log.reviewed_by_name}
                              </p>
                            )}
                            {isEditing && (
                              <p className="text-[10px] text-warning mt-1.5 flex items-center gap-1">
                                <AlertTriangle size={10} /> Editing as {user?.role?.replace('_', ' ')}. Status will be preserved.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-outline bg-surface-2/60 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-3 rounded-lg transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cfg = status === 'approved'
    ? { label: 'Approved', cls: 'bg-success-container text-success', Icon: CheckCircle }
    : status === 'rejected'
    ? { label: 'Rejected', cls: 'bg-danger-container text-danger', Icon: XCircle }
    : { label: 'Pending', cls: 'bg-warning-container text-warning', Icon: AlertTriangle };
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.cls}`}>
      <Icon size={10} /> {cfg.label}
    </span>
  );
}
