import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { Users, Calendar, DollarSign, TrendingUp, AlertCircle, CheckCircle2, UserCheck, Clock as ClockIcon, Wrench, XCircle, MessageCircle } from 'lucide-react';
import { leaveTypeLabel } from '../utils/leaveLabel';
import { toast } from '../components/Toaster';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import CountUp from '../components/CountUp';
import AttendanceHeatmap from '../components/AttendanceHeatmap';

// M3-friendly chart palette — vivid enough to read on both light and dark surfaces
const COLORS = ['#7c5cff', '#a78bff', '#67e8f9', '#34d399', '#fbbf24', '#fb7185', '#f472b6'];
const CHART_AXIS = '#94a3b8';
const CHART_GRID = 'rgba(148, 163, 184, 0.18)';
const CHART_BRAND = '#7c5cff';
const CHART_ACCENT = '#EE2770';
const CHART_DANGER = '#f87171';
const CHART_TOOLTIP_BG = 'rgb(var(--surface-3))';
const CHART_TOOLTIP_TEXT = 'rgb(var(--on-surface))';
const CHART_TOOLTIP_STYLE = {
  background: CHART_TOOLTIP_BG,
  borderRadius: 12,
  border: '1px solid rgb(var(--outline))',
  boxShadow: 'var(--elev-3)',
  color: CHART_TOOLTIP_TEXT,
  fontSize: 12,
} as const;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Neon DATE columns serialize as ISO timestamps with IST offset (e.g. "2026-05-04T18:30:00.000Z" = May 5 in IST)
// This helper normalises any date value to a plain YYYY-MM-DD string in IST
function toDateStr(val: any): string {
  if (!val) return '';
  const s = typeof val === 'string' ? val : String(val);
  if (s.includes('T')) {
    const d = new Date(s);
    d.setMinutes(d.getMinutes() + 330); // +5:30 IST offset
    return d.toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────
// "Out today" widget — surfaces who is on leave / short leave / half day
// for the current calendar day. Visible to every signed-in user (both
// admin Dashboard and the employee landing) so the org knows who is
// reachable before pinging them.
//
// Data path: parent passes in the already-loaded leaveRequests array +
// employees lookup so we don't hit the API again. We filter:
//   - status NOT IN ('rejected', 'cancelled') AND today between
//     from_date and to_date (inclusive). Half-day / short-leave rows
//     still surface — they are partially out, which the chip makes clear.
//   - HR-stage rejection or any rejection drops the row entirely.
// ─────────────────────────────────────────────────────────────────────────

const LEAVE_TONE: Record<string, { bg: string; text: string; ring: string; dot: string }> = {
  full_day:    { bg: 'bg-brand/10',    text: 'text-brand',    ring: 'ring-brand/20',    dot: 'bg-brand' },
  casual:      { bg: 'bg-success/10',  text: 'text-success',  ring: 'ring-success/20',  dot: 'bg-success' },
  sick:        { bg: 'bg-danger/10',   text: 'text-danger',   ring: 'ring-danger/20',   dot: 'bg-danger' },
  earned:      { bg: 'bg-accent/10',   text: 'text-accent',   ring: 'ring-accent/20',   dot: 'bg-accent' },
  half_day:    { bg: 'bg-warning/10',  text: 'text-warning',  ring: 'ring-warning/20',  dot: 'bg-warning' },
  short_leave: { bg: 'bg-warning/10',  text: 'text-warning',  ring: 'ring-warning/20',  dot: 'bg-warning' },
  unpaid:      { bg: 'bg-surface-3',   text: 'text-on-surface-muted', ring: 'ring-outline', dot: 'bg-on-surface-subtle' },
};

// ─────────────────────────────────────────────────────────────────────────
// Holidays widget — surfaces the company's Fixed holidays alongside the
// Optional pool that employees can pick from (2/year cap). Visible on
// both Dashboard variants so everyone in the org can plan around the
// next few off-days without digging into Settings.
//
// Past dates fall off automatically. We pull the current and next year
// in one shot so the "next 90 days" view still surfaces something
// useful when the user lands in December.
// ─────────────────────────────────────────────────────────────────────────

interface HolidayRow {
  date: string;
  name: string;
}

// Bootstrap-fed. Parent passes the pre-loaded holidays + optional pool
// so the widget never fires its own network call. If the parent hasn't
// finished loading yet, `loading` is true and skeletons render.
function HolidaysCard({
  fixedRaw, optionalRaw, loading,
}: {
  fixedRaw: any[];
  optionalRaw: any[];
  loading: boolean;
}) {
  const { fixed, optional } = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const norm = (list: any[], nameKey: 'name' | 'label') => list
      .map(h => ({ date: String(h.date).slice(0, 10), name: h[nameKey] }))
      .filter(h => h.date >= todayIso)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      fixed: norm(fixedRaw, 'name'),
      optional: norm(optionalRaw, 'label'),
    };
  }, [fixedRaw, optionalRaw]);

  const fmt = (iso: string): { date: string; weekday: string; daysAway: string } => {
    const d = new Date(iso + 'T12:00:00');
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    return {
      date: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      daysAway: diff === 0 ? 'today' : diff === 1 ? 'tomorrow'
                : diff < 7 ? `in ${diff}d`
                : d.toLocaleDateString('en-IN', { year: 'numeric' }) !== String(today.getFullYear())
                  ? d.toLocaleDateString('en-IN', { year: 'numeric' }) : `in ${diff}d`,
    };
  };

  const renderList = (rows: HolidayRow[], emptyText: string, dotClass: string) => {
    if (loading) return (
      <ul className="space-y-2">
        {[0, 1, 2].map(i => (
          <li key={i} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-surface-2 animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-32 bg-surface-2 rounded animate-pulse" />
              <div className="h-2.5 w-20 bg-surface-2 rounded animate-pulse" />
            </div>
          </li>
        ))}
      </ul>
    );
    if (rows.length === 0) return (
      <p className="text-xs text-on-surface-subtle text-center py-6">{emptyText}</p>
    );
    return (
      <ul className="space-y-2 max-h-[260px] overflow-y-auto pr-1 -mr-1">
        {rows.slice(0, 8).map(h => {
          const f = fmt(h.date);
          return (
            <li key={h.date + h.name} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-surface-2/40">
              <div className="w-9 h-9 rounded-lg bg-surface-2 border border-outline flex flex-col items-center justify-center flex-shrink-0">
                <span className="text-[8px] uppercase font-bold text-on-surface-subtle leading-none">{f.weekday}</span>
                <span className="num-mono text-xs font-bold text-on-surface leading-none mt-0.5">{f.date.split(' ')[0]}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${dotClass} flex-shrink-0`} />
                  <p className="text-sm font-semibold text-on-surface truncate">{h.name}</p>
                </div>
                <p className="text-[11px] text-on-surface-subtle">{f.date} · {f.daysAway}</p>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="relative bg-surface rounded-xl-3 p-6 border border-outline shadow-elev-2 overflow-hidden">
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-warning/15 blur-2xl opacity-50" />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-xl font-bold text-on-surface tracking-tight inline-flex items-center gap-2">
              🌴 Holidays
            </h3>
            <p className="text-xs text-on-surface-muted mt-0.5">Fixed days off + the optional pool you can pick from (2/year).</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Fixed</p>
              {!loading && <span className="text-[10px] num-mono text-on-surface-subtle">{fixed.length}</span>}
            </div>
            {renderList(fixed, 'No upcoming fixed holidays.', 'bg-danger')}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Optional</p>
              {!loading && <span className="text-[10px] num-mono text-on-surface-subtle">{optional.length}</span>}
            </div>
            {renderList(optional, 'No optional dates published yet.', 'bg-warning')}
          </div>
        </div>
      </div>
    </div>
  );
}

// Bootstrap-fed. Parent passes the pre-loaded outToday payload so this
// widget never fires its own network call — the shape is identical to
// what /api/leaves/out-today returned before.
function OutTodayCard({
  data, loading,
}: {
  data: Awaited<ReturnType<typeof api.getOutToday>> | null;
  loading: boolean;
}) {

  // "back …" label. We accept the server-supplied `today` so we don't
  // have to recompute IST vs UTC client-side.
  const returnLabel = (toDateStr: string, todayStr: string): string => {
    if (!toDateStr || !todayStr) return '';
    const back = new Date(toDateStr + 'T00:00:00');
    back.setDate(back.getDate() + 1);
    if (back.getDay() === 0) back.setDate(back.getDate() + 1);
    const today = new Date(todayStr + 'T00:00:00');
    const diffDays = Math.round((back.getTime() - today.getTime()) / 86_400_000);
    if (diffDays <= 1) return 'back tomorrow';
    if (diffDays <= 7) return `back ${back.toLocaleDateString('en-IN', { weekday: 'short' })}`;
    return `back ${back.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  };

  const out = data?.out ?? [];

  return (
    <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-outline">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle">Out today</p>
          <h3 className="font-display text-base font-bold text-on-surface mt-0.5">
            {loading
              ? <span className="inline-block w-32 h-4 bg-surface-2 rounded animate-pulse" />
              : out.length === 0
                ? "Full house"
                : out.length === 1
                  ? "1 person away"
                  : `${out.length} people away`}
          </h3>
        </div>
        {!loading && out.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-on-surface-subtle">
            <span className="num-mono">{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          </span>
        )}
      </div>

      {loading ? (
        // Skeleton — 2 muted rows so the layout doesn't shift when data
        // lands. Picks the same row height as a real entry.
        <ul className="divide-y divide-outline">
          {[0, 1].map(i => (
            <li key={i} className="px-5 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-surface-2 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 bg-surface-2 rounded animate-pulse" />
                <div className="h-2.5 w-20 bg-surface-2 rounded animate-pulse" />
              </div>
              <div className="space-y-1.5 flex flex-col items-end">
                <div className="h-3.5 w-16 bg-surface-2 rounded-full animate-pulse" />
                <div className="h-2.5 w-12 bg-surface-2 rounded animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      ) : out.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 text-center">
          <div className="w-12 h-12 rounded-full bg-success-container flex items-center justify-center mb-3">
            <CheckCircle2 size={20} className="text-success" />
          </div>
          <p className="text-sm font-semibold text-on-surface">Everyone's in today.</p>
        </div>
      ) : (
        <ul className="divide-y divide-outline max-h-[280px] overflow-y-auto">
          {out.map(r => {
            const tone = LEAVE_TONE[r.type] ?? LEAVE_TONE.full_day;
            const back = returnLabel(r.to_date, data?.today ?? '');
            return (
              <li key={r.id} className="px-5 py-3 flex items-center gap-3 hover:bg-surface-2/50 transition-colors">
                <div className="w-9 h-9 rounded-full bg-brand-container text-on-brand-container flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {r.avatar || r.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-on-surface truncate">{r.name}</p>
                  {r.designation && (
                    <p className="text-[11px] text-on-surface-subtle truncate">{r.designation}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ring-1 ${tone.bg} ${tone.text} ${tone.ring}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                    {leaveTypeLabel(r.type, r.slot)}
                  </span>
                  <span className="text-[10px] text-on-surface-subtle">{back}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [repairTickets, setRepairTickets] = useState<any[]>([]);
  const [hoursSummary, setHoursSummary] = useState<any>(null);
  // Holiday / optional / out-today used to be loaded by child components
  // (HolidaysCard, OutTodayCard). They now come in through the bootstrap
  // bundle and get passed down as props — saves 5 extra network calls.
  const [holidaysThisYear, setHolidaysThisYear] = useState<any[]>([]);
  const [holidaysNextYear, setHolidaysNextYear] = useState<any[]>([]);
  const [optionalThisYear, setOptionalThisYear] = useState<any[]>([]);
  const [optionalNextYear, setOptionalNextYear] = useState<any[]>([]);
  const [outToday, setOutToday] = useState<Awaited<ReturnType<typeof api.getOutToday>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvingLeave, setApprovingLeave] = useState<Record<string, boolean>>({});

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const currentMonthName = MONTH_FULL[now.getMonth()];
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Company news widget state + upcoming events
  const [announcements, setAnnouncements] = useState<Array<any>>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<Array<any>>([]);
  const [showManageAnnouncements, setShowManageAnnouncements] = useState(false);
  const isAdminOrHR = user?.role === 'admin' || user?.role === 'hr_manager';

  // One-shot bootstrap: replaces 11 previously-separate mount fetches
  // (employees + leaves + payroll + attendance + tickets + announcements
  // + upcoming events + holidays × 2 + optional-leave × 2 + out-today)
  // with a single round-trip. Server runs the sub-queries in parallel
  // using shared memoTtl caches so this endpoint is the cheapest way to
  // hydrate the dashboard even on a cold Lambda. hoursSummary is loaded
  // separately because it needs a heavier per-employee compute pass.
  const applyBootstrap = (b: Awaited<ReturnType<typeof api.getDashboardBootstrap>>) => {
    setAnnouncements(b.announcements ?? []);
    setUpcomingEvents(b.upcomingEvents ?? []);
    setEmployees(b.employees ?? []);
    setLeaveRequests(b.leaveRequests ?? []);
    setAttendance(b.attendance ?? []);
    setPayroll(b.payroll ?? []);
    setRepairTickets(b.repairTickets ?? []);
    setOutToday(b.outToday ?? { today: '', out: [] });
    setHolidaysThisYear(b.holidaysThisYear ?? []);
    setHolidaysNextYear(b.holidaysNextYear ?? []);
    setOptionalThisYear(b.optionalThisYear ?? []);
    setOptionalNextYear(b.optionalNextYear ?? []);
  };
  useEffect(() => {
    Promise.all([
      api.getDashboardBootstrap(currentMonth, currentYear).then(applyBootstrap).catch(() => {}),
      // hoursSummary NOT in bootstrap — heavier compute, isolated call.
      api.getHoursSummary(currentMonth, currentYear).then(setHoursSummary).catch(() => setHoursSummary(null)),
    ]).finally(() => setLoading(false));
  }, [currentMonth, currentYear]);

  // Focus refetch — re-hydrate everything through bootstrap when the tab
  // regains focus (came back after lunch). Still ONE round-trip.
  useEffect(() => {
    const refetch = () => {
      api.getDashboardBootstrap(currentMonth, currentYear).then(applyBootstrap).catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refetch(); };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [currentMonth, currentYear]);

  // Live-refresh tick — kept for the "company news feels alive" moment.
  // Only pulls the two small surfaces (announcements + events); doesn't
  // duplicate the heavy bundle.
  useLiveRefresh(() => {
    api.getAnnouncements().then(setAnnouncements).catch(() => {});
    api.getUpcomingEvents(30).then(setUpcomingEvents).catch(() => {});
  });

  const activeEmployees = employees.filter(e => e.status === 'active').length;
  const pendingLeaves = leaveRequests.filter((l: any) => l.status === 'pending');
  const totalNetPay = payroll.reduce((s: number, p: any) => s + Number(p.net_pay), 0);

  // Normalise all attendance dates to YYYY-MM-DD (handles Neon IST offset)
  const normAttendance = attendance.map(r => ({ ...r, dateStr: toDateStr(r.date) }));

  const todayPresent = normAttendance.filter(r => r.dateStr === todayStr && (r.status === 'present' || r.status === 'late')).length;
  const attendanceRate = activeEmployees ? Math.round((todayPresent / activeEmployees) * 100) : 0;

  // Department headcount
  const deptCounts: Record<string, number> = {};
  employees.forEach(e => { deptCounts[e.department] = (deptCounts[e.department] || 0) + 1; });
  const deptData = Object.entries(deptCounts).map(([name, value]) => ({ name, value }));

  // Attendance trend: last 7 unique working days with records
  const uniqueDates = [...new Set(normAttendance.map(r => r.dateStr))].filter(Boolean).sort().slice(-7);
  const attendanceTrend = uniqueDates.map(date => {
    const dayRecords = normAttendance.filter(r => r.dateStr === date);
    const present = dayRecords.filter(r => r.status === 'present' || r.status === 'late').length;
    return {
      day: DAY_LABELS[new Date(date + 'T12:00:00Z').getUTCDay()],
      present,
      absent: Math.max(0, activeEmployees - present),
    };
  });

  // Headcount per month: last 7 months ending this month
  const headcountMonths = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentYear, currentMonth - 1 - (6 - i), 1);
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const count = employees.filter(e => e.join_date && new Date(e.join_date) <= endOfMonth).length;
    return { month: MONTH_SHORT[d.getMonth()], count };
  });
  const headcountSubtitle = `${headcountMonths[0].month} ${headcountMonths[0].month === MONTH_SHORT[currentMonth - 1] ? currentYear : currentYear - (currentMonth < 7 ? 1 : 0)} – ${MONTH_SHORT[currentMonth - 1]} ${currentYear}`;

  // Recent activity from leave requests sorted by most recent
  const sortedLeaves = [...leaveRequests].sort((a, b) => {
    const tA = new Date(a.applied_on ?? a.created_at ?? 0).getTime();
    const tB = new Date(b.applied_on ?? b.created_at ?? 0).getTime();
    return tB - tA;
  });
  const recentActivity = sortedLeaves.slice(0, 5).map((l: any) => {
    const name = l.employee_name?.split(' ')[0] ?? 'Employee';
    const typeLabel = l.type === 'full_day' ? 'full day' : l.type === 'half_day' ? 'half day' : l.type === 'short_leave' ? 'short leave' : l.type ?? '';
    const ts = new Date(l.applied_on ?? l.created_at ?? Date.now()).getTime();
    const daysAgo = Math.floor((Date.now() - ts) / 86400000);
    const timeStr = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`;
    if (l.status === 'approved') return { text: `${name}'s ${typeLabel} leave approved`, time: timeStr, icon: CheckCircle2, color: 'text-green-500' };
    if (l.status === 'rejected') return { text: `${name}'s ${typeLabel} leave rejected`, time: timeStr, icon: AlertCircle, color: 'text-red-400' };
    return { text: `${name} applied for ${typeLabel} leave`, time: timeStr, icon: Calendar, color: 'text-amber-500' };
  });

  // Week-over-week attendance change
  const thisWeekDates = uniqueDates.slice(-5);
  const lastWeekDates = uniqueDates.slice(-10, -5);
  const avgThis = thisWeekDates.length ? thisWeekDates.reduce((s, d) => {
    const p = normAttendance.filter(r => r.dateStr === d && (r.status === 'present' || r.status === 'late')).length;
    return s + (activeEmployees ? p / activeEmployees : 0);
  }, 0) / thisWeekDates.length : 0;
  const avgLast = lastWeekDates.length ? lastWeekDates.reduce((s, d) => {
    const p = normAttendance.filter(r => r.dateStr === d && (r.status === 'present' || r.status === 'late')).length;
    return s + (activeEmployees ? p / activeEmployees : 0);
  }, 0) / lastWeekDates.length : 0;
  const weekChange = avgLast > 0 ? Math.round((avgThis - avgLast) * 100) : null;

  // Y-axis max = activeEmployees rounded up to nearest 5
  const yMax = Math.max(5, Math.ceil((activeEmployees + 1) / 5) * 5);

  const handleLeaveAction = async (leaveId: string, action: 'approved' | 'rejected') => {
    // Reject must carry a reason — otherwise the employee gets a bare
    // "Leave Rejected" ping with no context. Prompt inline; abort on
    // empty / cancel.
    let rejection_reason: string | undefined;
    if (action === 'rejected') {
      const r = window.prompt('Reason for rejection (will be shown to the employee):', '');
      if (r === null) return;            // user cancelled
      if (!r.trim()) { alert('A rejection reason is required.'); return; }
      rejection_reason = r.trim();
    }
    setApprovingLeave(prev => ({ ...prev, [leaveId]: true }));
    try {
      await api.updateLeaveStatus(leaveId, action, { actioner_name: user?.name, rejection_reason });
      setLeaveRequests(prev => prev.map(l => l.id === leaveId ? { ...l, status: action } : l));
      toast.success(action === 'approved' ? 'Leave approved' : 'Leave rejected', 'Employee has been notified.');
    } catch (e: any) {
      toast.error('Action failed', e?.message);
    }
    finally { setApprovingLeave(prev => ({ ...prev, [leaveId]: false })); }
  };

  const stats: Array<{ label: string; value: ReactNode; sub: string; icon: any; iconBg: string; iconColor: string }> = [
    { label: 'Total Employees',   value: employees.length ? <CountUp to={employees.length} /> : '—', sub: `${activeEmployees} active`, icon: Users, iconBg: 'bg-brand-container', iconColor: 'text-on-brand-container' },
    { label: "Today's Attendance", value: activeEmployees ? <><CountUp to={todayPresent} /><span className="text-on-surface-subtle">/{activeEmployees}</span></> : '—', sub: activeEmployees ? `${attendanceRate}% attendance rate` : 'No employees', icon: UserCheck, iconBg: 'bg-success-container', iconColor: 'text-success' },
    { label: 'Pending Leaves',    value: <CountUp to={pendingLeaves.length} />, sub: 'Awaiting approval', icon: Calendar, iconBg: 'bg-warning-container', iconColor: 'text-warning' },
    { label: 'Monthly Payroll',   value: totalNetPay ? <CountUp to={totalNetPay / 100000} decimals={1} prefix="₹" suffix="L" /> : '—', sub: `${currentMonthName} ${currentYear} · Net`, icon: DollarSign, iconBg: 'bg-accent-container', iconColor: 'text-on-accent-container' },
  ];

  const greeting = (() => {
    const h = now.getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const ringCircumference = 2 * Math.PI * 48;
  const ringTargetOffset = ringCircumference * (1 - attendanceRate / 100);
  // Start ring fully empty, animate to target after first paint
  const [ringOffset, setRingOffset] = useState(ringCircumference);
  useEffect(() => {
    const id = setTimeout(() => setRingOffset(ringTargetOffset), 120);
    return () => clearTimeout(id);
  }, [ringTargetOffset]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-outline border-t-accent rounded-full animate-spin" />
    </div>
  );

  // Employees / coordinators get a personal-flavored landing dashboard
  // instead of the org-wide KPIs. Same Announcements + Coming up appear
  // for both groups so company news reaches everyone uniformly.
  if (!isAdminOrHR) return (
    <EmployeeDashboardView
      announcements={announcements}
      upcomingEvents={upcomingEvents}
    />
  );

  return (
    <div className="space-y-6">
      {/* ── Hero band ───────────────────────────────────────────────────────── */}
      <section className="relative aurora-bg grain-overlay rounded-xl-4 overflow-hidden text-white animate-fade-in">
        <div className="relative grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 p-6 sm:p-8">
          {/* Left: greeting + lede */}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-white/70 uppercase tracking-[0.22em]">
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl xl:text-5xl font-semibold leading-[1.05] tracking-tight mt-2">
              {greeting},
              <span className="block bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-transparent">
                {firstName}.
              </span>
            </h1>
            <p className="text-sm text-white/70 mt-3 max-w-md leading-relaxed">
              {pendingLeaves.length > 0
                ? `${pendingLeaves.length} leave request${pendingLeaves.length === 1 ? '' : 's'} waiting on you, and ${todayPresent} of ${activeEmployees} folks clocked in today.`
                : `Everything's clear — ${todayPresent} of ${activeEmployees} folks are clocked in today.`}
            </p>
            {/* Quick actions */}
            <div className="flex flex-wrap gap-2 mt-5">
              <Link to="/attendance" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-white text-[#192250] hover:bg-white/90 transition-colors">
                <UserCheck size={13} strokeWidth={2.25} /> Attendance
              </Link>
              <Link to="/leave" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-white/12 backdrop-blur-sm border border-white/15 text-white hover:bg-white/20 transition-colors">
                <Calendar size={13} strokeWidth={2.25} /> Leaves
              </Link>
              <Link to="/employees" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-white/12 backdrop-blur-sm border border-white/15 text-white hover:bg-white/20 transition-colors">
                <Users size={13} strokeWidth={2.25} /> People
              </Link>
              <Link to="/hours" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-white/12 backdrop-blur-sm border border-white/15 text-white hover:bg-white/20 transition-colors">
                <ClockIcon size={13} strokeWidth={2.25} /> Project hours
              </Link>
            </div>
          </div>

          {/* Right: attendance ring + key stats */}
          <div className="flex items-center gap-6 lg:justify-end">
            {/* Progress ring */}
            <div className="relative w-32 h-32 sm:w-36 sm:h-36 flex-shrink-0">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r="48" fill="none" strokeWidth="8" className="ring-track" />
                <circle cx="60" cy="60" r="48" fill="none" strokeWidth="8"
                  className="ring-value"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="num-mono text-3xl sm:text-4xl font-semibold leading-none">
                  <CountUp to={attendanceRate} duration={1100} />
                  <span className="text-base text-white/55 ml-0.5">%</span>
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55 mt-1.5">Present today</span>
              </div>
            </div>
            {/* Two side stats */}
            <div className="space-y-3 flex-1 min-w-0">
              <div className="rounded-xl-2 px-4 py-3 bg-white/8 border border-white/10 backdrop-blur-sm animate-fade-up stagger-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-white/55 font-semibold">People</p>
                <p className="num-mono text-2xl font-semibold mt-0.5 leading-none"><CountUp to={employees.length} /></p>
                <p className="text-[11px] text-white/55 mt-1"><CountUp to={activeEmployees} /> active</p>
              </div>
              <div className="rounded-xl-2 px-4 py-3 bg-white/8 border border-white/10 backdrop-blur-sm animate-fade-up stagger-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-white/55 font-semibold">Net payroll</p>
                <p className="num-mono text-2xl font-semibold mt-0.5 leading-none">
                  {totalNetPay ? <CountUp to={totalNetPay / 100000} decimals={1} prefix="₹" suffix="L" /> : '—'}
                </p>
                <p className="text-[11px] text-white/55 mt-1">{currentMonthName} {currentYear}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Bento KPI grid (asymmetric) ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, sub, icon: Icon, iconBg, iconColor }, i) => (
          <div key={label}
            className={`group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up stagger-${i + 1} ${i === 0 ? 'col-span-2 lg:col-span-2' : ''}`}>
            {/* Decorative accent corner */}
            <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-30 group-hover:opacity-60 group-hover:scale-110 transition-all duration-500 ${iconBg} blur-xl`} />

            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.16em]">{label}</p>
                <p className={`num-mono font-semibold text-on-surface mt-2 leading-none ${i === 0 ? 'text-5xl' : 'text-3xl'}`}>{value}</p>
                <p className="text-xs text-on-surface-subtle mt-2.5">{sub}</p>
              </div>
              <div className={`w-11 h-11 rounded-2xl ${iconBg} flex items-center justify-center flex-shrink-0 shadow-elev-1 group-hover:scale-110 transition-transform duration-300`}>
                <Icon size={20} className={iconColor} strokeWidth={1.75} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* IT Repairs alert — shown when there's any open ticket activity */}
      {(() => {
        const openTickets       = repairTickets.filter(t => !['paid', 'cancelled'].includes(t.status));
        const inRepair          = openTickets.filter(t => ['picked_up', 'returned'].includes(t.status)).length;
        const reported          = openTickets.filter(t => t.status === 'reported').length;
        const awaitingApproval  = openTickets.filter(t => t.status === 'awaiting_approval').length;
        const unpaid = openTickets.reduce((s, t) => s + Number(t.final_cost ?? t.quoted_cost ?? 0), 0);
        if (openTickets.length === 0) return null;
        return (
          <Link to="/asset-repairs" className="flex items-center gap-3 px-4 py-3 rounded-xl-2 border border-warning/20 bg-warning-container/60 hover:bg-warning-container transition-colors group">
            <div className="w-10 h-10 rounded-2xl bg-warning/15 flex items-center justify-center flex-shrink-0">
              <Wrench size={18} className="text-warning" />
            </div>
            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1">
              {reported > 0 && (
                <span className="text-sm text-on-surface"><strong className="font-bold">{reported}</strong> new</span>
              )}
              {inRepair > 0 && (
                <span className="text-sm text-on-surface"><strong className="font-bold">{inRepair}</strong> in repair</span>
              )}
              {awaitingApproval > 0 && (
                <span className="text-sm text-danger"><strong className="font-bold">{awaitingApproval}</strong> need approval</span>
              )}
              {unpaid > 0 && (
                <span className="text-sm text-on-surface"><strong className="font-bold">₹{unpaid.toLocaleString('en-IN')}</strong> unpaid</span>
              )}
            </div>
            <span className="text-xs font-semibold text-warning group-hover:underline">View →</span>
          </Link>
        );
      })()}

      {/* Project Hours summary tile */}
      {hoursSummary && (hoursSummary.total_allocated > 0 || hoursSummary.pending_review_count > 0) && (
        <Link to="/hours" className="flex items-center gap-3 px-4 py-3 rounded-xl-2 border border-brand/15 bg-brand-container/50 hover:bg-brand-container transition-colors group">
          <div className="w-10 h-10 rounded-2xl bg-brand/15 flex items-center justify-center flex-shrink-0">
            <ClockIcon size={18} className="text-on-brand-container" />
          </div>
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm text-on-surface">
              <strong className="font-bold">{Math.round(Number(hoursSummary.total_allocated))}h</strong> allocated · {currentMonthName}
            </span>
            <span className="text-sm text-on-surface">
              <strong className="font-bold">{Math.round(Number(hoursSummary.total_logged_approved))}h</strong> logged
            </span>
            {Number(hoursSummary.total_logged_over_plan ?? 0) > 0 && (
              <span className="text-sm text-warning inline-flex items-center gap-1">
                <AlertCircle size={12} />
                <strong className="font-bold">+{Math.round(Number(hoursSummary.total_logged_over_plan))}h</strong> over plan
                <span className="text-xs text-on-surface-muted">({hoursSummary.over_plan_log_count} logs)</span>
              </span>
            )}
            {hoursSummary.pending_review_count > 0 && (
              <span className="text-sm text-danger">
                <strong className="font-bold">{hoursSummary.pending_review_count}</strong> pending review
              </span>
            )}
            <span className="text-xs text-on-surface-muted">
              {hoursSummary.employees?.length ?? 0} employees on plan
            </span>
          </div>
          <span className="text-xs font-semibold text-on-brand-container group-hover:underline">View Hours →</span>
        </Link>
      )}

      {/* Attendance heatmap + Dept distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Heatmap card — same aesthetic as hero */}
        <div className="lg:col-span-2 relative bg-surface rounded-xl-3 p-6 border border-outline shadow-elev-2 overflow-hidden animate-fade-up stagger-5 group hover:shadow-elev-3 transition-shadow">
          {/* Decorative accent corner */}
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-accent/20 blur-3xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="absolute -bottom-16 -left-16 w-40 h-40 rounded-full bg-brand/20 blur-3xl opacity-40" />

          <div className="relative">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="font-display text-xl font-bold text-on-surface tracking-tight">Attendance pulse</h3>
                <p className="text-xs text-on-surface-muted mt-1">Last 35 days · darker = higher % present</p>
              </div>
              {weekChange !== null && (
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1 ${weekChange >= 0 ? 'bg-success-container text-success' : 'bg-danger-container text-danger'}`}>
                  <TrendingUp size={11} /> {weekChange >= 0 ? '+' : ''}{weekChange}% wk
                </span>
              )}
            </div>
            <AttendanceHeatmap records={normAttendance} activeEmployees={activeEmployees} days={35} />
          </div>
        </div>

        {/* Department donut — matched aesthetic */}
        <div className="relative bg-surface rounded-xl-3 p-6 border border-outline shadow-elev-2 overflow-hidden animate-fade-up stagger-6 group hover:shadow-elev-3 transition-shadow">
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-brand/20 blur-2xl opacity-40 group-hover:opacity-70 transition-opacity duration-500" />
          <div className="relative">
            <h3 className="font-display text-xl font-bold text-on-surface tracking-tight">By department</h3>
            <p className="text-xs text-on-surface-muted mt-1 mb-3">Headcount split</p>
            {deptData.length === 0 ? (
              <div className="flex items-center justify-center h-[160px] text-sm text-on-surface-muted">No employee data</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={deptData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" stroke="none" paddingAngle={3}>
                      {deptData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={{ color: CHART_TOOLTIP_TEXT }} labelStyle={{ color: CHART_TOOLTIP_TEXT }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {deptData.slice(0, 5).map((d, i) => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length], boxShadow: `0 0 8px ${COLORS[i % COLORS.length]}40` }} />
                        <span className="text-on-surface-muted truncate">{d.name}</span>
                      </div>
                      <span className="num-mono font-semibold text-on-surface">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Who's out today — surfaced above the headcount band so it's the
          first "team availability" read after the KPI hero. */}
      <OutTodayCard data={outToday} loading={loading} />

      {/* Fixed + Optional holidays — same row as Out Today's vibe:
          team-wide availability info that everyone benefits from
          seeing on the landing page. */}
      <HolidaysCard fixedRaw={[...holidaysThisYear, ...holidaysNextYear]} optionalRaw={[...optionalThisYear, ...optionalNextYear]} loading={loading} />

      {/* Headcount growth + Pending leaves + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="relative bg-surface rounded-xl-3 p-6 border border-outline shadow-elev-2 overflow-hidden group hover:shadow-elev-3 transition-shadow animate-fade-up stagger-5">
          <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full bg-brand/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <h3 className="font-display text-xl font-bold text-on-surface tracking-tight">Headcount growth</h3>
            <p className="text-xs text-on-surface-muted mt-1 mb-4">{headcountSubtitle}</p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={headcountMonths} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: CHART_AXIS, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: CHART_AXIS, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} domain={[0, yMax]} allowDecimals={false} />
                <Tooltip cursor={{ fill: CHART_GRID }} contentStyle={CHART_TOOLTIP_STYLE} itemStyle={{ color: CHART_TOOLTIP_TEXT }} labelStyle={{ color: CHART_TOOLTIP_TEXT }} />
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={CHART_BRAND} stopOpacity={0.8} />
                  </linearGradient>
                </defs>
                <Bar dataKey="count" fill="url(#barGrad)" radius={[8, 8, 0, 0]} name="Headcount" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="relative bg-surface rounded-xl-3 p-6 border border-outline shadow-elev-2 overflow-hidden group hover:shadow-elev-3 transition-shadow animate-fade-up stagger-6">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-warning/20 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-xl font-bold text-on-surface tracking-tight">Pending leaves</h3>
              <span className="num-mono text-xs bg-warning-container text-warning px-2.5 py-0.5 rounded-full font-semibold"><CountUp to={pendingLeaves.length} /> pending</span>
            </div>
            {/* Scrollable list — when there are many pending, the widget
                used to truncate at 3 and only hint "+N more". HR needs to
                see every request without leaving the dashboard, so keep
                everything in the DOM and let it scroll inside a fixed
                viewport. The fade-out at the bottom signals "more below" */}
            <div className="relative">
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 -mr-1">
                {pendingLeaves.map((l: any) => {
                  const busy = approvingLeave[l.id];
                  return (
                    <div key={l.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-brand-container flex items-center justify-center text-on-brand-container text-xs font-bold flex-shrink-0">
                          {(l.employee_name ?? '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-on-surface truncate">{(l.employee_name ?? 'Employee').split(' ')[0]}</p>
                          <p className="text-xs text-on-surface-muted capitalize truncate">{leaveTypeLabel(l.type, l.slot)} · {l.days}d</p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          disabled={busy}
                          onClick={() => handleLeaveAction(l.id, 'approved')}
                          className="px-2.5 py-1 text-xs bg-success-container text-success rounded-md hover:opacity-80 transition-opacity font-semibold disabled:opacity-50">
                          {busy ? '…' : 'Approve'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => handleLeaveAction(l.id, 'rejected')}
                          className="px-2.5 py-1 text-xs bg-danger-container text-danger rounded-md hover:opacity-80 transition-opacity font-semibold disabled:opacity-50">
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
                {pendingLeaves.length === 0 && (
                  <div className="flex flex-col items-center gap-1.5 py-4 text-on-surface-muted">
                    <CheckCircle2 size={20} className="text-success/60" />
                    <p className="text-sm">No pending requests</p>
                  </div>
                )}
              </div>
              {/* Fade-out hint so users know there's more below the fold */}
              {pendingLeaves.length > 3 && (
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-surface to-transparent" />
              )}
            </div>
          </div>
        </div>

        <div className="relative bg-surface rounded-xl-3 p-6 border border-outline shadow-elev-2 overflow-hidden group hover:shadow-elev-3 transition-shadow animate-fade-up stagger-6">
          <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full bg-accent/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <h3 className="font-display text-xl font-bold text-on-surface tracking-tight mb-4">Recent activity</h3>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-on-surface-muted text-center py-4">No recent activity</p>
            ) : (
              <div className="space-y-3">
                {recentActivity.map((item, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-surface-2 border border-outline flex items-center justify-center flex-shrink-0 mt-0.5">
                      <item.icon size={14} className={item.color} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-on-surface leading-snug">{item.text}</p>
                      <p className="text-[11px] text-on-surface-muted mt-0.5 font-mono">{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Company news + Upcoming events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Announcements — spans 2 columns */}
        <div className="lg:col-span-2 relative bg-surface rounded-xl-3 p-6 border border-outline shadow-elev-2 overflow-hidden group hover:shadow-elev-3 transition-shadow animate-fade-up">
          <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full bg-brand/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h3 className="font-display text-xl font-bold text-on-surface tracking-tight inline-flex items-center gap-2">
                  📢 Company Announcements
                </h3>
                <p className="text-xs text-on-surface-muted mt-0.5">News, updates, and reminders</p>
              </div>
              <button onClick={() => setShowManageAnnouncements(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-accent text-on-accent hover:opacity-90">
                + Post
              </button>
            </div>
            {announcements.length === 0 ? (
              <div className="text-center py-8 text-sm text-on-surface-subtle">
                Nothing posted yet. Click + Post to add the first announcement.
              </div>
            ) : (
              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1 -mr-1">
                {announcements.map((a: any) => (
                  <AnnouncementCard key={a.id} a={a}
                    canDelete={isAdminOrHR || a.posted_by_id === user?.id}
                    onChanged={() => api.getAnnouncements().then(setAnnouncements).catch(() => {})}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Upcoming events — 1 column */}
        <div className="relative bg-surface rounded-xl-3 p-6 border border-outline shadow-elev-2 overflow-hidden group hover:shadow-elev-3 transition-shadow animate-fade-up">
          <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full bg-accent/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <h3 className="font-display text-xl font-bold text-on-surface tracking-tight mb-1 inline-flex items-center gap-2">
              📅 Coming up
            </h3>
            <p className="text-xs text-on-surface-muted mb-4">Recent days + next 30 — holidays, birthdays, anniversaries</p>
            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-on-surface-subtle text-center py-8">Nothing on the horizon this month.</p>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 -mr-1">
                {upcomingEvents.map((e: any, i: number) => {
                  // Normalize both dates to LOCAL noon so the delta is
                  // always a whole-day multiple. Previously today was
                  // anchored at midnight and the event at noon, giving a
                  // -0.5 day diff for yesterday's events; Math.round(-0.5)
                  // is 0 in JS (rounds toward +Inf), which mislabelled
                  // yesterday's birthday as "Today".
                  const now = new Date();
                  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
                  const [ey, em, ed] = String(e.event_date).split('-').map(Number);
                  const eventDate = new Date(ey, em - 1, ed, 12, 0, 0);
                  const daysAway = Math.round((eventDate.getTime() - todayNoon.getTime()) / 86400_000);
                  const dayLabel =
                    daysAway === 0 ? 'Today' :
                    daysAway === 1 ? 'Tomorrow' :
                    daysAway === -1 ? 'Yesterday' :
                    daysAway < 0 ? `${Math.abs(daysAway)}d ago` :
                    `in ${daysAway}d`;
                  const dateLabel = eventDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                  const cfg = e.kind === 'holiday'
                    ? { emoji: '🎉', tone: 'bg-warning-container text-warning border-warning/30' }
                    : e.kind === 'birthday'
                    ? { emoji: '🎂', tone: 'bg-brand-container text-on-brand-container border-brand/30' }
                    : { emoji: '🎯', tone: 'bg-accent/10 text-accent border-accent/30' };
                  return (
                    <div key={i} className={`flex items-center gap-3 rounded-lg border ${cfg.tone} px-3 py-2`}>
                      <span className="text-lg flex-shrink-0">{cfg.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface truncate">{e.label}</p>
                        <p className="text-[10px] text-on-surface-subtle">{dateLabel}{e.employee?.designation ? ` · ${e.employee.designation}` : ''}</p>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${daysAway <= 1 ? 'text-on-surface' : 'text-on-surface-muted'}`}>
                        {dayLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {showManageAnnouncements && (
        <ManageAnnouncementsModal
          isAdminOrHR={isAdminOrHR}
          currentItems={announcements}
          onClose={() => setShowManageAnnouncements(false)}
          onChanged={() => api.getAnnouncements().then(setAnnouncements).catch(() => {})}
        />
      )}
    </div>
  );
}

// Admin / HR modal for managing the company announcements list. Create a
// new post inline, edit existing posts, toggle pinned, delete. Designed
// to live inside the Dashboard widget so HR doesn't need to navigate to
// a separate page just to post a quick note.
// Shared card for one announcement on the dashboard widgets. Renders role
// chips when a human posted it, a HRMS badge + accented border when the
// post was auto-generated for a birthday or anniversary, and an inline
// Delete affordance when the viewer is allowed to remove it (own post or
// admin/HR).
function AnnouncementCard({ a, canDelete, onChanged }: {
  a: any;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const isAdminOrHR = user?.role === 'admin' || user?.role === 'hr_manager';
  const isAuto = a.kind === 'birthday' || a.kind === 'anniversary';
  const tone = isAuto
    ? a.kind === 'birthday'
      ? 'border-brand/30 bg-brand-container/40'
      : 'border-accent/40 bg-accent/5'
    : a.pinned ? 'border-accent/40 bg-accent/5' : 'border-outline bg-surface-2/30';
  const roleLabel =
    a.posted_by_role === 'admin' ? 'Admin' :
    a.posted_by_role === 'hr_manager' ? 'HR' :
    a.posted_by_role === 'project_coordinator' ? 'Coord' :
    a.posted_by_role === 'employee' ? 'Employee' : null;
  const remove = async () => {
    if (!confirm(`Delete "${a.title}"?`)) return;
    try {
      await api.deleteAnnouncement(a.id);
      toast.success('Announcement deleted', a.title);
      onChanged();
    } catch (e: any) { toast.error('Failed to delete', e?.message); }
  };
  // Comment thread state. Lazy-loaded the first time the user clicks
  // through to expand the thread — keeps the dashboard widget cheap.
  const [comments, setComments] = useState<any[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  // Lightweight count fetch on mount so the "💬 N" pill renders without
  // having to expand the thread first. One round-trip per card; the
  // payload is short.
  useEffect(() => {
    let dropped = false;
    api.getAnnouncementComments(a.id)
      .then(c => { if (!dropped) setCommentCount(c.length); })
      .catch(() => {/* leave null */});
    return () => { dropped = true; };
  }, [a.id]);
  const loadComments = async () => {
    try {
      const c = await api.getAnnouncementComments(a.id);
      setComments(c);
      setCommentCount(c.length);
    } catch { setComments([]); }
  };
  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && comments === null) await loadComments();
  };
  const postComment = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await api.addAnnouncementComment(a.id, draft.trim());
      setDraft('');
      await loadComments();
    } catch (e: any) { toast.error('Failed to comment', e?.message); }
    finally { setPosting(false); }
  };
  const removeComment = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.deleteAnnouncementComment(a.id, commentId);
      await loadComments();
    } catch (e: any) { toast.error('Failed to delete', e?.message); }
  };
  return (
    <article className={`rounded-xl-2 border ${tone} px-4 py-3 relative group`}>
      <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {a.pinned && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-accent text-on-accent">📌 Pinned</span>}
          {a.kind === 'birthday' && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-brand text-on-brand">🎂 Birthday</span>}
          {a.kind === 'anniversary' && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-accent text-on-accent">🎯 Anniversary</span>}
          <p className="font-display text-base font-bold text-on-surface tracking-tight truncate">{a.title}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <p className="text-[10px] text-on-surface-subtle whitespace-nowrap">
            {new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </p>
          {canDelete && (
            <button onClick={remove}
              title="Delete"
              className="opacity-0 group-hover:opacity-100 text-[11px] font-semibold text-danger hover:underline transition-opacity">
              Delete
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-on-surface-muted whitespace-pre-line leading-snug">{a.body}</p>
      {(a.posted_by_name || isAuto) && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-on-surface-subtle">
          <span>— {a.posted_by_name ?? 'Digital Leap HRMS'}</span>
          {roleLabel && (
            <span className="font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-surface-2 text-on-surface-muted border border-outline">
              {roleLabel}
            </span>
          )}
          {isAuto && (
            <span className="font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
              Auto
            </span>
          )}
        </div>
      )}

      {/* Comment thread — collapsed by default, lazy-loads on first open. */}
      <div className="mt-2 pt-2 border-t border-outline/60">
        <button onClick={toggle}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-on-surface-muted hover:text-accent transition-colors">
          <MessageCircle size={12} />
          {commentCount === 0 || commentCount === null
            ? (expanded ? 'Hide comments' : 'Reply')
            : (expanded ? `Hide ${commentCount} comment${commentCount === 1 ? '' : 's'}` : `${commentCount} comment${commentCount === 1 ? '' : 's'}`)}
        </button>
        {expanded && (
          <div className="mt-2 space-y-2">
            {(comments ?? []).map(c => {
              const canRemove = isAdminOrHR || c.posted_by_id === user?.id;
              const cRole = c.posted_by_role === 'admin' ? 'Admin'
                : c.posted_by_role === 'hr_manager' ? 'HR'
                : c.posted_by_role === 'project_coordinator' ? 'Coord'
                : c.posted_by_role === 'employee' ? 'Employee' : null;
              return (
                <div key={c.id} className="rounded-lg bg-surface px-3 py-2 border border-outline group/c">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[11px] font-bold text-on-surface truncate">{c.posted_by_name ?? 'Someone'}</span>
                      {cRole && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-surface-2 text-on-surface-muted border border-outline">
                          {cRole}
                        </span>
                      )}
                      <span className="text-[10px] text-on-surface-subtle whitespace-nowrap">
                        · {new Date(c.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {canRemove && (
                      <button onClick={() => removeComment(c.id)}
                        className="opacity-0 group-hover/c:opacity-100 text-[10px] font-semibold text-danger hover:underline transition-opacity">
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-on-surface whitespace-pre-line leading-snug">{c.body}</p>
                </div>
              );
            })}
            {comments && comments.length === 0 && (
              <p className="text-[11px] text-on-surface-subtle italic">No comments yet. Be the first to reply.</p>
            )}
            <div className="flex items-start gap-2">
              <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1}
                placeholder="Write a comment…"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); postComment(); }
                }}
                className="flex-1 text-xs border border-outline rounded-lg px-2.5 py-1.5 bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent/30" />
              <button onClick={postComment} disabled={posting || !draft.trim()}
                className="px-3 py-1.5 text-[11px] font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-40 whitespace-nowrap">
                {posting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function ManageAnnouncementsModal({ isAdminOrHR, currentItems, onClose, onChanged }: {
  isAdminOrHR: boolean;
  currentItems: any[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>(currentItems);
  const [editing, setEditing] = useState<any | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftPinned, setDraftPinned] = useState(false);
  const [draftExpires, setDraftExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const resetForm = () => {
    setEditing(null);
    setDraftTitle('');
    setDraftBody('');
    setDraftPinned(false);
    setDraftExpires('');
    setError('');
  };

  const startEdit = (a: any) => {
    setEditing(a);
    setDraftTitle(a.title);
    setDraftBody(a.body);
    setDraftPinned(!!a.pinned);
    setDraftExpires(a.expires_at ? a.expires_at.slice(0, 10) : '');
    setError('');
  };

  const submit = async () => {
    if (!draftTitle.trim() || !draftBody.trim()) { setError('Title and body are required'); return; }
    setBusy(true); setError('');
    try {
      const payload = {
        title: draftTitle.trim(),
        body: draftBody.trim(),
        pinned: draftPinned,
        expires_at: draftExpires || null,
      };
      if (editing) await api.updateAnnouncement(editing.id, payload);
      else         await api.createAnnouncement(payload);
      const fresh = await api.getAnnouncements();
      setItems(fresh);
      onChanged();
      resetForm();
    } catch (e: any) { setError(e?.message ?? 'Failed to save'); }
    finally { setBusy(false); }
  };

  const remove = async (a: any) => {
    if (!confirm(`Delete "${a.title}"?`)) return;
    try {
      await api.deleteAnnouncement(a.id);
      const fresh = await api.getAnnouncements();
      setItems(fresh);
      onChanged();
    } catch (e: any) { alert(e?.message ?? 'Failed to delete'); }
  };

  // Modal is open to every signed-in user now — anyone can post. Pin /
  // Expiry controls + per-row Edit/Delete on others' posts stay gated to
  // admin/HR (handled inline above).

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <h2 className="font-display text-lg font-bold text-on-surface inline-flex items-center gap-2">
            📢 {isAdminOrHR ? 'Manage Company Announcements' : 'Share an update'}
          </h2>
          <button onClick={onClose}><XCircle size={18} className="text-on-surface-subtle" /></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="space-y-3 border-b border-outline pb-5">
            <p className="text-xs font-bold uppercase tracking-wider text-on-surface-subtle">
              {editing ? `Editing — ${editing.title}` : 'New Announcement'}
            </p>
            <input value={draftTitle} onChange={e => setDraftTitle(e.target.value)} placeholder="Title (e.g. New holiday policy)"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
            <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} rows={4}
              placeholder="What's the announcement? Plain text, line breaks preserved."
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent/30" />
            {/* Pin + Expiry are admin/HR controls — gate them so an
                employee posting a quick update can't pin their own post
                to the top of the company feed indefinitely. */}
            {isAdminOrHR && (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-on-surface-muted inline-flex items-center gap-2">
                  <input type="checkbox" checked={draftPinned} onChange={e => setDraftPinned(e.target.checked)} />
                  📌 Pin to top
                </label>
                <div>
                  <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Auto-expire (optional)</label>
                  <input type="date" value={draftExpires} onChange={e => setDraftExpires(e.target.value)}
                    className="w-full text-sm border border-outline rounded-lg px-3 py-1.5 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
                </div>
              </div>
            )}
            {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-2">
              {editing && (
                <button onClick={resetForm} className="px-3 py-1.5 text-xs font-semibold text-on-surface-muted border border-outline rounded-lg hover:bg-surface-2">Cancel edit</button>
              )}
              <button onClick={submit} disabled={busy}
                className="px-4 py-1.5 text-xs font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50">
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Post announcement'}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-on-surface-subtle mb-3">Active announcements ({items.length})</p>
            {items.length === 0 ? (
              <p className="text-sm text-on-surface-subtle text-center py-6">Nothing posted yet.</p>
            ) : (
              <div className="space-y-2">
                {items.map(a => {
                  const isOwn = a.posted_by_id === user?.id;
                  const canEdit = isAdminOrHR || isOwn;
                  const canRemove = canEdit;
                  return (
                    <div key={a.id} className={`rounded-lg border ${a.pinned ? 'border-accent/40 bg-accent/5' : 'border-outline'} px-3 py-2 flex items-start justify-between gap-3`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          {a.pinned && <span className="text-[10px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-accent text-on-accent">📌</span>}
                          {a.kind === 'birthday' && <span className="text-[10px]">🎂</span>}
                          {a.kind === 'anniversary' && <span className="text-[10px]">🎯</span>}
                          <p className="text-sm font-bold text-on-surface truncate">{a.title}</p>
                          {a.posted_by_role && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-surface-2 text-on-surface-muted border border-outline">
                              {a.posted_by_role === 'admin' ? 'Admin' : a.posted_by_role === 'hr_manager' ? 'HR' : a.posted_by_role === 'project_coordinator' ? 'Coord' : 'Employee'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-on-surface-muted truncate">{a.body}</p>
                      </div>
                      <div className="flex flex-shrink-0 gap-1">
                        {canEdit && <button onClick={() => startEdit(a)} className="text-[11px] font-semibold text-on-surface-muted hover:text-accent px-2 py-1">Edit</button>}
                        {canRemove && <button onClick={() => remove(a)} className="text-[11px] font-semibold text-danger hover:underline px-2 py-1">Delete</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Employee / Coordinator Dashboard
// Same `/` URL, different layout. Shows the user's own snapshot — basic
// info, today's status, leave balance, quick action shortcuts — then the
// same Company Announcements + Coming up widgets the admin Dashboard has.
// ─────────────────────────────────────────────────────────────────────────

function EmployeeDashboardView({ announcements, upcomingEvents }: {
  announcements: any[]; upcomingEvents: any[];
}) {
  const { user } = useAuth();
  const isAdminOrHR = user?.role === 'admin' || user?.role === 'hr_manager';
  const [empRow, setEmpRow] = useState<any>(null);
  const [balance, setBalance] = useState<any>({ full_day: 0, short_leave: 0 });
  const [myAttendance, setMyAttendance] = useState<any[]>([]);
  const [myLeaves, setMyLeaves] = useState<any[]>([]);
  // Open the post modal on the employee dashboard too — anyone can share now.
  const [showPostModal, setShowPostModal] = useState(false);
  // Local copy of announcements so the optimistic refresh after a post
  // shows up here. The parent fetches every 15s anyway; this just makes
  // it instant.
  const [localAnnouncements, setLocalAnnouncements] = useState<any[]>(announcements);
  useEffect(() => { setLocalAnnouncements(announcements); }, [announcements]);
  const refreshAnnouncements = () => {
    api.getAnnouncements().then(setLocalAnnouncements).catch(() => {});
  };
  const [reportingManager, setReportingManager] = useState<any | null>(null);

  // Resolve the user's own employee record + personal counters. This runs
  // once on mount — the parent Dashboard already polls announcements +
  // events on a live timer.
  useEffect(() => {
    if (!user?.employee_id_ref) return;
    api.getEmployees().then((emps: any[]) => {
      const me = emps.find(e => e.employee_id === user.employee_id_ref);
      if (!me) return;
      setEmpRow(me);
      const mgr = me.reporting_manager_id ? emps.find(e => e.id === me.reporting_manager_id) : null;
      setReportingManager(mgr ? { name: mgr.name, designation: mgr.designation } : null);
      api.getLeaveBalance(me.id).then(setBalance).catch(() => {});
      api.getAttendance({ employee_id: me.id, month: new Date().getMonth() + 1, year: new Date().getFullYear() })
        .then(setMyAttendance).catch(() => {});
      api.getLeaveRequests({ employee_id: me.id }).then(setMyLeaves).catch(() => {});
    }).catch(() => {});
  }, [user?.employee_id_ref]);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const greeting = (() => {
    const h = now.getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  // Attendance % for current month so far.
  const workingDays = myAttendance.filter((r: any) => r.status !== 'weekend' && r.status !== 'holiday').length;
  const presentDays = myAttendance.filter((r: any) => ['present', 'late', 'wfh', 'wfh_half'].includes(r.status)).length;
  const attendancePct = workingDays > 0 ? Math.round((presentDays / workingDays) * 100) : 0;
  const todayRec = myAttendance.find((r: any) => (r.date ?? '').slice(0, 10) === todayStr);
  const pendingLeaveCount = myLeaves.filter((l: any) => l.status === 'pending').length;

  return (
    <div className="space-y-6">
      {/* ── Welcome banner ──────────────────────────────────────────────────── */}
      <section className="relative aurora-bg grain-overlay rounded-xl-4 overflow-hidden text-white animate-fade-in">
        <div className="relative grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 p-6 sm:p-8">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-white/70 uppercase tracking-[0.22em]">
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl xl:text-5xl font-semibold leading-[1.05] tracking-tight mt-2">
              {greeting},
              <span className="block bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-transparent">
                {firstName}.
              </span>
            </h1>
            <p className="text-sm text-white/70 mt-3 max-w-md leading-relaxed">
              {todayRec?.check_in
                ? `Clocked in at ${todayRec.check_in}. ${pendingLeaveCount > 0 ? `You have ${pendingLeaveCount} leave request${pendingLeaveCount === 1 ? '' : 's'} waiting on approval.` : "You're all set for today."}`
                : pendingLeaveCount > 0
                  ? `You haven't clocked in yet. ${pendingLeaveCount} leave request${pendingLeaveCount === 1 ? '' : 's'} pending.`
                  : "You haven't clocked in yet. Ready when you are."}
            </p>
            {/* Quick actions */}
            <div className="flex flex-wrap gap-2 mt-5">
              <Link to="/my?tab=leave&apply=1" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-white text-[#192250] hover:bg-white/90 transition-colors">
                <Calendar size={13} strokeWidth={2.25} /> Apply Leave
              </Link>
              <Link to="/my?tab=my-hours" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-white/12 backdrop-blur-sm border border-white/15 text-white hover:bg-white/20 transition-colors">
                <ClockIcon size={13} strokeWidth={2.25} /> Log Hours
              </Link>
              <Link to="/my?tab=wfh&apply=1" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-white/12 backdrop-blur-sm border border-white/15 text-white hover:bg-white/20 transition-colors">
                <UserCheck size={13} strokeWidth={2.25} /> Apply WFH
              </Link>
              <Link to="/my?tab=attendance" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-white/12 backdrop-blur-sm border border-white/15 text-white hover:bg-white/20 transition-colors">
                <TrendingUp size={13} strokeWidth={2.25} /> My Attendance
              </Link>
            </div>
          </div>
          {/* Right side: avatar + identity card */}
          <div className="flex items-center justify-center lg:justify-end">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/15 p-4 max-w-xs w-full">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-xl font-bold flex-shrink-0">
                  {user?.avatar || firstName[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-display text-base font-bold truncate">{user?.name}</p>
                  <p className="text-[11px] text-white/70 truncate">{user?.designation ?? '—'}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#FF80A8' }}>
                    {(user as any)?.employee_code ?? user?.employee_id_ref}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-white/60">Dept.</p>
                  <p className="font-semibold truncate">{user?.department ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-white/60">Manager</p>
                  <p className="font-semibold truncate">{reportingManager?.name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-white/60">Joined</p>
                  <p className="font-semibold truncate">{empRow?.join_date ? new Date(empRow.join_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-white/60">Today</p>
                  <p className="font-semibold truncate">
                    {todayRec?.check_in ? `In ${todayRec.check_in}` : 'Not in yet'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Who's out today — visible to everyone for team availability ───── */}
      <OutTodayCard data={outToday} loading={loading} />

      {/* ── Fixed + Optional holidays — so everyone can plan around them ──── */}
      <HolidaysCard fixedRaw={[...holidaysThisYear, ...holidaysNextYear]} optionalRaw={[...optionalThisYear, ...optionalNextYear]} loading={loading} />

      {/* ── Personal KPI tiles ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-success-container blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-success">{attendancePct}<span className="text-sm">%</span></p>
            <p className="text-xs text-on-surface-muted mt-0.5">Attendance this month</p>
          </div>
        </div>
        <div className="relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand-container blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-on-brand-container">{balance?.full_day ?? 0}</p>
            <p className="text-xs text-on-surface-muted mt-0.5">Full day leave balance</p>
          </div>
        </div>
        <div className="relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-accent/15 blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-accent">{balance?.short_leave ?? 0}</p>
            <p className="text-xs text-on-surface-muted mt-0.5">Short leave credits</p>
          </div>
        </div>
        <div className="relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-warning-container blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-warning">{pendingLeaveCount}</p>
            <p className="text-xs text-on-surface-muted mt-0.5">Pending leave requests</p>
          </div>
        </div>
      </div>

      {/* ── Announcements + Coming up (same shape as admin Dashboard) ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 relative bg-surface rounded-xl-3 p-6 border border-outline shadow-elev-2 overflow-hidden">
          <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full bg-brand/15 blur-2xl opacity-50" />
          <div className="relative">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h3 className="font-display text-xl font-bold text-on-surface tracking-tight inline-flex items-center gap-2">
                  📢 Company Announcements
                </h3>
                <p className="text-xs text-on-surface-muted mt-0.5">Anyone can share news, updates, or a quick shout-out.</p>
              </div>
              <button onClick={() => setShowPostModal(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-accent text-on-accent hover:opacity-90">
                + Post
              </button>
            </div>
            {localAnnouncements.length === 0 ? (
              <div className="text-center py-8 text-sm text-on-surface-subtle">Nothing posted yet. Click + Post to share something with the team.</div>
            ) : (
              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1 -mr-1">
                {localAnnouncements.map((a: any) => (
                  <AnnouncementCard key={a.id} a={a}
                    canDelete={isAdminOrHR || a.posted_by_id === user?.id}
                    onChanged={refreshAnnouncements}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="relative bg-surface rounded-xl-3 p-6 border border-outline shadow-elev-2 overflow-hidden">
          <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full bg-accent/15 blur-2xl opacity-50" />
          <div className="relative">
            <h3 className="font-display text-xl font-bold text-on-surface tracking-tight inline-flex items-center gap-2 mb-1">
              📅 Coming up
            </h3>
            <p className="text-xs text-on-surface-muted mb-4">Recent days + next 30 — holidays, birthdays, anniversaries</p>
            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-on-surface-subtle text-center py-8">Nothing on the horizon this month.</p>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 -mr-1">
                {upcomingEvents.map((e: any, i: number) => {
                  // Normalize both dates to LOCAL noon so the delta is
                  // always a whole-day multiple. Previously today was
                  // anchored at midnight and the event at noon, giving a
                  // -0.5 day diff for yesterday's events; Math.round(-0.5)
                  // is 0 in JS (rounds toward +Inf), which mislabelled
                  // yesterday's birthday as "Today".
                  const now = new Date();
                  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
                  const [ey, em, ed] = String(e.event_date).split('-').map(Number);
                  const eventDate = new Date(ey, em - 1, ed, 12, 0, 0);
                  const daysAway = Math.round((eventDate.getTime() - todayNoon.getTime()) / 86400_000);
                  const dayLabel =
                    daysAway === 0 ? 'Today' :
                    daysAway === 1 ? 'Tomorrow' :
                    daysAway === -1 ? 'Yesterday' :
                    daysAway < 0 ? `${Math.abs(daysAway)}d ago` :
                    `in ${daysAway}d`;
                  const dateLabel = eventDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                  const cfg = e.kind === 'holiday'
                    ? { emoji: '🎉', tone: 'bg-warning-container text-warning border-warning/30' }
                    : e.kind === 'birthday'
                    ? { emoji: '🎂', tone: 'bg-brand-container text-on-brand-container border-brand/30' }
                    : { emoji: '🎯', tone: 'bg-accent/10 text-accent border-accent/30' };
                  return (
                    <div key={i} className={`flex items-center gap-3 rounded-lg border ${cfg.tone} px-3 py-2`}>
                      <span className="text-lg flex-shrink-0">{cfg.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface truncate">{e.label}</p>
                        <p className="text-[10px] text-on-surface-subtle">{dateLabel}{e.employee?.designation ? ` · ${e.employee.designation}` : ''}</p>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${daysAway <= 1 ? 'text-on-surface' : 'text-on-surface-muted'}`}>
                        {dayLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer link to deeper personal portal */}
      <div className="text-center">
        <Link to="/my" className="text-xs font-semibold text-on-surface-muted hover:text-accent transition-colors">
          Open the full My Portal → all your tabs (leaves, hours, payslips, performance…)
        </Link>
      </div>

      {showPostModal && (
        <ManageAnnouncementsModal
          isAdminOrHR={isAdminOrHR}
          currentItems={localAnnouncements}
          onClose={() => setShowPostModal(false)}
          onChanged={refreshAnnouncements}
        />
      )}
    </div>
  );
}
