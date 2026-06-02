import { useEffect, useState } from 'react';
import { X, AlertTriangle, CheckCircle, XCircle, Clock as ClockIcon, Pencil, Save, History, ChevronDown, Trash2 } from 'lucide-react';
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
  assignment_id: string;
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
  admin_edit_count?: number;
  last_admin_edit_at?: string | null;
  last_admin_editor?: string | null;
}

interface DayRow {
  id: string;
  assignment_id: string;
  log_date: string;
  week_num: number;
  hours: number;
  notes: string | null;
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
  const [days, setDays] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ hours: string; desc: string; reason: string }>({ hours: '', desc: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.getHourLogs({ employee_id: employeeId, month, year }).then(d => setLogs(d as LogRow[])).catch(() => {}),
      api.getHourLogDays({ employee_id: employeeId, month, year }).then(d => setDays(d as DayRow[])).catch(() => setDays([])),
    ]).finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, month, year]);

  const startEdit = (log: LogRow) => {
    setEditingId(log.id);
    setEditDraft({ hours: String(log.hours_logged), desc: log.work_description ?? '', reason: '' });
  };

  const cancelEdit = () => { setEditingId(null); setEditDraft({ hours: '', desc: '', reason: '' }); };

  const saveEdit = async (log: LogRow) => {
    const h = Number(editDraft.hours);
    if (Number.isNaN(h) || h < 0) return;
    // Editing an approved log requires a reason — the backend enforces this too
    if (canEditAny && log.status === 'approved' && !editDraft.reason.trim()) {
      alert('Please add a short reason — this log is already approved, so the audit trail requires it.');
      return;
    }
    setSaving(true);
    try {
      await api.editHourLog(log.id, {
        hours_logged: h,
        work_description: editDraft.desc,
        actor_id: user?.id,
        actor_name: user?.name,
        actor_role: user?.role,
        // Privileged edit: keep whatever status the log already has (don't reset approved → pending)
        keep_status: canEditAny,
        reason: editDraft.reason.trim() || undefined,
      });
      setEditingId(null);
      // refresh both the logs and any open history for this log
      reload();
      if (historyOpenFor === log.id) loadHistory(log.id);
    } catch (err: any) {
      alert(err.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const deleteLog = async (log: LogRow) => {
    const reason = log.status === 'approved'
      ? window.prompt(`Delete this approved ${log.hours_logged}h log for W${log.week_num}?\nA reason is required (visible to ${employeeName} in the notification and audit trail).`)
      : (window.confirm(`Delete the ${log.hours_logged}h log for W${log.week_num}?`) ? '' : null);
    if (reason === null) return; // cancelled
    if (log.status === 'approved' && !reason.trim()) {
      alert('Reason is required for deleting an approved log.');
      return;
    }
    try {
      await api.deleteHourLog(log.id, {
        actor_id: user?.id,
        actor_name: user?.name,
        actor_role: user?.role,
        reason: reason.trim() || undefined,
      });
      reload();
    } catch (err: any) {
      alert(err.message ?? 'Failed to delete.');
    }
  };

  const loadHistory = async (logId: string) => {
    setHistoryLoading(prev => ({ ...prev, [logId]: true }));
    try {
      const data = await api.getHourLogAudit(logId);
      setHistoryData(prev => ({ ...prev, [logId]: data }));
    } catch {
      setHistoryData(prev => ({ ...prev, [logId]: [] }));
    } finally {
      setHistoryLoading(prev => ({ ...prev, [logId]: false }));
    }
  };
  const toggleHistory = (logId: string) => {
    if (historyOpenFor === logId) {
      setHistoryOpenFor(null);
    } else {
      setHistoryOpenFor(logId);
      if (!historyData[logId]) loadHistory(logId);
    }
  };

  const fmtTs = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const ACTION_LABEL: Record<string, { label: string; cls: string; Icon: any }> = {
    created:     { label: 'Submitted',       cls: 'bg-brand-container text-on-brand-container', Icon: ClockIcon },
    resubmitted: { label: 'Re-submitted',    cls: 'bg-brand-container text-on-brand-container', Icon: ClockIcon },
    edited:      { label: 'Edited',          cls: 'bg-surface-2 text-on-surface-muted', Icon: Pencil },
    approved:    { label: 'Approved',        cls: 'bg-success-container text-success', Icon: CheckCircle },
    rejected:    { label: 'Rejected',        cls: 'bg-danger-container text-danger', Icon: XCircle },
    admin_edit:  { label: 'Admin override',  cls: 'bg-warning-container text-warning', Icon: AlertTriangle },
    deleted:     { label: 'Deleted',         cls: 'bg-danger-container text-danger', Icon: XCircle },
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
                                <p className="text-sm font-semibold text-on-surface truncate flex items-center gap-2">
                                  <span>{log.project_name}{log.project_client_name ? <span className="text-on-surface-muted font-normal"> · {log.project_client_name}</span> : null}</span>
                                  {(log.admin_edit_count ?? 0) > 0 && (
                                    <button
                                      onClick={(ev) => { ev.stopPropagation(); toggleHistory(log.id); }}
                                      title={`Edited ${log.admin_edit_count}× by admin${log.last_admin_editor ? ` (last: ${log.last_admin_editor})` : ''}`}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-warning-container text-warning hover:opacity-80 transition-opacity"
                                    >
                                      <Pencil size={9} />
                                      <span className="num-mono">{log.admin_edit_count}</span>
                                      <span className="font-normal">{(log.admin_edit_count ?? 0) === 1 ? 'admin edit' : 'admin edits'}</span>
                                    </button>
                                  )}
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
                                {canEditAny && !isEditing && (
                                  <button onClick={() => deleteLog(log)}
                                    title={log.status === 'approved' ? 'Delete (requires reason)' : 'Delete log'}
                                    className="p-1.5 rounded-md text-on-surface-muted hover:text-danger hover:bg-danger-container transition-colors">
                                    <Trash2 size={13} />
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
                                {!isEditing && (
                                  <button
                                    onClick={() => toggleHistory(log.id)}
                                    title="View change history"
                                    className={`p-1.5 rounded-md transition-colors ${historyOpenFor === log.id ? 'text-accent bg-accent-container' : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-2'}`}>
                                    <History size={13} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Reason input when editing an already-approved log */}
                            {isEditing && canEditAny && log.status === 'approved' && (
                              <div className="mt-2">
                                <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted block mb-1">
                                  Reason for change <span className="text-danger">*</span>
                                </label>
                                <input
                                  value={editDraft.reason}
                                  onChange={e => setEditDraft(d => ({ ...d, reason: e.target.value }))}
                                  placeholder="e.g. correcting from a typo, reconciling with timesheet, etc."
                                  className="w-full bg-surface border border-outline rounded-lg px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
                                />
                                <p className="text-[10px] text-on-surface-subtle mt-1">
                                  Visible in the audit trail to everyone (including {employeeName}).
                                </p>
                              </div>
                            )}

                            {/* Daily breakdown — visible whenever the log has day entries */}
                            {(() => {
                              const logDays = days.filter(d => d.assignment_id === log.assignment_id && d.week_num === log.week_num)
                                                  .sort((a, b) => String(a.log_date).localeCompare(String(b.log_date)));
                              if (logDays.length === 0) return null;
                              return (
                                <div className="mt-3 rounded-lg bg-surface-2/40 border border-outline overflow-hidden">
                                  <p className="px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted border-b border-outline bg-surface-2">
                                    Daily breakdown · {logDays.length} {logDays.length === 1 ? 'day' : 'days'}
                                  </p>
                                  <ul className="divide-y divide-outline">
                                    {logDays.map(d => {
                                      // Neon serialises DATE as a full ISO timestamp ("2026-05-04T00:00:00.000Z").
                                      // Take just the YYYY-MM-DD part before re-parsing — otherwise concatenating
                                      // 'T12:00:00Z' produces an invalid timestamp and getUTCDate() → NaN.
                                      const iso = String(d.log_date).slice(0, 10);
                                      const dt = new Date(iso + 'T12:00:00Z');
                                      const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()];
                                      return (
                                        <li key={d.id} className="px-3 py-1.5 flex items-center gap-3 text-xs">
                                          <div className="w-16 flex-shrink-0">
                                            <p className="text-[10px] uppercase font-bold text-on-surface-subtle">{dayName}</p>
                                            <p className="num-mono font-semibold text-on-surface leading-tight">{dt.getUTCDate()}</p>
                                          </div>
                                          <p className="num-mono font-bold text-on-surface w-12 flex-shrink-0">{Number(d.hours)}<span className="text-on-surface-muted font-normal text-[10px]">h</span></p>
                                          <p className="flex-1 min-w-0 text-on-surface-muted truncate">{d.notes || <span className="text-on-surface-subtle italic">No note</span>}</p>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              );
                            })()}

                            {log.reviewed_by_name && !isEditing && (
                              <p className="text-[10px] text-on-surface-subtle mt-1.5">
                                {log.status === 'approved' ? 'Approved' : log.status === 'rejected' ? 'Rejected' : 'Reviewed'} by {log.reviewed_by_name}
                              </p>
                            )}

                            {/* Audit history (expandable) */}
                            {historyOpenFor === log.id && (
                              <div className="mt-3 rounded-lg border border-outline bg-surface-2/50 overflow-hidden">
                                <div className="px-3 py-2 border-b border-outline bg-surface-2 flex items-center justify-between">
                                  <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted flex items-center gap-1.5">
                                    <History size={11} /> Change history
                                  </p>
                                  <button onClick={() => toggleHistory(log.id)} className="text-on-surface-subtle hover:text-on-surface">
                                    <ChevronDown size={12} className="rotate-180 transition-transform" />
                                  </button>
                                </div>
                                {historyLoading[log.id] ? (
                                  <div className="px-3 py-4 text-center text-xs text-on-surface-subtle">Loading history…</div>
                                ) : (historyData[log.id] ?? []).length === 0 ? (
                                  <div className="px-3 py-4 text-center text-xs text-on-surface-subtle">No history yet.</div>
                                ) : (
                                  <ol className="divide-y divide-outline">
                                    {(historyData[log.id] ?? []).map(entry => {
                                      const cfg = ACTION_LABEL[entry.action] ?? ACTION_LABEL.edited;
                                      const Icon = cfg.Icon;
                                      const hoursChanged = entry.before_hours !== null && entry.before_hours !== entry.after_hours;
                                      const statusChanged = entry.before_status && entry.before_status !== entry.after_status;
                                      const descChanged = (entry.before_description ?? '') !== (entry.after_description ?? '');
                                      return (
                                        <li key={entry.id} className="px-3 py-2.5 flex gap-2.5">
                                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 ${cfg.cls}`}>
                                            <Icon size={12} />
                                          </span>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline justify-between gap-2">
                                              <p className="text-xs font-semibold text-on-surface">
                                                {cfg.label}
                                                {entry.actor_name && <span className="text-on-surface-muted font-normal"> · by {entry.actor_name}</span>}
                                                {entry.actor_role && entry.actor_role !== 'employee' && (
                                                  <span className="ml-1 inline-flex items-center px-1.5 py-0 rounded-full text-[9px] font-bold uppercase tracking-wider bg-surface-3 text-on-surface-muted">
                                                    {entry.actor_role.replace('_', ' ')}
                                                  </span>
                                                )}
                                              </p>
                                              <p className="text-[10px] text-on-surface-subtle font-mono whitespace-nowrap">{fmtTs(entry.created_at)}</p>
                                            </div>
                                            {entry.action === 'deleted' ? (
                                              <p className="text-[11px] text-danger mt-0.5">
                                                Removed (was <span className="num-mono font-semibold">{Number(entry.before_hours)}h</span>)
                                              </p>
                                            ) : hoursChanged && (
                                              <p className="text-[11px] text-on-surface-muted mt-0.5">
                                                Hours: <span className="num-mono text-on-surface-subtle line-through">{Number(entry.before_hours)}h</span> → <span className="num-mono font-semibold text-on-surface">{Number(entry.after_hours)}h</span>
                                              </p>
                                            )}
                                            {!hoursChanged && entry.action === 'created' && entry.after_hours !== null && (
                                              <p className="text-[11px] text-on-surface-muted mt-0.5">Hours: <span className="num-mono font-semibold text-on-surface">{Number(entry.after_hours)}h</span></p>
                                            )}
                                            {statusChanged && (
                                              <p className="text-[11px] text-on-surface-muted mt-0.5">
                                                Status: <span className="text-on-surface-subtle">{entry.before_status}</span> → <span className="font-semibold text-on-surface">{entry.after_status}</span>
                                              </p>
                                            )}
                                            {descChanged && (
                                              <p className="text-[11px] text-on-surface-muted mt-0.5 line-clamp-2">
                                                Description changed
                                              </p>
                                            )}
                                            {entry.reason && (
                                              <p className="text-[11px] mt-1 italic text-warning bg-warning-container px-2 py-1 rounded">
                                                "{entry.reason}"
                                              </p>
                                            )}
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ol>
                                )}
                              </div>
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
