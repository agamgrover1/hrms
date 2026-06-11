import { useState, useEffect, useCallback, useMemo } from 'react';
import { CheckCircle, XCircle, AlertTriangle, X, Filter, ClipboardCheck, ArrowUpDown, Clock, PauseCircle, MessageSquare, Send } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

type SortKey = 'oldest' | 'newest' | 'project' | 'hours_desc' | 'over_alloc';

function ago(ts: string | null | undefined): string {
  if (!ts) return '';
  const ms = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtSubmitted(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  } catch { return '—'; }
}

interface HourLog {
  id: string;
  project_id: string;
  employee_id: string;
  employee_name: string;
  month: number;
  year: number;
  week_num: number;
  hours_logged: number;
  work_description: string | null;
  effective_description: string | null;  // server-side fallback: aggregates day notes when work_description is empty
  day_notes: Array<{ date: string; hours: number; notes: string | null }> | null;
  status: string;
  rejection_reason: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  submitted_at: string;
  project_name?: string;
  project_client_name?: string | null;
  project_reporting_id?: string | null;
  project_reporting_name?: string | null;
  w1_hours?: number; w2_hours?: number; w3_hours?: number; w4_hours?: number; w5_hours?: number;
  comment_count?: number;
}

interface HourLogComment {
  id: string;
  author_id: string | null;
  author_name: string | null;
  author_role: string | null;
  body: string;
  created_at: string;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function weekAllocFor(log: HourLog): number {
  const k = `w${log.week_num}_hours` as 'w1_hours' | 'w2_hours' | 'w3_hours' | 'w4_hours' | 'w5_hours';
  return Number(log[k] ?? 0);
}

export default function HoursApproval() {
  const { user } = useAuth();
  const role = user?.role ?? 'employee';
  const isAdmin = role === 'admin' || role === 'hr_manager' || role === 'project_coordinator';

  // Map app_user → their employee.id (for project_reporting_id matching)
  const [reviewerEmpId, setReviewerEmpId] = useState<string | null>(null);
  const [logs, setLogs] = useState<HourLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'pending' | 'on_hold' | 'approved' | 'rejected' | 'all'>('pending');
  const [scope, setScope] = useState<'mine' | 'all'>(isAdmin ? 'all' : 'mine');
  const [sortBy, setSortBy] = useState<SortKey>('oldest');
  const [rejecting, setRejecting] = useState<HourLog | null>(null);
  const [holding, setHolding]   = useState<HourLog | null>(null);
  const [commentingOn, setCommentingOn] = useState<HourLog | null>(null);

  // Resolve current user's employee.id once
  useEffect(() => {
    if (!user?.employee_id_ref) return;
    api.getEmployees()
      .then(emps => {
        const me = emps.find((e: any) => e.employee_id === user.employee_id_ref);
        if (me) setReviewerEmpId(me.id);
      })
      .catch(() => {});
  }, [user?.employee_id_ref]);

  const load = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (filterStatus !== 'all') params.status = filterStatus;
    if (scope === 'mine' && reviewerEmpId) params.reviewer_id = reviewerEmpId;
    api.getHourLogs(params)
      .then(d => setLogs(d as HourLog[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterStatus, scope, reviewerEmpId]);

  useEffect(() => {
    if (scope === 'mine' && !reviewerEmpId) return; // wait until we know who I am
    load();
  }, [load, scope, reviewerEmpId]);

  const approve = async (log: HourLog) => {
    await api.approveHourLog(log.id, {
      reviewer_id: reviewerEmpId ?? user?.id,
      reviewer_name: user?.name,
    }).catch((err: any) => alert(err.message ?? 'Approve failed.'));
    load();
  };

  const reject = async (log: HourLog, reason: string) => {
    await api.rejectHourLog(log.id, {
      reviewer_id: reviewerEmpId ?? user?.id,
      reviewer_name: user?.name,
      rejection_reason: reason,
    }).catch((err: any) => alert(err.message ?? 'Reject failed.'));
    setRejecting(null);
    load();
  };

  const hold = async (log: HourLog, note: string) => {
    await api.holdHourLog(log.id, {
      reviewer_id: reviewerEmpId ?? user?.id,
      reviewer_name: user?.name,
      reviewer_role: user?.role,
      note,
    }).catch((err: any) => alert(err.message ?? 'Hold failed.'));
    setHolding(null);
    load();
  };

  // Apply sort BEFORE grouping so groups inherit the order — for "oldest"
  // sort, the project/week with the oldest submission floats to the top.
  const sortedLogs = useMemo(() => {
    const copy = [...logs];
    const cmpDate = (a: HourLog, b: HourLog) => {
      const ax = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
      const bx = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
      return ax - bx;
    };
    switch (sortBy) {
      case 'oldest':     copy.sort(cmpDate); break;
      case 'newest':     copy.sort((a, b) => -cmpDate(a, b)); break;
      case 'project':    copy.sort((a, b) => (a.project_name ?? '').localeCompare(b.project_name ?? '')); break;
      case 'hours_desc': copy.sort((a, b) => Number(b.hours_logged) - Number(a.hours_logged)); break;
      case 'over_alloc': copy.sort((a, b) => (Number(b.hours_logged) - weekAllocFor(b)) - (Number(a.hours_logged) - weekAllocFor(a))); break;
    }
    return copy;
  }, [logs, sortBy]);

  // Group by project + week_num, but preserve sort order: first-seen wins.
  const grouped: Record<string, HourLog[]> = {};
  const groupOrder: string[] = [];
  sortedLogs.forEach(l => {
    const key = `${l.project_name ?? l.project_id}__${l.year}-${String(l.month).padStart(2, '0')}-W${l.week_num}`;
    if (!grouped[key]) { grouped[key] = []; groupOrder.push(key); }
    grouped[key].push(l);
  });

  const oldestPending = useMemo(() => {
    const pending = sortedLogs.filter(l => l.status === 'pending');
    if (!pending.length) return null;
    return pending.reduce((acc, l) =>
      (!acc || new Date(l.submitted_at).getTime() < new Date(acc.submitted_at).getTime()) ? l : acc
    , null as HourLog | null);
  }, [sortedLogs]);

  const counts = {
    pending:  logs.filter(l => l.status === 'pending').length,
    on_hold:  logs.filter(l => l.status === 'on_hold').length,
    approved: logs.filter(l => l.status === 'approved').length,
    rejected: logs.filter(l => l.status === 'rejected').length,
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden animate-fade-up stagger-1">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-warning-container blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-warning">{counts.pending}</p>
            <p className="text-xs text-on-surface-muted mt-0.5">Pending</p>
          </div>
        </div>
        <div className="group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden animate-fade-up stagger-2">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-accent/15 blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-accent">{counts.on_hold}</p>
            <p className="text-xs text-on-surface-muted mt-0.5">On hold</p>
          </div>
        </div>
        <div className="group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden animate-fade-up stagger-3">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-success-container blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-success">{counts.approved}</p>
            <p className="text-xs text-on-surface-muted mt-0.5">Approved</p>
          </div>
        </div>
        <div className="group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden animate-fade-up stagger-4">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-danger-container blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-danger">{counts.rejected}</p>
            <p className="text-xs text-on-surface-muted mt-0.5">Rejected</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5 bg-surface rounded-lg border border-outline p-1">
          {(['pending','on_hold','approved','rejected','all'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize ${filterStatus === s ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
              {s === 'on_hold' ? 'On hold' : s}
            </button>
          ))}
        </div>
        {isAdmin && (
          <div className="inline-flex items-center gap-1.5 bg-surface rounded-lg border border-outline p-1">
            <button onClick={() => setScope('mine')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${scope === 'mine' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
              <Filter size={11} className="inline mr-1" />My Reviews
            </button>
            <button onClick={() => setScope('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${scope === 'all' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
              All Projects
            </button>
          </div>
        )}
        <div className="inline-flex items-center gap-1.5 bg-surface rounded-lg border border-outline px-2 py-1">
          <ArrowUpDown size={12} className="text-on-surface-subtle" />
          <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)}
            className="text-xs bg-transparent focus:outline-none font-semibold text-on-surface-muted">
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="project">By project</option>
            <option value="hours_desc">Most hours</option>
            <option value="over_alloc">Over allocation</option>
          </select>
        </div>
      </div>

      {/* Stale-pending nudge — if the oldest pending log has been sitting more
          than 48h, surface it so the reviewer knows people are waiting. */}
      {filterStatus === 'pending' && oldestPending && (Date.now() - new Date(oldestPending.submitted_at).getTime()) > 48 * 3600 * 1000 && (
        <div className="rounded-xl-2 border border-warning/40 bg-warning-container/40 px-4 py-2.5 flex items-center gap-2 text-sm">
          <Clock size={14} className="text-warning shrink-0" />
          <span className="text-on-surface">
            <b>{oldestPending.employee_name}</b>'s log on <b>{oldestPending.project_name}</b> has been pending for <b>{ago(oldestPending.submitted_at)}</b>.
          </span>
        </div>
      )}

      {/* Groups */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-surface rounded-xl-2 p-12 border border-outline text-center text-on-surface-subtle">Loading logs…</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="bg-surface rounded-xl-2 p-12 border border-outline text-center">
            <ClipboardCheck size={32} className="mx-auto text-on-surface-subtle mb-2" />
            <p className="text-sm text-on-surface-muted">Nothing to review here.</p>
          </div>
        ) : groupOrder.map(key => {
          const group = grouped[key];
          const sample = group[0];
          // Newest-submitted in this group — used to show "submitted Xh ago"
          // alongside the week label.
          const groupLatest = group.reduce((acc: HourLog | null, l) =>
            (!acc || new Date(l.submitted_at).getTime() > new Date(acc.submitted_at).getTime()) ? l : acc
          , null as HourLog | null);
          return (
            <div key={key} className="relative bg-surface rounded-xl-3 border border-outline shadow-elev-2 overflow-hidden group hover:shadow-elev-3 transition-shadow">
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-0 group-hover:opacity-50 transition-opacity duration-500" />
              <div className="relative px-4 py-3 bg-gradient-to-r from-brand-container/50 to-surface border-b border-outline flex items-center justify-between">
                <div>
                  <p className="font-display text-xl font-bold tracking-tight text-on-surface">{sample.project_name}{sample.project_client_name ? ` · ${sample.project_client_name}` : ''}</p>
                  <p className="text-xs text-on-surface-muted">
                    {MONTHS[sample.month-1]} {sample.year} · Week {sample.week_num}
                    {groupLatest?.submitted_at && (
                      <> · <span className="text-on-surface">last submitted {ago(groupLatest.submitted_at)}</span></>
                    )}
                  </p>
                </div>
                <p className="text-xs text-on-surface-subtle">{group.length} {group.length === 1 ? 'entry' : 'entries'}</p>
              </div>
              <table className="relative w-full text-sm">
                <thead className="bg-surface-2 border-b border-outline text-left text-xs font-semibold text-on-surface-muted uppercase">
                  <tr>
                    <th className="px-4 py-2">Employee</th>
                    <th className="px-4 py-2 text-right">Allocated</th>
                    <th className="px-4 py-2 text-right">Logged</th>
                    <th className="px-4 py-2">Submitted</th>
                    <th className="px-4 py-2">What they worked on</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline">
                  {group.map(log => {
                    const alloc = weekAllocFor(log);
                    const delta = Number(log.hours_logged) - alloc;
                    const overAlloc = delta > 0;
                    const isStale = log.status === 'pending' && log.submitted_at && (Date.now() - new Date(log.submitted_at).getTime()) > 48 * 3600 * 1000;
                    return (
                      <tr key={log.id} className="hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3 font-medium text-on-surface">{log.employee_name}</td>
                        <td className="px-4 py-3 text-right text-on-surface-muted num-mono">{alloc}h</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`num-mono inline-flex items-center gap-1 font-semibold ${overAlloc ? 'text-danger' : 'text-on-surface'}`}>
                            {log.hours_logged}h
                            {delta !== 0 && (
                              <span className="text-[10px] font-normal text-on-surface-subtle">
                                {overAlloc && <AlertTriangle size={10} className="inline text-danger mr-0.5" />}
                                {overAlloc ? '+' : ''}{delta}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="text-on-surface num-mono">{fmtSubmitted(log.submitted_at)}</div>
                          <div className={`text-[10px] mt-0.5 ${isStale ? 'text-warning font-semibold' : 'text-on-surface-subtle'}`}>
                            {ago(log.submitted_at)}
                            {isStale && <span className="ml-1">· stale</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-on-surface-muted text-xs max-w-md">
                          <DescriptionCell log={log} />
                          {log.status === 'rejected' && log.rejection_reason && (
                            <p className="text-danger mt-1 flex items-center gap-1">
                              <XCircle size={11} /> {log.rejection_reason}
                            </p>
                          )}
                          {log.status === 'on_hold' && log.rejection_reason && (
                            <p className="text-accent mt-1 flex items-center gap-1">
                              <PauseCircle size={11} /> {log.rejection_reason}
                            </p>
                          )}
                          {!!log.comment_count && log.comment_count > 0 && (
                            <button onClick={() => setCommentingOn(log)}
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline">
                              <MessageSquare size={11} /> {log.comment_count} {log.comment_count === 1 ? 'comment' : 'comments'}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={log.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(log.status === 'pending' || log.status === 'on_hold') ? (
                            <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                              <button onClick={() => approve(log)}
                                className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-white bg-success hover:bg-success/90 transition-colors"
                                title="Approve these hours">
                                <CheckCircle size={12} className="inline mr-1" />Approve
                              </button>
                              {log.status === 'pending' && (
                                <button onClick={() => setHolding(log)}
                                  className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-accent border border-accent/40 hover:bg-accent/10 transition-colors"
                                  title="Park this log and ask the employee for clarification">
                                  <PauseCircle size={12} className="inline mr-1" />Hold
                                </button>
                              )}
                              <button onClick={() => setCommentingOn(log)}
                                className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-on-surface-muted border border-outline hover:bg-surface-2 transition-colors"
                                title="Open the comments thread">
                                <MessageSquare size={12} className="inline mr-1" />Discuss
                              </button>
                              <button onClick={() => setRejecting(log)}
                                className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-danger border border-danger/30 hover:bg-danger-container transition-colors">
                                <XCircle size={12} className="inline mr-1" />Reject
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2">
                              <button onClick={() => setCommentingOn(log)}
                                className="px-2 py-1 rounded-md text-[11px] font-semibold text-on-surface-muted border border-outline hover:bg-surface-2 transition-colors"
                                title="Open the comments thread">
                                <MessageSquare size={11} className="inline mr-1" />Discuss
                              </button>
                              <span className="text-xs text-on-surface-subtle">{log.reviewed_by_name || '—'}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {rejecting && (
        <RejectModal
          log={rejecting}
          onClose={() => setRejecting(null)}
          onConfirm={reason => reject(rejecting, reason)}
        />
      )}

      {holding && (
        <HoldModal
          log={holding}
          onClose={() => setHolding(null)}
          onConfirm={note => hold(holding, note)}
        />
      )}

      {commentingOn && (
        <CommentsModal
          log={commentingOn}
          currentUser={{ id: reviewerEmpId ?? user?.id ?? '', name: user?.name ?? '', role: user?.role ?? '' }}
          onClose={() => setCommentingOn(null)}
          onAfterPost={load}
        />
      )}
    </div>
  );
}

// Renders the "What they worked on" cell. Prefers structured per-day notes
// (each day on its own row, with hours, so the reviewer sees the daily
// shape of the work). Falls back to the aggregated effective_description
// or the legacy work_description when day-level data is missing.
function DescriptionCell({ log }: { log: HourLog }) {
  const days = (log.day_notes ?? []).filter(d => (d.notes ?? '').trim().length > 0);
  if (days.length > 0) {
    return (
      <ul className="space-y-1">
        {days.map((d) => {
          const dt = new Date(String(d.date).slice(0, 10) + 'T12:00:00Z');
          const dayLabel = dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
          return (
            <li key={d.date} className="flex items-start gap-2 leading-snug">
              <span className="num-mono text-[10px] font-semibold text-on-surface-subtle min-w-[42px] uppercase tracking-wide">{dayLabel}</span>
              <span className="num-mono text-[10px] font-bold text-accent min-w-[28px]">{Number(d.hours)}h</span>
              <span className="text-on-surface flex-1">{d.notes}</span>
            </li>
          );
        })}
      </ul>
    );
  }
  const fallback = log.effective_description || log.work_description;
  if (fallback) return <span>{fallback}</span>;
  return <span className="text-on-surface-subtle italic">—</span>;
}

function StatusPill({ status }: { status: string }) {
  const cfg = status === 'approved'
    ? { label: 'Approved', className: 'bg-success-container text-success' }
    : status === 'rejected'
    ? { label: 'Rejected', className: 'bg-danger-container text-danger' }
    : status === 'on_hold'
    ? { label: 'On hold',  className: 'bg-accent/15 text-accent' }
    : { label: 'Pending',  className: 'bg-warning-container text-warning' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// Hold modal — reviewer parks the log instead of approving or rejecting
// outright. The note becomes the first comment on the thread so the
// employee sees exactly what's being asked. Keep the language soft —
// "ask for clarification", not "reject" — since on_hold is recoverable.
function HoldModal({ log, onClose, onConfirm }: { log: HourLog; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <h3 className="font-display text-lg font-semibold text-on-surface inline-flex items-center gap-2">
            <PauseCircle size={18} className="text-accent" /> Put on hold
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-sm text-on-surface-muted">
            Parking <span className="num-mono font-medium text-on-surface">{log.hours_logged}h</span> from{' '}
            <span className="font-medium text-on-surface">{log.employee_name}</span> on{' '}
            <span className="font-medium text-on-surface">{log.project_name}</span> (W{log.week_num}).
            They'll get notified and can reply on the thread.
          </p>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">What do you need clarified? *</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={4}
              placeholder="e.g. The post on Wednesday — can you share the link and which client it was for?"
              className="w-full bg-surface border border-outline rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg transition-colors">Cancel</button>
          <button onClick={() => note.trim() && onConfirm(note.trim())} disabled={!note.trim()}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 bg-accent hover:opacity-90 transition-colors">
            Put on hold
          </button>
        </div>
      </div>
    </div>
  );
}

// Comments thread modal — loads the full back-and-forth for one log and
// lets the viewer add a reply. Used by reviewer (to ask for justification
// without flipping status), employee (to respond), or anyone else with
// access. Each side gets pinged on the other's reply via the POST
// endpoint's notification logic, so this is the entire conversation.
function CommentsModal({ log, currentUser, onClose, onAfterPost }: {
  log: HourLog;
  currentUser: { id: string; name: string; role: string };
  onClose: () => void;
  onAfterPost: () => void;
}) {
  const [comments, setComments] = useState<HourLogComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    api.getHourLogComments(log.id)
      .then(setComments)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [log.id]);
  useEffect(refresh, [refresh]);

  const post = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await api.addHourLogComment(log.id, {
        author_id: currentUser.id,
        author_name: currentUser.name,
        author_role: currentUser.role,
        body: draft.trim(),
      });
      setDraft('');
      refresh();
      onAfterPost();
    } catch (e: any) { alert(e?.message ?? 'Failed to post comment'); }
    finally { setPosting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <div>
            <h3 className="font-display text-lg font-semibold text-on-surface inline-flex items-center gap-2">
              <MessageSquare size={18} className="text-accent" /> Discussion
            </h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              {log.employee_name} · {log.project_name} · W{log.week_num} · <span className="num-mono">{log.hours_logged}h</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3 overflow-y-auto flex-1 bg-surface-2/30">
          {loading ? (
            <p className="text-sm text-on-surface-subtle text-center py-8">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-on-surface-subtle text-center py-8">
              No comments yet. Start the conversation below — useful when a specific DSR task needs justification.
            </p>
          ) : (
            comments.map(c => {
              const isMe = !!c.author_id && c.author_id === currentUser.id;
              return (
                <div key={c.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${isMe ? 'bg-accent text-on-accent' : 'bg-surface border border-outline text-on-surface'}`}>
                    <div className={`text-[10px] font-semibold mb-0.5 ${isMe ? 'text-on-accent/80' : 'text-on-surface-muted'}`}>
                      {c.author_name || 'Unknown'}{c.author_role ? ` · ${c.author_role}` : ''} · {ago(c.created_at)}
                    </div>
                    <div className="whitespace-pre-line leading-snug">{c.body}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="px-6 py-4 border-t border-outline">
          <div className="flex items-end gap-2">
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
              placeholder="Add a comment…"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }}
              className="flex-1 bg-surface border border-outline rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none" />
            <button onClick={post} disabled={!draft.trim() || posting}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-white bg-accent hover:opacity-90 disabled:opacity-50 transition-colors inline-flex items-center gap-1">
              <Send size={13} /> {posting ? '…' : 'Send'}
            </button>
          </div>
          <p className="text-[10px] text-on-surface-subtle mt-1.5">Tip: ⌘/Ctrl + Enter to send.</p>
        </div>
      </div>
    </div>
  );
}

function RejectModal({ log, onClose, onConfirm }: { log: HourLog; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <h3 className="font-display text-lg font-semibold text-on-surface">Reject hour log</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-sm text-on-surface-muted">
            Rejecting <span className="num-mono font-medium text-on-surface">{log.hours_logged}h</span> from{' '}
            <span className="font-medium text-on-surface">{log.employee_name}</span> on{' '}
            <span className="font-medium text-on-surface">{log.project_name}</span> (W{log.week_num}).
          </p>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Reason *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={4}
              placeholder="Explain what's wrong so the employee can resubmit."
              className="w-full bg-surface border border-outline rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-danger/30 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg transition-colors">Cancel</button>
          <button onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={!reason.trim()}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 bg-danger hover:bg-danger/90 transition-colors">
            Confirm Reject
          </button>
        </div>
      </div>
    </div>
  );
}
