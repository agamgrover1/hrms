import { useState, useEffect, useCallback } from 'react';
import { Clock, CheckCircle, XCircle, AlertCircle, ChevronLeft, ChevronRight, CalendarDays, X,
  Fingerprint, RefreshCw, ChevronDown, ChevronUp, Activity, Calendar } from 'lucide-react';
import { api } from '../services/api';
import { toast } from '../components/Toaster';
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
  present:      { label: 'Present',      color: 'bg-success-container text-success', dot: 'bg-success' },
  absent:       { label: 'Absent',       color: 'bg-danger-container text-danger',   dot: 'bg-danger' },
  late:         { label: 'Late',         color: 'bg-warning-container text-warning', dot: 'bg-warning' },
  'half-day':   { label: 'Half Day',     color: 'bg-brand-container text-on-brand-container', dot: 'bg-brand' },
  short_leave:  { label: 'Short Leave',  color: 'bg-warning-container text-warning', dot: 'bg-warning' },
  on_leave:     { label: 'On Leave',     color: 'bg-brand-container text-on-brand-container', dot: 'bg-brand' },
  unpaid_leave: { label: 'Unpaid Leave', color: 'bg-danger-container text-danger',   dot: 'bg-danger' },
  weekend:      { label: 'Weekend',      color: 'bg-surface-2 text-on-surface-subtle', dot: 'bg-surface-3' },
  holiday:      { label: 'Holiday',      color: 'bg-surface-2 text-on-surface-muted', dot: 'bg-on-surface-muted' },
  wfh:          { label: 'Work From Home', color: 'bg-brand-container text-on-brand-container', dot: 'bg-brand' },
  wfh_half:     { label: 'Half Day WFH', color: 'bg-accent/10 text-accent',          dot: 'bg-accent' },
  no_record:    { label: 'No Record',    color: 'bg-surface-2 text-on-surface-muted', dot: 'bg-surface-3' },
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

  const inputCls = 'w-full text-sm border border-outline rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand bg-surface text-on-surface';
  const labelCls = 'block text-xs font-medium text-on-surface-muted mb-1';

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
      <div className="bg-surface rounded-2xl shadow-elev-3 w-full max-w-md border border-outline">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-container flex items-center justify-center">
              <CalendarDays size={17} className="text-on-brand-container" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold tracking-tight text-on-surface">Mark Attendance</h2>
              <p className="text-xs text-on-surface-subtle">Manually record attendance for any employee</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors">
            <X size={18} className="text-on-surface-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Employee */}
          <div>
            <label className={labelCls}>Employee <span className="text-danger">*</span></label>
            <select value={form.employee_id} onChange={e => set('employee_id', e.target.value)} className={inputCls}>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_id})</option>
              ))}
            </select>
            {selectedEmp && (
              <p className="text-xs text-on-surface-subtle mt-1">{selectedEmp.designation} · {selectedEmp.department}</p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className={labelCls}>Date <span className="text-danger">*</span></label>
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
            <label className={labelCls}>Status <span className="text-danger">*</span></label>
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
                        ? 'border-brand bg-brand-container text-on-brand-container'
                        : 'border-outline bg-surface text-on-surface-muted hover:border-outline hover:bg-surface-2'
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
            <p className="text-sm text-danger bg-danger-container border border-danger/20 rounded-lg px-4 py-2.5">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-on-surface bg-surface-2 border border-outline hover:bg-surface-3 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-on-accent bg-accent hover:opacity-90 rounded-lg shadow-elev-1 transition-all disabled:opacity-60">
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
  const [sessionModal, setSessionModal] = useState<{ record: any; sessions: any[]; loading: boolean; error?: string } | null>(null);

  // Status view (alternate view: all employees grouped by attendance status)
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const [viewMode, setViewMode] = useState<'employee' | 'status'>('employee');
  const [statusDate, setStatusDate] = useState(todayStr);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [statusDayRecords, setStatusDayRecords] = useState<any[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);

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

  // Short-day notes for the selected employee + visible month. HR / manager
  // can annotate someone else's day; the server enforces who's allowed.
  // Keyed by date (YYYY-MM-DD) so render-time lookup is O(1).
  const [attendanceNotes, setAttendanceNotes] = useState<Record<string, { note: string; author_name: string | null; author_role: string | null; updated_at: string }>>({});
  const [editingNoteDate, setEditingNoteDate] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedEmpId) { setAttendanceNotes({}); return; }
    api.getAttendanceNotes(selectedEmpId, viewMonth + 1, viewYear)
      .then(rows => {
        const byDate: Record<string, any> = {};
        (rows as any[]).forEach(n => { byDate[n.date] = n; });
        setAttendanceNotes(byDate);
      })
      .catch(() => setAttendanceNotes({}));
  }, [selectedEmpId, viewMonth, viewYear]);

  const fetchSyncHistory = useCallback(() => {
    api.getBiometricSyncHistory().then(setSyncHistory).catch(() => {});
  }, []);

  // Only fetch per-employee records/leaves while the employee view is active
  useEffect(() => { if (viewMode === 'employee') fetchRecords(); }, [fetchRecords, viewMode]);
  useEffect(() => { if (viewMode === 'employee') fetchLeaves(); }, [fetchLeaves, viewMode]);
  useEffect(() => { if (isHROrAdmin) fetchSyncHistory(); }, [fetchSyncHistory, isHROrAdmin]);

  // Fetch all employees' records for the selected date when in Status view
  const fetchStatusDayRecords = useCallback(() => {
    if (viewMode !== 'status') return;
    const [y, m] = statusDate.split('-').map(Number);
    if (!y || !m) return;
    setStatusLoading(true);
    api.getAttendance({ month: m, year: y })
      .then(rows => {
        const filtered = (rows as any[]).filter(r => {
          if (!r.date || (typeof r.date === 'string' && !r.date.trim())) return false;
          const dateStr = parseLocalDate(r.date).toLocaleDateString('en-CA');
          return dateStr && dateStr !== 'Invalid Date' && dateStr === statusDate;
        });
        setStatusDayRecords(filtered);
      })
      .catch(() => setStatusDayRecords([]))
      .finally(() => setStatusLoading(false));
  }, [viewMode, statusDate]);
  useEffect(() => { fetchStatusDayRecords(); }, [fetchStatusDayRecords]);

  const handleSyncNow = async (fullMonth = false) => {
    setSyncing(true);
    setSyncError('');
    setSyncSuccess('');
    try {
      const today = new Date().toISOString().split('T')[0];
      // For the "Sync Today" button, cover yesterday + today so late
      // punches from the previous evening get picked up (eTimeOffice
      // sometimes delivers them after midnight).
      const yest = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
      const fromDate = fullMonth
        ? `${today.slice(0, 7)}-01`   // first day of current month
        : yest;                       // yesterday → today
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
    } catch (e: any) {
      setSessionModal({ record, sessions: [], loading: false, error: e.message ?? 'Failed to load session data' });
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
      <div className="rounded-xl-2 p-6 text-white flex items-center justify-between shadow-elev-2"
        style={{ background: 'linear-gradient(135deg, #192250 0%, #111737 100%)' }}>
        <div>
          <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <p className="num-mono text-3xl font-bold mt-1">{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
          {clocked && <p className="num-mono text-xs mt-1" style={{ color: '#ff75b0' }}>Clocked in at {clockTime}</p>}
        </div>
        <div className="flex items-center gap-3">
          {isHROrAdmin && (
            <button onClick={() => setShowMark(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl-2 text-sm font-semibold transition-all"
              style={{ background: 'rgba(238,39,112,0.2)', border: '1px solid rgba(238,39,112,0.4)', color: '#ff75b0' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(238,39,112,0.35)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(238,39,112,0.2)'; }}>
              <CalendarDays size={15} /> Mark Attendance
            </button>
          )}
          <button onClick={handleClock}
            className={`px-6 py-3 rounded-xl-2 font-semibold text-sm transition-all shadow-elev-2 active:scale-95 ${clocked ? 'cursor-default' : ''}`}
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
          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
            {/* Header row */}
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-xl-2 bg-brand-container flex items-center justify-center flex-shrink-0">
                  <Fingerprint size={18} className="text-on-brand-container" />
                </div>
                <div className="min-w-0">
                  <p className="font-display font-bold text-sm tracking-tight text-on-surface">Biometric Sync</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="flex items-center gap-1 text-xs text-on-surface-subtle">
                      <Activity size={10} className="text-success" />
                      Daily auto-sync · today + yesterday
                    </span>
                    {lastSync && (
                      <span className="num-mono text-xs text-on-surface-subtle">
                        · Last: {fmtAgo(lastSync.synced_at)}
                        {lastSync.records_updated + lastSync.records_created > 0
                          ? ` (${lastSync.records_updated + lastSync.records_created} records)`
                          : ' (no changes)'}
                      </span>
                    )}
                    {!lastSync && <span className="text-xs text-on-surface-subtle">· No syncs yet</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Sync This Month button */}
                <button
                  onClick={() => handleSyncNow(true)}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl-2 border border-outline bg-surface-2 text-on-surface hover:bg-surface-3 transition-colors disabled:opacity-50"
                >
                  <Calendar size={13} />
                  {syncing ? '…' : 'Sync This Month'}
                </button>
                {/* Sync Now (today) button */}
                <button
                  onClick={() => handleSyncNow(false)}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-on-accent bg-accent hover:opacity-90 rounded-xl-2 shadow-elev-1 transition-all disabled:opacity-60"
                >
                  <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Syncing…' : 'Sync Today + Yesterday'}
                </button>
                {/* Toggle history */}
                <button
                  onClick={() => setShowSyncHistory(v => !v)}
                  className="p-2 rounded-xl-2 hover:bg-surface-2 transition-colors"
                  title="Toggle sync history"
                >
                  {showSyncHistory ? <ChevronUp size={16} className="text-on-surface-subtle" /> : <ChevronDown size={16} className="text-on-surface-subtle" />}
                </button>
              </div>
            </div>

            {/* Feedback messages */}
            {(syncError || syncSuccess) && (
              <div className={`mx-5 mb-4 px-4 py-2.5 rounded-xl-2 text-xs font-semibold ${syncError ? 'bg-danger-container text-danger border border-danger/20' : 'bg-success-container text-success border border-success/20'}`}>
                {syncError || syncSuccess}
              </div>
            )}

            {/* Sync history table */}
            {showSyncHistory && (
              <div className="border-t border-outline overflow-x-auto">
                {syncHistory.length === 0 ? (
                  <p className="text-sm text-on-surface-subtle text-center py-6">No sync history yet</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-2">
                        {['Synced At', 'Trigger', 'Date', 'Updated', 'Created', 'Status'].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline">
                      {syncHistory.map(s => {
                        const isRolledBack = s.is_rolled_back || s.status === 'rolled_back';
                        const isFailed = s.status === 'failed';
                        return (
                          <tr key={s.id} className="hover:bg-surface-2 transition-colors">
                            <td className="px-4 py-3 num-mono text-xs text-on-surface-muted whitespace-nowrap">
                              {new Date(s.synced_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                              {', '}{new Date(s.synced_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                            </td>
                            <td className="px-4 py-3 text-xs text-on-surface-muted capitalize whitespace-nowrap">
                              {s.triggered === 'manual' ? `Manual${s.triggered_by ? ` — ${s.triggered_by}` : ''}` : 'Auto'}
                            </td>
                            <td className="px-4 py-3 text-xs text-on-surface-muted">{s.date_range ?? '—'}</td>
                            <td className="px-4 py-3 num-mono text-xs font-semibold text-center text-on-surface">{s.records_updated ?? 0}</td>
                            <td className="px-4 py-3 num-mono text-xs font-semibold text-center text-on-surface">{s.records_created ?? 0}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                                isRolledBack ? 'bg-surface-2 text-on-surface-muted' :
                                isFailed ? 'bg-danger-container text-danger' :
                                'bg-success-container text-success'
                              }`}>
                                {isRolledBack ? 'Rolled Back' : isFailed ? '✕ Failed' : '✓ Success'}
                              </span>
                              {s.error_msg && <p className="text-xs text-danger mt-0.5 truncate max-w-[150px]">{s.error_msg}</p>}
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

      {/* ── View Toggle ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex bg-surface-2 p-1 rounded-lg border border-outline">
          <button onClick={() => setViewMode('employee')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-all ${viewMode === 'employee' ? 'bg-accent text-on-accent shadow-elev-1' : 'text-on-surface-muted hover:text-on-surface'}`}>
            By Employee
          </button>
          <button onClick={() => { setViewMode('status'); setStatusFilter('all'); }}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-all ${viewMode === 'status' ? 'bg-accent text-on-accent shadow-elev-1' : 'text-on-surface-muted hover:text-on-surface'}`}>
            By Status
          </button>
        </div>

        {viewMode === 'employee' ? (
          <>
            <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)}
              className="text-sm border border-outline rounded-lg px-3 py-2.5 bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 text-on-surface">
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <span className="text-sm text-on-surface-subtle">{monthName} {viewYear}</span>
            {(() => {
              const emp = employees.find(e => e.id === selectedEmpId);
              if (!emp) return null;
              const isNight = emp.shift === 'night';
              return (
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full ${
                  isNight ? 'bg-brand-container text-on-brand-container' : 'bg-warning-container text-warning'
                }`}>
                  {isNight ? '🌙' : '☀️'} {isNight ? 'Night Shift · 6:30 PM – 3:30 AM' : 'Day Shift · 9:00 AM – 6:00 PM'}
                </span>
              );
            })()}
          </>
        ) : (
          <>
            <input type="date" value={statusDate} max={todayStr}
              onChange={e => setStatusDate(e.target.value)}
              className="text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 text-on-surface"/>
            <span className="text-sm text-on-surface-subtle">
              {parseLocalDate(statusDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </>
        )}
      </div>

      {viewMode === 'employee' && (<>
      {/* Summary Cards — clicking jumps into Status view filtered to today */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Present', value: presentCount, icon: CheckCircle, color: 'text-success', blob: 'bg-success/15', filter: 'present' },
          { label: 'Absent',  value: absentCount,  icon: XCircle,     color: 'text-danger',  blob: 'bg-danger/15',  filter: 'absent'  },
          { label: 'Late',    value: lateCount,    icon: AlertCircle, color: 'text-warning', blob: 'bg-warning/15', filter: 'late'    },
          { label: 'Avg Hours/Day', value: fmtHours(totalHours / Math.max(presentCount + lateCount, 1)), icon: Clock, color: 'text-brand', blob: 'bg-brand/15', filter: null },
        ].map(({ label, value, icon: Icon, color, blob, filter }, i) => (
          <button key={label}
            onClick={() => {
              if (!filter) return;
              setViewMode('status');
              setStatusDate(todayStr);
              setStatusFilter(filter);
            }}
            disabled={!filter}
            className={`group relative overflow-hidden bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 text-left transition-all animate-fade-up stagger-${i + 1} ${filter ? 'cursor-pointer hover:shadow-elev-2' : 'cursor-default opacity-90'}`}>
            <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full ${blob} blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500`} />
            <div className="relative">
              <Icon size={18} className={color} />
              <p className="num-mono text-2xl font-bold text-on-surface mt-2">{value}</p>
              <p className="text-xs text-on-surface-subtle mt-0.5">{label}{filter ? ' →' : ''}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Calendar */}
        <div className="bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">{monthName} {viewYear}</h3>
            <div className="flex gap-1">
              <button onClick={prevMonth} className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors">
                <ChevronLeft size={16} className="text-on-surface-subtle" />
              </button>
              <button onClick={nextMonth} className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors">
                <ChevronRight size={16} className="text-on-surface-subtle" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d} className="text-center text-xs font-medium text-on-surface-subtle py-1">{d}</div>
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
                <div key={i} className={`relative flex flex-col items-center py-1 rounded-lg num-mono text-sm transition-colors
                  ${isToday ? 'bg-accent text-on-accent font-semibold' : 'hover:bg-surface-2 text-on-surface'}
                  ${record?.status === 'absent' && !isToday ? 'text-danger' : ''}`}>
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
                <div key={s} className="flex items-center gap-1.5 text-xs text-on-surface-muted">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Daily Log */}
        <div className="bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1">
          <h3 className="font-display text-xl font-bold tracking-tight text-on-surface mb-4">Daily Log</h3>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-6 h-6 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {records.filter(r => r.status !== 'weekend').map(r => {
                const cfg = statusConfig[r.status as keyof typeof statusConfig];
                const leave = getLeaveForDay(r.date);
                const leaveTag = leave ? LEAVE_TAG[leave.type] : null;

                // Use source as the authoritative signal — extension_hours could be >0 from partial data
                const isExtension = r.source === 'wfh_extension';

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

                const noteRow = attendanceNotes[r.date];
                return (
                  <div key={r.date} className="border-b border-outline last:border-0">
                  <div
                    onClick={() => r.check_in && handleOpenSessions(r)}
                    className={`flex items-start justify-between py-2.5 gap-3 ${r.check_in ? 'cursor-pointer hover:bg-surface-2 rounded-lg px-1 -mx-1 transition-colors' : ''}`}>
                    {/* Left: status + date */}
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${cfg?.color}`}>{cfg?.label}</span>
                      {isShortDay && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold border border-warning/40 bg-warning-container text-warning flex-shrink-0">Short Day</span>
                      )}
                      {(isShortDay || (r.status === 'late' && !r.check_out)) && (() => {
                        const has = !!attendanceNotes[r.date];
                        return (
                          <button onClick={(e) => { e.stopPropagation(); setEditingNoteDate(r.date); }}
                            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border flex-shrink-0 transition-colors ${
                              has
                                ? 'bg-accent/10 text-accent border-accent/30 hover:bg-accent/20'
                                : 'text-on-surface-subtle border-outline hover:bg-surface-2'
                            }`}>
                            {has ? '📝 Note' : '+ Add note'}
                          </button>
                        );
                      })()}
                      {leaveTag && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold border flex-shrink-0"
                          style={{ background: leaveTag.bg, color: leaveTag.color, borderColor: leaveTag.color + '40' }}>
                          {leaveTag.label}
                          {leave?.status === 'pending' && <span className="ml-1 opacity-60">(pending)</span>}
                        </span>
                      )}
                      <span className="num-mono text-sm text-on-surface-muted flex-shrink-0">
                        {parseLocalDate(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>

                    {/* Right: time breakdown */}
                    {r.check_in ? (
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        {/* Presence window — secondary grey */}
                        <span className="num-mono text-[11px] text-on-surface-subtle">
                          {r.check_in} → {r.check_out ?? 'Active'}
                        </span>

                        {/* Productive hours — primary bold green */}
                        <span className="num-mono text-xs font-bold text-success">
                          {fmtHours(r.total_hours)} worked
                        </span>

                        {/* Break time — only when sessions had breaks */}
                        {fmtBreak && (
                          <span className="num-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warning-container text-warning">
                            {fmtBreak} break
                          </span>
                        )}

                        {/* Extension tag */}
                        {isExtension && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-accent/25 bg-accent/10 text-accent">
                            💻 Extension{Number(r.extension_hours) > 0 ? ` · ${fmtHours(r.extension_hours)}` : ''}
                          </span>
                        )}
                        {/* Activity score badge — only for extension-tracked records with score data */}
                        {isExtension && r.activity_score != null && (() => {
                          const score = Number(r.activity_score);
                          const tone = score >= 70
                            ? 'bg-success-container text-success border-success/40'
                            : score >= 40
                              ? 'bg-warning-container text-warning border-warning/40'
                              : 'bg-danger-container text-danger border-danger/40';
                          const label = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
                          return (
                            <span className={`inline-flex items-center gap-1 num-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${tone}`}
                              title="Activity score: % of clocked-in time with mouse/keyboard interaction">
                              {label} {score}% active
                            </span>
                          );
                        })()}
                      </div>
                    ) : <span className="text-xs text-on-surface-subtle">—</span>}
                  </div>
                  {noteRow && (
                    <div className="mt-1 ml-1 text-xs bg-accent/5 border border-accent/20 rounded-md px-3 py-1.5 mb-2">
                      <p className="text-on-surface whitespace-pre-line">{noteRow.note}</p>
                      <p className="text-[10px] text-on-surface-subtle mt-0.5">
                        — {noteRow.author_name ?? 'Unknown'}{noteRow.author_role ? ` (${noteRow.author_role})` : ''} · {new Date(noteRow.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                  )}
                  </div>
                );
              })}
              {records.filter(r => r.status !== 'weekend').length === 0 && (
                <p className="text-sm text-on-surface-subtle text-center py-8">No records found</p>
              )}
            </div>
          )}
        </div>
      </div>
      </>)}

      {/* ── Status View — all employees grouped/filtered by attendance status ─ */}
      {viewMode === 'status' && (() => {
        // Detect weekend so HR knows why everything shows "No Record"
        const dow = parseLocalDate(statusDate).getDay();
        const isWeekend = dow === 0 || dow === 6;

        // Build a single lookup map (O(n)) instead of .find for every employee (O(n*m))
        const recordMap = new Map<string, any>();
        for (const r of statusDayRecords) recordMap.set(r.employee_id, r);

        const activeEmps = employees.filter(e => e.status === 'active');
        const employeeStatuses = activeEmps.map(emp => {
          const record = recordMap.get(emp.id);
          const status = record?.status ?? 'no_record';
          return { employee: emp, record, status };
        });

        const counts: Record<string, number> = {
          all:     employeeStatuses.length,
          present: employeeStatuses.filter(es => es.status === 'present').length,
          late:    employeeStatuses.filter(es => es.status === 'late').length,
          absent:  employeeStatuses.filter(es => es.status === 'absent').length,
          on_leave:employeeStatuses.filter(es => ['on_leave','short_leave','half-day','unpaid_leave'].includes(es.status)).length,
          wfh:     employeeStatuses.filter(es => ['wfh','wfh_half'].includes(es.status)).length,
          no_record: employeeStatuses.filter(es => es.status === 'no_record').length,
        };

        const filtered = employeeStatuses.filter(es => {
          if (statusFilter === 'all')      return true;
          if (statusFilter === 'on_leave') return ['on_leave','short_leave','half-day','unpaid_leave'].includes(es.status);
          if (statusFilter === 'wfh')      return ['wfh','wfh_half'].includes(es.status);
          return es.status === statusFilter;
        });

        const TABS: { key: string; label: string; activeCls: string }[] = [
          { key: 'all',      label: 'All',         activeCls: 'bg-accent text-on-accent' },
          { key: 'present',  label: 'Present',     activeCls: 'bg-success text-on-accent' },
          { key: 'late',     label: 'Late',        activeCls: 'bg-warning text-on-accent' },
          { key: 'absent',   label: 'Absent',      activeCls: 'bg-danger text-on-accent' },
          { key: 'on_leave', label: 'On Leave',    activeCls: 'bg-brand text-on-accent' },
          { key: 'wfh',      label: 'WFH',         activeCls: 'bg-accent text-on-accent' },
          { key: 'no_record',label: 'No Record',   activeCls: 'bg-surface-3 text-on-surface' },
        ];

        return (
          <div className="space-y-4">
            {/* Weekend banner — explains why the day shows all No Record */}
            {isWeekend && (
              <div className="px-4 py-3 rounded-xl-2 text-sm font-medium flex items-start gap-2.5 border border-warning/30 bg-warning-container text-warning">
                <span>🏖️</span>
                <span>This is a weekend — most employees won't have attendance records. Showing data anyway in case anyone worked.</span>
              </div>
            )}

            {/* Status tabs with counts */}
            <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-2 overflow-x-auto">
              <div className="flex gap-1 min-w-max">
                {TABS.map(t => {
                  const active = statusFilter === t.key;
                  return (
                    <button key={t.key} onClick={() => setStatusFilter(t.key)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${active ? `${t.activeCls} shadow-elev-1` : 'text-on-surface-muted hover:bg-surface-2'}`}>
                      {t.label}
                      <span className={`num-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/25' : 'bg-surface-2 text-on-surface-muted'}`}>
                        {counts[t.key] ?? 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Employee list */}
            <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
              <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
                <div>
                  <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">
                    {TABS.find(t => t.key === statusFilter)?.label} (<span className="num-mono">{filtered.length}</span>)
                  </h3>
                  <p className="text-xs text-on-surface-subtle mt-0.5">
                    {parseLocalDate(statusDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>

              {statusLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-sm text-on-surface-subtle py-12">
                  No employees in this category on this date
                </p>
              ) : (
                <div className="divide-y divide-outline">
                  {filtered.map(({ employee, record, status }) => {
                    const cfg = statusConfig[status as keyof typeof statusConfig];
                    const isExt = record?.source === 'wfh_extension';
                    const isBio = record?.source === 'biometric';
                    return (
                      <div key={employee.id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2 transition-colors">
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-full bg-brand-container text-on-brand-container flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {employee.avatar || (employee.name ? employee.name.split(' ').map((p: string) => p[0]).filter(Boolean).join('').slice(0,2) : '?')}
                        </div>
                        {/* Name + meta */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-on-surface truncate">{employee.name ?? '—'}</p>
                          <p className="text-xs text-on-surface-subtle truncate">{employee.employee_id ?? '—'}{employee.designation ? ` · ${employee.designation}` : ''}</p>
                        </div>
                        {/* Times + hours */}
                        <div className="hidden sm:flex flex-col items-end gap-0.5 flex-shrink-0 min-w-[120px]">
                          {record?.check_in ? (
                            <>
                              <span className="num-mono text-[11px] text-on-surface-subtle">{record.check_in} → {record.check_out ?? 'Active'}</span>
                              <span className="num-mono text-xs font-bold text-success">{fmtHours(record.total_hours)} worked</span>
                            </>
                          ) : (
                            <span className="text-xs text-on-surface-subtle">—</span>
                          )}
                        </div>
                        {/* Source tag */}
                        <div className="hidden md:block flex-shrink-0">
                          {isExt && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">💻 Ext</span>
                          )}
                          {isBio && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-success-container text-success">🔵 Bio</span>
                          )}
                        </div>
                        {/* Status badge */}
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${cfg?.color ?? 'bg-surface-2 text-on-surface-muted'}`}>
                          {status === 'no_record' ? 'No Record' : (cfg?.label ?? status)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

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
          <div className="bg-surface rounded-2xl shadow-elev-3 w-full max-w-md overflow-hidden border border-outline">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline"
              style={{ background: 'linear-gradient(135deg,#192250 0%,#111737 100%)' }}>
              <div>
                <p className="font-display text-white font-bold text-sm tracking-tight">
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
                  <div className="w-6 h-6 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
                </div>
              ) : sessionModal.error ? (
                <div className="text-center py-8">
                  <p className="text-sm text-danger bg-danger-container border border-danger/20 rounded-xl-2 px-4 py-3">{sessionModal.error}</p>
                  <button onClick={() => handleOpenSessions(sessionModal.record)} className="mt-3 text-xs text-on-brand-container hover:underline">Retry</button>
                </div>
              ) : sessionModal.sessions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-on-surface-subtle">No session data — single clock-in/out record</p>
                  {sessionModal.record.check_in && (
                    <div className="mt-4 p-3 bg-surface-2 border border-outline rounded-xl-2 text-sm">
                      <span className="num-mono font-semibold text-on-surface">{sessionModal.record.check_in}</span>
                      <span className="text-on-surface-subtle mx-2">→</span>
                      <span className="num-mono font-semibold text-on-surface">{sessionModal.record.check_out ?? 'Active'}</span>
                      <span className="num-mono ml-3 font-bold text-success">{fmtHours(sessionModal.record.total_hours)}</span>
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
                      <div key={i} className={`flex items-center gap-3 p-3 rounded-xl-2 border ${
                        b.type === 'work'
                          ? 'bg-success-container/40 border-success/20'
                          : 'bg-warning-container border-warning/20'
                      }`}>
                        <div className={`min-h-[32px] rounded-full flex-shrink-0 self-stretch ${b.type === 'work' ? 'bg-success' : 'bg-warning'}`}
                          style={{ width: '3px' }}/>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${b.type === 'work' ? 'text-success' : 'text-warning'}`}>
                              {b.type === 'work' ? `Work Session ${blocks.filter((x,j) => x.type==='work'&&j<=i).length}` : 'Break'}
                            </span>
                            {b.type === 'work' && b.source === 'wfh_extension' && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">💻 ext</span>
                            )}
                            {b.type === 'work' && b.source === 'biometric' && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-success-container text-success">🔵 bio</span>
                            )}
                          </div>
                          <p className="num-mono text-xs text-on-surface-muted mt-0.5">
                            {fmt12(b.from)} <span className="mx-1">→</span> {fmt12(b.to)}
                          </p>
                        </div>
                        <span className={`num-mono text-sm font-black flex-shrink-0 ${b.type === 'work' ? 'text-on-surface' : 'text-warning'}`}>
                          {fmtMins(b.minutes)}
                        </span>
                      </div>
                    ))}

                    {/* Summary row */}
                    <div className="mt-3 pt-3 border-t border-outline flex items-center justify-between">
                      <div className="text-center flex-1">
                        <p className="text-xs text-on-surface-subtle">Worked</p>
                        <p className="num-mono text-lg font-black text-success">{fmtMins(totalWorked)}</p>
                      </div>
                      <div className="w-px h-10 bg-outline" />
                      <div className="text-center flex-1">
                        <p className="text-xs text-on-surface-subtle">Break</p>
                        <p className={`num-mono text-lg font-black ${totalBreak > 0 ? 'text-warning' : 'text-on-surface-subtle'}`}>{totalBreak > 0 ? fmtMins(totalBreak) : '—'}</p>
                      </div>
                      <div className="w-px h-10 bg-outline" />
                      <div className="text-center flex-1">
                        <p className="text-xs text-on-surface-subtle">Active</p>
                        {(() => {
                          const totalActiveM = sessions.reduce((s, r) => s + Number(r.active_minutes || 0), 0);
                          const score = totalWorked > 0 ? Math.min(100, Math.round(totalActiveM / totalWorked * 100)) : null;
                          const tone = score === null
                            ? 'text-on-surface-subtle'
                            : score >= 70 ? 'text-success' : score >= 40 ? 'text-warning' : 'text-danger';
                          return <p className={`num-mono text-lg font-black ${tone}`}>{score !== null ? `${score}%` : '—'}</p>;
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {editingNoteDate && selectedEmpId && (
        <AttendanceNoteEditor
          employeeId={selectedEmpId}
          date={editingNoteDate}
          existing={attendanceNotes[editingNoteDate]?.note ?? ''}
          authorName={user?.name ?? null}
          authorRole={user?.role ?? null}
          onClose={() => setEditingNoteDate(null)}
          onSaved={(noteText) => {
            setEditingNoteDate(null);
            if (!noteText) {
              setAttendanceNotes(prev => {
                const next = { ...prev };
                delete next[editingNoteDate];
                return next;
              });
            } else {
              setAttendanceNotes(prev => ({
                ...prev,
                [editingNoteDate]: {
                  note: noteText,
                  author_name: user?.name ?? null,
                  author_role: user?.role ?? null,
                  updated_at: new Date().toISOString(),
                },
              }));
            }
          }}
        />
      )}
    </div>
  );
}

// Lightweight inline editor for an attendance-day note. Same shape as the
// employee-side modal in MyPortal — kept separate so the HR page doesn't
// pull a chunk of MyPortal as a dep. Empty save = delete.
function AttendanceNoteEditor({ employeeId, date, existing, authorName, authorRole, onClose, onSaved }: {
  employeeId: string;
  date: string;
  existing: string;
  authorName: string | null;
  authorRole: string | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [text, setText] = useState(existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const friendlyDate = new Date(date + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const submit = async () => {
    setBusy(true); setError('');
    try {
      await api.upsertAttendanceNote({ employee_id: employeeId, date, note: text.trim() });
      toast.success(text.trim() ? 'Note saved' : 'Note deleted', friendlyDate);
      onSaved(text.trim());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save');
      toast.error('Failed to save note', e?.message);
    }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-outline">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div>
            <h3 className="font-display text-base font-bold text-on-surface">Note for {friendlyDate}</h3>
            <p className="text-[11px] text-on-surface-muted mt-0.5">
              Saving as <b>{authorName ?? 'you'}</b>{authorRole ? ` (${authorRole})` : ''}. Blank + save deletes the note.
            </p>
          </div>
          <button onClick={onClose}><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="p-6 space-y-3">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} autoFocus
            placeholder="e.g. Left early for a customer meeting at 4 PM. Manager approved."
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent/30" />
          {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
          <p className="text-[10px] text-on-surface-subtle">⌘/Ctrl-Enter to save.</p>
        </div>
        <div className="px-6 py-3 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50">
            {busy ? 'Saving…' : (existing && !text.trim()) ? 'Delete note' : existing ? 'Update' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}
