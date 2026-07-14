import { useState, useEffect, useCallback, useMemo } from 'react';
import { CheckCircle, XCircle, AlertTriangle, X, Filter, ClipboardCheck, ArrowUpDown, Clock, PauseCircle, MessageSquare } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import HourLogCommentsModal from '../components/HourLogCommentsModal';
import { formatWeekDays, isCurrentWeekOfMonth, isEmptyWeek } from '../utils/weekRange';
import { toast } from '../components/Toaster';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

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
  // KPI cards need cross-status totals — the `logs` list is scoped to the
  // active filter tab, so counting off it gives (pending, 0, 0, 0). Load a
  // separate counts fetch and refresh it alongside the list.
  const [statusCounts, setStatusCounts] = useState({ pending: 0, on_hold: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'pending' | 'on_hold' | 'approved' | 'rejected' | 'all'>('pending');
  const [scope, setScope] = useState<'mine' | 'all'>(isAdmin ? 'all' : 'mine');
  const [sortBy, setSortBy] = useState<SortKey>('oldest');
  const [rejecting, setRejecting] = useState<HourLog | null>(null);
  const [holding, setHolding]   = useState<HourLog | null>(null);
  const [commentingOn, setCommentingOn] = useState<HourLog | null>(null);
  // Top-level tab. The existing weekly-log queue stays the default; the new
  // allocation-change queue lives alongside it so reviewers don't get a
  // second sidebar item to remember.
  const [topTab, setTopTab] = useState<'logs' | 'allocations' | 'internal'>(() => {
    // Deep-link support: bell notifications on internal-hour reviews
    // carry ?queue=internal so the reviewer lands on the right tab.
    const q = new URLSearchParams(window.location.search).get('queue');
    return q === 'allocations' ? 'allocations' : q === 'internal' ? 'internal' : 'logs';
  });
  const canApproveAlloc = role === 'admin' || role === 'project_coordinator';

  // Resolve current user's employee.id once
  useEffect(() => {
    if (!user?.employee_id_ref) return;
    api.getEmployeesSlim()
      .then(emps => {
        const me = emps.find((e: any) => e.employee_id === user.employee_id_ref);
        if (me) setReviewerEmpId(me.id);
      })
      .catch(() => {});
  }, [user?.employee_id_ref]);

  // load() supports a "silent" mode used by the 12s background poll —
  // it refreshes the data without toggling `loading` to true. Without
  // this, the live refresh kept replacing the table with the
  // "Loading logs…" placeholder every 12 seconds and the whole screen
  // appeared to flicker. The initial mount + filter / scope changes
  // still go through the loud path so the user sees a clear loading
  // signal when they explicitly asked for different data.
  const load = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const params: any = {};
    if (filterStatus !== 'all') params.status = filterStatus;
    if (scope === 'mine' && reviewerEmpId) params.reviewer_id = reviewerEmpId;
    // Fire the list + KPI counts in parallel. Counts respect scope (mine
    // vs all-projects) but NOT the active filter tab — that's the whole
    // point: the cards show every status regardless of what's selected.
    const countParams: any = {};
    if (scope === 'mine' && reviewerEmpId) countParams.reviewer_id = reviewerEmpId;
    Promise.all([
      api.getHourLogs(params).then(d => setLogs(d as HourLog[])).catch(() => {}),
      api.getHourLogCounts(countParams).then(setStatusCounts).catch(() => {}),
    ]).finally(() => { if (!opts?.silent) setLoading(false); });
  }, [filterStatus, scope, reviewerEmpId]);

  useEffect(() => {
    if (scope === 'mine' && !reviewerEmpId) return; // wait until we know who I am
    load();
  }, [load, scope, reviewerEmpId]);

  // Live refresh on the queue, silent mode so the placeholder doesn't
  // flash every 12 seconds. Manager / coordinator sees new submissions
  // pop into Pending automatically and comments accrue on the rows
  // without the whole queue blinking.
  const silentLoad = useCallback(() => load({ silent: true }), [load]);
  useLiveRefresh(silentLoad);

  // Deep-link auto-open: a notification can land here with ?logId=…&discuss=1
  // (e.g. an employee replied on a held log, or an admin was @-mentioned in
  // a comment on someone else's log) and we open the modal once the
  // matching row is in state.
  //
  // We widen along both filters before giving up:
  //   1. filterStatus → 'all' so a held / approved / rejected log still
  //      surfaces from a "pending"-default view.
  //   2. scope → 'all' if the log isn't in the current 'mine' bucket.
  //      Necessary when an admin / HR gets tagged in a log they don't
  //      normally review — they still need the modal to open.
  //
  // Clean the URL so a refresh doesn't re-pop the modal.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const logId = params.get('logId');
    const wantDiscuss = params.get('discuss') === '1';
    if (!logId || !wantDiscuss) return;
    if (filterStatus !== 'all') { setFilterStatus('all'); return; }
    const log = logs.find(l => l.id === logId);
    if (!log) {
      // Log not in state yet. If we're already scope='all', logs will
      // arrive on the next render — do nothing, effect will re-run.
      // If we're scope='mine' and the log isn't ours, widen and let the
      // fetch complete.
      if (scope !== 'all') setScope('all');
      return;
    }
    setCommentingOn(log);
    const u = new URL(window.location.href);
    u.searchParams.delete('logId'); u.searchParams.delete('discuss');
    window.history.replaceState({}, '', u.toString());
  }, [logs, filterStatus, scope]);

  // Optimistic UI: flip the row in local state immediately so the button
  // press feels instant. If the server rejects (network blip, auth, etc.)
  // we revert the row and surface a toast. The full silentLoad() after
  // syncs any other fields the server populated (reviewed_by, reviewed_at).
  const approve = async (log: HourLog) => {
    const prev = log;
    setLogs(curr => curr.map(l => l.id === log.id ? {
      ...l, status: 'approved',
      reviewed_by_name: user?.name ?? l.reviewed_by_name,
      reviewed_at: new Date().toISOString(),
    } : l));
    toast.success('Hours approved', `${log.employee_name} · ${log.hours_logged}h on ${log.project_name}.`);
    try {
      await api.approveHourLog(log.id, {
        reviewer_id: reviewerEmpId ?? user?.id,
        reviewer_name: user?.name,
      });
      load();
    } catch (err: any) {
      // Revert the optimistic flip so the row goes back to its real state.
      setLogs(curr => curr.map(l => l.id === log.id ? prev : l));
      toast.error('Approve failed — change reverted', err?.message);
    }
  };

  const reject = async (log: HourLog, reason: string) => {
    const prev = log;
    setLogs(curr => curr.map(l => l.id === log.id ? {
      ...l, status: 'rejected', rejection_reason: reason,
      reviewed_by_name: user?.name ?? l.reviewed_by_name,
      reviewed_at: new Date().toISOString(),
    } : l));
    setRejecting(null);
    toast.success('Hours rejected', `${log.employee_name} has been notified with your reason.`);
    try {
      await api.rejectHourLog(log.id, {
        reviewer_id: reviewerEmpId ?? user?.id,
        reviewer_name: user?.name,
        rejection_reason: reason,
      });
      load();
    } catch (err: any) {
      setLogs(curr => curr.map(l => l.id === log.id ? prev : l));
      toast.error('Reject failed — change reverted', err?.message);
    }
  };

  const hold = async (log: HourLog, note: string) => {
    try {
      await api.holdHourLog(log.id, {
        reviewer_id: reviewerEmpId ?? user?.id,
        reviewer_name: user?.name,
        reviewer_role: user?.role,
        note,
      });
      toast.success('Log put on hold', `${log.employee_name} can reply on the thread.`);
    } catch (err: any) { toast.error('Hold failed', err?.message); }
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

  // KPI cards use cross-status totals from the counts endpoint (see
  // statusCounts state). The local `logs` list — scoped to the active
  // filter tab — can't answer "how many approved" when you're on the
  // Pending tab, hence the split.
  const counts = statusCounts;

  return (
    <div className="space-y-5">
      {/* Top-level tabs: weekly logs queue vs allocation change queue */}
      <div className="inline-flex items-center gap-1.5 bg-surface rounded-lg border border-outline p-1">
        <button onClick={() => setTopTab('logs')}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold ${topTab === 'logs' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
          Hour logs
        </button>
        <button onClick={() => setTopTab('allocations')}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold ${topTab === 'allocations' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
          Allocation requests
        </button>
        <button onClick={() => setTopTab('internal')}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold ${topTab === 'internal' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
          Internal activities
        </button>
      </div>

      {topTab === 'internal' ? (
        <InternalLogReviewView reviewerEmpId={reviewerEmpId} />
      ) : topTab === 'allocations' ? (
        <AllocationRequestsView canApprove={canApproveAlloc} currentUserId={user?.id ?? ''} />
      ) : (<>
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
                        <td className="px-4 py-3 text-on-surface-muted text-xs min-w-[320px] max-w-[560px] whitespace-normal break-words">
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
        <HourLogCommentsModal
          logId={commentingOn.id}
          subtitle={`${commentingOn.employee_name} · ${commentingOn.project_name ?? ''} · W${commentingOn.week_num} · ${commentingOn.hours_logged}h`}
          currentUser={{ id: reviewerEmpId ?? user?.id ?? '', name: user?.name ?? '', role: user?.role ?? '' }}
          onClose={() => setCommentingOn(null)}
          onAfterPost={load}
        />
      )}
      </>)}
    </div>
  );
}

// Allocation requests queue. Coordinators / admin approve or reject here;
// requesters see their own past requests (status + reviewer note). Each
// row shows the current vs proposed week split as a side-by-side diff so
// the change is legible at a glance.
function AllocationRequestsView({ canApprove, currentUserId }: { canApprove: boolean; currentUserId: string }) {
  const [rows, setRows] = useState<import('../services/api').AllocationChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'cancelled' | 'all'>('pending');
  const [reviewing, setReviewing] = useState<{ req: any; mode: 'approve' | 'reject' } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getAllocationRequests(statusFilter === 'all' ? {} : { status: statusFilter })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [statusFilter]);
  useEffect(load, [load]);

  const counts = useMemo(() => ({
    pending:   rows.filter(r => r.status === 'pending').length,
    approved:  rows.filter(r => r.status === 'approved').length,
    rejected:  rows.filter(r => r.status === 'rejected').length,
    cancelled: rows.filter(r => r.status === 'cancelled').length,
  }), [rows]);

  const cancel = async (id: string) => {
    if (!confirm('Cancel this pending request?')) return;
    try { await api.cancelAllocationRequest(id); load(); } catch (e: any) { alert(e?.message ?? 'Failed'); }
  };

  return (
    <div className="space-y-5">
      <div className="inline-flex items-center gap-1.5 bg-surface rounded-lg border border-outline p-1">
        {(['pending','approved','rejected','cancelled','all'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize ${statusFilter === s ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
            {s}{s !== 'all' ? ` (${(counts as any)[s]})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-surface rounded-xl-2 p-12 border border-outline text-center text-on-surface-subtle">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-surface rounded-xl-2 p-12 border border-outline text-center">
          <ClipboardCheck size={32} className="mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">No allocation change requests {statusFilter !== 'all' ? `(${statusFilter})` : ''}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <AllocationRequestCard
              key={r.id} req={r}
              canApprove={canApprove && r.status === 'pending'}
              canCancel={r.status === 'pending' && r.requested_by_id === currentUserId}
              onApprove={() => setReviewing({ req: r, mode: 'approve' })}
              onReject={() => setReviewing({ req: r, mode: 'reject' })}
              onCancel={() => cancel(r.id)}
            />
          ))}
        </div>
      )}

      {reviewing && (
        <AllocationReviewModal
          req={reviewing.req}
          mode={reviewing.mode}
          onClose={() => setReviewing(null)}
          onDone={() => { setReviewing(null); load(); }}
        />
      )}
    </div>
  );
}

function AllocationRequestCard({ req: r, canApprove, canCancel, onApprove, onReject, onCancel }: {
  req: import('../services/api').AllocationChangeRequest;
  canApprove: boolean; canCancel: boolean;
  onApprove: () => void; onReject: () => void; onCancel: () => void;
}) {
  // Compute per-week deltas so the diff highlights only the cells that
  // actually moved. The proposed_* fields may be null when the requester
  // didn't touch that week — fall back to current_* in that case.
  const weeks = [1,2,3,4,5].map(i => {
    const cur = Number((r as any)[`current_w${i}`] ?? 0);
    const prop = (r as any)[`proposed_w${i}`];
    const effProp = prop == null ? cur : Number(prop);
    return { i, cur, prop: effProp, changed: cur !== effProp };
  });
  const curMonthly  = Number(r.current_monthly ?? 0);
  const propMonthly = r.proposed_monthly == null ? curMonthly : Number(r.proposed_monthly);
  const monthlyDelta = propMonthly - curMonthly;
  const tone =
    r.status === 'approved' ? 'border-success/30' :
    r.status === 'rejected' ? 'border-danger/30'  :
    r.status === 'cancelled' ? 'border-outline'   :
                              'border-warning/40';
  return (
    <div className={`bg-surface rounded-xl-2 border ${tone} shadow-elev-1 overflow-hidden`}>
      <div className="px-4 py-3 border-b border-outline flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-display text-base font-bold text-on-surface tracking-tight">
            {r.employee_name} · <span className="text-on-surface-muted">{r.project_name}</span>
          </p>
          <p className="text-[11px] text-on-surface-muted mt-0.5">
            {MONTHS[r.month-1]} {r.year} · Requested by {r.requested_by_name || '—'} {r.requested_by_role ? `(${r.requested_by_role})` : ''} · {ago(r.created_at)}
          </p>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
          r.status === 'pending'   ? 'bg-warning-container text-warning' :
          r.status === 'approved'  ? 'bg-success-container text-success' :
          r.status === 'rejected'  ? 'bg-danger-container text-danger' :
                                     'bg-surface-2 text-on-surface-muted'
        }`}>
          {r.status}
        </span>
      </div>
      <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-outline bg-surface-2/50 p-3">
          <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-subtle mb-2">Current</p>
          <div className="flex gap-2 justify-between">
            {weeks.map(w => {
              const empty = isEmptyWeek(r.month, r.year, w.i);
              const cur   = isCurrentWeekOfMonth(r.month, r.year, w.i);
              return (
                <div key={w.i} className={`flex flex-col items-center ${empty ? 'opacity-40' : ''}`}>
                  <span className={`text-[9px] uppercase tracking-wider font-bold ${cur ? 'text-accent' : 'text-on-surface-subtle'}`}>W{w.i}</span>
                  <span className={`text-[8px] font-normal ${cur ? 'text-accent' : 'text-on-surface-subtle'}`}>
                    {empty ? '—' : formatWeekDays(r.month, r.year, w.i)}
                  </span>
                  <span className="num-mono text-sm text-on-surface-muted">{w.cur}</span>
                </div>
              );
            })}
            <div className="flex flex-col items-center pl-2 ml-2 border-l border-outline">
              <span className="text-[9px] uppercase tracking-wider font-bold text-on-surface-subtle">M</span>
              <span className="num-mono text-sm font-bold text-on-surface">{curMonthly}</span>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
          <p className="text-[10px] uppercase tracking-wider font-bold text-accent mb-2">Proposed</p>
          <div className="flex gap-2 justify-between">
            {weeks.map(w => {
              const empty = isEmptyWeek(r.month, r.year, w.i);
              const cur   = isCurrentWeekOfMonth(r.month, r.year, w.i);
              return (
                <div key={w.i} className={`flex flex-col items-center ${empty ? 'opacity-40' : ''}`}>
                  <span className={`text-[9px] uppercase tracking-wider font-bold ${cur ? 'text-accent' : 'text-on-surface-subtle'}`}>W{w.i}</span>
                  <span className={`text-[8px] font-normal ${cur ? 'text-accent' : 'text-on-surface-subtle'}`}>
                    {empty ? '—' : formatWeekDays(r.month, r.year, w.i)}
                  </span>
                  <span className={`num-mono text-sm font-bold ${w.changed ? 'text-accent' : 'text-on-surface-muted'}`}>{w.prop}</span>
                  {w.changed && (
                    <span className={`text-[9px] font-bold ${w.prop > w.cur ? 'text-warning' : 'text-success'}`}>
                      {w.prop > w.cur ? '+' : ''}{w.prop - w.cur}
                    </span>
                  )}
                </div>
              );
            })}
            <div className="flex flex-col items-center pl-2 ml-2 border-l border-accent/30">
              <span className="text-[9px] uppercase tracking-wider font-bold text-accent">M</span>
              <span className={`num-mono text-sm font-bold ${monthlyDelta !== 0 ? 'text-accent' : 'text-on-surface-muted'}`}>{propMonthly}</span>
              {monthlyDelta !== 0 && (
                <span className={`text-[9px] font-bold ${monthlyDelta > 0 ? 'text-warning' : 'text-success'}`}>
                  {monthlyDelta > 0 ? '+' : ''}{monthlyDelta}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="px-4 py-2 border-t border-outline text-xs space-y-1">
        <p className="text-on-surface-muted"><span className="font-semibold text-on-surface">Reason:</span> {r.reason}</p>
        {r.review_note && (
          <p className={r.status === 'approved' ? 'text-success' : 'text-danger'}>
            <span className="font-semibold">{r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.reviewed_by_name}:</span> {r.review_note}
          </p>
        )}
      </div>
      {(canApprove || canCancel) && (
        <div className="px-4 py-2 border-t border-outline bg-surface-2/50 flex justify-end gap-2">
          {canCancel && (
            <button onClick={onCancel}
              className="px-3 py-1.5 rounded-md text-xs font-semibold text-on-surface-muted border border-outline hover:bg-surface-2">
              Cancel request
            </button>
          )}
          {canApprove && (
            <>
              <button onClick={onReject}
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-danger border border-danger/30 hover:bg-danger-container">
                <XCircle size={12} className="inline mr-1" /> Reject
              </button>
              <button onClick={onApprove}
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-success hover:opacity-90">
                <CheckCircle size={12} className="inline mr-1" /> Approve & Apply
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AllocationReviewModal({ req: r, mode, onClose, onDone }: {
  req: import('../services/api').AllocationChangeRequest;
  mode: 'approve' | 'reject';
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (mode === 'reject' && !note.trim()) { setError('A note is required when rejecting.'); return; }
    setBusy(true); setError('');
    try {
      if (mode === 'approve') {
        await api.approveAllocationRequest(r.id, { review_note: note.trim() || undefined });
        toast.success('Allocation change applied', `${r.employee_name} · ${r.project_name}.`);
      } else {
        await api.rejectAllocationRequest(r.id, { review_note: note.trim() });
        toast.success('Allocation change rejected', 'Requester has been notified.');
      }
      onDone();
    } catch (e: any) { setError(e?.message ?? 'Failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-outline">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <h3 className="font-display text-base font-bold text-on-surface">
            {mode === 'approve' ? 'Approve & apply change' : 'Reject change'}
          </h3>
          <button onClick={onClose}><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-sm text-on-surface-muted">
            {mode === 'approve'
              ? `Approving will overwrite ${r.employee_name}'s allocation on ${r.project_name} (${MONTHS[r.month-1]} ${r.year}) with the proposed values.`
              : `Rejecting will send the requester a notification with your note so they know why.`}
          </p>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-on-surface-subtle mb-1 block">
              Note {mode === 'reject' ? '*' : '(optional)'}
            </label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder={mode === 'approve' ? 'Optional context for the requester / employee.' : 'Tell them what to fix or why this isn\'t happening.'}
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-6 py-3 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy}
            className={`px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50 ${mode === 'approve' ? 'bg-success' : 'bg-danger'} hover:opacity-90`}>
            {busy ? '…' : mode === 'approve' ? 'Approve & Apply' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Renders the "What they worked on" cell. When day-level notes exist we
// show each day + hours + note on its own row (the shape of the work).
// When the employee ALSO wrote a distinct weekly summary in
// work_description (i.e. something other than the stitched day notes),
// we surface it above the day breakdown so the reviewer sees both.
// Falls back to the aggregated description when no day notes exist.
function DescriptionCell({ log }: { log: HourLog }) {
  const days = (log.day_notes ?? []).filter(d => (d.notes ?? '').trim().length > 0);
  const weekly = (log.work_description ?? '').trim();
  // effective_description = weekly if present, else stitched day notes.
  // Suppress weekly when it equals the stitched form so we don't repeat.
  const stitchedFromDays = days.map(d => {
    const dt = new Date(String(d.date).slice(0, 10) + 'T12:00:00Z');
    return `${String(dt.getUTCDate()).padStart(2, '0')}: ${(d.notes ?? '').trim()}`;
  }).join(' · ');
  const weeklyDistinct = weekly && weekly !== stitchedFromDays;

  if (days.length > 0) {
    return (
      <div className="space-y-1.5">
        {weeklyDistinct && (
          <p className="text-on-surface whitespace-pre-wrap break-words leading-snug">{weekly}</p>
        )}
        <ul className="space-y-1">
          {days.map((d) => {
            const dt = new Date(String(d.date).slice(0, 10) + 'T12:00:00Z');
            const dayLabel = dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
            return (
              <li key={d.date} className="flex items-start gap-2 leading-snug">
                <span className="num-mono text-[10px] font-semibold text-on-surface-subtle min-w-[42px] uppercase tracking-wide shrink-0 pt-0.5">{dayLabel}</span>
                <span className="num-mono text-[10px] font-bold text-accent min-w-[28px] shrink-0 pt-0.5">{Number(d.hours)}h</span>
                <span className="text-on-surface flex-1 whitespace-pre-wrap break-words">{d.notes}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  const fallback = log.effective_description || log.work_description;
  if (fallback) return <span className="whitespace-pre-wrap break-words">{fallback}</span>;
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

// ── Internal-activity log review queue ────────────────────────────────────
// Surfaces every PENDING internal-hour-log entry visible to the current
// reviewer (their team members plus anyone whose internal logs they can
// already see — chain managers, admin/HR, project reviewers/leads).
function InternalLogReviewView({ reviewerEmpId }: { reviewerEmpId: string | null }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [members, setMembers] = useState<any[]>([]);
  useEffect(() => {
    if (!reviewerEmpId) return;
    api.getTeamMembers(reviewerEmpId, true).then(setMembers).catch(() => setMembers([]));
  }, [reviewerEmpId]);
  const load = useCallback(async () => {
    if (!members.length) { setLogs([]); setLoading(false); return; }
    setLoading(true);
    try {
      // 60-day window covers the typical "log last month's hours" pattern
      // without bloating the queue.
      const from = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const all = await Promise.all(members.map(m =>
        api.getInternalHourLogs({ employee_id: m.id, from, to })
          .then(r => (r as any[]).map(l => ({ ...l, employee_name: m.name })))
          .catch(() => [])
      ));
      setLogs(all.flat().sort((a, b) => String(b.log_date).localeCompare(String(a.log_date))));
    } finally { setLoading(false); }
  }, [members]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() =>
    statusFilter === 'all' ? logs : logs.filter(l => l.status === statusFilter)
  , [logs, statusFilter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const l of logs) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [logs]);

  const approve = async (l: any) => {
    try { await api.approveInternalHourLog(l.id); load(); }
    catch (e: any) { toast.error('Approve failed', e.message); }
  };
  const reject = async (l: any) => {
    const reason = window.prompt('Reason for rejecting this log (employee will see it):');
    if (!reason?.trim()) return;
    try { await api.rejectInternalHourLog(l.id, reason.trim()); load(); }
    catch (e: any) { toast.error('Reject failed', e.message); }
  };

  if (!reviewerEmpId) {
    return (
      <div className="rounded-xl-2 border border-outline bg-surface px-5 py-12 text-center text-sm text-on-surface-muted">
        Loading your team…
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 bg-surface rounded-lg border border-outline p-1 w-fit">
        {(['pending','approved','rejected','all'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize ${
              statusFilter === s ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'
            }`}>
            {s}{s !== 'all' && counts[s] > 0 && <span className="num-mono opacity-75 ml-1">({counts[s]})</span>}
          </button>
        ))}
      </div>
      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-on-surface-muted">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Clock size={28} className="mx-auto text-on-surface-subtle mb-2" />
            <p className="text-sm text-on-surface-muted">No {statusFilter === 'all' ? '' : statusFilter} internal-activity logs from your team.</p>
            <p className="text-xs text-on-surface-subtle mt-1">New submissions land here for review and ping you on the bell.</p>
          </div>
        ) : (
          <div className="divide-y divide-outline">
            {filtered.map(l => {
              const tone = l.status === 'approved' ? 'border-l-4 border-l-success'
                : l.status === 'rejected' ? 'border-l-4 border-l-danger'
                : 'border-l-4 border-l-warning';
              return (
                <div key={l.id} className={`px-5 py-3 ${tone} hover:bg-surface-2/40 transition-colors`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-on-surface">
                        {l.employee_name} <span className="text-on-surface-muted">· {l.activity_name}</span>
                      </p>
                      <p className="text-[11px] text-on-surface-subtle mt-0.5">
                        {new Date(l.log_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}<span className="num-mono">{Number(l.hours).toFixed(1)}h</span>
                        {l.reviewed_by_name && (
                          <> · <span className="opacity-75">{l.status === 'approved' ? 'Approved' : 'Rejected'} by {l.reviewed_by_name}</span></>
                        )}
                      </p>
                      {l.notes && <p className="text-xs text-on-surface mt-1 whitespace-pre-line">{l.notes}</p>}
                      {l.status === 'rejected' && l.rejection_reason && (
                        <p className="text-[11px] text-danger italic mt-1">Rejection reason: "{l.rejection_reason}"</p>
                      )}
                    </div>
                    {l.status === 'pending' && (
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button onClick={() => approve(l)}
                          className="text-[10px] font-bold px-2.5 py-1.5 rounded bg-success text-on-accent hover:opacity-90 inline-flex items-center gap-1">
                          <CheckCircle size={11} /> Approve
                        </button>
                        <button onClick={() => reject(l)}
                          className="text-[10px] font-bold px-2.5 py-1.5 rounded text-danger border border-danger/30 hover:bg-danger-container inline-flex items-center gap-1">
                          <XCircle size={11} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
