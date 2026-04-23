import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { Users, Clock, Calendar, DollarSign, TrendingUp, AlertCircle, CheckCircle2, UserCheck } from 'lucide-react';
import { api } from '../services/api';

const COLORS = ['#5C4BDA', '#8269ff', '#a99bff', '#38bdf8', '#34d399', '#fb923c', '#f472b6'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Dashboard() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  useEffect(() => {
    Promise.all([
      api.getEmployees(),
      api.getLeaveRequests(),
      api.getPayroll({ month: 'March', year: 2026 }),
      api.getAttendance({ month: currentMonth, year: currentYear }),
    ]).then(([emps, leaves, pay, att]) => {
      setEmployees(emps);
      setLeaveRequests(leaves);
      setPayroll(pay);
      setAttendance(att);
    }).finally(() => setLoading(false));
  }, []);

  const activeEmployees = employees.filter(e => e.status === 'active').length;
  const pendingLeaves = leaveRequests.filter((l: any) => l.status === 'pending');
  const totalNetPay = payroll.reduce((s: number, p: any) => s + Number(p.net_pay), 0);

  const todayStr = now.toISOString().split('T')[0];
  const todayPresent = attendance.filter(r => r.date === todayStr && (r.status === 'present' || r.status === 'late')).length;
  const attendanceRate = activeEmployees ? Math.round((todayPresent / activeEmployees) * 100) : 0;

  const deptCounts: Record<string, number> = {};
  employees.forEach(e => { deptCounts[e.department] = (deptCounts[e.department] || 0) + 1; });
  const deptData = Object.entries(deptCounts).map(([name, value]) => ({ name, value }));

  // Attendance trend: last 7 unique dates with records, aggregated by date
  const uniqueDates = [...new Set(attendance.map(r => r.date as string))].sort().slice(-7);
  const attendanceTrend = uniqueDates.map(date => {
    const dayRecords = attendance.filter(r => r.date === date);
    const present = dayRecords.filter(r => r.status === 'present' || r.status === 'late').length;
    return { day: DAY_LABELS[new Date(date + 'T12:00:00').getDay()], present, absent: Math.max(0, activeEmployees - present) };
  });

  // Headcount per month: count employees whose join_date <= end of that month
  const monthlyHeadcount = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentYear, currentMonth - 1 - (6 - i), 1);
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const count = employees.filter(e => e.join_date && new Date(e.join_date) <= endOfMonth).length;
    return { month: MONTH_NAMES[d.getMonth()], count };
  });

  // Recent activity from real leave requests
  const sortedLeaves = [...leaveRequests].sort((a, b) => new Date(b.applied_on).getTime() - new Date(a.applied_on).getTime());
  const recentActivity = sortedLeaves.slice(0, 5).map((l: any) => {
    const name = l.employee_name?.split(' ')[0] ?? 'Employee';
    const typeLabel = l.type === 'full_day' ? 'full day' : l.type === 'half_day' ? 'half day' : l.type === 'short_leave' ? 'short leave' : l.type;
    const daysAgo = Math.floor((Date.now() - new Date(l.applied_on).getTime()) / 86400000);
    const timeStr = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`;
    if (l.status === 'approved') return { text: `${name}'s ${typeLabel} leave approved`, time: timeStr, icon: CheckCircle2 };
    if (l.status === 'rejected') return { text: `${name}'s ${typeLabel} leave rejected`, time: timeStr, icon: AlertCircle };
    return { text: `${name} applied for ${typeLabel} leave`, time: timeStr, icon: Calendar };
  });

  // Week-over-week attendance change
  const thisWeekDates = uniqueDates.slice(-5);
  const lastWeekDates = uniqueDates.slice(-10, -5);
  const avgThis = thisWeekDates.length ? thisWeekDates.reduce((s, d) => {
    const p = attendance.filter(r => r.date === d && (r.status === 'present' || r.status === 'late')).length;
    return s + (activeEmployees ? p / activeEmployees : 0);
  }, 0) / thisWeekDates.length : 0;
  const avgLast = lastWeekDates.length ? lastWeekDates.reduce((s, d) => {
    const p = attendance.filter(r => r.date === d && (r.status === 'present' || r.status === 'late')).length;
    return s + (activeEmployees ? p / activeEmployees : 0);
  }, 0) / lastWeekDates.length : 0;
  const weekChange = avgLast > 0 ? Math.round((avgThis - avgLast) * 100) : null;

  const stats = [
    { label: 'Total Employees', value: employees.length || '—', sub: `${activeEmployees} active`, icon: Users, iconBg: 'bg-primary-100', iconColor: 'text-primary-600' },
    { label: "Today's Attendance", value: activeEmployees ? `${todayPresent}/${activeEmployees}` : '—', sub: activeEmployees ? `${attendanceRate}% attendance rate` : 'No employees', icon: UserCheck, iconBg: 'bg-green-100', iconColor: 'text-green-600' },
    { label: 'Pending Leaves', value: pendingLeaves.length, sub: 'Awaiting approval', icon: Calendar, iconBg: 'bg-amber-100', iconColor: 'text-amber-600' },
    { label: 'Monthly Payroll', value: totalNetPay ? `₹${(totalNetPay / 100000).toFixed(1)}L` : '—', sub: 'March 2026 · Net', icon: DollarSign, iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
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
              <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} domain={[0, 12]} />
              <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
              <Area type="monotone" dataKey="present" stroke="#5C4BDA" strokeWidth={2} fill="url(#presentGrad)" name="Present" />
              <Area type="monotone" dataKey="absent" stroke="#f87171" strokeWidth={2} fill="none" strokeDasharray="4 2" name="Absent" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-1">By Department</h3>
          <p className="text-xs text-gray-400 mb-4">Headcount distribution</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={deptData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" stroke="none">
                {deptData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {deptData.slice(0, 4).map((d, i) => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />
                  <span className="text-gray-500">{d.name}</span>
                </div>
                <span className="font-medium text-gray-700">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-1">Headcount Growth</h3>
          <p className="text-xs text-gray-400 mb-4">Oct 2025 – Apr 2026</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={monthlyHeadcount} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} domain={[0, 12]} />
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
            {pendingLeaves.slice(0, 3).map((l: any) => (
              <div key={l.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-semibold">
                    {l.employee_name.split(' ').map((n: string) => n[0]).join('')}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{l.employee_name.split(' ')[0]}</p>
                    <p className="text-xs text-gray-400 capitalize">{l.type} · {l.days}d</p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button className="px-2.5 py-1 text-xs bg-green-50 text-green-600 rounded-md hover:bg-green-100 transition-colors font-medium">Approve</button>
                  <button className="px-2.5 py-1 text-xs bg-red-50 text-red-500 rounded-md hover:bg-red-100 transition-colors font-medium">Reject</button>
                </div>
              </div>
            ))}
            {pendingLeaves.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No pending requests</p>}
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {recentActivity.map((item, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <item.icon size={13} className="text-gray-500" />
                </div>
                <div>
                  <p className="text-sm text-gray-700">{item.text}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
