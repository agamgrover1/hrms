import { useState, useEffect, useCallback, useMemo } from 'react';
import { CheckCircle, XCircle, AlertTriangle, X, Filter, ClipboardCheck, ArrowUpDown, Clock, PauseCircle, MessageSquare, Check, User as UserIcon, Calendar as CalendarIcon } from 'lucide-react';
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

// ── Day-grain approval queue ──────────────────────────────────────────────
// Reviewer approves / holds / rejects ONE day at a time. Rows come pre-
// grouped by (employee, project, week) on the frontend so the reviewer
// can scan a colleague's week end-to-end without losing context.
// Weekly hour_logs.status is derived on the backend from the child day
// statuses (see rollupWeeklyStatusFromDays in api/index.ts) so downstream
// filters + reports keep working unchanged.

interface DayRow {
  id: string;
  log_date: string;
  hours: number;
  notes: string | null;
  status: 'pending' | 'approved' | 'on_hold' | 'rejected';
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  assignment_id: string;
  hour_log_id: string;
  week_num: number;
  month: number;
  year: number;
  employee_id: string;
  employee_name: string;
  project_id: string;
  project_name: string;
  project_client_name: string | null;
  weekly_description: string | null;
  weekly_hours: number;
  weekly_billable_hours: number | null;
  comment_count: number;
}

function fmtDayLabel(iso: string): string {
  const dt = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function DayApprovalView({ reviewerEmpId, isAdmin, user }: {
  reviewerEmpId: string | null;
  isAdmin: boolean;
  user: any;
}) {
  const [rows, setRows] = useState<DayRow[]>([]);
  const [counts, setCounts] = useState({ pending: 0, on_hold: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'pending' | 'on_hold' | 'approved' | 'rejected' | 'all'>('pending');
  const [scope, setScope] = useState<'mine' | 'all'>(isAdmin ? 'all' : 'mine');
  const [rejectTarget, setRejectTarget] = useState<DayRow | null>(null);
  const [holdTarget, setHoldTarget] = useState<DayRow | null>(null);
  const [discussLog, setDiscussLog] = useState<{ hourLogId: string; subtitle: string } | null>(null);

  const load = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const params: any = {};
    if (filterStatus !== 'all') params.status = filterStatus;
    if (scope === 'mine' && reviewerEmpId) params.reviewer_id = reviewerEmpId;
    const countParams: any = {};
    if (scope === 'mine' && reviewerEmpId) countParams.reviewer_id = reviewerEmpId;
    Promise.all([
      api.getHourLogDaysQueue(params).then(d => setRows(d as DayRow[])).catch(() => {}),
      api.getHourLogDaysCounts(countParams).then(setCounts).catch(() => {}),
    ]).finally(() => { if (!opts?.silent) setLoading(false); });
  }, [filterStatus, scope, reviewerEmpId]);

  useEffect(() => {
    if (scope === 'mine' && !reviewerEmpId) return;
    load();
  }, [load, scope, reviewerEmpId]);

  const silentLoad = useCallback(() => load({ silent: true }), [load]);
  useLiveRefresh(silentLoad);

  // Group by (employee, project, week). Each group card renders one row
  // per day inside it, so the reviewer can scan Komal's Mon-Fri on a
  // single project together.
  const groups = useMemo(() => {
    const map = new Map<string, {
      key: string;
      employee_id: string; employee_name: string;
      project_id: string; project_name: string; project_client_name: string | null;
      week_num: number; month: number; year: number;
      weekly_description: string | null;
      hour_log_id: string;
      rows: DayRow[];
    }>();
    for (const r of rows) {
      const key = `${r.employee_id}__${r.project_id}__${r.year}-${r.month}-W${r.week_num}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          employee_id: r.employee_id, employee_name: r.employee_name,
          project_id: r.project_id, project_name: r.project_name,
          project_client_name: r.project_client_name,
          week_num: r.week_num, month: r.month, year: r.year,
          weekly_description: r.weekly_description,
          hour_log_id: r.hour_log_id,
          rows: [],
        };
        map.set(key, g);
      }
      g.rows.push(r);
    }
    // Order each group's days chronologically; groups by oldest-day-first
    // so the queue naturally surfaces the longest-waiting entries.
    for (const g of map.values()) {
      g.rows.sort((a, b) => new Date(a.log_date).getTime() - new Date(b.log_date).getTime());
    }
    return Array.from(map.values()).sort((a, b) => {
      const aMin = Math.min(...a.rows.map(r => new Date(r.log_date).getTime()));
      const bMin = Math.min(...b.rows.map(r => new Date(r.log_date).getTime()));
      return aMin - bMin;
    });
  }, [rows]);

  // Actions. Optimistic — flip local status, roll back on failure.
  const approveDay = async (d: DayRow) => {
    setRows(rs => rs.map(r => r.id === d.id ? { ...r, status: 'approved', reviewed_by_name: user?.name ?? r.reviewed_by_name, reviewed_at: new Date().toISOString() } : r));
    toast.success('Approved', `${d.employee_name} · ${Number(d.hours)}h · ${fmtDayLabel(d.log_date)}.`);
    try {
      await api.approveHourLogDay(d.id, { reviewer_id: reviewerEmpId ?? user?.id, reviewer_name: user?.name });
      silentLoad();
    } catch (e: any) {
      toast.error('Approve failed', e?.message);
      silentLoad();
    }
  };
  const rejectDay = async (d: DayRow, reason: string) => {
    setRows(rs => rs.map(r => r.id === d.id ? { ...r, status: 'rejected', rejection_reason: reason, reviewed_by_name: user?.name ?? r.reviewed_by_name, reviewed_at: new Date().toISOString() } : r));
    setRejectTarget(null);
    toast.success('Rejected', `${d.employee_name} has been notified.`);
    try {
      await api.rejectHourLogDay(d.id, { reviewer_id: reviewerEmpId ?? user?.id, reviewer_name: user?.name, rejection_reason: reason });
      silentLoad();
    } catch (e: any) { toast.error('Reject failed', e?.message); silentLoad(); }
  };
  const holdDay = async (d: DayRow, note: string) => {
    setRows(rs => rs.map(r => r.id === d.id ? { ...r, status: 'on_hold', rejection_reason: note, reviewed_by_name: user?.name ?? r.reviewed_by_name, reviewed_at: new Date().toISOString() } : r));
    setHoldTarget(null);
    toast.success('On hold', `${d.employee_name} can reply on the thread.`);
    try {
      await api.holdHourLogDay(d.id, { reviewer_id: reviewerEmpId ?? user?.id, reviewer_name: user?.name, rejection_reason: note });
      silentLoad();
    } catch (e: any) { toast.error('Hold failed', e?.message); silentLoad(); }
  };

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Pending" value={counts.pending} tone="text-warning" bg="bg-warning-container" />
        <KpiCard label="On hold" value={counts.on_hold} tone="text-accent" bg="bg-accent/15" />
        <KpiCard label="Approved" value={counts.approved} tone="text-success" bg="bg-success-container" />
        <KpiCard label="Rejected" value={counts.rejected} tone="text-danger" bg="bg-danger-container" />
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
        <span className="text-xs text-on-surface-subtle ml-auto">
          Approve day-by-day. The weekly rollup follows: 'rejected' wins over 'on_hold' wins over 'pending' wins over 'approved'.
        </span>
      </div>

      {/* Groups */}
      {loading ? (
        <div className="bg-surface rounded-xl-2 p-12 border border-outline text-center text-on-surface-subtle">Loading logs…</div>
      ) : groups.length === 0 ? (
        <div className="bg-surface rounded-xl-2 p-12 border border-outline text-center">
          <ClipboardCheck size={32} className="mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">Nothing to review here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => (
            <DayGroupCard
              key={g.key} group={g}
              onApprove={approveDay}
              onReject={setRejectTarget}
              onHold={setHoldTarget}
              onDiscuss={() => setDiscussLog({
                hourLogId: g.hour_log_id,
                subtitle: `${g.employee_name} · ${g.project_name} · W${g.week_num}`,
              })}
            />
          ))}
        </div>
      )}

      {rejectTarget && (
        <DayReasonModal
          title="Reject this day"
          confirmLabel="Confirm Reject"
          tone="danger"
          subtitle={`${Number(rejectTarget.hours)}h from ${rejectTarget.employee_name} on ${rejectTarget.project_name} · ${fmtDayLabel(rejectTarget.log_date)}.`}
          placeholder="Explain what's wrong so the employee can resubmit that day."
          onClose={() => setRejectTarget(null)}
          onConfirm={r => rejectDay(rejectTarget, r)}
        />
      )}
      {holdTarget && (
        <DayReasonModal
          title="Put this day on hold"
          confirmLabel="Put on hold"
          tone="accent"
          subtitle={`Parking ${Number(holdTarget.hours)}h from ${holdTarget.employee_name} on ${holdTarget.project_name} · ${fmtDayLabel(holdTarget.log_date)}.`}
          placeholder="What do you need clarified? The employee will get pinged."
          onClose={() => setHoldTarget(null)}
          onConfirm={n => holdDay(holdTarget, n)}
        />
      )}
      {discussLog && (
        <HourLogCommentsModal
          logId={discussLog.hourLogId}
          subtitle={discussLog.subtitle}
          currentUser={{ id: reviewerEmpId ?? user?.id ?? '', name: user?.name ?? '', role: user?.role ?? '' }}
          onClose={() => setDiscussLog(null)}
          onAfterPost={silentLoad}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, tone, bg }: { label: string; value: number; tone: string; bg: string }) {
  return (
    <div className="group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden">
      <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full ${bg} blur-2xl opacity-50`} />
      <div className="relative">
        <p className={`num-mono text-2xl font-bold ${tone}`}>{value}</p>
        <p className="text-xs text-on-surface-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function DayGroupCard({ group, onApprove, onReject, onHold, onDiscuss }: {
  group: {
    employee_id: string; employee_name: string;
    project_id: string; project_name: string; project_client_name: string | null;
    week_num: number; month: number; year: number;
    weekly_description: string | null;
    hour_log_id: string;
    rows: DayRow[];
  };
  onApprove: (d: DayRow) => void;
  onReject: (d: DayRow) => void;
  onHold: (d: DayRow) => void;
  onDiscuss: () => void;
}) {
  const totalHours = group.rows.reduce((s, r) => s + Number(r.hours), 0);
  const approvedHours = group.rows.filter(r => r.status === 'approved').reduce((s, r) => s + Number(r.hours), 0);
  return (
    <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-brand-container/40 to-surface border-b border-outline flex items-center justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <p className="font-display text-base font-bold text-on-surface truncate">
            {group.project_name}
            {group.project_client_name && <span className="text-on-surface-muted font-normal"> · {group.project_client_name}</span>}
          </p>
          <p className="text-xs text-on-surface-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
            <UserIcon size={11} className="text-on-surface-subtle" />
            <span className="font-semibold text-on-surface">{group.employee_name}</span>
            <span className="text-on-surface-subtle">·</span>
            <span>{MONTHS[group.month - 1]} {group.year} · Week {group.week_num}</span>
            <span className="text-on-surface-subtle">·</span>
            <span className="num-mono">{approvedHours}/{totalHours}h approved</span>
          </p>
          {group.weekly_description && (
            <p className="mt-1.5 text-xs text-on-surface-muted italic whitespace-pre-wrap break-words leading-snug max-w-3xl">
              "{group.weekly_description}"
            </p>
          )}
        </div>
        <button onClick={onDiscuss}
          className="shrink-0 px-2.5 py-1.5 rounded-md text-xs font-semibold text-on-surface-muted border border-outline hover:bg-surface-2 transition-colors">
          <MessageSquare size={11} className="inline mr-1" />Discuss
        </button>
      </div>
      <ul className="divide-y divide-outline">
        {group.rows.map(d => <DayRowItem key={d.id} d={d} onApprove={onApprove} onReject={onReject} onHold={onHold} />)}
      </ul>
    </div>
  );
}

function DayRowItem({ d, onApprove, onReject, onHold }: {
  d: DayRow;
  onApprove: (d: DayRow) => void;
  onReject: (d: DayRow) => void;
  onHold: (d: DayRow) => void;
}) {
  const actionable = d.status === 'pending' || d.status === 'on_hold';
  return (
    <li className="px-4 py-3 flex items-start gap-4">
      <div className="w-24 shrink-0">
        <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-subtle flex items-center gap-1">
          <CalendarIcon size={10} /> {fmtDayLabel(d.log_date)}
        </p>
        <p className="num-mono text-base font-bold text-on-surface mt-0.5">{Number(d.hours)}h</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-on-surface whitespace-pre-wrap break-words leading-snug">
          {d.notes || <span className="text-on-surface-subtle italic">No note</span>}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <StatusPill status={d.status} />
          {d.reviewed_by_name && (
            <span className="text-[10px] text-on-surface-subtle">
              by {d.reviewed_by_name}
              {d.reviewed_at && ` · ${new Date(d.reviewed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
            </span>
          )}
        </div>
        {d.status === 'rejected' && d.rejection_reason && (
          <p className="text-xs text-danger mt-1.5 flex items-center gap-1"><XCircle size={11} /> {d.rejection_reason}</p>
        )}
        {d.status === 'on_hold' && d.rejection_reason && (
          <p className="text-xs text-accent mt-1.5 flex items-center gap-1"><PauseCircle size={11} /> {d.rejection_reason}</p>
        )}
      </div>
      {actionable && (
        <div className="shrink-0 flex items-center gap-1 flex-wrap justify-end">
          <button onClick={() => onApprove(d)}
            className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-white bg-success hover:bg-success/90 transition-colors"
            title="Approve this day">
            <Check size={12} className="inline mr-1" />Approve
          </button>
          {d.status === 'pending' && (
            <button onClick={() => onHold(d)}
              className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-accent border border-accent/40 hover:bg-accent/10 transition-colors"
              title="Ask for clarification on this day">
              <PauseCircle size={12} className="inline mr-1" />Hold
            </button>
          )}
          <button onClick={() => onReject(d)}
            className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-danger border border-danger/30 hover:bg-danger-container transition-colors"
            title="Reject this day">
            <XCircle size={12} className="inline mr-1" />Reject
          </button>
        </div>
      )}
    </li>
  );
}

// Small reason-input modal shared by reject / hold on the day queue.
function DayReasonModal({ title, subtitle, placeholder, confirmLabel, tone, onClose, onConfirm }: {
  title: string;
  subtitle: string;
  placeholder: string;
  confirmLabel: string;
  tone: 'danger' | 'accent';
  onClose: () => void;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const btn = tone === 'danger'
    ? 'bg-danger hover:bg-danger/90'
    : 'bg-accent hover:opacity-90';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <h3 className="font-display text-lg font-semibold text-on-surface">{title}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-sm text-on-surface-muted">{subtitle}</p>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} autoFocus
            placeholder={placeholder}
            className="w-full bg-surface border border-outline rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none" />
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={() => text.trim() && onConfirm(text.trim())} disabled={!text.trim()}
            className={`px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 ${btn}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function HoursApproval() {
  const { user } = useAuth();
  const role = user?.role ?? 'employee';
  const isAdmin = role === 'admin' || role === 'hr_manager' || role === 'project_coordinator';

  // Map app_user → their employee.id (for project_reporting_id matching)
  const [reviewerEmpId, setReviewerEmpId] = useState<string | null>(null);
  // Top-level tab. Deep-link `?queue=internal` lands on the internal-log
  // review sub-view; `?queue=allocations` on the allocation-change queue.
  const [topTab, setTopTab] = useState<'logs' | 'allocations' | 'internal'>(() => {
    const q = new URLSearchParams(window.location.search).get('queue');
    return q === 'allocations' ? 'allocations' : q === 'internal' ? 'internal' : 'logs';
  });
  const canApproveAlloc = role === 'admin' || role === 'project_coordinator';

  // Resolve current user's employee.id once — DayApprovalView reads this
  // to filter its queue when scope='mine'.
  useEffect(() => {
    if (!user?.employee_id_ref) return;
    api.getEmployeesSlim()
      .then(emps => {
        const me = emps.find((e: any) => e.employee_id === user.employee_id_ref);
        if (me) setReviewerEmpId(me.id);
      })
      .catch(() => {});
  }, [user?.employee_id_ref]);

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
      ) : (
        <DayApprovalView
          reviewerEmpId={reviewerEmpId}
          isAdmin={isAdmin}
          user={user}
        />
      )}
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
