import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { Users, Calendar, DollarSign, TrendingUp, AlertCircle, CheckCircle2, UserCheck, Clock as ClockIcon, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

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

export default function Dashboard() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [repairTickets, setRepairTickets] = useState<any[]>([]);
  const [hoursSummary, setHoursSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [approvingLeave, setApprovingLeave] = useState<Record<string, boolean>>({});

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const currentMonthName = MONTH_FULL[now.getMonth()];
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    Promise.all([
      api.getEmployees(),
      api.getLeaveRequests(),
      api.getPayroll({ month: currentMonthName, year: currentYear }),
      api.getAttendance({ month: currentMonth, year: currentYear }),
      api.getRepairTickets().catch(() => []),
      api.getHoursSummary(currentMonth, currentYear).catch(() => null),
    ]).then(([emps, leaves, pay, att, tickets, hours]) => {
      setEmployees(emps);
      setLeaveRequests(leaves);
      setPayroll(pay);
      setAttendance(att);
      setRepairTickets(tickets);
      setHoursSummary(hours);
    }).finally(() => setLoading(false));
  }, []);

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
    setApprovingLeave(prev => ({ ...prev, [leaveId]: true }));
    try {
      await api.updateLeaveStatus(leaveId, action, { actioner_name: user?.name });
      setLeaveRequests(prev => prev.map(l => l.id === leaveId ? { ...l, status: action } : l));
    } catch { /* ignore — Leave page handles errors */ }
    finally { setApprovingLeave(prev => ({ ...prev, [leaveId]: false })); }
  };

  const stats = [
    { label: 'Total Employees', value: employees.length || '—', sub: `${activeEmployees} active`, icon: Users, iconBg: 'bg-brand-container', iconColor: 'text-on-brand-container' },
    { label: "Today's Attendance", value: activeEmployees ? `${todayPresent}/${activeEmployees}` : '—', sub: activeEmployees ? `${attendanceRate}% attendance rate` : 'No employees', icon: UserCheck, iconBg: 'bg-success-container', iconColor: 'text-success' },
    { label: 'Pending Leaves', value: pendingLeaves.length, sub: 'Awaiting approval', icon: Calendar, iconBg: 'bg-warning-container', iconColor: 'text-warning' },
    { label: 'Monthly Payroll', value: totalNetPay ? `₹${(totalNetPay / 100000).toFixed(1)}L` : '—', sub: `${currentMonthName} ${currentYear} · Net`, icon: DollarSign, iconBg: 'bg-accent-container', iconColor: 'text-on-accent-container' },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-outline border-t-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Greeting strip */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-on-surface-muted uppercase tracking-[0.18em]">
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h2 className="text-2xl sm:text-[28px] font-bold tracking-tight text-on-surface mt-1">
            {(() => {
              const h = now.getHours();
              const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
              const first = user?.name?.split(' ')[0] ?? 'there';
              return `${greet}, ${first}.`;
            })()}
          </h2>
          <p className="text-sm text-on-surface-muted mt-1">
            Here's what's happening across the team today.
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(({ label, value, sub, icon: Icon, iconBg, iconColor }) => (
          <div key={label} className="group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-shadow overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-on-surface-muted uppercase tracking-wider">{label}</p>
                <p className="text-3xl font-bold tracking-tight text-on-surface mt-2 leading-none">{value}</p>
                <p className="text-xs text-on-surface-subtle mt-2">{sub}</p>
              </div>
              <div className={`w-11 h-11 rounded-2xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
                <Icon size={20} className={iconColor} />
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

      {/* Attendance trend + Dept distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-on-surface tracking-tight">Attendance Trend</h3>
              <p className="text-xs text-on-surface-muted mt-0.5">Last 7 working days</p>
            </div>
            {weekChange !== null && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1 ${weekChange >= 0 ? 'bg-success-container text-success' : 'bg-danger-container text-danger'}`}>
                <TrendingUp size={11} /> {weekChange >= 0 ? '+' : ''}{weekChange}% this week
              </span>
            )}
          </div>
          {attendanceTrend.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-sm text-on-surface-muted">No attendance data for this month yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={attendanceTrend}>
                <defs>
                  <linearGradient id="presentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_BRAND} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={CHART_BRAND} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: CHART_AXIS }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: CHART_AXIS }} axisLine={false} tickLine={false} domain={[0, yMax]} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={{ color: CHART_TOOLTIP_TEXT }} labelStyle={{ color: CHART_TOOLTIP_TEXT }} />
                <Area type="monotone" dataKey="present" stroke={CHART_BRAND} strokeWidth={2.5} fill="url(#presentGrad)" name="Present" />
                <Area type="monotone" dataKey="absent" stroke={CHART_DANGER} strokeWidth={2} fill="none" strokeDasharray="4 3" name="Absent" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1">
          <h3 className="font-semibold text-on-surface tracking-tight mb-1">By Department</h3>
          <p className="text-xs text-on-surface-muted mb-4">Headcount distribution</p>
          {deptData.length === 0 ? (
            <div className="flex items-center justify-center h-[160px] text-sm text-on-surface-muted">No employee data</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={deptData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" stroke="none" paddingAngle={2}>
                    {deptData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} itemStyle={{ color: CHART_TOOLTIP_TEXT }} labelStyle={{ color: CHART_TOOLTIP_TEXT }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {deptData.slice(0, 5).map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-on-surface-muted truncate">{d.name}</span>
                    </div>
                    <span className="font-semibold text-on-surface tabular-nums">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Headcount growth + Pending leaves + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1">
          <h3 className="font-semibold text-on-surface tracking-tight mb-1">Headcount Growth</h3>
          <p className="text-xs text-on-surface-muted mb-4">{headcountSubtitle}</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={headcountMonths} barSize={22}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: CHART_AXIS }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: CHART_AXIS }} axisLine={false} tickLine={false} domain={[0, yMax]} allowDecimals={false} />
              <Tooltip cursor={{ fill: CHART_GRID }} contentStyle={CHART_TOOLTIP_STYLE} itemStyle={{ color: CHART_TOOLTIP_TEXT }} labelStyle={{ color: CHART_TOOLTIP_TEXT }} />
              <Bar dataKey="count" fill={CHART_BRAND} radius={[6, 6, 0, 0]} name="Headcount" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-on-surface tracking-tight">Pending Leaves</h3>
            <span className="text-xs bg-warning-container text-warning px-2.5 py-0.5 rounded-full font-semibold">{pendingLeaves.length} pending</span>
          </div>
          <div className="space-y-3">
            {pendingLeaves.slice(0, 3).map((l: any) => {
              const busy = approvingLeave[l.id];
              return (
                <div key={l.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-brand-container flex items-center justify-center text-on-brand-container text-xs font-bold flex-shrink-0">
                      {(l.employee_name ?? '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-on-surface truncate">{(l.employee_name ?? 'Employee').split(' ')[0]}</p>
                      <p className="text-xs text-on-surface-muted capitalize truncate">{(l.type ?? '').replace(/_/g, ' ')} · {l.days}d</p>
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
            {pendingLeaves.length > 3 && (
              <p className="text-xs text-center text-on-surface-muted pt-1">+{pendingLeaves.length - 3} more — see Leave Management</p>
            )}
            {pendingLeaves.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 py-4 text-on-surface-muted">
                <CheckCircle2 size={20} className="text-success/60" />
                <p className="text-sm">No pending requests</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1">
          <h3 className="font-semibold text-on-surface tracking-tight mb-4">Recent Activity</h3>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-on-surface-muted text-center py-4">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((item, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <item.icon size={14} className={item.color} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-on-surface leading-snug">{item.text}</p>
                    <p className="text-xs text-on-surface-muted mt-0.5">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
