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
  present:'bg-success', late:'bg-warning', absent:'bg-danger',
  on_leave:'bg-violet-400', wfh:'bg-blue-400', wfh_half:'bg-pink-400',
  holiday:'bg-purple-400', weekend:'bg-on-surface-subtle', short_leave:'bg-orange-400',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-sm font-bold tracking-tight text-on-surface">{title}</h3>
          <button onClick={onClose}><X size={15} className="text-on-surface-subtle"/></button>
        </div>
        <p className="text-xs text-on-surface-muted mb-4 bg-surface-2 rounded-lg px-3 py-2">{info}</p>
        {type === 'approve' && (
          <div className="mb-3">
            <label className="text-xs font-semibold text-on-surface-muted block mb-1">
              {isIncentive ? 'Incentive Amount (₹) *' : 'Approved Amount (₹)'}
            </label>
            <input type="number" min="1" value={amt} onChange={e=>setAmt(e.target.value)}
              placeholder="Enter amount"
              className="w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
          </div>
        )}
        {type === 'reject' && (
          <div className="mb-3">
            <label className="text-xs font-semibold text-on-surface-muted block mb-1">Reason (optional)</label>
            <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2}
              placeholder="Reason for rejection…"
              className="w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
          </div>
        )}
        {type === 'pay' && (
          <div className="mb-3">
            <label className="text-xs font-semibold text-on-surface-muted block mb-1">Payment Note (optional)</label>
            <input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Paid via May payroll"
              className="w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
          </div>
        )}
        {err && <p className="text-xs text-danger font-medium bg-danger-container border border-danger/20 rounded-lg px-3 py-2 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-outline rounded-xl text-sm font-medium text-on-surface-muted hover:bg-surface-2 transition-colors">Cancel</button>
          <button onClick={handle} disabled={saving}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-60 transition-all shadow-elev-1 hover:opacity-90 ${
              type==='reject' ? 'bg-danger text-white'
              : type==='pay' ? 'bg-accent text-on-accent'
              : 'bg-success text-white'
            }`}>
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
  const [hoursYTD, setHoursYTD] = useState<{ approved: number; within: number; over: number; overCount: number } | null>(null);

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
    // YTD hours overage — compute from approved logs joined with assignment alloc
    api.getHourLogs({ employee_id: emp.id, year: perfYear })
      .then((logs: any[]) => {
        let approved = 0, within = 0, over = 0, overCount = 0;
        for (const l of logs) {
          if (l.status !== 'approved') continue;
          const h = Number(l.hours_logged) || 0;
          const w = Number(l[`w${l.week_num}_hours`] ?? 0);
          const o = Math.max(0, h - w);
          approved += h;
          within  += Math.min(h, w);
          over    += o;
          if (o > 0) overCount += 1;
        }
        setHoursYTD({ approved, within, over, overCount });
      })
      .catch(() => setHoursYTD(null));
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
      <div className="w-8 h-8 border-4 border-outline border-t-accent rounded-full animate-spin"/>
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

  const inputCls = 'w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
  const labelCls = 'block text-xs font-medium text-on-surface-muted mb-1';

  const statusBadge = (status: string) => (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-muted">
      <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status] ?? 'bg-on-surface-subtle'}`}/>
      {STATUS_LABEL[status] ?? status}
    </span>
  );

  const TabError = ({ t }: { t: Tab }) => tabError[t] ? (
    <div className="flex items-center justify-between px-4 py-3 bg-danger-container border border-danger/20 rounded-xl-2 text-xs text-danger font-medium">
      {tabError[t]}
      <button onClick={() => refreshTab(t)} className="flex items-center gap-1 underline underline-offset-2">
        <RefreshCw size={11}/> Retry
      </button>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <button onClick={() => navigate('/employees')}
          className="flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-on-surface mb-4 transition-colors">
          <ArrowLeft size={15}/> Back to Employees
        </button>

        <section className="relative aurora-bg grain-overlay rounded-xl-3 overflow-hidden text-white animate-fade-in">
          <div className="absolute top-4 right-4 z-10 flex gap-2">
            <button onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/15 hover:bg-white/25 border border-white/15 backdrop-blur-sm rounded-lg text-white text-xs font-semibold transition-colors">
              <Pencil size={12}/> Edit
            </button>
            <button onClick={() => setShowDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-danger/70 hover:bg-danger/90 rounded-lg text-white text-xs font-semibold transition-colors">
              <Trash2 size={12}/> Delete
            </button>
          </div>

          <div className="relative px-6 sm:px-8 pt-8 pb-6">
            <div className="flex items-start gap-5">
              <div className="w-20 h-20 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center text-2xl font-bold shadow-elev-2 flex-shrink-0">
                {emp.avatar}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-white/70 uppercase tracking-[0.22em]">{emp.employee_id}</p>
                <h1 className="font-display text-3xl sm:text-4xl font-semibold leading-[1.05] tracking-tight mt-1.5">{emp.name}</h1>
                <p className="text-sm text-white/80 font-medium mt-2">{emp.designation}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-5">
              {[
                { icon: MapPin,   text: emp.department },
                { icon: Calendar, text: `Joined ${fmtDate(emp.join_date, {day:'numeric',month:'short',year:'numeric'})}` },
                { icon: Clock,    text: emp.shift === 'night' ? 'Night Shift' : 'Day Shift' },
              ].map(({ icon: Icon, text }) => (
                <span key={text} className="inline-flex items-center gap-1.5 text-xs text-white/85 bg-white/10 border border-white/15 backdrop-blur-sm rounded-full px-3 py-1">
                  <Icon size={11} className="text-white/65"/>{text}
                </span>
              ))}
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 backdrop-blur-sm ${emp.status === 'active' ? 'bg-success/25 text-white border border-success/40' : 'bg-danger/25 text-white border border-danger/40'}`}>
                {emp.status === 'active' ? '● Active' : '● Inactive'}
              </span>
              {onProbation && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1 bg-warning/25 text-white border border-warning/40 backdrop-blur-sm">
                  ⏳ On Probation
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Tab nav (pill style) */}
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 mt-4 px-3 overflow-x-auto">
          <div className="flex gap-1 py-2">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-semibold rounded-full whitespace-nowrap transition-all ${tab===t
                  ? 'bg-accent text-on-accent shadow-elev-1'
                  : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-2'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Overview ───────────────────────────────────────────────────────── */}
      {tab === 'Overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Personal info */}
          <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-6 overflow-hidden animate-fade-up stagger-1">
            <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50" />
            <div className="relative">
              <h3 className="font-display text-xl font-bold tracking-tight text-on-surface mb-4">Personal Information</h3>
              <div className="space-y-4">
                {[
                  { icon: Mail,  label: 'Email',    value: emp.email },
                  { icon: Phone, label: 'Phone',    value: emp.phone || '—' },
                  { icon: MapPin,label: 'Location', value: emp.location || '—' },
                  { icon: User,  label: 'Reporting Manager', value: emp.manager || '—' },
                  { icon: Clock, label: 'Shift', value: emp.shift === 'night' ? '🌙 Night Shift (6:30 PM – 3:30 AM)' : '☀️ Day Shift (9:00 AM – 6:00 PM)' },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-surface-2 border border-outline flex items-center justify-center flex-shrink-0">
                      <Icon size={14} className="text-on-surface-subtle"/>
                    </div>
                    <div>
                      <p className="text-xs text-on-surface-subtle">{label}</p>
                      <p className="text-sm font-medium text-on-surface mt-0.5">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {/* Compensation */}
            <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-6 overflow-hidden animate-fade-up stagger-2">
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-accent/15 blur-2xl opacity-50" />
              <div className="relative">
                <h3 className="font-display text-xl font-bold tracking-tight text-on-surface mb-4">Compensation</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-brand-container rounded-xl-2 p-4 text-center">
                    <p className="text-xs text-on-brand-container font-medium">Monthly Gross</p>
                    <p className="num-mono text-xl font-bold text-on-brand-container mt-1">₹{Number(emp.salary || 0).toLocaleString('en-IN')}</p>
                  </div>
                  <div className="bg-surface-2 border border-outline rounded-xl-2 p-4 text-center">
                    <p className="text-xs text-on-surface-muted font-medium">Annual CTC</p>
                    <p className="num-mono text-xl font-bold text-on-surface mt-1">₹{(Number(emp.ctc || 0)/100000).toFixed(1)}L</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Probation */}
            <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-6 overflow-hidden animate-fade-up stagger-3">
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-warning/15 blur-2xl opacity-50" />
              <div className="relative">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Probation / Confirmation</h3>
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${onProbation?'bg-warning-container text-warning':'bg-success-container text-success'}`}>
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
                    className="px-4 py-2 text-xs font-semibold bg-accent text-on-accent rounded-lg shadow-elev-1 hover:opacity-90 disabled:opacity-60 whitespace-nowrap transition-all">
                    {savingProb ? '…' : probSaved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
                {probError && <p className="text-xs text-danger mt-2">{probError}</p>}
              </div>
            </div>

            {/* Leave balance */}
            <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-6 overflow-hidden animate-fade-up stagger-4">
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50" />
              <div className="relative">
                <h3 className="font-display text-xl font-bold tracking-tight text-on-surface mb-4">Leave Balance Adjustment</h3>
                {!balLoaded ? <p className="text-xs text-on-surface-subtle">Loading…</p> : (
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
                      className="w-full py-2 text-xs font-semibold bg-accent text-on-accent rounded-lg shadow-elev-1 hover:opacity-90 disabled:opacity-60 transition-all">
                      {savingBal ? 'Saving…' : balSaved ? '✓ Balance Updated' : 'Save Balance'}
                    </button>
                    {balError && <p className="text-xs text-danger">{balError}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Attendance ─────────────────────────────────────────────────────── */}
      {tab === 'Attendance' && (
        <div className="space-y-5">
          <TabError t="Attendance"/>
          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-4 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-on-surface-muted">Viewing:</p>
            <select value={attMonth} onChange={e => setAttMonth(Number(e.target.value))}
              className="text-sm bg-surface border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20">
              {MONTH_FULL.map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
            <select value={attYear} onChange={e => setAttYear(Number(e.target.value))}
              className="text-sm bg-surface border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20">
              {[now.getFullYear()-1, now.getFullYear()].map(y => <option key={y}>{y}</option>)}
            </select>
            <button onClick={loadAttendance} className="flex items-center gap-1.5 text-xs font-medium text-on-surface-muted hover:text-on-surface ml-auto transition-colors">
              <RefreshCw size={13}/> Refresh
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              {label:'Present',  count:presentCnt, color:'#16a34a', stagger:'stagger-1'},
              {label:'Late',     count:lateCnt,    color:'#d97706', stagger:'stagger-2'},
              {label:'Absent',   count:absentCnt,  color:'#dc2626', stagger:'stagger-3'},
              {label:'On Leave', count:leaveCnt,   color:'#7c3aed', stagger:'stagger-4'},
              {label:'WFH',      count:wfhCnt,     color:'#0d9488', stagger:'stagger-5'},
            ].map(({label,count,color,stagger}) => (
              <div key={label} className={`group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-4 text-center overflow-hidden animate-fade-up ${stagger}`}>
                <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50" />
                <div className="relative">
                  <p className="num-mono text-2xl font-black" style={{color}}>{count}</p>
                  <p className="text-xs text-on-surface-subtle mt-0.5">{label}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
            {attLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-4 border-outline border-t-accent rounded-full animate-spin"/>
              </div>
            ) : normAtt.length === 0 ? (
              <p className="text-center text-sm text-on-surface-subtle py-12">No attendance records for {MONTH_FULL[attMonth-1]} {attYear}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2">
                      {['Date','Day','Status','In → Out','Productive','Break','Source'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide whitespace-nowrap">{h}</th>
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
                      <tr key={r.id ?? r.dateStr} className="border-t border-outline hover:bg-surface-2/60 transition-colors">
                        <td className="px-4 py-3 font-medium text-on-surface">{fmtDate(r.date,{day:'numeric',month:'short'})}</td>
                        <td className="px-4 py-3 text-on-surface-muted">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(r.dateStr+'T12:00:00Z').getUTCDay()]}</td>
                        <td className="px-4 py-3">{statusBadge(r.status)}</td>
                        <td className="px-4 py-3 text-on-surface-muted whitespace-nowrap num-mono">
                          {r.check_in ? `${fmtTime(r.check_in)} → ${fmtTime(r.check_out)}` : '—'}
                        </td>
                        <td className="px-4 py-3 font-semibold text-success whitespace-nowrap num-mono">
                          {r.check_in ? fmtHours(r.total_hours) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {breakMin >= 1 ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warning-container text-warning">
                              {fmtBreakMin(breakMin)}
                            </span>
                          ) : <span className="text-xs text-on-surface-subtle">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {(r.source === 'wfh_extension' || Number(r.extension_hours) > 0) ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-accent/25 bg-accent/10 text-accent">
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
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-success/25 bg-success-container text-success">
                              🔵 Biometric
                            </span>
                          ) : r.check_in ? (
                            <span className="text-[10px] text-on-surface-subtle">Manual</span>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Full day card with breakdown */}
              <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-4 overflow-hidden animate-fade-up stagger-1">
                <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50" />
                <div className="relative">
                  <p className="num-mono text-2xl font-black text-on-brand-container">{leaveBalance.full_day ?? 0}</p>
                  <p className="text-xs text-on-surface-subtle mt-0.5">Full Day remaining</p>
                  <div className="h-1 rounded-full mt-2 bg-brand/10">
                    <div className="h-1 rounded-full bg-brand" style={{width:`${Math.min(100,Number(leaveBalance.full_day??0)*10)}%`}}/>
                  </div>
                  {(Number(leaveBalance.prev_month_carry_full_day) > 0 || Number(leaveBalance.current_month_credit_full_day) > 0) && (
                    <div className="mt-2 pt-2 border-t border-outline space-y-0.5">
                      {Number(leaveBalance.current_month_credit_full_day) > 0 && (
                        <p className="text-[11px] text-on-brand-container font-medium">+{leaveBalance.current_month_credit_full_day} credited in {leaveBalance.current_month_label?.split(' ')[0] ?? 'this month'}</p>
                      )}
                      {Number(leaveBalance.prev_month_carry_full_day) > 0 && (
                        <p className="text-[11px] text-on-surface-muted">+{leaveBalance.prev_month_carry_full_day} carried from {leaveBalance.prev_month_label?.split(' ')[0] ?? 'last month'}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {/* Short leave card */}
              <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-4 overflow-hidden animate-fade-up stagger-2">
                <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-accent/15 blur-2xl opacity-50" />
                <div className="relative">
                  <p className="num-mono text-2xl font-black" style={{color:'#7c3aed'}}>{leaveBalance.short_leave ?? 0}</p>
                  <p className="text-xs text-on-surface-subtle mt-0.5">Short / Half Day remaining</p>
                  <div className="h-1 rounded-full mt-2" style={{background:'rgba(124,58,237,0.10)'}}>
                    <div className="h-1 rounded-full" style={{background:'#7c3aed',width:`${Math.min(100,Number(leaveBalance.short_leave??0)*50)}%`}}/>
                  </div>
                  <p className="text-[11px] text-on-surface-muted mt-2 pt-2 border-t border-outline">Resets to 2 every month</p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
            <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
              <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Leave Requests</h3>
              <button onClick={() => refreshTab('Leave')} className="flex items-center gap-1 text-xs text-on-surface-subtle hover:text-on-surface-muted transition-colors">
                <RefreshCw size={12}/> Refresh
              </button>
            </div>
            {leaveLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-4 border-outline border-t-accent rounded-full animate-spin"/>
              </div>
            ) : leaves.length === 0 ? (
              <p className="text-center text-sm text-on-surface-subtle py-12">No leave requests</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2">
                      {['Type','From','To','Days','Reason','Applied','Status'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...leaves].sort((a,b) => new Date(b.applied_on??b.created_at??0).getTime() - new Date(a.applied_on??a.created_at??0).getTime()).map(l => {
                      const colors: Record<string,string> = {
                        pending:'bg-warning-container text-warning border-warning/25',
                        approved:'bg-success-container text-success border-success/25',
                        rejected:'bg-danger-container text-danger border-danger/25',
                        cancelled:'bg-surface-2 text-on-surface-muted border-outline',
                      };
                      return (
                        <tr key={l.id} className="border-t border-outline hover:bg-surface-2/60 transition-colors">
                          <td className="px-4 py-3 font-medium text-on-surface capitalize whitespace-nowrap">{(l.type??'').replace(/_/g,' ')}</td>
                          <td className="px-4 py-3 text-on-surface-muted whitespace-nowrap">{fmtDate(l.from_date,{day:'numeric',month:'short'})}</td>
                          <td className="px-4 py-3 text-on-surface-muted whitespace-nowrap">{fmtDate(l.to_date,{day:'numeric',month:'short'})}</td>
                          <td className="px-4 py-3 text-on-surface-muted num-mono">{l.days}</td>
                          <td className="px-4 py-3 text-on-surface-muted max-w-[140px] truncate">{l.reason}</td>
                          <td className="px-4 py-3 text-xs text-on-surface-subtle font-mono whitespace-nowrap">{fmtDate(l.applied_on??l.created_at)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium capitalize ${colors[l.status]??'bg-surface-2 text-on-surface-muted border-outline'}`}>
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
          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-4 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-on-surface-muted">Year:</p>
            <select value={perfYear} onChange={e => setPerfYear(Number(e.target.value))}
              className="text-sm bg-surface border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20">
              {[now.getFullYear()-1, now.getFullYear()].map(y => <option key={y}>{y}</option>)}
            </select>
            <button onClick={() => refreshTab('Performance')} className="flex items-center gap-1.5 text-xs font-medium text-on-surface-muted hover:text-on-surface ml-auto transition-colors">
              <RefreshCw size={13}/> Refresh
            </button>
          </div>

          {/* YTD project hours overage */}
          {hoursYTD && hoursYTD.approved > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-4 overflow-hidden animate-fade-up stagger-1">
                <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-brand/15 blur-2xl opacity-50" />
                <div className="relative">
                  <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Approved YTD</p>
                  <p className="num-mono text-2xl font-bold text-on-surface mt-1.5"><span>{Math.round(hoursYTD.approved)}</span><span className="text-base text-on-surface-muted ml-0.5">h</span></p>
                  <p className="text-[11px] text-on-surface-subtle mt-1">All approved project hours · {perfYear}</p>
                </div>
              </div>
              <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-4 overflow-hidden animate-fade-up stagger-2">
                <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-success/15 blur-2xl opacity-50" />
                <div className="relative">
                  <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Within plan</p>
                  <p className="num-mono text-2xl font-bold text-success mt-1.5"><span>{Math.round(hoursYTD.within)}</span><span className="text-base text-on-surface-muted ml-0.5">h</span></p>
                  <p className="text-[11px] text-on-surface-subtle mt-1">Hours that stayed within the coordinator's plan</p>
                </div>
              </div>
              <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-4 overflow-hidden animate-fade-up stagger-3">
                <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full ${hoursYTD.over > 0 ? 'bg-warning/25' : 'bg-surface-3'} blur-2xl opacity-60`} />
                <div className="relative">
                  <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Over plan</p>
                  <p className={`num-mono text-2xl font-bold mt-1.5 ${hoursYTD.over > 0 ? 'text-warning' : 'text-on-surface-subtle'}`}>
                    {hoursYTD.over > 0 ? '+' : ''}<span>{Math.round(hoursYTD.over)}</span><span className={`text-base ml-0.5 ${hoursYTD.over > 0 ? 'text-on-surface-muted' : 'text-on-surface-subtle'}`}>h</span>
                  </p>
                  <p className="text-[11px] text-on-surface-subtle mt-1">Approved hours logged beyond weekly allocation</p>
                </div>
              </div>
              <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-4 overflow-hidden animate-fade-up stagger-4">
                <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-accent/15 blur-2xl opacity-50" />
                <div className="relative">
                  <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Over-plan logs</p>
                  <p className="num-mono text-2xl font-bold text-on-surface mt-1.5">{hoursYTD.overCount}</p>
                  <p className="text-[11px] text-on-surface-subtle mt-1">Count of weeks that ran over plan</p>
                </div>
              </div>
            </div>
          )}

          {perfLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-outline border-t-accent rounded-full animate-spin"/>
            </div>
          ) : perf.length === 0 ? (
            <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-12 text-center">
              <Star size={36} className="text-on-surface-subtle mx-auto mb-3"/>
              <p className="text-sm text-on-surface-subtle">No performance reviews for {perfYear} yet</p>
            </div>
          ) : (
            <>
              <div className="group relative bg-surface rounded-xl-3 border border-outline shadow-elev-2 p-5 overflow-hidden animate-fade-up stagger-1">
                <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50" />
                <div className="relative">
                  <h3 className="font-display text-xl font-bold tracking-tight text-on-surface mb-1">Overall Score — <span className="num-mono">{perfYear}</span></h3>
                  <p className="text-xs text-on-surface-muted mb-4">Monthly performance rating (out of 100)</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={chartData} barSize={24}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false}/>
                      <XAxis dataKey="month" tick={{fontSize:11,fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
                      <YAxis domain={[0,100]} tick={{fontSize:11,fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
                      <Tooltip contentStyle={{borderRadius:12,border:'1px solid rgb(var(--outline))',background:'rgb(var(--surface-3))',color:'rgb(var(--on-surface))',boxShadow:'var(--elev-3)',fontSize:12}} formatter={(v:any)=>[`${v}`,'Score']}/>
                      <Bar dataKey="score" radius={[4,4,0,0]} name="Score">
                        {chartData.map((d,i) => <Cell key={i} fill={d.score ? perfColor(d.score) : 'rgb(var(--outline))'}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-2">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide whitespace-nowrap">Month</th>
                        {PERF_LABELS.map(l => <th key={l} className="text-left px-3 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide whitespace-nowrap">{l}</th>)}
                        <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Overall</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perf.map(r => (
                        <tr key={r.id} className="border-t border-outline hover:bg-surface-2/60 transition-colors">
                          <td className="px-4 py-3 font-semibold text-on-surface whitespace-nowrap">{MONTH_SHORT[(r.month??1)-1]} <span className="num-mono">{r.year}</span></td>
                          {PERF_KEYS.map(k => <td key={k} className="px-3 py-3 text-on-surface-muted num-mono">{r[k]??'—'}</td>)}
                          <td className="px-4 py-3">
                            <span className="num-mono text-sm font-bold" style={{color:perfColor(Number(r.overall_score))}}>{Number(r.overall_score).toFixed(0)}</span>
                            <span className="num-mono text-xs text-on-surface-subtle">/100</span>
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
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
          <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Upsell Incentive Requests</h3>
            <button onClick={() => refreshTab('Incentives')} className="flex items-center gap-1 text-xs text-on-surface-subtle hover:text-on-surface-muted transition-colors">
              <RefreshCw size={12}/> Refresh
            </button>
          </div>
          <TabError t="Incentives"/>
          {incLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-outline border-t-accent rounded-full animate-spin"/>
            </div>
          ) : incentives.length === 0 ? (
            <div className="text-center py-12">
              <TrendingUp size={32} className="text-on-surface-subtle mx-auto mb-2"/>
              <p className="text-sm text-on-surface-subtle">No incentive requests from this employee</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2">
                    {['Client','Service','Deal Value','Incentive','Date','Status','Action'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {incentives.map(r => {
                    const statusCls: Record<string,string> = {
                      pending: 'bg-warning-container text-warning',
                      approved: 'bg-success-container text-success',
                      rejected: 'bg-danger-container text-danger',
                      paid: 'bg-accent/15 text-accent',
                    };
                    return (
                      <tr key={r.id} className="border-t border-outline hover:bg-surface-2/60 transition-colors">
                        <td className="px-4 py-3 font-medium text-on-surface">{r.client_name}</td>
                        <td className="px-4 py-3 text-on-surface-muted max-w-[140px] truncate">{r.service_description}</td>
                        <td className="px-4 py-3 text-on-surface-muted num-mono">{fmtAmt(r.deal_value)}</td>
                        <td className={`px-4 py-3 font-semibold num-mono ${r.approved_amount ? 'text-success' : 'text-on-surface-subtle'}`}>{fmtAmt(r.approved_amount)}</td>
                        <td className="px-4 py-3 text-xs text-on-surface-subtle font-mono whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold capitalize ${statusCls[r.status] ?? statusCls.pending}`}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            {r.status==='pending'&&<>
                              <button onClick={()=>setIncAction({row:r,type:'approve'})} className="text-xs px-2 py-1 rounded-lg font-semibold bg-success text-white hover:opacity-90 shadow-elev-1 transition-all">Approve</button>
                              <button onClick={()=>setIncAction({row:r,type:'reject'})} className="text-xs px-2 py-1 rounded-lg font-semibold bg-danger-container text-danger hover:opacity-90 transition-all">Reject</button>
                            </>}
                            {r.status==='approved'&&<button onClick={()=>setIncAction({row:r,type:'pay'})} className="text-xs px-2 py-1 rounded-lg font-semibold bg-accent text-on-accent hover:opacity-90 shadow-elev-1 transition-all">Mark Paid</button>}
                            {(r.status==='rejected'||r.status==='paid')&&<span className="text-xs text-on-surface-subtle italic">Closed</span>}
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
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
          <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Expense Claims</h3>
            <button onClick={() => refreshTab('Expenses')} className="flex items-center gap-1 text-xs text-on-surface-subtle hover:text-on-surface-muted transition-colors">
              <RefreshCw size={12}/> Refresh
            </button>
          </div>
          <TabError t="Expenses"/>
          {expLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-outline border-t-accent rounded-full animate-spin"/>
            </div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-12">
              <FileText size={32} className="text-on-surface-subtle mx-auto mb-2"/>
              <p className="text-sm text-on-surface-subtle">No expense claims from this employee</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2">
                    {['Category','Description','Claimed','Approved','Expense Date','Submitted','Status','Action'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(r => {
                    const statusCls: Record<string,string> = {
                      pending: 'bg-warning-container text-warning',
                      approved: 'bg-success-container text-success',
                      rejected: 'bg-danger-container text-danger',
                      paid: 'bg-accent/15 text-accent',
                    };
                    return (
                      <tr key={r.id} className="border-t border-outline hover:bg-surface-2/60 transition-colors">
                        <td className="px-4 py-3 font-medium text-on-surface">{r.category}</td>
                        <td className="px-4 py-3 text-on-surface-muted max-w-[140px] truncate">{r.description}</td>
                        <td className="px-4 py-3 text-on-surface-muted num-mono">{fmtAmt(r.amount)}</td>
                        <td className={`px-4 py-3 font-semibold num-mono ${r.approved_amount ? 'text-success' : 'text-on-surface-subtle'}`}>{fmtAmt(r.approved_amount)}</td>
                        <td className="px-4 py-3 text-xs text-on-surface-subtle font-mono whitespace-nowrap">{fmtDate(r.expense_date)}</td>
                        <td className="px-4 py-3 text-xs text-on-surface-subtle font-mono whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold capitalize ${statusCls[r.status] ?? statusCls.pending}`}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            {r.status==='pending'&&<>
                              <button onClick={()=>setExpAction({row:r,type:'approve'})} className="text-xs px-2 py-1 rounded-lg font-semibold bg-success text-white hover:opacity-90 shadow-elev-1 transition-all">Approve</button>
                              <button onClick={()=>setExpAction({row:r,type:'reject'})} className="text-xs px-2 py-1 rounded-lg font-semibold bg-danger-container text-danger hover:opacity-90 transition-all">Reject</button>
                            </>}
                            {r.status==='approved'&&<button onClick={()=>setExpAction({row:r,type:'pay'})} className="text-xs px-2 py-1 rounded-lg font-semibold bg-accent text-on-accent hover:opacity-90 shadow-elev-1 transition-all">Mark Paid</button>}
                            {(r.status==='rejected'||r.status==='paid')&&<span className="text-xs text-on-surface-subtle italic">Closed</span>}
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
            <div className="bg-danger-container border border-danger/20 rounded-xl-2 p-5 flex items-start gap-3">
              <Shield size={18} className="text-danger mt-0.5 flex-shrink-0"/>
              <div className="flex-1">
                <p className="font-bold text-danger text-sm">On Performance Improvement Plan (PIP)</p>
                <p className="text-xs text-danger/85 mt-1 font-mono">{fmtDate(pip.start_date)} → {fmtDate(pip.end_date)}</p>
                {pip.goals && <p className="text-xs text-danger/75 mt-1 italic">"{pip.goals}"</p>}
              </div>
              <select value={pip.status} disabled={pipUpdating}
                onChange={e => handlePipUpdate(e.target.value)}
                className="text-xs bg-surface border border-danger/20 rounded-lg px-2 py-1.5 text-danger focus:outline-none focus:ring-2 focus:ring-danger/20 disabled:opacity-60">
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </div>
          )}

          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Warnings</h3>
                {warnings.length > 0 && (
                  <span className={`num-mono text-xs font-bold px-2 py-0.5 rounded-full ${warnings.length>=3?'bg-danger-container text-danger':warnings.length===2?'bg-warning-container text-warning':'bg-warning-container text-warning'}`}>
                    {warnings.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => refreshTab('Warnings')} className="flex items-center gap-1 text-xs text-on-surface-subtle hover:text-on-surface-muted transition-colors">
                  <RefreshCw size={12}/>
                </button>
                <button onClick={() => { setShowWarnForm(v => !v); setWarnError(''); }}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-warning/25 bg-warning-container text-warning hover:opacity-90 transition-all">
                  <AlertTriangle size={11}/> Issue Warning
                  {showWarnForm ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
                </button>
              </div>
            </div>

            {showWarnForm && (
              <div className="mb-4 p-4 bg-warning-container border border-warning/20 rounded-xl-2 space-y-3">
                <div className="flex gap-2">
                  {(['warning','serious','final'] as const).map(s => (
                    <button key={s} onClick={() => setWarnSeverity(s)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border capitalize transition-all ${warnSeverity===s
                        ? s==='final'?'bg-danger text-white border-danger':s==='serious'?'bg-orange-500 text-white border-orange-500':'bg-warning text-white border-warning'
                        : 'bg-surface text-on-surface-muted border-outline hover:border-outline-strong'}`}>{s}</button>
                  ))}
                </div>
                <textarea value={warnReason} onChange={e => { setWarnReason(e.target.value); setWarnError(''); }} rows={2}
                  placeholder="Reason for this warning…"
                  className="w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none"/>
                {warnError && <p className="text-xs text-danger font-medium">{warnError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setShowWarnForm(false); setWarnError(''); setWarnReason(''); }}
                    className="flex-1 py-1.5 border border-outline rounded-lg text-xs font-medium text-on-surface-muted hover:bg-surface transition-colors">Cancel</button>
                  <button onClick={handleIssueWarning} disabled={issuingWarn || !warnReason.trim()}
                    className="flex-1 py-1.5 bg-warning text-white rounded-lg text-xs font-semibold shadow-elev-1 hover:opacity-90 disabled:opacity-50 transition-all">
                    {issuingWarn ? 'Issuing…' : 'Issue Warning'}
                  </button>
                </div>
              </div>
            )}

            {warnLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-4 border-outline border-t-accent rounded-full animate-spin"/>
              </div>
            ) : warnings.length === 0 ? (
              <p className="text-xs text-on-surface-subtle">No warnings on record.</p>
            ) : (
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <div key={w.id} className={`flex items-start gap-3 p-4 rounded-xl-2 border ${w.severity==='final'?'border-danger/20 bg-danger-container':w.severity==='serious'?'border-orange-500/20 bg-orange-50 dark:bg-orange-950/30':'border-warning/20 bg-warning-container'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 num-mono ${w.severity==='final'?'bg-danger text-white':w.severity==='serious'?'bg-orange-500 text-white':'bg-warning text-white'}`}>{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${w.severity==='final'?'bg-danger/15 text-danger':w.severity==='serious'?'bg-orange-500/15 text-orange-700 dark:text-orange-300':'bg-warning/15 text-warning'}`}>{w.severity}</span>
                      <p className="text-xs text-on-surface mt-1 leading-snug">{w.reason}</p>
                      <p className="text-[10px] text-on-surface-subtle mt-0.5 font-mono">{w.issued_by?`By ${w.issued_by} · `:''}{fmtDate(w.created_at)}</p>
                    </div>
                    <button onClick={() => handleDeleteWarning(w.id)}
                      className="text-on-surface-subtle hover:text-danger transition-colors flex-shrink-0 mt-0.5">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {warnings.length === 2 && !pip && (
              <p className="text-xs text-warning font-semibold mt-3 flex items-center gap-1">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-danger-container flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-danger"/>
            </div>
            <h3 className="font-display text-base font-bold tracking-tight text-on-surface mb-1">Delete {emp.name}?</h3>
            <p className="text-sm text-on-surface-muted mb-6">This permanently removes the employee record, all attendance, leaves, and payroll data. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDelete(false)} disabled={deleting}
                className="flex-1 py-2.5 border border-outline rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2 disabled:opacity-60 transition-colors">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 py-2.5 bg-danger hover:opacity-90 text-white rounded-lg text-sm font-semibold shadow-elev-1 disabled:opacity-60 transition-all">
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
