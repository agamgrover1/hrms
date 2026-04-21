import { useState, useEffect } from 'react';
import { Clock, CheckCircle, XCircle, AlertCircle, ChevronLeft, ChevronRight, CalendarDays, X } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const statusConfig = {
  present: { label: 'Present', color: 'bg-green-50 text-green-600', dot: 'bg-green-500' },
  absent: { label: 'Absent', color: 'bg-red-50 text-red-500', dot: 'bg-red-500' },
  late: { label: 'Late', color: 'bg-amber-50 text-amber-600', dot: 'bg-amber-500' },
  'half-day': { label: 'Half Day', color: 'bg-blue-50 text-blue-600', dot: 'bg-blue-500' },
  weekend: { label: 'Weekend', color: 'bg-gray-50 text-gray-400', dot: 'bg-gray-300' },
  holiday: { label: 'Holiday', color: 'bg-purple-50 text-purple-500', dot: 'bg-purple-400' },
};

function generateCalendarDays(year: number, month: number) {
  const days: (number | null)[] = [];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);
  return days;
}

function MarkAttendanceModal({ employees, onClose, onSaved }: {
  employees: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    employee_id: employees[0]?.id || '',
    date: today,
    status: 'present',
    check_in: '09:00',
    check_out: '18:00',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 bg-white';
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

  const needsTimes = form.status === 'present' || form.status === 'late' || form.status === 'half-day';

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    if (!form.employee_id) return setError('Select an employee.');
    if (!form.date) return setError('Date is required.');
    setSaving(true);
    try {
      await api.markAttendance({
        employee_id: form.employee_id,
        date: form.date,
        status: form.status,
        check_in: needsTimes ? form.check_in : undefined,
        check_out: needsTimes ? form.check_out : undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to mark attendance.');
    } finally {
      setSaving(false);
    }
  };

  const selectedEmp = employees.find(e => e.id === form.employee_id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center">
              <CalendarDays size={17} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Mark Attendance</h2>
              <p className="text-xs text-gray-400">Manually record attendance for any employee</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Employee */}
          <div>
            <label className={labelCls}>Employee <span className="text-red-400">*</span></label>
            <select value={form.employee_id} onChange={e => set('employee_id', e.target.value)} className={inputCls}>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_id})</option>
              ))}
            </select>
            {selectedEmp && (
              <p className="text-xs text-gray-400 mt-1">{selectedEmp.designation} · {selectedEmp.department}</p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className={labelCls}>Date <span className="text-red-400">*</span></label>
            <input
              type="date"
              value={form.date}
              max={today}
              onChange={e => set('date', e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Status */}
          <div>
            <label className={labelCls}>Status <span className="text-red-400">*</span></label>
            <div className="grid grid-cols-2 gap-2">
              {(['present', 'absent', 'late', 'half-day'] as const).map(s => {
                const cfg = statusConfig[s];
                const active = form.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set('status', s)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                      active
                        ? 'border-primary-400 bg-primary-50 text-primary-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Check-in / Check-out (only for time-based statuses) */}
          {needsTimes && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Check-In Time</label>
                <input type="time" value={form.check_in} onChange={e => set('check_in', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Check-Out Time</label>
                <input type="time" value={form.check_out} onChange={e => set('check_out', e.target.value)} className={inputCls} />
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Attendance() {
  const { user } = useAuth();
  const isHROrAdmin = user?.role === 'admin' || user?.role === 'hr_manager';

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [records, setRecords] = useState<any[]>([]);
  const [clocked, setClocked] = useState(false);
  const [clockTime, setClockTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMark, setShowMark] = useState(false);

  const calendarDays = generateCalendarDays(viewYear, viewMonth);
  const monthName = new Date(viewYear, viewMonth, 1).toLocaleString('default', { month: 'long' });

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    const n = new Date();
    if (viewYear > n.getFullYear() || (viewYear === n.getFullYear() && viewMonth >= n.getMonth())) return;
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  useEffect(() => {
    api.getEmployees().then(emps => {
      setEmployees(emps);
      if (emps.length) setSelectedEmpId(emps[0].id);
    });
  }, []);

  const fetchRecords = () => {
    if (!selectedEmpId) return;
    setLoading(true);
    api.getAttendance({ employee_id: selectedEmpId, month: viewMonth + 1, year: viewYear })
      .then(setRecords)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRecords();
  }, [selectedEmpId, viewMonth, viewYear]);

  const getDayRecord = (day: number) => {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Use local timezone when parsing the date from DB (Neon returns UTC ISO strings,
    // which shifts the date backwards by the local UTC offset)
    return records.find(r => {
      if (!r.date) return false;
      const localDate = new Date(r.date).toLocaleDateString('en-CA'); // 'en-CA' → YYYY-MM-DD in local tz
      return localDate === dateStr;
    });
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
    fetchRecords();
  };

  return (
    <div className="space-y-5">
      {/* Clock In Widget */}
      <div className="bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl p-6 text-white flex items-center justify-between">
        <div>
          <p className="text-primary-100 text-sm font-medium">
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <p className="text-3xl font-bold mt-1 tabular-nums">
            {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
          {clocked && <p className="text-primary-100 text-xs mt-1">Clocked in at {clockTime}</p>}
        </div>
        <div className="flex items-center gap-3">
          {isHROrAdmin && (
            <button onClick={() => setShowMark(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white/15 hover:bg-white/25 rounded-xl text-sm font-medium transition-all border border-white/20">
              <CalendarDays size={15} /> Mark Attendance
            </button>
          )}
          <button onClick={handleClock}
            className={`px-6 py-3 rounded-xl font-semibold text-sm transition-all shadow-lg ${clocked ? 'bg-white/20 text-white cursor-default' : 'bg-white text-primary-600 hover:bg-primary-50 active:scale-95'}`}>
            {clocked ? '✓ Clocked In' : 'Clock In'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 text-gray-700">
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <span className="text-sm text-gray-400">{monthName} {viewYear}</span>
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
            <h3 className="font-semibold text-gray-800">{monthName} {viewYear}</h3>
            <div className="flex gap-1">
              <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                <ChevronLeft size={16} className="text-gray-400" />
              </button>
              <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                <ChevronRight size={16} className="text-gray-400" />
              </button>
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
              const isToday = day === now.getDate() && viewMonth === now.getMonth() && viewYear === now.getFullYear();
              const dotColor = record ? statusConfig[record.status as keyof typeof statusConfig]?.dot : '';
              return (
                <div key={i} className={`relative flex flex-col items-center py-1.5 rounded-lg text-sm transition-colors
                  ${isToday ? 'bg-primary-500 text-white font-semibold' : 'hover:bg-gray-50 text-gray-700'}
                  ${record?.status === 'absent' && !isToday ? 'text-red-400' : ''}`}>
                  {day}
                  {record && record.status !== 'weekend' && (
                    <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${isToday ? 'bg-white/70' : dotColor}`} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {['present', 'absent', 'late', 'half-day', 'weekend'].map(s => {
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

      {showMark && (
        <MarkAttendanceModal
          employees={employees}
          onClose={() => setShowMark(false)}
          onSaved={() => {
            setShowMark(false);
            fetchRecords();
          }}
        />
      )}
    </div>
  );
}
