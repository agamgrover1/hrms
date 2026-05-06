import { useState, useEffect, useCallback } from 'react';
import { Clock, CheckCircle, XCircle, AlertCircle, ChevronLeft, ChevronRight, CalendarDays, X,
  Fingerprint, RefreshCw, ChevronDown, ChevronUp, Activity, Calendar } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

function fmtHours(h: number | string | null | undefined): string {
  const total = Number(h) || 0;
  const hrs = Math.floor(total);
  const mins = Math.round((total - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

// Neon returns DATE columns as "YYYY-MM-DDT18:30:00.000Z" (IST midnight as UTC offset).
// Use local Date methods so browser IST timezone resolves the correct calendar date.
function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  if (dateStr.includes('T')) {
    const d = new Date(dateStr);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()); // local midnight ✓
  }
  const [y, m, d] = (dateStr).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const statusConfig = {
  present:      { label: 'Present',      color: 'bg-green-50 text-green-600',   dot: 'bg-green-500' },
  absent:       { label: 'Absent',       color: 'bg-red-50 text-red-500',       dot: 'bg-red-500' },
  late:         { label: 'Late',         color: 'bg-amber-50 text-amber-600',   dot: 'bg-amber-500' },
  'half-day':   { label: 'Half Day',     color: 'bg-blue-50 text-blue-600',     dot: 'bg-blue-500' },
  short_leave:  { label: 'Short Leave',  color: 'bg-orange-50 text-orange-600', dot: 'bg-orange-400' },
  on_leave:     { label: 'On Leave',     color: 'bg-violet-50 text-violet-600', dot: 'bg-violet-400' },
  unpaid_leave: { label: 'Unpaid Leave', color: 'bg-rose-50 text-rose-600',     dot: 'bg-rose-400' },
  weekend:      { label: 'Weekend',      color: 'bg-gray-50 text-gray-400',     dot: 'bg-gray-300' },
  holiday:      { label: 'Holiday',      color: 'bg-purple-50 text-purple-500', dot: 'bg-purple-400' },
  wfh:          { label: 'Work From Home',    color: 'bg-[#192250]/10 text-[#192250]',  dot: 'bg-[#192250]' },
  wfh_half:     { label: 'Half Day WFH',      color: 'bg-[#EE2770]/10 text-[#EE2770]', dot: 'bg-[#EE2770]' },
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

  const needsTimes = form.status === 'present' || form.status === 'late' || form.status === 'half-day' || form.status === 'short_leave';

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
              {(['present', 'absent', 'late', 'half-day', 'short_leave'] as const).map(s => {
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
  const [leaves, setLeaves] = useState<any[]>([]);
  const [clocked, setClocked] = useState(false);
  const [clockTime, setClockTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMark, setShowMark] = useState(false);

  // Biometric sync state
  const [syncHistory, setSyncHistory] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncSuccess, setSyncSuccess] = useState('');
  const [showSyncHistory, setShowSyncHistory] = useState(false);
  // Session detail modal
  const [sessionModal, setSessionModal] = useState<{ record: any; sessions: any[]; loading: boolean } | null>(null);

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

  const fetchRecords = useCallback(() => {
    if (!selectedEmpId) return;
    setLoading(true);
    api.getAttendance({ employee_id: selectedEmpId, month: viewMonth + 1, year: viewYear })
      .then(setRecords)
      .finally(() => setLoading(false));
  }, [selectedEmpId, viewMonth, viewYear]);

  const fetchLeaves = useCallback(() => {
    if (!selectedEmpId) return;
    api.getLeaveRequests({ employee_id: selectedEmpId }).then(setLeaves).catch(() => {});
  }, [selectedEmpId]);

  const fetchSyncHistory = useCallback(() => {
    api.getBiometricSyncHistory().then(setSyncHistory).catch(() => {});
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { fetchLeaves(); }, [fetchLeaves]);
  useEffect(() => { if (isHROrAdmin) fetchSyncHistory(); }, [fetchSyncHistory, isHROrAdmin]);

  const handleSyncNow = async (fullMonth = false) => {
    setSyncing(true);
    setSyncError('');
    setSyncSuccess('');
    try {
      const today = new Date().toISOString().split('T')[0];
      const fromDate = fullMonth
        ? `${today.slice(0, 7)}-01`   // first day of current month
        : today;
      const result = await api.syncBiometric(user?.name ?? 'HR', fromDate, today);
      const label = fullMonth ? 'Month sync complete' : 'Sync complete';
      setSyncSuccess(`${label} — ${result.records_updated} updated, ${result.records_created} created`);
      fetchSyncHistory();
      fetchRecords();
      fetchLeaves();
    } catch (err: any) {
      setSyncError(err.message ?? 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };


  const getDayRecord = (day: number) => {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return records.find(r => {
      if (!r.date) return false;
      const localDate = parseLocalDate(r.date).toLocaleDateString('en-CA');
      return localDate === dateStr;
    });
  };

  // Returns the first active (non-rejected, non-cancelled) leave that covers a given YYYY-MM-DD date
  const getLeaveForDay = (dateStr: string) =>
    leaves.find(l =>
      l.status !== 'rejected' && l.status !== 'cancelled' &&
      dateStr >= l.from_date && dateStr <= l.to_date
    ) ?? null;

  const LEAVE_TAG: Record<string, { label: string; bg: string; color: string }> = {
    full_day:    { label: 'Full Day',    bg: '#eff6ff', color: '#2563eb' },
    half_day:    { label: 'Half Day',    bg: '#f5f3ff', color: '#7c3aed' },
    short_leave: { label: 'Short Leave', bg: '#fff7ed', color: '#c2410c' },
    unpaid:      { label: 'Unpaid',      bg: '#fff1f2', color: '#be123c' },
    casual:      { label: 'Casual',      bg: '#f0fdf4', color: '#15803d' },
    sick:        { label: 'Sick',        bg: '#fef9c3', color: '#a16207' },
    earned:      { label: 'Earned',      bg: '#e0f2fe', color: '#0369a1' },
  };

  const presentCount = records.filter(r => r.status === 'present').length;
  const absentCount = records.filter(r => r.status === 'absent').length;
  const lateCount = records.filter(r => r.status === 'late').length;
  const totalHours = records.reduce((s, r) => s + Number(r.total_hours || 0), 0);

  const handleOpenSessions = async (record: any) => {
    const dateStr = typeof record.date === 'string' && record.date.includes('T')
      ? (() => { const d = new Date(record.date); d.setMinutes(d.getMinutes() + 330); return d.toISOString().slice(0, 10); })()
      : String(record.date).slice(0, 10);
    setSessionModal({ record, sessions: [], loading: true });
    try {
      const sessions = await api.getAttendanceSessions(selectedEmpId, dateStr);
      setSessionModal({ record, sessions, loading: false });
    } catch {
      setSessionModal({ record, sessions: [], loading: false });
    }
  };

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
      <div className="rounded-2xl p-6 text-white flex items-center justify-between"
        style={{ background: 'linear-gradient(135deg, #192250 0%, #111737 100%)' }}>
        <div>
          <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <p className="text-3xl font-bold mt-1 tabular-nums">{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
          {clocked && <p className="text-xs mt-1" style={{ color: '#ff75b0' }}>Clocked in at {clockTime}</p>}
        </div>
        <div className="flex items-center gap-3">
          {isHROrAdmin && (
            <button onClick={() => setShowMark(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'rgba(238,39,112,0.2)', border: '1px solid rgba(238,39,112,0.4)', color: '#ff75b0' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(238,39,112,0.35)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(238,39,112,0.2)'; }}>
              <CalendarDays size={15} /> Mark Attendance
            </button>
          )}
          <button onClick={handleClock}
            className={`px-6 py-3 rounded-xl font-semibold text-sm transition-all shadow-lg active:scale-95 ${clocked ? 'cursor-default' : ''}`}
            style={clocked
              ? { background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }
              : { background: '#EE2770', color: '#fff', boxShadow: '0 4px 15px rgba(238,39,112,0.4)' }}>
            {clocked ? '✓ Clocked In' : 'Clock In'}
          </button>
        </div>
      </div>

      {/* ── Biometric Sync Panel (HR/Admin only) ─────────────────────────── */}
      {isHROrAdmin && (() => {
        const lastSync = syncHistory.find(s => s.status !== 'failed');

        function fmtAgo(iso: string) {
          const diff = Date.now() - new Date(iso).getTime();
          const m = Math.floor(diff / 60000);
          if (m < 1) return 'just now';
          if (m < 60) return `${m}m ago`;
          const h = Math.floor(m / 60);
          if (h < 24) return `${h}h ago`;
          return `${Math.floor(h / 24)}d ago`;
        }

        return (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Header row */}
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(25,34,80,0.07)' }}>
                  <Fingerprint size={18} style={{ color: '#192250' }} />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm" style={{ color: '#192250' }}>Biometric Sync</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Activity size={10} className="text-green-500" />
                      Auto-sync every 5 min
                    </span>
                    {lastSync && (
                      <span className="text-xs text-gray-400">
                        · Last: {fmtAgo(lastSync.synced_at)}
                        {lastSync.records_updated + lastSync.records_created > 0
                          ? ` (${lastSync.records_updated + lastSync.records_created} records)`
                          : ' (no changes)'}
                      </span>
                    )}
                    {!lastSync && <span className="text-xs text-gray-400">· No syncs yet</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Sync This Month button */}
                <button
                  onClick={() => handleSyncNow(true)}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all disabled:opacity-50"
                  style={{ color: '#192250', borderColor: '#e2e4ed', background: '#fff' }}
                >
                  <Calendar size={13} />
                  {syncing ? '…' : 'Sync This Month'}
                </button>
                {/* Sync Now (today) button */}
                <button
                  onClick={() => handleSyncNow(false)}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-xl transition-all disabled:opacity-60 shadow-sm"
                  style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}
                >
                  <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Syncing…' : 'Sync Today'}
                </button>
                {/* Toggle history */}
                <button
                  onClick={() => setShowSyncHistory(v => !v)}
                  className="p-2 rounded-xl hover:bg-gray-50 transition-colors"
                  title="Toggle sync history"
                >
                  {showSyncHistory ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </button>
              </div>
            </div>

            {/* Feedback messages */}
            {(syncError || syncSuccess) && (
              <div className={`mx-5 mb-4 px-4 py-2.5 rounded-xl text-xs font-semibold ${syncError ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-700 border border-green-100'}`}>
                {syncError || syncSuccess}
              </div>
            )}

            {/* Sync history table */}
            {showSyncHistory && (
              <div className="border-t border-gray-100 overflow-x-auto">
                {syncHistory.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No sync history yet</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: '#f8f9fc' }}>
                        {['Synced At', 'Trigger', 'Date', 'Updated', 'Created', 'Status'].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {syncHistory.map(s => {
                        const isRolledBack = s.is_rolled_back || s.status === 'rolled_back';
                        const isFailed = s.status === 'failed';
                        return (
                          <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                              {new Date(s.synced_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                              {', '}{new Date(s.synced_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600 capitalize whitespace-nowrap">
                              {s.triggered === 'manual' ? `Manual${s.triggered_by ? ` — ${s.triggered_by}` : ''}` : 'Auto'}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">{s.date_range ?? '—'}</td>
                            <td className="px-4 py-3 text-xs font-semibold text-center" style={{ color: '#192250' }}>{s.records_updated ?? 0}</td>
                            <td className="px-4 py-3 text-xs font-semibold text-center" style={{ color: '#192250' }}>{s.records_created ?? 0}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                                isRolledBack ? 'bg-gray-100 text-gray-500' :
                                isFailed ? 'bg-red-50 text-red-600' :
                                'bg-green-50 text-green-700'
                              }`}>
                                {isRolledBack ? 'Rolled Back' : isFailed ? '✕ Failed' : '✓ Success'}
                              </span>
                              {s.error_msg && <p className="text-xs text-red-400 mt-0.5 truncate max-w-[150px]">{s.error_msg}</p>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div className="flex flex-wrap items-center gap-3">
        <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 text-gray-700">
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <span className="text-sm text-gray-400">{monthName} {viewYear}</span>
        {(() => {
          const emp = employees.find(e => e.id === selectedEmpId);
          if (!emp) return null;
          const isNight = emp.shift === 'night';
          return (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
              style={isNight
                ? { background: '#1e1b4b', color: '#a5b4fc' }
                : { background: '#fef3c7', color: '#92400e' }}>
              {isNight ? '🌙' : '☀️'} {isNight ? 'Night Shift · 6:30 PM – 3:30 AM' : 'Day Shift · 9:00 AM – 6:00 PM'}
            </span>
          );
        })()}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Present', value: presentCount, icon: CheckCircle, color: 'text-green-500' },
          { label: 'Absent', value: absentCount, icon: XCircle, color: 'text-red-500' },
          { label: 'Late', value: lateCount, icon: AlertCircle, color: 'text-amber-500' },
          { label: 'Avg Hours/Day', value: fmtHours(totalHours / Math.max(presentCount + lateCount, 1)), icon: Clock, color: 'text-primary-500' },
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
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const leave = getLeaveForDay(dateStr);
              const leaveTag = leave ? LEAVE_TAG[leave.type] : null;
              const isToday = day === now.getDate() && viewMonth === now.getMonth() && viewYear === now.getFullYear();
              const dotColor = record ? statusConfig[record.status as keyof typeof statusConfig]?.dot : '';
              return (
                <div key={i} className={`relative flex flex-col items-center py-1 rounded-lg text-sm transition-colors
                  ${isToday ? 'bg-primary-500 text-white font-semibold' : 'hover:bg-gray-50 text-gray-700'}
                  ${record?.status === 'absent' && !isToday ? 'text-red-400' : ''}`}>
                  {day}
                  {record && record.status !== 'weekend' && (
                    <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${isToday ? 'bg-white/70' : dotColor}`} />
                  )}
                  {leaveTag && (
                    <span className="text-[8px] font-bold px-1 rounded mt-0.5 leading-tight"
                      style={{ background: isToday ? 'rgba(255,255,255,0.25)' : leaveTag.bg, color: isToday ? '#fff' : leaveTag.color }}>
                      {leaveTag.label.split(' ')[0]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {['present', 'absent', 'late', 'half-day', 'short_leave', 'on_leave', 'unpaid_leave', 'wfh', 'wfh_half', 'weekend'].map(s => {
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
                const leave = getLeaveForDay(r.date);
                const leaveTag = leave ? LEAVE_TAG[leave.type] : null;

                const isExtension = r.source === 'wfh_extension' || Number(r.extension_hours) > 0;

                // Break time only meaningful for extension records that have multiple sessions.
                // Biometric and manual records have a single continuous check_in→check_out — no breaks.
                const parseHHMM = (t: string | null | undefined) => {
                  if (!t) return null;
                  const parts = t.split(':').map(Number);
                  return (parts[0] || 0) * 60 + (parts[1] || 0); // handles HH:MM and HH:MM:SS
                };
                const productiveMin = Number(r.total_hours || 0) * 60;
                const breakMin = (() => {
                  if (!isExtension || !r.check_in || !r.check_out) return 0;
                  const inMin  = parseHHMM(r.check_in);
                  const outMin = parseHHMM(r.check_out);
                  if (inMin === null || outMin === null) return 0;
                  // Handle midnight crossover for night shift
                  const spanMin = outMin >= inMin ? outMin - inMin : (24 * 60 - inMin) + outMin;
                  return productiveMin > 0 && spanMin > productiveMin ? Math.round(spanMin - productiveMin) : 0;
                })();
                const fmtBreak = breakMin >= 1
                  ? breakMin >= 60
                    ? `${Math.floor(breakMin / 60)}h ${breakMin % 60 > 0 ? (breakMin % 60) + 'm' : ''}`.trim()
                    : `${breakMin}m`
                  : null;

                const isShortDay = (r.status === 'present' || r.status === 'late')
                  && r.check_out && productiveMin > 0 && productiveMin < 8 * 60;

                return (
                  <div key={r.date}
                    onClick={() => r.check_in && handleOpenSessions(r)}
                    className={`flex items-start justify-between py-2.5 border-b border-gray-50 last:border-0 gap-3 ${r.check_in ? 'cursor-pointer hover:bg-gray-50/60 rounded-lg px-1 -mx-1 transition-colors' : ''}`}>
                    {/* Left: status + date */}
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${cfg?.color}`}>{cfg?.label}</span>
                      {isShortDay && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold border flex-shrink-0"
                          style={{ background: '#fffbeb', color: '#b45309', borderColor: '#fde68a' }}>Short Day</span>
                      )}
                      {leaveTag && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold border flex-shrink-0"
                          style={{ background: leaveTag.bg, color: leaveTag.color, borderColor: leaveTag.color + '40' }}>
                          {leaveTag.label}
                          {leave?.status === 'pending' && <span className="ml-1 opacity-60">(pending)</span>}
                        </span>
                      )}
                      <span className="text-sm text-gray-700 flex-shrink-0">
                        {parseLocalDate(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>

                    {/* Right: time breakdown */}
                    {r.check_in ? (
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        {/* Presence window — secondary grey */}
                        <span className="text-[11px] text-gray-400">
                          {r.check_in} → {r.check_out ?? 'Active'}
                        </span>

                        {/* Productive hours — primary bold green */}
                        <span className="text-xs font-bold" style={{ color: '#15803d' }}>
                          {fmtHours(r.total_hours)} worked
                        </span>

                        {/* Break time — only when sessions had breaks */}
                        {fmtBreak && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: '#fffbeb', color: '#b45309' }}>
                            {fmtBreak} break
                          </span>
                        )}

                        {/* Extension tag */}
                        {isExtension && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border"
                            style={{ background: 'rgba(238,39,112,0.08)', color: '#EE2770', borderColor: 'rgba(238,39,112,0.25)' }}>
                            💻 Extension{Number(r.extension_hours) > 0 ? ` · ${fmtHours(r.extension_hours)}` : ''}
                          </span>
                        )}
                      </div>
                    ) : <span className="text-xs text-gray-300">—</span>}
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

      {/* ── Session Detail Modal ────────────────────────────────────────────── */}
      {sessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100"
              style={{ background: 'linear-gradient(135deg,#192250 0%,#111737 100%)' }}>
              <div>
                <p className="text-white font-bold text-sm">
                  {parseLocalDate(sessionModal.record.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <p className="text-white/50 text-xs mt-0.5">Session breakdown</p>
              </div>
              <button onClick={() => setSessionModal(null)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                <X size={16} className="text-white/60" />
              </button>
            </div>

            <div className="p-5">
              {sessionModal.loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
                </div>
              ) : sessionModal.sessions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-400">No session data — single clock-in/out record</p>
                  {sessionModal.record.check_in && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-xl text-sm">
                      <span className="font-semibold text-gray-700">{sessionModal.record.check_in}</span>
                      <span className="text-gray-400 mx-2">→</span>
                      <span className="font-semibold text-gray-700">{sessionModal.record.check_out ?? 'Active'}</span>
                      <span className="ml-3 font-bold" style={{ color: '#15803d' }}>{fmtHours(sessionModal.record.total_hours)}</span>
                    </div>
                  )}
                </div>
              ) : (() => {
                // Build timeline: sessions interleaved with break blocks
                const sessions = sessionModal.sessions;
                const parseHM = (t: string) => { const [h,m] = t.split(':').map(Number); return h*60+m; };
                const fmt12 = (t: string | null | undefined) => {
                  if (!t) return 'Active';
                  const [h,m] = t.split(':').map(Number);
                  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
                };
                const fmtMins = (m: number) => m === 0 ? '—' : m >= 60 ? `${Math.floor(m/60)}h ${m%60>0?m%60+'m':''}`.trim() : `${m}m`;

                const blocks: { type: 'work'|'break'; from: string; to: string; minutes: number; source: string }[] = [];
                sessions.forEach((s, i) => {
                  blocks.push({ type: 'work', from: s.clock_in, to: s.clock_out ?? '', minutes: Number(s.duration_minutes || 0), source: s.source ?? 'manual' });
                  if (i < sessions.length - 1 && s.clock_out && sessions[i+1].clock_in) {
                    const breakMin = parseHM(sessions[i+1].clock_in) - parseHM(s.clock_out);
                    if (breakMin > 0) blocks.push({ type: 'break', from: s.clock_out, to: sessions[i+1].clock_in, minutes: breakMin, source: '' });
                  }
                });

                const totalWorked = sessions.reduce((s, r) => s + Number(r.duration_minutes || 0), 0);
                const totalBreak  = blocks.filter(b => b.type === 'break').reduce((s, b) => s + b.minutes, 0);

                return (
                  <div className="space-y-2">
                    {blocks.map((b, i) => (
                      <div key={i} className={`flex items-center gap-3 p-3 rounded-xl ${b.type === 'work' ? 'border' : ''}`}
                        style={b.type === 'work'
                          ? { background: 'rgba(22,163,74,0.04)', borderColor: 'rgba(22,163,74,0.15)' }
                          : { background: '#fffbeb' }}>
                        <div className={`w-2 h-full min-h-[32px] rounded-full flex-shrink-0 self-stretch`}
                          style={{ background: b.type === 'work' ? '#15803d' : '#d97706', width: '3px' }}/>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold" style={{ color: b.type === 'work' ? '#15803d' : '#b45309' }}>
                              {b.type === 'work' ? `Work Session ${blocks.filter((x,j) => x.type==='work'&&j<=i).length}` : 'Break'}
                            </span>
                            {b.type === 'work' && b.source === 'wfh_extension' && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(238,39,112,0.1)', color: '#EE2770' }}>💻 ext</span>
                            )}
                            {b.type === 'work' && b.source === 'biometric' && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(22,163,74,0.1)', color: '#15803d' }}>🔵 bio</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {fmt12(b.from)} <span className="mx-1">→</span> {fmt12(b.to)}
                          </p>
                        </div>
                        <span className="text-sm font-black flex-shrink-0" style={{ color: b.type === 'work' ? '#192250' : '#b45309' }}>
                          {fmtMins(b.minutes)}
                        </span>
                      </div>
                    ))}

                    {/* Summary row */}
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                      <div className="text-center flex-1">
                        <p className="text-xs text-gray-400">Worked</p>
                        <p className="text-lg font-black" style={{ color: '#15803d' }}>{fmtMins(totalWorked)}</p>
                      </div>
                      <div className="w-px h-10 bg-gray-100" />
                      <div className="text-center flex-1">
                        <p className="text-xs text-gray-400">On Break</p>
                        <p className="text-lg font-black" style={{ color: totalBreak > 0 ? '#b45309' : '#d1d5db' }}>{totalBreak > 0 ? fmtMins(totalBreak) : '—'}</p>
                      </div>
                      <div className="w-px h-10 bg-gray-100" />
                      <div className="text-center flex-1">
                        <p className="text-xs text-gray-400">Present</p>
                        <p className="text-lg font-black text-gray-700">{fmtMins(totalWorked + totalBreak)}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
