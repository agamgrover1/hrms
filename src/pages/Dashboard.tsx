import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { Users, Calendar, DollarSign, TrendingUp, AlertCircle, CheckCircle2, UserCheck } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const COLORS = ['#5C4BDA', '#8269ff', '#a99bff', '#38bdf8', '#34d399', '#fb923c', '#f472b6'];
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
    ]).then(([emps, leaves, pay, att, tickets]) => {
      setEmployees(emps);
      setLeaveRequests(leaves);
      setPayroll(pay);
      setAttendance(att);
      setRepairTickets(tickets);
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
    { label: 'Total Employees', value: employees.length || '—', sub: `${activeEmployees} active`, icon: Users, iconBg: 'bg-primary-100', iconColor: 'text-primary-600' },
    { label: "Today's Attendance", value: activeEmployees ? `${todayPresent}/${activeEmployees}` : '—', sub: activeEmployees ? `${attendanceRate}% attendance rate` : 'No employees', icon: UserCheck, iconBg: 'bg-green-100', iconColor: 'text-green-600' },
    { label: 'Pending Leaves', value: pendingLeaves.length, sub: 'Awaiting approval', icon: Calendar, iconBg: 'bg-amber-100', iconColor: 'text-amber-600' },
    { label: 'Monthly Payroll', value: totalNetPay ? `₹${(totalNetPay / 100000).toFixed(1)}L` : '—', sub: `${currentMonthName} ${currentYear} · Net`, icon: DollarSign, iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(({ label, value, sub, icon: Icon, iconBg, iconColor }) => (
          <div key={label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500 font-medium">{label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
              </div>
              <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>
                <Icon size={18} className={iconColor} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* IT Repairs alert — only shown when there's activity */}
      {(() => {
        const inRepair = repairTickets.filter(t => ['picked_up', 'returned'].includes(t.status)).length;
        const awaitingApproval = repairTickets.filter(t => t.status === 'awaiting_approval').length;
        const unpaid = repairTickets.filter(t => t.status !== 'paid' && t.status !== 'cancelled')
          .reduce((s, t) => s + Number(t.final_cost ?? t.quoted_cost ?? 0), 0);
        if (inRepair === 0 && awaitingApproval === 0 && unpaid === 0) return null;
        return (
          <a href="/asset-repairs" className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-100 bg-amber-50 hover:bg-amber-100/50 transition-colors group">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-lg">🔧</span>
            </div>
            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1">
              {inRepair > 0 && (
                <span className="text-sm text-amber-900"><strong className="font-bold">{inRepair}</strong> {inRepair === 1 ? 'laptop' : 'laptops'} in repair</span>
              )}
              {awaitingApproval > 0 && (
                <span className="text-sm text-red-700"><strong className="font-bold">{awaitingApproval}</strong> awaiting approval</span>
              )}
              {unpaid > 0 && (
                <span className="text-sm text-amber-900"><strong className="font-bold">₹{unpaid.toLocaleString('en-IN')}</strong> unpaid</span>
              )}
            </div>
            <span className="text-xs font-semibold text-amber-700 group-hover:underline">View →</span>
          </a>
        );
      })()}

      {/* Attendance trend + Dept distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-800">Attendance Trend</h3>
              <p className="text-xs text-gray-400 mt-0.5">Last 7 working days</p>
            </div>
            {weekChange !== null && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1 ${weekChange >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                <TrendingUp size={11} /> {weekChange >= 0 ? '+' : ''}{weekChange}% this week
              </span>
            )}
          </div>
          {attendanceTrend.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-sm text-gray-400">No attendance data for this month yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={attendanceTrend}>
                <defs>
                  <linearGradient id="presentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5C4BDA" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#5C4BDA" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} domain={[0, yMax]} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
                <Area type="monotone" dataKey="present" stroke="#5C4BDA" strokeWidth={2} fill="url(#presentGrad)" name="Present" />
                <Area type="monotone" dataKey="absent" stroke="#f87171" strokeWidth={2} fill="none" strokeDasharray="4 2" name="Absent" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-1">By Department</h3>
          <p className="text-xs text-gray-400 mb-4">Headcount distribution</p>
          {deptData.length === 0 ? (
            <div className="flex items-center justify-center h-[160px] text-sm text-gray-400">No employee data</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={deptData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" stroke="none">
                    {deptData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {deptData.slice(0, 5).map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-gray-500 truncate max-w-[100px]">{d.name}</span>
                    </div>
                    <span className="font-medium text-gray-700">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Headcount growth + Pending leaves + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-1">Headcount Growth</h3>
          <p className="text-xs text-gray-400 mb-4">{headcountSubtitle}</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={headcountMonths} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} domain={[0, yMax]} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
              <Bar dataKey="count" fill="#5C4BDA" radius={[4, 4, 0, 0]} name="Headcount" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">Pending Leaves</h3>
            <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium">{pendingLeaves.length} pending</span>
          </div>
          <div className="space-y-3">
            {pendingLeaves.slice(0, 3).map((l: any) => {
              const busy = approvingLeave[l.id];
              return (
                <div key={l.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-semibold flex-shrink-0">
                      {(l.employee_name ?? '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{(l.employee_name ?? 'Employee').split(' ')[0]}</p>
                      <p className="text-xs text-gray-400 capitalize">{(l.type ?? '').replace(/_/g, ' ')} · {l.days}d</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      disabled={busy}
                      onClick={() => handleLeaveAction(l.id, 'approved')}
                      className="px-2.5 py-1 text-xs bg-green-50 text-green-600 rounded-md hover:bg-green-100 transition-colors font-medium disabled:opacity-50">
                      {busy ? '…' : 'Approve'}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => handleLeaveAction(l.id, 'rejected')}
                      className="px-2.5 py-1 text-xs bg-red-50 text-red-500 rounded-md hover:bg-red-100 transition-colors font-medium disabled:opacity-50">
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
            {pendingLeaves.length > 3 && (
              <p className="text-xs text-center text-gray-400 pt-1">+{pendingLeaves.length - 3} more — see Leave Management</p>
            )}
            {pendingLeaves.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No pending requests</p>}
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-4">Recent Activity</h3>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((item, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <item.icon size={13} className={item.color} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-700">{item.text}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.time}</p>
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
