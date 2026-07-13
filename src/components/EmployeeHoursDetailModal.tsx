import { useEffect, useState } from 'react';
import { X, AlertTriangle, CheckCircle, XCircle, Clock as ClockIcon, Pencil, Save, History, ChevronDown, Trash2, SlidersHorizontal } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from './Toaster';
import { formatWeekDays, isCurrentWeekOfMonth, isEmptyWeek } from '../utils/weekRange';
import { ProjectDailyActivityModal } from '../pages/Projects';

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
  effective_description?: string | null;
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

interface AssignmentRow {
  id: string;
  project_id: string;
  project_name?: string;
  project_client_name?: string | null;
  project_flag?: string | null;
  monthly_hours: number;
  w1_hours: number;
  w2_hours: number;
  w3_hours: number;
  w4_hours: number;
  w5_hours: number;
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
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  // Internal activity logs surface alongside project hours so the manager
  // (or admin / HR) viewing this drill-in can see the full picture —
  // someone without project allocation may still be carrying meaningful
  // load through training, recruiting, ops, doc work etc.
  const [internalLogs, setInternalLogs] = useState<Array<{ id: string; employee_id: string; activity_id: string; activity_name: string; log_date: string; hours: number; notes: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ hours: string; desc: string; reason: string }>({ hours: '', desc: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  // Allocation-change request flow: who can request, the modal target, and
  // the set of assignment ids that already have a pending request (so the
  // button switches to "Pending" instead of letting the user fire a duplicate
  // — the backend would 409 anyway, but this avoids the round-trip).
  const canRequestAlloc =
    user?.role === 'admin' || user?.role === 'hr_manager' ||
    user?.role === 'project_coordinator' || user?.role === 'employee';
  const [editingAlloc, setEditingAlloc] = useState<AssignmentRow | null>(null);
  // Drill-in further — clicking the project name on a row opens the
  // ProjectDailyActivityModal so the viewer can see the full project's
  // month (who's allocated, per-day logged hours, plan-vs-actual). Same
  // modal pattern as the Projects page so the visual stays consistent.
  const [openProject, setOpenProject] = useState<{ id: string; name: string; client_name: string | null } | null>(null);
  const [pendingAllocs, setPendingAllocs] = useState<Set<string>>(new Set());
  // Approve / reject state. Same permission surface as edit (canEditAny):
  // admin / HR / coord. Reject uses an inline mini prompt because opening
  // yet another modal on top of this one felt heavy for what's usually a
  // one-line note.
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.getHourLogs({ employee_id: employeeId, month, year }).then(d => setLogs(d as LogRow[])).catch(() => {}),
      api.getHourLogDays({ employee_id: employeeId, month, year }).then(d => setDays(d as DayRow[])).catch(() => setDays([])),
      api.getProjectAssignments({ employee_id: employeeId, month, year }).then(d => setAssignments(d as AssignmentRow[])).catch(() => setAssignments([])),
      // Same window as project hours — month boundaries. The backend
      // returns empty for users without permission, so we can fire it
      // unconditionally and not worry about a 403 banner.
      (() => {
        const from = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        return api.getInternalHourLogs({ employee_id: employeeId, from, to })
          .then(d => setInternalLogs(d ?? []))
          .catch(() => setInternalLogs([]));
      })(),
      api.getAllocationRequests({ status: 'pending' }).then(rs => {
        // Build a quick lookup for "this assignment already has a pending
        // request". Filtered to the current employee so we don't carry a
        // larger set than needed for the render.
        setPendingAllocs(new Set(rs.filter(r => r.employee_id === employeeId).map(r => r.assignment_id)));
      }).catch(() => setPendingAllocs(new Set())),
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

  // Approve / reject a pending log from inside this drill-in modal, so
  // a coord or manager reviewing the employee's month can act on the row
  // without having to navigate over to /hours/approvals. Same optimistic
  // flip + revert-on-error pattern as HoursApproval so the button feels
  // instant. reviewingId gates the button so a double-click doesn't
  // race two requests.
  const approve = async (log: LogRow) => {
    setReviewingId(log.id);
    const prev = log;
    setLogs(curr => curr.map(l => l.id === log.id ? {
      ...l, status: 'approved',
      reviewed_by_name: user?.name ?? l.reviewed_by_name,
      reviewed_at: new Date().toISOString(),
      rejection_reason: null,
    } : l));
    try {
      await api.approveHourLog(log.id, {
        reviewer_id: user?.id,
        reviewer_name: user?.name,
      });
      toast.success('Hours approved', `${employeeName} · ${Number(log.hours_logged)}h on ${log.project_name ?? 'project'}.`);
    } catch (err: any) {
      setLogs(curr => curr.map(l => l.id === log.id ? prev : l));
      toast.error('Approve failed — change reverted', err?.message);
    } finally { setReviewingId(null); }
  };
  const openReject = (log: LogRow) => {
    setRejectingId(log.id);
    setRejectReason('');
  };
  const cancelReject = () => { setRejectingId(null); setRejectReason(''); };
  const confirmReject = async (log: LogRow) => {
    const reason = rejectReason.trim();
    if (!reason) return; // button is disabled but defensive
    setReviewingId(log.id);
    const prev = log;
    setLogs(curr => curr.map(l => l.id === log.id ? {
      ...l, status: 'rejected', rejection_reason: reason,
      reviewed_by_name: user?.name ?? l.reviewed_by_name,
      reviewed_at: new Date().toISOString(),
    } : l));
    cancelReject();
    try {
      await api.rejectHourLog(log.id, {
        reviewer_id: user?.id,
        reviewer_name: user?.name,
        rejection_reason: reason,
      });
      toast.success('Hours rejected', `${employeeName} has been notified with your reason.`);
    } catch (err: any) {
      setLogs(curr => curr.map(l => l.id === log.id ? prev : l));
      toast.error('Reject failed — change reverted', err?.message);
    } finally { setReviewingId(null); }
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
        {/* Header — aurora background lives on the wrapper, but the
            grain overlay is the one that needs clipping (it tiles with a
            mix-blend-mode and would otherwise leak past the rounded
            corners). Removing overflow-hidden from the wrapper means
            long names with descenders no longer get bottom-clipped. */}
        <div className="relative aurora-bg text-white px-6 py-5">
          <div className="absolute inset-0 grain-overlay pointer-events-none overflow-hidden" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-white/70">Project hours · {MONTHS[month - 1]} {year}</p>
              <h3 className="font-display text-2xl font-bold tracking-tight leading-snug mt-1 break-words">{employeeName}</h3>
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
          ) : (
            <div className="p-5 space-y-5">
              {/* ── Projects assigned this month — what coordinator planned ── */}
              {assignments.length > 0 && (
                <div className="rounded-xl-2 border border-outline bg-surface shadow-elev-1 overflow-hidden">
                  <div className="px-4 py-2.5 bg-surface-2 border-b border-outline flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">
                      Projects assigned · {MONTHS[month-1]} {year}
                    </p>
                    <p className="text-[10px] text-on-surface-subtle">
                      <span className="num-mono font-semibold text-on-surface">{assignments.length}</span> project{assignments.length === 1 ? '' : 's'}
                      <span className="mx-1.5">·</span>
                      <span className="num-mono font-semibold text-on-surface">{assignments.reduce((s, a) => s + Number(a.monthly_hours), 0)}h</span> planned
                    </p>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-surface-2/50 text-on-surface-subtle">
                      <tr>
                        <th className="px-4 py-2 text-left font-bold tracking-wider">Project</th>
                        {[1,2,3,4,5].map(w => {
                          const empty = isEmptyWeek(month, year, w);
                          const cur   = isCurrentWeekOfMonth(month, year, w);
                          return (
                            <th key={w} className={`px-2 py-2 text-center font-bold ${cur ? 'bg-accent/10' : ''} ${empty ? 'opacity-40' : ''}`}>
                              <div className={cur ? 'text-accent' : ''}>W{w}</div>
                              <div className={`text-[9px] font-normal normal-case tracking-normal ${cur ? 'text-accent' : 'text-on-surface-subtle'}`}>
                                {empty ? '—' : formatWeekDays(month, year, w)}
                              </div>
                            </th>
                          );
                        })}
                        <th className="px-2 py-2 text-center font-bold bg-surface-3">M</th>
                        <th className="px-3 py-2 text-right font-bold">Logged / Plan</th>
                        {canRequestAlloc && <th className="px-2 py-2 text-right font-bold w-px">{/* edit column */}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline">
                      {assignments
                        .slice()
                        .sort((a, b) => (a.project_name ?? '').localeCompare(b.project_name ?? ''))
                        .map(a => {
                          // Sum approved + pending logs for this assignment across the month
                          const projectLogs = logs.filter(l => l.project_id === a.project_id);
                          const approvedH = projectLogs.filter(l => l.status === 'approved').reduce((s, l) => s + Number(l.hours_logged), 0);
                          const pendingH  = projectLogs.filter(l => l.status === 'pending').reduce((s, l) => s + Number(l.hours_logged), 0);
                          const plan = Number(a.monthly_hours);
                          const totalCounted = approvedH + pendingH;
                          const over = approvedH > plan;
                          return (
                            <tr key={a.id} className="hover:bg-surface-2/40 transition-colors">
                              <td className="px-4 py-2">
                                <button
                                  onClick={() => setOpenProject({
                                    id: a.project_id,
                                    name: a.project_name ?? '',
                                    client_name: a.project_client_name ?? null,
                                  })}
                                  title="Open project — see who's allocated, logged hours, plan vs actual"
                                  className="text-left group">
                                  <p className="font-semibold text-on-surface leading-tight group-hover:text-accent transition-colors">
                                    {a.project_flag && (
                                      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${a.project_flag === 'red' ? 'bg-danger' : 'bg-warning'}`} />
                                    )}
                                    {a.project_name}
                                  </p>
                                  {a.project_client_name && <p className="text-[10px] text-on-surface-muted">{a.project_client_name}</p>}
                                </button>
                              </td>
                              {[a.w1_hours, a.w2_hours, a.w3_hours, a.w4_hours, a.w5_hours].map((h, i) => (
                                <td key={i} className="px-2 py-2 text-center">
                                  <span className={`num-mono ${Number(h) > 0 ? 'text-on-surface font-semibold' : 'text-on-surface-subtle'}`}>{Number(h)}</span>
                                </td>
                              ))}
                              <td className="px-2 py-2 text-center bg-surface-2 font-bold">
                                <span className="num-mono text-on-surface">{plan}</span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <p className={`num-mono font-bold ${over ? 'text-warning' : approvedH === 0 && pendingH === 0 ? 'text-on-surface-subtle' : 'text-on-surface'}`}>
                                  {approvedH}<span className="text-on-surface-muted font-normal">/{plan}</span>
                                </p>
                                {pendingH > 0 && (
                                  <p className="text-[10px] text-warning">
                                    +<span className="num-mono">{pendingH}h</span> pending
                                  </p>
                                )}
                              </td>
                              {canRequestAlloc && (
                                <td className="px-2 py-2 text-right">
                                  {pendingAllocs.has(a.id) ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-warning bg-warning-container px-2 py-1 rounded-md whitespace-nowrap">
                                      <ClockIcon size={10} /> Pending
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => setEditingAlloc(a)}
                                      title="Propose a change to this allocation"
                                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent border border-accent/30 hover:bg-accent/10 px-2 py-1 rounded-md whitespace-nowrap">
                                      <SlidersHorizontal size={10} /> Edit
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Week-by-week submitted logs ── */}
              {weeks.length === 0 ? (
                <div className="px-6 py-12 text-center bg-surface-2/30 rounded-xl-2 border border-outline border-dashed">
                  <ClockIcon size={24} className="mx-auto text-on-surface-subtle mb-2" />
                  <p className="text-sm text-on-surface-muted">No hour logs submitted yet for {employeeName} in {MONTHS[month-1]} {year}.</p>
                  {assignments.length > 0 && (
                    <p className="text-xs text-on-surface-subtle mt-1">Plan above shows what's allocated — actuals will appear once they log time.</p>
                  )}
                </div>
              ) : (
              <div className="space-y-4">
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
                                    {(log.effective_description || log.work_description) && (
                                      <p className="text-xs text-on-surface-muted mt-1 leading-relaxed whitespace-pre-wrap break-words">{log.effective_description || log.work_description}</p>
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
                                {/* Approve / Reject shortcuts — only for
                                    pending rows. Same permission surface
                                    as edit; the backend accepts anyone
                                    with a user id, so this mirrors the
                                    existing gate elsewhere. */}
                                {canEditAny && !isEditing && log.status === 'pending' && (
                                  <>
                                    <button onClick={() => approve(log)}
                                      disabled={reviewingId === log.id}
                                      title="Approve these hours"
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-success-container text-success hover:opacity-90 disabled:opacity-50">
                                      <CheckCircle size={12} /> Approve
                                    </button>
                                    <button onClick={() => openReject(log)}
                                      disabled={reviewingId === log.id}
                                      title="Reject with a reason"
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-danger-container text-danger hover:opacity-90 disabled:opacity-50">
                                      <XCircle size={12} /> Reject
                                    </button>
                                  </>
                                )}
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

                            {/* Reject-with-reason inline prompt. Sits
                                inside the row so the visual context
                                stays intact. Reason is required — the
                                employee sees it in the rejection
                                notification. */}
                            {rejectingId === log.id && (
                              <div className="mt-2 rounded-lg border border-danger/25 bg-danger-container/40 p-3 space-y-2">
                                <label className="text-[10px] uppercase tracking-[0.16em] font-bold text-danger block">
                                  Reason for rejection <span className="opacity-70">*</span>
                                </label>
                                <textarea
                                  value={rejectReason}
                                  onChange={e => setRejectReason(e.target.value)}
                                  rows={2}
                                  autoFocus
                                  placeholder="e.g. missing daily notes; please add task descriptions and resubmit."
                                  className="w-full bg-surface border border-outline rounded-md px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-danger/30 resize-none"
                                />
                                <p className="text-[10px] text-on-surface-muted">
                                  {employeeName} sees this reason in the notification. They can edit their log and resubmit.
                                </p>
                                <div className="flex items-center gap-2 justify-end">
                                  <button onClick={cancelReject}
                                    className="px-2.5 py-1.5 rounded-md text-xs text-on-surface-muted hover:bg-surface-2">
                                    Cancel
                                  </button>
                                  <button onClick={() => confirmReject(log)}
                                    disabled={!rejectReason.trim() || reviewingId === log.id}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-danger text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
                                    <XCircle size={11} /> Reject hours
                                  </button>
                                </div>
                              </div>
                            )}

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
                                        <li key={d.id} className="px-3 py-1.5 flex items-start gap-3 text-xs">
                                          <div className="w-16 flex-shrink-0">
                                            <p className="text-[10px] uppercase font-bold text-on-surface-subtle">{dayName}</p>
                                            <p className="num-mono font-semibold text-on-surface leading-tight">{dt.getUTCDate()}</p>
                                          </div>
                                          <p className="num-mono font-bold text-on-surface w-12 flex-shrink-0">{Number(d.hours)}<span className="text-on-surface-muted font-normal text-[10px]">h</span></p>
                                          <p className="flex-1 min-w-0 text-on-surface-muted break-words whitespace-pre-wrap leading-snug">{d.notes || <span className="text-on-surface-subtle italic">No note</span>}</p>
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

              {/* ── Internal activities for the month ─────────────────────────
                  Surface internal hour logs alongside project hours so
                  managers / HR / admin viewing this drill-in see the full
                  picture of someone's time — especially valuable for people
                  with little or no project allocation (HR, recruiters,
                  ops) who otherwise look "idle" here. */}
              <InternalLogsSection
                logs={internalLogs}
                month={month}
                year={year}
                employeeName={employeeName}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-outline bg-surface-2/60 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-3 rounded-lg transition-colors">Close</button>
        </div>
      </div>
      {editingAlloc && (
        <EditAllocationModal
          assignment={editingAlloc}
          employeeName={employeeName}
          month={month}
          year={year}
          onClose={() => setEditingAlloc(null)}
          onSubmitted={() => { setEditingAlloc(null); reload(); }}
        />
      )}
      {/* Project drill-in. Reuses the same daily-activity modal the
          /projects page exposes, so HR / managers / coords see one
          consistent layout regardless of where they jumped in from. */}
      {openProject && (
        <ProjectDailyActivityModal
          project={openProject as any}
          onClose={() => setOpenProject(null)}
          initialMonth={month}
          initialYear={year}
        />
      )}
    </div>
  );
}

// Modal for proposing a change to an assignment's W1-W5 + monthly. Submits
// as a pending allocation_change_request; coordinator approves separately
// to write back to project_assignments. Requester puts in a free-text
// reason so the coordinator has context to decide.
function EditAllocationModal({ assignment: a, employeeName, month, year, onClose, onSubmitted }: {
  assignment: AssignmentRow;
  employeeName: string;
  month: number; year: number;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [w, setW] = useState({
    w1: String(Number(a.w1_hours) || 0),
    w2: String(Number(a.w2_hours) || 0),
    w3: String(Number(a.w3_hours) || 0),
    w4: String(Number(a.w4_hours) || 0),
    w5: String(Number(a.w5_hours) || 0),
    monthly: String(Number(a.monthly_hours) || 0),
  });
  // Auto-sum the week values into the monthly total UNLESS the user has
  // touched the monthly field directly. That way the common case (edit a
  // week, monthly follows) is friction-free, but the edge case (a project
  // that bills a flat monthly cap regardless of week split) is still
  // expressible.
  const [monthlyTouched, setMonthlyTouched] = useState(false);
  const weekSum = ['w1','w2','w3','w4','w5'].reduce((s, k) => s + (Number((w as any)[k]) || 0), 0);
  const effectiveMonthly = monthlyTouched ? Number(w.monthly) || 0 : weekSum;

  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!reason.trim()) { setError('Reason is required'); return; }
    setBusy(true); setError('');
    try {
      await api.createAllocationRequest({
        assignment_id: a.id,
        proposed_w1: Number(w.w1) || 0,
        proposed_w2: Number(w.w2) || 0,
        proposed_w3: Number(w.w3) || 0,
        proposed_w4: Number(w.w4) || 0,
        proposed_w5: Number(w.w5) || 0,
        proposed_monthly: effectiveMonthly,
        reason: reason.trim(),
      });
      toast.success('Sent for coordinator approval', `${employeeName} · ${a.project_name}.`);
      onSubmitted();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to submit');
      toast.error('Failed to send', e?.message);
    }
    finally { setBusy(false); }
  };

  // NOTE: Do NOT extract these inputs into a closure-defined sub-component.
  // The parent re-renders on every keystroke and any inline component would
  // get a fresh function identity → React treats it as a new component type
  // → remounts the <input> → focus is lost between every character typed.
  // Keep the JSX inline.

  return (
    // stopPropagation on the backdrop is critical here. This modal is
    // rendered as a sibling of the parent EmployeeHoursDetailModal's content
    // but INSIDE its full-screen backdrop, which has onClick={onClose}. Any
    // click reaching the parent backdrop closes BOTH modals — and yes,
    // clicking inside an <input> dispatches a click event that bubbles up
    // before the focus is established. So a stray keystroke or click in
    // this child modal was tearing down the parent on every interaction.
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
         onClick={e => e.stopPropagation()}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-outline">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div>
            <h2 className="font-display text-base font-bold text-on-surface inline-flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-accent" /> Propose allocation change
            </h2>
            <p className="text-[11px] text-on-surface-muted mt-0.5">
              {employeeName} · {a.project_name} · {month}/{year}
            </p>
          </div>
          <button onClick={onClose}><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-on-surface-muted">
            Coordinator approval is required before this takes effect. Until they approve, the planned hours stay as they are.
          </p>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-subtle">Current plan</p>
            </div>
            <div className="flex gap-2 justify-between bg-surface-2/50 rounded-lg p-3 border border-outline">
              {['w1','w2','w3','w4','w5'].map(k => (
                <div key={k} className="flex flex-col items-center">
                  <span className="text-[9px] uppercase tracking-wider font-bold text-on-surface-subtle">{k.toUpperCase()}</span>
                  <span className="num-mono text-sm text-on-surface-muted">{Number((a as any)[`${k}_hours`]) || 0}</span>
                </div>
              ))}
              <div className="flex flex-col items-center pl-2 ml-2 border-l border-outline">
                <span className="text-[9px] uppercase tracking-wider font-bold text-on-surface-subtle">Month</span>
                <span className="num-mono text-sm font-bold text-on-surface">{Number(a.monthly_hours) || 0}</span>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wider font-bold text-accent">Proposed plan</p>
              {!monthlyTouched && (
                <span className="text-[10px] text-on-surface-subtle">Monthly auto-sums from weeks</span>
              )}
            </div>
            <div className="flex gap-2 justify-between bg-accent/5 rounded-lg p-3 border border-accent/30">
              {(['w1','w2','w3','w4','w5'] as const).map(k => (
                <div key={k} className="flex flex-col items-center">
                  <label className="text-[10px] font-bold text-on-surface-subtle uppercase tracking-wider mb-1">{k.toUpperCase()}</label>
                  <input type="number" min="0" step="0.5" value={w[k]}
                    onChange={e => { const v = e.target.value; setW(p => ({ ...p, [k]: v })); }}
                    className="w-14 text-center num-mono text-sm border border-outline rounded-md py-1.5 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
                </div>
              ))}
              <div className="flex flex-col items-center pl-2 ml-2 border-l border-accent/30">
                <label className="text-[10px] font-bold text-accent uppercase tracking-wider mb-1">Month</label>
                <input type="number" min="0" step="0.5" value={monthlyTouched ? w.monthly : String(effectiveMonthly)}
                  onChange={e => { setMonthlyTouched(true); setW(p => ({ ...p, monthly: e.target.value })); }}
                  className="w-16 text-center num-mono text-sm font-bold border border-accent/40 rounded-md py-1.5 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-on-surface-subtle mb-1 block">Reason *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="e.g. Sprint scope changed — moving 4h from W2 to W3 for the migration. Coordinator will see this."
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>

          {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-6 py-3 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50">
            {busy ? 'Sending…' : 'Send for approval'}
          </button>
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

// Renders the month's internal activity logs grouped by activity name,
// with per-date entries and notes. Returns null when there are no logs
// so we don't show an empty section for project-only employees.
function InternalLogsSection({ logs, month, year, employeeName }: {
  logs: Array<{ id: string; activity_id: string; activity_name: string; log_date: string; hours: number; notes: string | null }>;
  month: number;
  year: number;
  employeeName: string;
}) {
  if (!logs || logs.length === 0) return null;
  const totalHours = logs.reduce((s, l) => s + Number(l.hours || 0), 0);
  const byActivity = new Map<string, { name: string; total: number; entries: typeof logs }>();
  for (const l of logs) {
    const key = l.activity_id ?? l.activity_name ?? 'other';
    const cur = byActivity.get(key) ?? { name: l.activity_name ?? 'Other', total: 0, entries: [] as typeof logs };
    cur.total += Number(l.hours || 0);
    cur.entries.push(l);
    byActivity.set(key, cur);
  }
  const groups = Array.from(byActivity.values()).sort((a, b) => b.total - a.total);
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-display text-sm font-bold text-on-surface tracking-tight">Internal activities</h4>
          <p className="text-[11px] text-on-surface-subtle mt-0.5">
            Logged by {employeeName.split(' ')[0]} — not tied to a billable project.
          </p>
        </div>
        <div className="text-right">
          <p className="num-mono text-lg font-bold text-on-surface">{totalHours}h</p>
          <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle">total · {MONTHS[month-1]} {year}</p>
        </div>
      </div>
      <div className="space-y-2">
        {groups.map(g => (
          <div key={g.name} className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-2/40 border-b border-outline flex items-center justify-between">
              <p className="text-sm font-semibold text-on-surface">{g.name}</p>
              <div className="flex items-center gap-3 text-right">
                <span className="num-mono text-sm font-bold text-on-surface">{g.total}h</span>
                <span className="text-[10px] text-on-surface-subtle">{g.entries.length} {g.entries.length === 1 ? 'entry' : 'entries'}</span>
              </div>
            </div>
            <div className="divide-y divide-outline">
              {g.entries
                .slice()
                .sort((a, b) => b.log_date.localeCompare(a.log_date))
                .map(e => (
                  <div key={e.id} className="px-4 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-on-surface-muted num-mono">
                        {new Date(e.log_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </p>
                      {e.notes && (
                        <p className="text-xs text-on-surface mt-0.5 whitespace-pre-line">{e.notes}</p>
                      )}
                    </div>
                    <span className="num-mono text-sm font-semibold text-on-surface flex-shrink-0">{e.hours}h</span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
