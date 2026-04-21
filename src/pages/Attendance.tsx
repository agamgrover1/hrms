import { useState, useEffect } from 'react';
import { Clock, CheckCircle, XCircle, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../services/api';

const statusConfig = {
  present: { label: 'Present', color: 'bg-green-50 text-green-600', dot: 'bg-green-500' },
  absent: { label: 'Absent', color: 'bg-red-50 text-red-500', dot: 'bg-red-500' },
  late: { label: 'Late', color: 'bg-amber-50 text-amber-600', dot: 'bg-amber-500' },
  'half-day': { label: 'Half Day', color: 'bg-blue-50 text-blue-600', dot: 'bg-blue-500' },
  weekend: { label: 'Weekend', color: 'bg-gray-50 text-gray-400', dot: 'bg-gray-300' },
  holiday: { label: 'Holiday', color: 'bg-purple-50 text-purple-500', dot: 'bg-purple-400' },
};

const today = new Date();

function generateCalendarDays(year: number, month: number) {
  const days: (number | null)[] = [];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);
  return days;
}

export default function Attendance() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [records, setRecords] = useState<any[]>([]);
  const [clocked, setClocked] = useState(false);
  const [clockTime, setClockTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const month = today.getMonth();
  const year = today.getFullYear();
  const calendarDays = generateCalendarDays(year, month);
  const monthName = today.toLocaleString('default', { month: 'long' });

  useEffect(() => {
    api.getEmployees().then(emps => {
      setEmployees(emps);
      if (emps.length) setSelectedEmpId(emps[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedEmpId) return;
    setLoading(true);
    api.getAttendance({ employee_id: selectedEmpId, month: month + 1, year })
      .then(setRecords)
      .finally(() => setLoading(false));
  }, [selectedEmpId]);

  const getDayRecord = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return records.find(r => r.date?.startsWith(dateStr));
  };

  const presentCount = records.filter(r => r.status === 'present').length;
  const absentCount = records.filter(r => r.status === 'absent').length;
  const lateCount = records.filter(r => r.status === 'late').length;
  const totalHours = records.reduce((s, r) => s + Number(r.total_hours || 0), 0);

  const handleClock = async () => {
    if (clocked || !selectedEmpId) return;
    await api.clockIn(selectedEmpId);
    setClockTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    setClocked(true);
    // Refresh records
    api.getAttendance({ employee_id: selectedEmpId, month: month + 1, year }).then(setRecords);
  };

  return (
    <div className="space-y-5">
      {/* Clock In Widget */}
      <div className="bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl p-6 text-white flex items-center justify-between">
        <div>
          <p className="text-primary-100 text-sm font-medium">
            {today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <p className="text-3xl font-bold mt-1 tabular-nums">
            {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
          {clocked && <p className="text-primary-100 text-xs mt-1">Clocked in at {clockTime}</p>}
        </div>
        <button onClick={handleClock}
          className={`px-6 py-3 rounded-xl font-semibold text-sm transition-all shadow-lg ${clocked ? 'bg-white/20 text-white cursor-default' : 'bg-white text-primary-600 hover:bg-primary-50 active:scale-95'}`}>
          {clocked ? '✓ Clocked In' : 'Clock In'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 text-gray-700">
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <span className="text-sm text-gray-400">{monthName} {year}</span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Present', value: presentCount, icon: CheckCircle, color: 'text-green-500' },
          { label: 'Absent', value: absentCount, icon: XCircle, color: 'text-red-500' },
          { label: 'Late', value: lateCount, icon: AlertCircle, color: 'text-amber-500' },
          { label: 'Avg Hours/Day', value: `${(totalHours / Math.max(presentCount + lateCount, 1)).toFixed(1)}h`, icon: Clock, color: 'text-primary-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <Icon size={18} className={color} />
            <p className="text-2xl font-bold text-gray-900 mt-2">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Calendar */}
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">{monthName} {year}</h3>
            <div className="flex gap-1">
              <button className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><ChevronLeft size={16} className="text-gray-400" /></button>
              <button className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><ChevronRight size={16} className="text-gray-400" /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, i) => {
              if (!day) return <div key={i} />;
              const record = getDayRecord(day);
              const isToday = day === today.getDate();
              const dotColor = record ? statusConfig[record.status as keyof typeof statusConfig]?.dot : '';
              return (
                <div key={i} className={`relative flex flex-col items-center py-1.5 rounded-lg text-sm transition-colors
                  ${isToday ? 'bg-primary-500 text-white font-semibold' : 'hover:bg-gray-50 text-gray-700'}
                  ${record?.status === 'absent' ? 'text-red-400' : ''}`}>
                  {day}
                  {record && record.status !== 'weekend' && (
                    <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${isToday ? 'bg-white/70' : dotColor}`} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {['present', 'absent', 'late', 'weekend'].map(s => {
              const cfg = statusConfig[s as keyof typeof statusConfig];
              return (
                <div key={s} className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Daily Log */}
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-4">Daily Log</h3>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {records.filter(r => r.status !== 'weekend').map(r => {
                const cfg = statusConfig[r.status as keyof typeof statusConfig];
                return (
                  <div key={r.date} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg?.color}`}>{cfg?.label}</span>
                      <span className="text-sm text-gray-700">
                        {new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {r.check_in ? <span>{r.check_in} – {r.check_out ?? '—'} <span className="text-gray-500 font-medium">{r.total_hours}h</span></span> : '—'}
                    </div>
                  </div>
                );
              })}
              {records.filter(r => r.status !== 'weekend').length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">No records found</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
