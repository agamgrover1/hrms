import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Trash2, Mail, Phone, MapPin, Calendar, Clock,
  AlertTriangle, Shield, X, TrendingUp, FileText, User, Star,
  ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { EditEmployeeModal } from './Employees';

// ── Helpers ───────────────────────────────────────────────────────────────────
function toDateStr(val: any): string {
  if (!val) return '';
  const s = typeof val === 'string' ? val : String(val);
  if (s.includes('T')) {
    const d = new Date(s);
    d.setMinutes(d.getMinutes() + 330); // +5:30 IST
    return d.toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}
function fmtDate(val: any, opts?: Intl.DateTimeFormatOptions) {
  const s = toDateStr(val);
  if (!s) return '—';
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-IN', opts ?? { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtAmt(n: any) {
  if (n == null || n === '') return '—';
  return `₹${Number(n).toLocaleString('en-IN')}`;
}
function fmtTime(t: any) {
  if (!t) return '—';
  const s = String(t);
  if (s.includes('T')) return new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return s.slice(0, 5);
}
function fmtHours(h: any) {
  const n = Number(h) || 0;
  const hrs = Math.floor(n);
  const mins = Math.round((n - hrs) * 60);
  if (hrs === 0 && mins === 0) return '—';
  return hrs === 0 ? `${mins}m` : mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`;
}
// Add 90 days to a date string, respecting IST — returns YYYY-MM-DD
function addDays(dateVal: any, days: number): string {
  const s = toDateStr(dateVal);
  if (!s) return '';
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const STATUS_DOT: Record<string,string> = {
  present:'bg-green-500', late:'bg-amber-500', absent:'bg-red-500',
  on_leave:'bg-violet-400', wfh:'bg-blue-400', wfh_half:'bg-pink-400',
  holiday:'bg-purple-400', weekend:'bg-gray-300', short_leave:'bg-orange-400',
  unpaid_leave:'bg-rose-400', 'half-day':'bg-sky-400',
};
const STATUS_LABEL: Record<string,string> = {
  present:'Present', late:'Late', absent:'Absent', on_leave:'On Leave',
  wfh:'WFH', wfh_half:'WFH Half', holiday:'Holiday', weekend:'Weekend',
  short_leave:'Short Leave', unpaid_leave:'Unpaid', 'half-day':'Half Day',
};
const PERF_KEYS   = ['productivity','quality','teamwork','attendance_score','initiative','client_satisfaction','ai_usage'];
const PERF_LABELS = ['Productivity','Quality','Teamwork','Attendance','Initiative','Client Sat.','AI Usage'];

// ── Mini action modal ─────────────────────────────────────────────────────────
function ActionModal({ title, info, type, isIncentive, onClose, onConfirm }: {
  title: string; info: string; type: 'approve'|'reject'|'pay';
  isIncentive: boolean; onClose: ()=>void; onConfirm: (d:any)=>Promise<void>;
}) {
  const [amt, setAmt]       = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote]     = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const handle = async () => {
    if (type === 'approve' && isIncentive && !(Number(amt) > 0)) {
      setErr('Enter a valid incentive amount greater than 0');
      return;
    }
    if (type === 'approve' && amt && Number(amt) <= 0) {
      setErr('Amount must be greater than 0');
      return;
    }
    setSaving(true); setErr('');
    try {
      const d: any = { status: type === 'approve' ? 'approved' : type === 'pay' ? 'paid' : 'rejected' };
      if (type === 'approve' && amt) d.approved_amount = Number(amt);
      if (type === 'reject') d.rejection_reason = reason;
      if (type === 'pay') d.payment_note = note;
      await onConfirm(d);
    } catch (e: any) { setErr(e.message ?? 'Action failed. Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm" style={{color:'#192250'}}>{title}</h3>
          <button onClick={onClose}><X size={15} className="text-gray-400"/></button>
        </div>
        <p className="text-xs text-gray-500 mb-4 bg-gray-50 rounded-lg px-3 py-2">{info}</p>
        {type === 'approve' && (
          <div className="mb-3">
            <label className="text-xs font-semibold text-gray-500 block mb-1">
              {isIncentive ? 'Incentive Amount (₹) *' : 'Approved Amount (₹)'}
            </label>
            <input type="number" min="1" value={amt} onChange={e=>setAmt(e.target.value)}
              placeholder="Enter amount"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"/>
          </div>
        )}
        {type === 'reject' && (
          <div className="mb-3">
            <label className="text-xs font-semibold text-gray-500 block mb-1">Reason (optional)</label>
            <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2}
              placeholder="Reason for rejection…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none"/>
          </div>
        )}
        {type === 'pay' && (
          <div className="mb-3">
            <label className="text-xs font-semibold text-gray-500 block mb-1">Payment Note (optional)</label>
            <input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Paid via May payroll"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none"/>
          </div>
        )}
        {err && <p className="text-xs text-red-500 font-medium bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handle} disabled={saving}
            className="flex-1 py-2 text-white rounded-xl text-sm font-semibold disabled:opacity-60"
            style={{background: type==='reject'?'#dc2626':type==='pay'?'#7c3aed':'#15803d'}}>
            {saving ? '…' : type==='approve'?'Approve':type==='pay'?'Mark Paid':'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = ['Overview','Attendance','Leave','Performance','Incentives','Expenses','Warnings'] as const;
type Tab = typeof TABS[number];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EmployeeProfile() {
  const { id }         = useParams<{id:string}>();
  const navigate       = useNavigate();
  const { user: me }   = useAuth();

  // Core state
  const [emp, setEmp]               = useState<any>(null);
  const [allEmps, setAllEmps]       = useState<any[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [designations, setDesignations] = useState<string[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<Tab>('Overview');
  const [showEdit, setShowEdit]     = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting]     = useState(false);

  // Track which tabs have been loaded so empty results don't cause infinite refetch
  const [loaded, setLoaded] = useState(new Set<Tab>());
  // Track per-tab errors
  const [tabError, setTabError] = useState<Partial<Record<Tab,string>>>({});

  // Attendance
  const now = new Date();
  const [attMonth, setAttMonth] = useState(now.getMonth() + 1);
  const [attYear, setAttYear]   = useState(now.getFullYear());
  const [attendance, setAttendance] = useState<any[]>([]);
  const [attLoading, setAttLoading] = useState(false);

  // Leave
  const [leaves, setLeaves]           = useState<any[]>([]);
  const [leaveBalance, setLeaveBalance] = useState<any>(null);
  const [leaveLoading, setLeaveLoading] = useState(false);

  // Overview — probation
  const [probationEnd, setProbationEnd] = useState('');
  const [savingProb, setSavingProb]     = useState(false);
  const [probSaved, setProbSaved]       = useState(false);
  const [probError, setProbError]       = useState('');

  // Overview — leave balance adjustment
  const [balAdj, setBalAdj]   = useState({ full_day: 0, short_leave: 0 });
  const [balLoaded, setBalLoaded] = useState(false);
  const [savingBal, setSavingBal] = useState(false);
  const [balSaved, setBalSaved]   = useState(false);
  const [balError, setBalError]   = useState('');

  // Performance
  const [perf, setPerf]         = useState<any[]>([]);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfYear, setPerfYear] = useState(now.getFullYear());

  // Incentives
  const [incentives, setIncentives] = useState<any[]>([]);
  const [incLoading, setIncLoading] = useState(false);
  const [incAction, setIncAction]   = useState<{row:any;type:'approve'|'reject'|'pay'}|null>(null);

  // Expenses
  const [expenses, setExpenses]   = useState<any[]>([]);
  const [expLoading, setExpLoading] = useState(false);
  const [expAction, setExpAction]   = useState<{row:any;type:'approve'|'reject'|'pay'}|null>(null);

  // Warnings
  const [warnings, setWarnings]   = useState<any[]>([]);
  const [pip, setPip]             = useState<any|null>(null);
  const [warnLoading, setWarnLoading] = useState(false);
  const [showWarnForm, setShowWarnForm] = useState(false);
  const [warnReason, setWarnReason]   = useState('');
  const [warnSeverity, setWarnSeverity] = useState('warning');
  const [issuingWarn, setIssuingWarn] = useState(false);
  const [warnError, setWarnError]     = useState('');
  const [pipUpdating, setPipUpdating] = useState(false);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      api.getEmployees(),
      api.getConfigDepartments().catch(() => []),
      api.getConfigDesignations().catch(() => []),
    ]).then(([emps, depts, desigs]) => {
      const found = (emps as any[]).find(e => e.id === id);
      if (!found) { navigate('/employees'); return; }
      setEmp(found);
      setAllEmps(emps);
      setDepartments((depts as any[]).map(d => d.name));
      setDesignations((desigs as any[]).map(d => d.name));
      // Probation: use toDateStr for IST-correct date, addDays for +90 calculation
      const storedEnd = toDateStr(found.probation_end_date);
      const defaultEnd = found.join_date ? addDays(found.join_date, 90) : '';
      setProbationEnd(storedEnd || defaultEnd);
      // Load leave balance for Overview tab
      api.getLeaveBalance(found.id).then(b => {
        setBalAdj({ full_day: b.full_day ?? 0, short_leave: b.short_leave ?? 0 });
        setLeaveBalance(b);
        setBalLoaded(true);
      }).catch(() => setBalLoaded(true));
    }).finally(() => setLoading(false));
  }, [id]);

  // ── Attendance loader ─────────────────────────────────────────────────────
  const loadAttendance = useCallback(() => {
    if (!emp?.id) return;
    setAttLoading(true);
    setTabError(prev => ({ ...prev, Attendance: '' }));
    api.getAttendance({ employee_id: emp.id, month: attMonth, year: attYear })
      .then(data => { setAttendance(data); setLoaded(prev => new Set(prev).add('Attendance')); })
      .catch(() => setTabError(prev => ({ ...prev, Attendance: 'Failed to load attendance. Try again.' })))
      .finally(() => setAttLoading(false));
  }, [emp?.id, attMonth, attYear]);

  // ── Performance loader (year-aware) ──────────────────────────────────────
  const loadPerformance = useCallback(() => {
    if (!emp?.id) return;
    setPerfLoading(true);
    setTabError(prev => ({ ...prev, Performance: '' }));
    api.getMonthlyPerformance(emp.id, perfYear)
      .then(data => { setPerf(data); setLoaded(prev => new Set(prev).add('Performance')); })
      .catch(() => setTabError(prev => ({ ...prev, Performance: 'Failed to load performance data.' })))
      .finally(() => setPerfLoading(false));
  }, [emp?.id, perfYear]);

  // ── Tab lazy-load — use explicit loaded Set instead of .length check ───────
  useEffect(() => {
    if (!emp?.id) return;
    if (tab === 'Attendance') { loadAttendance(); return; }

    if (tab === 'Leave' && !loaded.has('Leave')) {
      setLeaveLoading(true);
      setTabError(prev => ({ ...prev, Leave: '' }));
      Promise.all([
        api.getLeaveRequests({ employee_id: emp.id }),
        api.getLeaveBalance(emp.id).catch(() => null),
      ]).then(([lv, bal]) => {
        setLeaves(lv);
        if (bal) setLeaveBalance(bal);
        setLoaded(prev => new Set(prev).add('Leave'));
      }).catch(() => setTabError(prev => ({ ...prev, Leave: 'Failed to load leave data.' })))
        .finally(() => setLeaveLoading(false));
    }

    if (tab === 'Performance' && !loaded.has('Performance')) {
      loadPerformance();
    }

    if (tab === 'Incentives' && !loaded.has('Incentives')) {
      setIncLoading(true);
      setTabError(prev => ({ ...prev, Incentives: '' }));
      api.getUpsellRequests(emp.id)
        .then(data => { setIncentives(data); setLoaded(prev => new Set(prev).add('Incentives')); })
        .catch(() => setTabError(prev => ({ ...prev, Incentives: 'Failed to load incentive data.' })))
        .finally(() => setIncLoading(false));
    }

    if (tab === 'Expenses' && !loaded.has('Expenses')) {
      setExpLoading(true);
      setTabError(prev => ({ ...prev, Expenses: '' }));
      api.getExpenses(emp.id)
        .then(data => { setExpenses(data); setLoaded(prev => new Set(prev).add('Expenses')); })
        .catch(() => setTabError(prev => ({ ...prev, Expenses: 'Failed to load expense data.' })))
        .finally(() => setExpLoading(false));
    }

    if (tab === 'Warnings' && !loaded.has('Warnings')) {
      setWarnLoading(true);
      setTabError(prev => ({ ...prev, Warnings: '' }));
      Promise.all([
        api.getWarnings(emp.id),
        api.getPips(emp.id).catch(() => []),
      ]).then(([ws, ps]) => {
        setWarnings(ws);
        setPip((ps as any[]).find((p:any) => p.status === 'active') ?? null);
        setLoaded(prev => new Set(prev).add('Warnings'));
      }).catch(() => setTabError(prev => ({ ...prev, Warnings: 'Failed to load warnings.' })))
        .finally(() => setWarnLoading(false));
    }
  }, [tab, emp?.id]);

  // Reload attendance when month/year changes
  useEffect(() => {
    if (tab === 'Attendance' && emp?.id) loadAttendance();
  }, [attMonth, attYear]);

  // Reload performance when year changes
  useEffect(() => {
    if (tab === 'Performance' && emp?.id) {
      setLoaded(prev => { const s = new Set(prev); s.delete('Performance'); return s; });
      loadPerformance();
    }
  }, [perfYear]);

  // ── Refresh helpers ───────────────────────────────────────────────────────
  const refreshTab = (t: Tab) => {
    setLoaded(prev => { const s = new Set(prev); s.delete(t); return s; });
    // Trigger the effect
    if (t === 'Attendance') { loadAttendance(); return; }
    if (t === 'Performance') { loadPerformance(); return; }
    // For other tabs, clearing from loaded set will trigger the useEffect on next tab switch.
    // Force a re-trigger by briefly switching tab then back — simpler: just re-run directly
    const refreshMap: Partial<Record<Tab, ()=>void>> = {
      Leave: () => {
        setLeaveLoading(true);
        Promise.all([api.getLeaveRequests({ employee_id: emp!.id }), api.getLeaveBalance(emp!.id).catch(() => null)])
          .then(([lv, bal]) => { setLeaves(lv); if (bal) setLeaveBalance(bal); setLoaded(prev => new Set(prev).add('Leave')); })
          .catch(() => setTabError(prev => ({ ...prev, Leave: 'Failed to load leave data.' })))
          .finally(() => setLeaveLoading(false));
      },
      Incentives: () => {
        setIncLoading(true);
        api.getUpsellRequests(emp!.id).then(d => { setIncentives(d); setLoaded(prev => new Set(prev).add('Incentives')); })
          .catch(() => {}).finally(() => setIncLoading(false));
      },
      Expenses: () => {
        setExpLoading(true);
        api.getExpenses(emp!.id).then(d => { setExpenses(d); setLoaded(prev => new Set(prev).add('Expenses')); })
          .catch(() => {}).finally(() => setExpLoading(false));
      },
      Warnings: () => {
        setWarnLoading(true);
        Promise.all([api.getWarnings(emp!.id), api.getPips(emp!.id).catch(() => [])])
          .then(([ws, ps]) => { setWarnings(ws); setPip((ps as any[]).find((p:any) => p.status === 'active') ?? null); setLoaded(prev => new Set(prev).add('Warnings')); })
          .catch(() => {}).finally(() => setWarnLoading(false));
      },
    };
    refreshMap[t]?.();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/>
    </div>
  );
  if (!emp) return null;

  // Probation: validate date before comparison
  const onProbation = (() => {
    if (!probationEnd) return false;
    const d = new Date(probationEnd);
    if (isNaN(d.getTime())) return false;
    return new Date() < d;
  })();

  // Attendance normalization
  const normAtt    = attendance.map(r => ({ ...r, dateStr: toDateStr(r.date) }));
  const presentCnt = normAtt.filter(r => r.status === 'present').length;
  const lateCnt    = normAtt.filter(r => r.status === 'late').length;
  const absentCnt  = normAtt.filter(r => r.status === 'absent').length;
  const leaveCnt   = normAtt.filter(r => ['on_leave','short_leave','unpaid_leave','half-day'].includes(r.status)).length;
  const wfhCnt     = normAtt.filter(r => ['wfh','wfh_half'].includes(r.status)).length;

  // Performance chart
  const chartData = MONTH_SHORT.map((m, i) => {
    const rec = perf.find(r => r.month === i + 1);
    return { month: m, score: rec ? Number(rec.overall_score) : null };
  });
  const perfColor = (s: number) => s >= 85 ? '#16a34a' : s >= 70 ? '#192250' : s >= 50 ? '#d97706' : '#dc2626';

  // Delete employee
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteEmployee(emp.id);
      navigate('/employees');
    } catch (err: any) {
      alert(err.message || 'Failed to delete employee. Please try again.');
      setShowDelete(false);
    } finally { setDeleting(false); }
  };

  // Issue warning
  const handleIssueWarning = async () => {
    if (!warnReason.trim()) return;
    setIssuingWarn(true);
    setWarnError('');
    try {
      const w = await api.issueWarning({
        employee_id: emp.id, employee_name: emp.name,
        reason: warnReason.trim(), severity: warnSeverity,
        issued_by: me?.name, issued_by_role: me?.role,
      });
      const updated = [...warnings, w];
      setWarnings(updated);
      if (updated.length >= 3) {
        api.getPips(emp.id).then(ps => setPip((ps as any[]).find((p:any) => p.status === 'active') ?? null)).catch(() => {});
      }
      setWarnReason(''); setShowWarnForm(false);
    } catch (e: any) {
      setWarnError(e.message ?? 'Failed to issue warning. Please try again.');
    } finally { setIssuingWarn(false); }
  };

  // Delete warning
  const handleDeleteWarning = async (warnId: string) => {
    try {
      await api.deleteWarning(warnId);
      setWarnings(prev => prev.filter(x => x.id !== warnId));
    } catch (e: any) {
      alert(e.message || 'Failed to delete warning. Please try again.');
    }
  };

  // Update PIP status
  const handlePipUpdate = async (newStatus: string) => {
    if (!pip || pipUpdating) return;
    setPipUpdating(true);
    const prevPip = pip;
    try {
      const u = await api.updatePip(pip.id, { status: newStatus });
      setPip(u.status === 'active' ? u : null);
    } catch (e: any) {
      setPip(prevPip); // revert
      alert(e.message || 'Failed to update PIP status.');
    } finally { setPipUpdating(false); }
  };

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-200 bg-white';
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

  const statusBadge = (status: string) => (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
      <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status] ?? 'bg-gray-400'}`}/>
      {STATUS_LABEL[status] ?? status}
    </span>
  );

  const TabError = ({ t }: { t: Tab }) => tabError[t] ? (
    <div className="flex items-center justify-between px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
      {tabError[t]}
      <button onClick={() => refreshTab(t)} className="flex items-center gap-1 underline underline-offset-2">
        <RefreshCw size={11}/> Retry
      </button>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <button onClick={() => navigate('/employees')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 transition-colors">
          <ArrowLeft size={15}/> Back to Employees
        </button>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="h-24 relative" style={{background:'linear-gradient(135deg,#192250 0%,#EE2770 100%)'}}>
            <div className="absolute top-3 right-3 flex gap-2">
              <button onClick={() => setShowEdit(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-white text-xs font-medium transition-colors">
                <Pencil size={12}/> Edit
              </button>
              <button onClick={() => setShowDelete(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/70 hover:bg-red-500/90 rounded-lg text-white text-xs font-medium transition-colors">
                <Trash2 size={12}/> Delete
              </button>
            </div>
          </div>

          <div className="px-6 pb-5">
            {/* Avatar overlaps banner; name is in its own block below so it's never hidden */}
            <div className="-mt-8 mb-3">
              <div className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center text-xl font-bold border-4 border-white shadow-md">
                {emp.avatar}
              </div>
            </div>
            <div className="mb-4">
              <h1 className="text-xl font-bold text-gray-900">{emp.name}</h1>
              <p className="text-sm text-primary-600 font-medium">{emp.designation}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: User,     text: emp.employee_id },
                { icon: MapPin,   text: emp.department },
                { icon: Calendar, text: `Joined ${fmtDate(emp.join_date, {day:'numeric',month:'short',year:'numeric'})}` },
                { icon: Clock,    text: emp.shift === 'night' ? 'Night Shift' : 'Day Shift' },
              ].map(({ icon: Icon, text }) => (
                <span key={text} className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-3 py-1">
                  <Icon size={11} className="text-gray-400"/>{text}
                </span>
              ))}
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 ${emp.status === 'active' ? 'bg-green-50 text-green-600 border border-green-100' : 'bg-red-50 text-red-500 border border-red-100'}`}>
                {emp.status === 'active' ? '● Active' : '● Inactive'}
              </span>
              {onProbation && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1 bg-amber-50 text-amber-700 border border-amber-100">
                  ⏳ On Probation
                </span>
              )}
            </div>
          </div>

          {/* Tab nav */}
          <div className="border-t border-gray-100 px-4 overflow-x-auto">
            <div className="flex gap-1 py-1">
              {TABS.map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap transition-all ${tab===t?'text-white':'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}
                  style={tab===t?{background:'linear-gradient(135deg,#192250,#141c43)'}:{}}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Overview ───────────────────────────────────────────────────────── */}
      {tab === 'Overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Personal info */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Personal Information</p>
            <div className="space-y-4">
              {[
                { icon: Mail,  label: 'Email',    value: emp.email },
                { icon: Phone, label: 'Phone',    value: emp.phone || '—' },
                { icon: MapPin,label: 'Location', value: emp.location || '—' },
                { icon: User,  label: 'Reporting Manager', value: emp.manager || '—' },
                { icon: Clock, label: 'Shift', value: emp.shift === 'night' ? '🌙 Night Shift (6:30 PM – 3:30 AM)' : '☀️ Day Shift (9:00 AM – 6:00 PM)' },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
                    <Icon size={14} className="text-gray-400"/>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">{label}</p>
                    <p className="text-sm font-medium text-gray-800 mt-0.5">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            {/* Compensation */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Compensation</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-primary-50 rounded-xl p-4 text-center">
                  <p className="text-xs text-primary-600 font-medium">Monthly Gross</p>
                  <p className="text-xl font-bold text-primary-700 mt-1">₹{Number(emp.salary || 0).toLocaleString('en-IN')}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-xs text-gray-500 font-medium">Annual CTC</p>
                  <p className="text-xl font-bold text-gray-800 mt-1">₹{(Number(emp.ctc || 0)/100000).toFixed(1)}L</p>
                </div>
              </div>
            </div>

            {/* Probation */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Probation / Confirmation</p>
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${onProbation?'bg-amber-100 text-amber-700':'bg-green-100 text-green-700'}`}>
                  {onProbation ? 'On Probation' : 'Confirmed'}
                </span>
              </div>
              <label className={labelCls}>{onProbation?'Probation End Date':'Confirmation Date'}</label>
              <div className="flex gap-2">
                <input type="date" value={probationEnd}
                  onChange={e => { setProbationEnd(e.target.value); setProbSaved(false); setProbError(''); }}
                  className={inputCls}/>
                <button onClick={async () => {
                  setSavingProb(true); setProbSaved(false); setProbError('');
                  try {
                    await api.updateEmployeeProbation(emp.id, probationEnd || null);
                    setProbSaved(true); setTimeout(() => setProbSaved(false), 2500);
                  } catch (e: any) { setProbError(e.message || 'Failed to save probation date'); }
                  finally { setSavingProb(false); }}
                } disabled={savingProb}
                  className="px-4 py-2 text-xs font-semibold text-white bg-primary-500 rounded-lg disabled:opacity-60 whitespace-nowrap">
                  {savingProb ? '…' : probSaved ? '✓ Saved' : 'Save'}
                </button>
              </div>
              {probError && <p className="text-xs text-red-500 mt-2">{probError}</p>}
            </div>

            {/* Leave balance */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Leave Balance Adjustment</p>
              {!balLoaded ? <p className="text-xs text-gray-400">Loading…</p> : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Full Day</label>
                      <input type="number" min="0" value={balAdj.full_day}
                        onChange={e => { setBalAdj(b => ({ ...b, full_day: Number(e.target.value) })); setBalSaved(false); setBalError(''); }}
                        className={inputCls}/>
                    </div>
                    <div>
                      <label className={labelCls}>Short Leave / Half Day credits</label>
                      <input type="number" min="0" value={balAdj.short_leave}
                        onChange={e => { setBalAdj(b => ({ ...b, short_leave: Number(e.target.value) })); setBalSaved(false); setBalError(''); }}
                        className={inputCls}/>
                    </div>
                  </div>
                  <button onClick={async () => {
                    setSavingBal(true); setBalSaved(false); setBalError('');
                    try {
                      await api.adjustLeaveBalance(emp.id, balAdj);
                      setBalSaved(true); setTimeout(() => setBalSaved(false), 2500);
                    } catch (e: any) { setBalError(e.message || 'Failed to save balance'); }
                    finally { setSavingBal(false); }}
                  } disabled={savingBal}
                    className="w-full py-2 text-xs font-semibold text-white bg-primary-500 rounded-lg disabled:opacity-60">
                    {savingBal ? 'Saving…' : balSaved ? '✓ Balance Updated' : 'Save Balance'}
                  </button>
                  {balError && <p className="text-xs text-red-500">{balError}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Attendance ─────────────────────────────────────────────────────── */}
      {tab === 'Attendance' && (
        <div className="space-y-5">
          <TabError t="Attendance"/>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-gray-700">Viewing:</p>
            <select value={attMonth} onChange={e => setAttMonth(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none">
              {MONTH_FULL.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
            <select value={attYear} onChange={e => setAttYear(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none">
              {[now.getFullYear()-1, now.getFullYear()].map(y => <option key={y}>{y}</option>)}
            </select>
            <button onClick={loadAttendance} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 ml-auto">
              <RefreshCw size={13}/> Refresh
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              {label:'Present',  count:presentCnt, color:'#16a34a', bg:'rgba(22,163,74,0.08)'},
              {label:'Late',     count:lateCnt,    color:'#d97706', bg:'rgba(217,119,6,0.08)'},
              {label:'Absent',   count:absentCnt,  color:'#dc2626', bg:'rgba(220,38,38,0.08)'},
              {label:'On Leave', count:leaveCnt,   color:'#7c3aed', bg:'rgba(124,58,237,0.08)'},
              {label:'WFH',      count:wfhCnt,     color:'#0d9488', bg:'rgba(13,148,136,0.08)'},
            ].map(({label,count,color,bg}) => (
              <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
                <p className="text-2xl font-black" style={{color}}>{count}</p>
                <p className="text-xs text-gray-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {attLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/>
              </div>
            ) : normAtt.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-12">No attendance records for {MONTH_FULL[attMonth-1]} {attYear}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{background:'#f8f9fc'}}>
                      {['Date','Day','Status','In → Out','Productive','Break','Source'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...normAtt].sort((a,b) => a.dateStr.localeCompare(b.dateStr)).map(r => {
                      // Break = presence window − productive session hours
                      const parseHHMM = (t: any) => { if (!t) return null; const s = String(t); const [h,m] = s.split(':').map(Number); return h*60+m; };
                      const inMin  = parseHHMM(r.check_in);
                      const outMin = parseHHMM(r.check_out);
                      const spanMin = (inMin !== null && outMin !== null && outMin > inMin) ? outMin - inMin : null;
                      const prodMin = Number(r.total_hours || 0) * 60;
                      const breakMin = (spanMin !== null && prodMin > 0 && spanMin > prodMin) ? Math.round(spanMin - prodMin) : 0;
                      const fmtBreakMin = (m: number) => m >= 60 ? `${Math.floor(m/60)}h${m%60>0?' '+(m%60)+'m':''}` : `${m}m`;
                      return (
                      <tr key={r.id ?? r.dateStr} className="border-t border-gray-50 hover:bg-gray-50/40">
                        <td className="px-4 py-3 font-medium text-gray-800">{fmtDate(r.date,{day:'numeric',month:'short'})}</td>
                        <td className="px-4 py-3 text-gray-500">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(r.dateStr+'T12:00:00Z').getUTCDay()]}</td>
                        <td className="px-4 py-3">{statusBadge(r.status)}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {r.check_in ? `${fmtTime(r.check_in)} → ${fmtTime(r.check_out)}` : '—'}
                        </td>
                        <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{color:'#15803d'}}>
                          {r.check_in ? fmtHours(r.total_hours) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {breakMin >= 1 ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{background:'#fffbeb',color:'#b45309'}}>
                              {fmtBreakMin(breakMin)}
                            </span>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {(r.source === 'wfh_extension' || Number(r.extension_hours) > 0) ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
                                style={{ background: 'rgba(238,39,112,0.08)', color: '#EE2770', borderColor: 'rgba(238,39,112,0.25)' }}>
                                💻 Extension
                              </span>
                              {r.activity_score != null && (() => {
                                const score = Number(r.activity_score);
                                const color = score >= 70 ? '#15803d' : score >= 40 ? '#d97706' : '#dc2626';
                                const label = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
                                return (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
                                    style={{ background: color + '15', color, borderColor: color + '40' }}>
                                    {label} {score}% active
                                  </span>
                                );
                              })()}
                            </div>
                          ) : r.source === 'biometric' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
                              style={{ background: 'rgba(22,163,74,0.08)', color: '#15803d', borderColor: 'rgba(22,163,74,0.25)' }}>
                              🔵 Biometric
                            </span>
                          ) : r.check_in ? (
                            <span className="text-[10px] text-gray-400">Manual</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Leave ──────────────────────────────────────────────────────────── */}
      {tab === 'Leave' && (
        <div className="space-y-5">
          <TabError t="Leave"/>
          {leaveBalance && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                {label:'Full Day',         value:leaveBalance.full_day??0,    color:'#2563eb', bg:'rgba(37,99,235,0.08)'},
                {label:'Short / Half Day', value:leaveBalance.short_leave??0, color:'#7c3aed', bg:'rgba(124,58,237,0.08)'},
              ].map(({label,value,color,bg}) => (
                <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <p className="text-2xl font-black" style={{color}}>{value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{label} remaining</p>
                  <div className="h-1 rounded-full mt-2" style={{background:bg}}>
                    <div className="h-1 rounded-full" style={{background:color,width:`${Math.min(100,Number(value)*10)}%`}}/>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
              <p className="font-semibold text-sm text-gray-800">Leave Requests</p>
              <button onClick={() => refreshTab('Leave')} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                <RefreshCw size={12}/> Refresh
              </button>
            </div>
            {leaveLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/>
              </div>
            ) : leaves.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-12">No leave requests</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{background:'#f8f9fc'}}>
                      {['Type','From','To','Days','Reason','Applied','Status'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...leaves].sort((a,b) => new Date(b.applied_on??b.created_at??0).getTime() - new Date(a.applied_on??a.created_at??0).getTime()).map(l => {
                      const colors: Record<string,string> = {
                        pending:'bg-amber-50 text-amber-600 border-amber-200',
                        approved:'bg-green-50 text-green-600 border-green-200',
                        rejected:'bg-red-50 text-red-500 border-red-200',
                        cancelled:'bg-gray-100 text-gray-500 border-gray-200',
                      };
                      return (
                        <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                          <td className="px-4 py-3 font-medium text-gray-800 capitalize whitespace-nowrap">{(l.type??'').replace(/_/g,' ')}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(l.from_date,{day:'numeric',month:'short'})}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(l.to_date,{day:'numeric',month:'short'})}</td>
                          <td className="px-4 py-3 text-gray-600">{l.days}</td>
                          <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate">{l.reason}</td>
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(l.applied_on??l.created_at)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium capitalize ${colors[l.status]??'bg-gray-50 text-gray-500 border-gray-200'}`}>
                              {l.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Performance ────────────────────────────────────────────────────── */}
      {tab === 'Performance' && (
        <div className="space-y-5">
          <TabError t="Performance"/>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-gray-700">Year:</p>
            <select value={perfYear} onChange={e => setPerfYear(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none">
              {[now.getFullYear()-1, now.getFullYear()].map(y => <option key={y}>{y}</option>)}
            </select>
            <button onClick={() => refreshTab('Performance')} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 ml-auto">
              <RefreshCw size={13}/> Refresh
            </button>
          </div>

          {perfLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/>
            </div>
          ) : perf.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
              <Star size={36} className="text-gray-200 mx-auto mb-3"/>
              <p className="text-sm text-gray-400">No performance reviews for {perfYear} yet</p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="font-semibold text-sm text-gray-800 mb-1">Overall Score — {perfYear}</p>
                <p className="text-xs text-gray-400 mb-4">Monthly performance rating (out of 100)</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} barSize={24}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false}/>
                    <XAxis dataKey="month" tick={{fontSize:11,fill:'#9ca3af'}} axisLine={false} tickLine={false}/>
                    <YAxis domain={[0,100]} tick={{fontSize:11,fill:'#9ca3af'}} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{borderRadius:8,border:'none',boxShadow:'0 4px 20px rgba(0,0,0,0.1)'}} formatter={(v:any)=>[`${v}`,'Score']}/>
                    <Bar dataKey="score" radius={[4,4,0,0]} name="Score">
                      {chartData.map((d,i) => <Cell key={i} fill={d.score ? perfColor(d.score) : '#e5e7eb'}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{background:'#f8f9fc'}}>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Month</th>
                        {PERF_LABELS.map(l => <th key={l} className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{l}</th>)}
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Overall</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perf.map(r => (
                        <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                          <td className="px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">{MONTH_SHORT[(r.month??1)-1]} {r.year}</td>
                          {PERF_KEYS.map(k => <td key={k} className="px-3 py-3 text-gray-600">{r[k]??'—'}</td>)}
                          <td className="px-4 py-3">
                            <span className="text-sm font-bold" style={{color:perfColor(Number(r.overall_score))}}>{Number(r.overall_score).toFixed(0)}</span>
                            <span className="text-xs text-gray-400">/100</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Incentives ─────────────────────────────────────────────────────── */}
      {tab === 'Incentives' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className="font-semibold text-sm text-gray-800">Upsell Incentive Requests</p>
            <button onClick={() => refreshTab('Incentives')} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
              <RefreshCw size={12}/> Refresh
            </button>
          </div>
          <TabError t="Incentives"/>
          {incLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/>
            </div>
          ) : incentives.length === 0 ? (
            <div className="text-center py-12">
              <TrendingUp size={32} className="text-gray-200 mx-auto mb-2"/>
              <p className="text-sm text-gray-400">No incentive requests from this employee</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{background:'#f8f9fc'}}>
                    {['Client','Service','Deal Value','Incentive','Date','Status','Action'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {incentives.map(r => {
                    const cfg: Record<string,{bg:string;color:string}> = {
                      pending:{bg:'#fffbeb',color:'#d97706'}, approved:{bg:'#f0fdf4',color:'#15803d'},
                      rejected:{bg:'#fef2f2',color:'#dc2626'}, paid:{bg:'#f5f3ff',color:'#7c3aed'},
                    };
                    const c = cfg[r.status]??cfg.pending;
                    return (
                      <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                        <td className="px-4 py-3 font-medium text-gray-800">{r.client_name}</td>
                        <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate">{r.service_description}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtAmt(r.deal_value)}</td>
                        <td className="px-4 py-3 font-semibold" style={{color:r.approved_amount?'#15803d':'#9ca3af'}}>{fmtAmt(r.approved_amount)}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2.5 py-1 rounded-full font-semibold capitalize" style={{background:c.bg,color:c.color}}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            {r.status==='pending'&&<>
                              <button onClick={()=>setIncAction({row:r,type:'approve'})} className="text-xs px-2 py-1 rounded-lg font-semibold text-white" style={{background:'#15803d'}}>Approve</button>
                              <button onClick={()=>setIncAction({row:r,type:'reject'})} className="text-xs px-2 py-1 rounded-lg font-semibold bg-red-50 text-red-600">Reject</button>
                            </>}
                            {r.status==='approved'&&<button onClick={()=>setIncAction({row:r,type:'pay'})} className="text-xs px-2 py-1 rounded-lg font-semibold text-white" style={{background:'#7c3aed'}}>Mark Paid</button>}
                            {(r.status==='rejected'||r.status==='paid')&&<span className="text-xs text-gray-300 italic">Closed</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Expenses ───────────────────────────────────────────────────────── */}
      {tab === 'Expenses' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className="font-semibold text-sm text-gray-800">Expense Claims</p>
            <button onClick={() => refreshTab('Expenses')} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
              <RefreshCw size={12}/> Refresh
            </button>
          </div>
          <TabError t="Expenses"/>
          {expLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/>
            </div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-12">
              <FileText size={32} className="text-gray-200 mx-auto mb-2"/>
              <p className="text-sm text-gray-400">No expense claims from this employee</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{background:'#f8f9fc'}}>
                    {['Category','Description','Claimed','Approved','Expense Date','Submitted','Status','Action'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(r => {
                    const cfg: Record<string,{bg:string;color:string}> = {
                      pending:{bg:'#fffbeb',color:'#d97706'}, approved:{bg:'#f0fdf4',color:'#15803d'},
                      rejected:{bg:'#fef2f2',color:'#dc2626'}, paid:{bg:'#f5f3ff',color:'#7c3aed'},
                    };
                    const c = cfg[r.status]??cfg.pending;
                    return (
                      <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                        <td className="px-4 py-3 font-medium text-gray-800">{r.category}</td>
                        <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate">{r.description}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtAmt(r.amount)}</td>
                        <td className="px-4 py-3 font-semibold" style={{color:r.approved_amount?'#15803d':'#9ca3af'}}>{fmtAmt(r.approved_amount)}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(r.expense_date)}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2.5 py-1 rounded-full font-semibold capitalize" style={{background:c.bg,color:c.color}}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            {r.status==='pending'&&<>
                              <button onClick={()=>setExpAction({row:r,type:'approve'})} className="text-xs px-2 py-1 rounded-lg font-semibold text-white" style={{background:'#15803d'}}>Approve</button>
                              <button onClick={()=>setExpAction({row:r,type:'reject'})} className="text-xs px-2 py-1 rounded-lg font-semibold bg-red-50 text-red-600">Reject</button>
                            </>}
                            {r.status==='approved'&&<button onClick={()=>setExpAction({row:r,type:'pay'})} className="text-xs px-2 py-1 rounded-lg font-semibold text-white" style={{background:'#7c3aed'}}>Mark Paid</button>}
                            {(r.status==='rejected'||r.status==='paid')&&<span className="text-xs text-gray-300 italic">Closed</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Warnings ───────────────────────────────────────────────────────── */}
      {tab === 'Warnings' && (
        <div className="space-y-5">
          <TabError t="Warnings"/>
          {pip && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-3">
              <Shield size={18} className="text-red-500 mt-0.5 flex-shrink-0"/>
              <div className="flex-1">
                <p className="font-bold text-red-700 text-sm">On Performance Improvement Plan (PIP)</p>
                <p className="text-xs text-red-600 mt-1">{fmtDate(pip.start_date)} → {fmtDate(pip.end_date)}</p>
                {pip.goals && <p className="text-xs text-red-500 mt-1 italic">"{pip.goals}"</p>}
              </div>
              <select value={pip.status} disabled={pipUpdating}
                onChange={e => handlePipUpdate(e.target.value)}
                className="text-xs border border-red-200 rounded-lg px-2 py-1.5 bg-white text-red-600 focus:outline-none disabled:opacity-60">
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm text-gray-800">Warnings</p>
                {warnings.length > 0 && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${warnings.length>=3?'bg-red-100 text-red-700':warnings.length===2?'bg-orange-100 text-orange-700':'bg-amber-100 text-amber-700'}`}>
                    {warnings.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => refreshTab('Warnings')} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                  <RefreshCw size={12}/>
                </button>
                <button onClick={() => { setShowWarnForm(v => !v); setWarnError(''); }}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100">
                  <AlertTriangle size={11}/> Issue Warning
                  {showWarnForm ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
                </button>
              </div>
            </div>

            {showWarnForm && (
              <div className="mb-4 p-4 bg-amber-50 border border-amber-100 rounded-xl space-y-3">
                <div className="flex gap-2">
                  {(['warning','serious','final'] as const).map(s => (
                    <button key={s} onClick={() => setWarnSeverity(s)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border capitalize transition-all ${warnSeverity===s
                        ? s==='final'?'bg-red-500 text-white border-red-500':s==='serious'?'bg-orange-500 text-white border-orange-500':'bg-amber-500 text-white border-amber-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>{s}</button>
                  ))}
                </div>
                <textarea value={warnReason} onChange={e => { setWarnReason(e.target.value); setWarnError(''); }} rows={2}
                  placeholder="Reason for this warning…"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none"/>
                {warnError && <p className="text-xs text-red-500 font-medium">{warnError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setShowWarnForm(false); setWarnError(''); setWarnReason(''); }}
                    className="flex-1 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-white">Cancel</button>
                  <button onClick={handleIssueWarning} disabled={issuingWarn || !warnReason.trim()}
                    className="flex-1 py-1.5 text-white rounded-lg text-xs font-semibold disabled:opacity-50" style={{background:'#d97706'}}>
                    {issuingWarn ? 'Issuing…' : 'Issue Warning'}
                  </button>
                </div>
              </div>
            )}

            {warnLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/>
              </div>
            ) : warnings.length === 0 ? (
              <p className="text-xs text-gray-400">No warnings on record.</p>
            ) : (
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <div key={w.id} className={`flex items-start gap-3 p-3 rounded-xl border ${w.severity==='final'?'border-red-200 bg-red-50':w.severity==='serious'?'border-orange-200 bg-orange-50':'border-amber-100 bg-amber-50'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${w.severity==='final'?'bg-red-500 text-white':w.severity==='serious'?'bg-orange-500 text-white':'bg-amber-400 text-white'}`}>{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${w.severity==='final'?'bg-red-100 text-red-700':w.severity==='serious'?'bg-orange-100 text-orange-700':'bg-amber-100 text-amber-700'}`}>{w.severity}</span>
                      <p className="text-xs text-gray-700 mt-1 leading-snug">{w.reason}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{w.issued_by?`By ${w.issued_by} · `:''}{fmtDate(w.created_at)}</p>
                    </div>
                    <button onClick={() => handleDeleteWarning(w.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {warnings.length === 2 && !pip && (
              <p className="text-xs text-orange-600 font-semibold mt-3 flex items-center gap-1">
                <AlertTriangle size={11}/> 1 more warning will trigger a PIP automatically.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showEdit && (
        <EditEmployeeModal
          emp={emp} allEmployees={allEmps} departments={departments} designations={designations}
          onClose={() => setShowEdit(false)}
          onSaved={updated => { setEmp(updated); setShowEdit(false); }}
        />
      )}

      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-500"/>
            </div>
            <h3 className="font-semibold text-gray-900 mb-1">Delete {emp.name}?</h3>
            <p className="text-sm text-gray-500 mb-6">This permanently removes the employee record, all attendance, leaves, and payroll data. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDelete(false)} disabled={deleting}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {incAction && (
        <ActionModal
          title={incAction.type==='approve'?'Approve Incentive':incAction.type==='pay'?'Mark Incentive Paid':'Reject Incentive'}
          info={`${incAction.row.client_name} — ${incAction.row.service_description}${incAction.row.deal_value?` (Deal: ${fmtAmt(incAction.row.deal_value)})`:''}`}
          type={incAction.type} isIncentive={true}
          onClose={() => setIncAction(null)}
          onConfirm={async d => {
            const updated = await api.reviewUpsell(incAction.row.id, { ...d, reviewed_by: me?.name });
            setIncentives(prev => prev.map(r => r.id===updated.id ? updated : r));
            setIncAction(null);
          }}
        />
      )}

      {expAction && (
        <ActionModal
          title={expAction.type==='approve'?'Approve Expense':expAction.type==='pay'?'Mark Expense Paid':'Reject Expense'}
          info={`${expAction.row.category} — ${expAction.row.description} (${fmtAmt(expAction.row.amount)})`}
          type={expAction.type} isIncentive={false}
          onClose={() => setExpAction(null)}
          onConfirm={async d => {
            const updated = await api.reviewExpense(expAction.row.id, { ...d, reviewed_by: me?.name });
            setExpenses(prev => prev.map(r => r.id===updated.id ? updated : r));
            setExpAction(null);
          }}
        />
      )}
    </div>
  );
}
