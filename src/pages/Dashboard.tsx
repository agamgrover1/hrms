import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { Users, Clock, Calendar, DollarSign, TrendingUp, AlertCircle, CheckCircle2, UserCheck } from 'lucide-react';
import { api } from '../services/api';

const attendanceTrend = [
  { day: 'Mon', present: 9, absent: 1 },
  { day: 'Tue', present: 10, absent: 0 },
  { day: 'Wed', present: 8, absent: 2 },
  { day: 'Thu', present: 9, absent: 1 },
  { day: 'Fri', present: 10, absent: 0 },
  { day: 'Mon', present: 8, absent: 2 },
  { day: 'Tue', present: 9, absent: 1 },
];

const monthlyHeadcount = [
  { month: 'Oct', count: 8 }, { month: 'Nov', count: 8 }, { month: 'Dec', count: 9 },
  { month: 'Jan', count: 9 }, { month: 'Feb', count: 10 }, { month: 'Mar', count: 10 }, { month: 'Apr', count: 10 },
];

const COLORS = ['#5C4BDA', '#8269ff', '#a99bff', '#38bdf8', '#34d399', '#fb923c', '#f472b6'];

const recentActivity = [
  { text: 'Kavya Iyer applied for sick leave', time: '2h ago', icon: Calendar },
  { text: 'Priya Sharma clocked in at 09:02 AM', time: '8h ago', icon: Clock },
  { text: 'March payroll processed successfully', time: '1d ago', icon: DollarSign },
  { text: 'Arjun Mehta leave approved', time: '2d ago', icon: CheckCircle2 },
  { text: 'Rohan Joshi marked inactive', time: '3d ago', icon: AlertCircle },
];

export default function Dashboard() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getEmployees(),
      api.getLeaveRequests(),
      api.getPayroll({ month: 'March', year: 2026 }),
    ]).then(([emps, leaves, pay]) => {
      setEmployees(emps);
      setLeaveRequests(leaves);
      setPayroll(pay);
    }).finally(() => setLoading(false));
  }, []);

  const activeEmployees = employees.filter(e => e.status === 'active').length;
  const pendingLeaves = leaveRequests.filter((l: any) => l.status === 'pending');
  const totalNetPay = payroll.reduce((s: number, p: any) => s + Number(p.net_pay), 0);

  const deptCounts: Record<string, number> = {};
  employees.forEach(e => { deptCounts[e.department] = (deptCounts[e.department] || 0) + 1; });
  const deptData = Object.entries(deptCounts).map(([name, value]) => ({ name, value }));

  const stats = [
    { label: 'Total Employees', value: employees.length || '—', sub: `${activeEmployees} active`, icon: Users, iconBg: 'bg-primary-100', iconColor: 'text-primary-600' },
    { label: "Today's Attendance", value: `${Math.round(activeEmployees * 0.85)}/10`, sub: '85% attendance rate', icon: UserCheck, iconBg: 'bg-green-100', iconColor: 'text-green-600' },
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
            <span className="text-xs bg-green-50 text-green-600 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
              <TrendingUp size={11} /> +5% this week
            </span>
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
