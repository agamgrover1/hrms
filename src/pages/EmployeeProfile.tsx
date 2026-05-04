import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Trash2, Mail, Phone, MapPin, Calendar, Clock,
  CheckCircle, XCircle, AlertTriangle, Shield, Check, X, DollarSign,
  TrendingUp, Target, FileText, User, Star, Plus, ChevronDown, ChevronUp,
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
    d.setMinutes(d.getMinutes() + 330);
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

const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const STATUS_DOT: Record<string,string> = {
  present: 'bg-green-500', late: 'bg-amber-500', absent: 'bg-red-500',
  on_leave: 'bg-violet-400', wfh: 'bg-blue-400', wfh_half: 'bg-pink-400',
  holiday: 'bg-purple-400', weekend: 'bg-gray-300', short_leave: 'bg-orange-400',
  unpaid_leave: 'bg-rose-400', 'half-day': 'bg-sky-400',
};
const STATUS_LABEL: Record<string,string> = {
  present: 'Present', late: 'Late', absent: 'Absent', on_leave: 'On Leave',
  wfh: 'WFH', wfh_half: 'WFH Half', holiday: 'Holiday', weekend: 'Weekend',
  short_leave: 'Short Leave', unpaid_leave: 'Unpaid', 'half-day': 'Half Day',
};

const PERF_KEYS = ['productivity','quality','teamwork','attendance_score','initiative','client_satisfaction','ai_usage'];
const PERF_LABELS = ['Productivity','Quality','Teamwork','Attendance','Initiative','Client Sat.','AI Usage'];

// ── Mini action modal for Incentives / Expenses ───────────────────────────────
function ActionModal({ title, info, type, isIncentive, onClose, onConfirm }: {
  title: string; info: string; type: 'approve'|'reject'|'pay';
  isIncentive: boolean; onClose: ()=>void; onConfirm: (d:any)=>Promise<void>;
}) {
  const [amt, setAmt] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const handle = async () => {
    if (type === 'approve' && isIncentive && !(Number(amt) > 0)) { setErr('Enter a valid amount > 0'); return; }
    setSaving(true); setErr('');
    try {
      const d: any = { status: type === 'approve' ? 'approved' : type === 'pay' ? 'paid' : 'rejected' };
      if (type === 'approve' && amt) d.approved_amount = Number(amt);
      if (type === 'reject') d.rejection_reason = reason;
      if (type === 'pay') d.payment_note = note;
      await onConfirm(d);
    } catch (e: any) { setErr(e.message ?? 'Action failed'); }
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
            <input type="number" value={amt} onChange={e=>setAmt(e.target.value)} placeholder="Enter amount"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none"/>
          </div>
        )}
        {type === 'reject' && (
          <div className="mb-3">
            <label className="text-xs font-semibold text-gray-500 block mb-1">Reason (optional)</label>
            <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2} placeholder="Reason…"
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
        {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600">Cancel</button>
          <button onClick={handle} disabled={saving}
            className="flex-1 py-2 text-white rounded-xl text-sm font-semibold disabled:opacity-60"
            style={{background: type==='reject'?'#dc2626': type==='pay'?'#7c3aed':'#15803d'}}>
            {saving ? '…' : type === 'approve' ? 'Approve' : type === 'pay' ? 'Mark Paid' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const TABS = ['Overview','Attendance','Leave','Performance','Incentives','Expenses','Warnings'] as const;
type Tab = typeof TABS[number];

export default function EmployeeProfile() {
  const { id } = useParams<{id:string}>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  const [emp, setEmp] = useState<any>(null);
  const [allEmps, setAllEmps] = useState<any[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [designations, setDesignations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('Overview');
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Attendance tab
  const now = new Date();
  const [attMonth, setAttMonth] = useState(now.getMonth() + 1);
  const [attYear, setAttYear] = useState(now.getFullYear());
  const [attendance, setAttendance] = useState<any[]>([]);
  const [attLoading, setAttLoading] = useState(false);

  // Leave tab
  const [leaves, setLeaves] = useState<any[]>([]);
  const [leaveBalance, setLeaveBalance] = useState<any>(null);
  const [leaveLoading, setLeaveLoading] = useState(false);

  // Probation (Overview)
  const [probationEnd, setProbationEnd] = useState('');
  const [savingProb, setSavingProb] = useState(false);
  const [probSaved, setProbSaved] = useState(false);

  // Leave balance adjustment (Overview)
  const [balAdj, setBalAdj] = useState({ full_day: 0, short_leave: 0 });
  const [balLoaded, setBalLoaded] = useState(false);
  const [savingBal, setSavingBal] = useState(false);
  const [balSaved, setBalSaved] = useState(false);

  // Performance tab
  const [perf, setPerf] = useState<any[]>([]);
  const [perfLoading, setPerfLoading] = useState(false);

  // Incentives tab
  const [incentives, setIncentives] = useState<any[]>([]);
  const [incLoading, setIncLoading] = useState(false);
  const [incAction, setIncAction] = useState<{row:any;type:'approve'|'reject'|'pay'}|null>(null);

  // Expenses tab
  const [expenses, setExpenses] = useState<any[]>([]);
  const [expLoading, setExpLoading] = useState(false);
  const [expAction, setExpAction] = useState<{row:any;type:'approve'|'reject'|'pay'}|null>(null);

  // Warnings tab
  const [warnings, setWarnings] = useState<any[]>([]);
  const [pip, setPip] = useState<any|null>(null);
  const [warnLoading, setWarnLoading] = useState(false);
  const [showWarnForm, setShowWarnForm] = useState(false);
  const [warnReason, setWarnReason] = useState('');
  const [warnSeverity, setWarnSeverity] = useState('warning');
  const [issuingWarn, setIssuingWarn] = useState(false);

  // Load employee + config
  useEffect(() => {
    Promise.all([
      api.getEmployees(),
      api.getConfigDepartments().catch(() => []),
      api.getConfigDesignations().catch(() => []),
    ]).then(([emps, depts, desigs]) => {
      const found = emps.find((e: any) => e.id === id);
      if (!found) { navigate('/employees'); return; }
      setEmp(found);
      setAllEmps(emps);
      setDepartments(depts.map((d: any) => d.name));
      setDesignations(desigs.map((d: any) => d.name));
      const defEnd = found.join_date
        ? (() => { const d = new Date(found.join_date); d.setDate(d.getDate() + 90); return d.toISOString().slice(0,10); })()
        : '';
      setProbationEnd(toDateStr(found.probation_end_date) || defEnd);
      // Load leave balance for overview
      api.getLeaveBalance(found.id).then(b => {
        setBalAdj({ full_day: b.full_day ?? 0, short_leave: b.short_leave ?? 0 });
        setBalLoaded(true);
        setLeaveBalance(b);
      }).catch(() => setBalLoaded(true));
    }).finally(() => setLoading(false));
  }, [id]);

  // Load attendance when tab or month changes
  const loadAttendance = useCallback(() => {
    if (!emp?.id) return;
    setAttLoading(true);
    api.getAttendance({ employee_id: emp.id, month: attMonth, year: attYear })
      .then(setAttendance).catch(() => {}).finally(() => setAttLoading(false));
  }, [emp?.id, attMonth, attYear]);

  // Load tab data lazily
  useEffect(() => {
    if (!emp?.id) return;
    if (tab === 'Attendance') loadAttendance();
    if (tab === 'Leave' && !leaves.length) {
      setLeaveLoading(true);
      Promise.all([
        api.getLeaveRequests({ employee_id: emp.id }),
        api.getLeaveBalance(emp.id).catch(() => null),
      ]).then(([lv, bal]) => { setLeaves(lv); if (bal) setLeaveBalance(bal); })
        .finally(() => setLeaveLoading(false));
    }
    if (tab === 'Performance' && !perf.length) {
      setPerfLoading(true);
      api.getMonthlyPerformance(emp.id, now.getFullYear())
        .then(setPerf).catch(() => {}).finally(() => setPerfLoading(false));
    }
    if (tab === 'Incentives' && !incentives.length) {
      setIncLoading(true);
      api.getUpsellRequests(emp.id).then(setIncentives).catch(() => {}).finally(() => setIncLoading(false));
    }
    if (tab === 'Expenses' && !expenses.length) {
      setExpLoading(true);
      api.getExpenses(emp.id).then(setExpenses).catch(() => {}).finally(() => setExpLoading(false));
    }
    if (tab === 'Warnings' && !warnings.length) {
      setWarnLoading(true);
      Promise.all([
        api.getWarnings(emp.id),
        api.getPips(emp.id).catch(() => []),
      ]).then(([ws, ps]) => {
        setWarnings(ws);
        setPip((ps as any[]).find((p:any) => p.status === 'active') ?? null);
      }).finally(() => setWarnLoading(false));
    }
  }, [tab, emp?.id]);

  // Re-load attendance when month changes
  useEffect(() => {
    if (tab === 'Attendance' && emp?.id) loadAttendance();
  }, [attMonth, attYear]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/>
    </div>
  );
  if (!emp) return null;

  const onProbation = probationEnd ? new Date() < new Date(probationEnd) : false;

  // ── Attendance helpers ────────────────────────────────────────────────────
  const normAtt = attendance.map(r => ({ ...r, dateStr: toDateStr(r.date) }));
  const presentCount = normAtt.filter(r => r.status === 'present').length;
  const lateCount    = normAtt.filter(r => r.status === 'late').length;
  const absentCount  = normAtt.filter(r => r.status === 'absent').length;
  const leaveCount   = normAtt.filter(r => ['on_leave','short_leave','unpaid_leave','half-day'].includes(r.status)).length;
  const wfhCount     = normAtt.filter(r => ['wfh','wfh_half'].includes(r.status)).length;

  // ── Performance helpers ───────────────────────────────────────────────────
  const chartData = MONTH_SHORT.map((m, i) => {
    const rec = perf.find(r => r.month === i + 1);
    return { month: m, score: rec ? Number(rec.overall_score) : null };
  });
  function perfColor(s: number) {
    if (s >= 85) return '#16a34a';
    if (s >= 70) return '#192250';
    if (s >= 50) return '#d97706';
    return '#dc2626';
  }

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteEmployee(emp.id);
      navigate('/employees');
    } catch (err: any) {
      alert(err.message || 'Failed to delete employee.');
    } finally { setDeleting(false); }
  };

  const handleIssueWarning = async () => {
    if (!warnReason.trim()) return;
    setIssuingWarn(true);
    try {
      const w = await api.issueWarning({
        employee_id: emp.id, employee_name: emp.name,
        reason: warnReason.trim(), severity: warnSeverity,
        issued_by: currentUser?.name, issued_by_role: currentUser?.role,
      });
      const updated = [...warnings, w];
      setWarnings(updated);
      if (updated.length >= 3) {
        api.getPips(emp.id).then(ps => setPip((ps as any[]).find((p:any) => p.status === 'active') ?? null)).catch(() => {});
      }
      setWarnReason(''); setShowWarnForm(false);
    } catch { /* ignore */ }
    finally { setIssuingWarn(false); }
  };

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-200 bg-white';
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

  const statusBadge = (status: string) => {
    const label = STATUS_LABEL[status] ?? status;
    const dot = STATUS_DOT[status] ?? 'bg-gray-400';
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
        <span className={`w-2 h-2 rounded-full ${dot}`}/>
        {label}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <button onClick={() => navigate('/employees')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 transition-colors">
          <ArrowLeft size={15}/> Back to Employees
        </button>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Banner */}
          <div className="h-24 relative" style={{background:'linear-gradient(135deg, #192250 0%, #EE2770 100%)'}}>
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
            <div className="-mt-8 flex items-end gap-4 mb-4">
              <div className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center text-xl font-bold border-4 border-white shadow-md flex-shrink-0">
                {emp.avatar}
              </div>
              <div className="pb-1">
                <h1 className="text-xl font-bold text-gray-900">{emp.name}</h1>
                <p className="text-sm text-primary-600 font-medium">{emp.designation}</p>
              </div>
            </div>

            {/* Quick info chips */}
            <div className="flex flex-wrap gap-2">
              {[
                { icon: User, text: emp.employee_id },
                { icon: MapPin, text: emp.department },
                { icon: Calendar, text: `Joined ${fmtDate(emp.join_date, {day:'numeric',month:'short',year:'numeric'})}` },
                { icon: Clock, text: emp.shift === 'night' ? 'Night Shift' : 'Day Shift' },
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
                  className={`px-4 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap transition-all ${
                    tab === t ? 'text-white' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                  style={tab === t ? {background:'linear-gradient(135deg,#192250,#141c43)'} : {}}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab: Overview ──────────────────────────────────────────────────── */}
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
                { icon: Clock, label: 'Shift',    value: emp.shift === 'night' ? '🌙 Night Shift (6:30 PM – 3:30 AM)' : '☀️ Day Shift (9:00 AM – 6:00 PM)' },
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
                  <p className="text-xl font-bold text-gray-800 mt-1">₹{(Number(emp.ctc || 0) / 100000).toFixed(1)}L</p>
                </div>
              </div>
            </div>

            {/* Probation */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Probation / Confirmation</p>
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${onProbation ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                  {onProbation ? 'On Probation' : 'Confirmed'}
                </span>
              </div>
              <label className={labelCls}>{onProbation ? 'Probation End Date' : 'Confirmation Date'}</label>
              <div className="flex gap-2">
                <input type="date" value={probationEnd} onChange={e => { setProbationEnd(e.target.value); setProbSaved(false); }}
                  className={inputCls}/>
                <button onClick={async () => {
                  setSavingProb(true); setProbSaved(false);
                  try { await api.updateEmployeeProbation(emp.id, probationEnd || null); setProbSaved(true); setTimeout(() => setProbSaved(false), 2500); }
                  catch { /* ignore */ } finally { setSavingProb(false); }
                }} disabled={savingProb}
                  className="px-4 py-2 text-xs font-semibold text-white bg-primary-500 rounded-lg disabled:opacity-60 whitespace-nowrap">
                  {savingProb ? '…' : probSaved ? '✓ Saved' : 'Save'}
                </button>
              </div>
            </div>

            {/* Leave balance */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Leave Balance</p>
              {!balLoaded ? <p className="text-xs text-gray-400">Loading…</p> : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Full Day</label>
                      <input type="number" min="0" value={balAdj.full_day}
                        onChange={e => setBalAdj(b => ({ ...b, full_day: Number(e.target.value) }))}
                        className={inputCls}/>
                    </div>
                    <div>
                      <label className={labelCls}>Short Leave / Half Day credits</label>
                      <input type="number" min="0" value={balAdj.short_leave}
                        onChange={e => setBalAdj(b => ({ ...b, short_leave: Number(e.target.value) }))}
                        className={inputCls}/>
                    </div>
                  </div>
                  <button onClick={async () => {
                    setSavingBal(true); setBalSaved(false);
                    try { await api.adjustLeaveBalance(emp.id, balAdj); setBalSaved(true); setTimeout(() => setBalSaved(false), 2500); }
                    catch { /* ignore */ } finally { setSavingBal(false); }
                  }} disabled={savingBal}
                    className="w-full py-2 text-xs font-semibold text-white bg-primary-500 rounded-lg disabled:opacity-60">
                    {savingBal ? 'Saving…' : balSaved ? '✓ Balance Updated' : 'Save Balance'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Attendance ────────────────────────────────────────────────── */}
      {tab === 'Attendance' && (
        <div className="space-y-5">
          {/* Month picker */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-gray-700">Viewing:</p>
            <select value={attMonth} onChange={e => setAttMonth(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none">
              {MONTH_FULL.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
            <select value={attYear} onChange={e => setAttYear(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none">
              {[now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1].map(y => <option key={y}>{y}</option>)}
            </select>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Present',   count: presentCount, color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
              { label: 'Late',      count: lateCount,    color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
              { label: 'Absent',    count: absentCount,  color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
              { label: 'On Leave',  count: leaveCount,   color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
              { label: 'WFH',       count: wfhCount,     color: '#0d9488', bg: 'rgba(13,148,136,0.08)' },
            ].map(({ label, count, color, bg }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
                <p className="text-2xl font-black" style={{color}}>{count}</p>
                <p className="text-xs text-gray-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Records table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {attLoading ? (
              <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/></div>
            ) : normAtt.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-12">No attendance records for {MONTH_FULL[attMonth-1]} {attYear}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{background:'#f8f9fc'}}>
                      {['Date','Day','Status','Check In','Check Out','Hours'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {normAtt.sort((a,b) => a.dateStr.localeCompare(b.dateStr)).map(r => (
                      <tr key={r.id ?? r.dateStr} className="border-t border-gray-50 hover:bg-gray-50/40">
                        <td className="px-4 py-3 font-medium text-gray-800">{fmtDate(r.date, {day:'numeric',month:'short'})}</td>
                        <td className="px-4 py-3 text-gray-500">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(r.dateStr+'T12:00:00Z').getUTCDay()]}</td>
                        <td className="px-4 py-3">{statusBadge(r.status)}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtTime(r.check_in)}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtTime(r.check_out)}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtHours(r.total_hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Leave ─────────────────────────────────────────────────────── */}
      {tab === 'Leave' && (
        <div className="space-y-5">
          {/* Balance cards */}
          {leaveBalance && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Full Day', value: leaveBalance.full_day ?? 0, color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
                { label: 'Short / Half Day', value: leaveBalance.short_leave ?? 0, color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
                { label: 'Casual', value: leaveBalance.casual ?? 0, color: '#0d9488', bg: 'rgba(13,148,136,0.08)' },
                { label: 'Sick', value: leaveBalance.sick ?? 0, color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <p className="text-2xl font-black" style={{color}}>{value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{label} remaining</p>
                  <div className="h-1 rounded-full mt-2" style={{background:bg}}>
                    <div className="h-1 rounded-full" style={{background:color,width:`${Math.min(100,value*10)}%`}}/>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Requests table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50">
              <p className="font-semibold text-sm text-gray-800">Leave Requests</p>
            </div>
            {leaveLoading ? (
              <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/></div>
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
                    {[...leaves].sort((a,b) => new Date(b.applied_on ?? b.created_at ?? 0).getTime() - new Date(a.applied_on ?? a.created_at ?? 0).getTime()).map(l => {
                      const colors: Record<string,string> = {
                        pending:'bg-amber-50 text-amber-600 border-amber-200',
                        approved:'bg-green-50 text-green-600 border-green-200',
                        rejected:'bg-red-50 text-red-500 border-red-200',
                        cancelled:'bg-gray-100 text-gray-500 border-gray-200',
                      };
                      return (
                        <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                          <td className="px-4 py-3 font-medium text-gray-800 capitalize whitespace-nowrap">{(l.type??'').replace(/_/g,' ')}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(l.from_date, {day:'numeric',month:'short'})}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(l.to_date, {day:'numeric',month:'short'})}</td>
                          <td className="px-4 py-3 text-gray-600">{l.days}</td>
                          <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate">{l.reason}</td>
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(l.applied_on ?? l.created_at)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${colors[l.status] ?? 'bg-gray-50 text-gray-500 border-gray-200'}`}>
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

      {/* ── Tab: Performance ───────────────────────────────────────────────── */}
      {tab === 'Performance' && (
        <div className="space-y-5">
          {perfLoading ? (
            <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/></div>
          ) : perf.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
              <Star size={36} className="text-gray-200 mx-auto mb-3"/>
              <p className="text-sm text-gray-400">No performance reviews for {now.getFullYear()} yet</p>
            </div>
          ) : (
            <>
              {/* Score chart */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="font-semibold text-sm text-gray-800 mb-1">Overall Score — {now.getFullYear()}</p>
                <p className="text-xs text-gray-400 mb-4">Monthly performance rating (out of 100)</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} barSize={24}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false}/>
                    <XAxis dataKey="month" tick={{fontSize:11,fill:'#9ca3af'}} axisLine={false} tickLine={false}/>
                    <YAxis domain={[0,100]} tick={{fontSize:11,fill:'#9ca3af'}} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{borderRadius:8,border:'none',boxShadow:'0 4px 20px rgba(0,0,0,0.1)'}} formatter={(v:any) => [`${v}`, 'Score']}/>
                    <Bar dataKey="score" radius={[4,4,0,0]} name="Score">
                      {chartData.map((d, i) => <Cell key={i} fill={d.score ? perfColor(d.score) : '#e5e7eb'}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Detail table */}
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
                          {PERF_KEYS.map(k => (
                            <td key={k} className="px-3 py-3 text-gray-600">{r[k] ?? '—'}</td>
                          ))}
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

      {/* ── Tab: Incentives ────────────────────────────────────────────────── */}
      {tab === 'Incentives' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className="font-semibold text-sm text-gray-800">Upsell Incentive Requests</p>
            <span className="text-xs text-gray-400">{incentives.length} total</span>
          </div>
          {incLoading ? (
            <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/></div>
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
                    const c = cfg[r.status] ?? cfg.pending;
                    return (
                      <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                        <td className="px-4 py-3 font-medium text-gray-800">{r.client_name}</td>
                        <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate">{r.service_description}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtAmt(r.deal_value)}</td>
                        <td className="px-4 py-3 font-semibold" style={{color:r.approved_amount?'#15803d':'#9ca3af'}}>{fmtAmt(r.approved_amount)}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{background:c.bg,color:c.color}}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            {r.status==='pending'&&<>
                              <button onClick={()=>setIncAction({row:r,type:'approve'})} className="text-xs px-2 py-1 rounded-lg font-semibold text-white" style={{background:'#15803d'}}>Approve</button>
                              <button onClick={()=>setIncAction({row:r,type:'reject'})} className="text-xs px-2 py-1 rounded-lg font-semibold bg-red-50 text-red-600">Reject</button>
                            </>}
                            {r.status==='approved'&&<button onClick={()=>setIncAction({row:r,type:'pay'})} className="text-xs px-2 py-1 rounded-lg font-semibold text-white" style={{background:'#7c3aed'}}>Mark Paid</button>}
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

      {/* ── Tab: Expenses ──────────────────────────────────────────────────── */}
      {tab === 'Expenses' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className="font-semibold text-sm text-gray-800">Expense Claims</p>
            <span className="text-xs text-gray-400">{expenses.length} total</span>
          </div>
          {expLoading ? (
            <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/></div>
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
                    const c = cfg[r.status] ?? cfg.pending;
                    return (
                      <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                        <td className="px-4 py-3 font-medium text-gray-800">{r.category}</td>
                        <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate">{r.description}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtAmt(r.amount)}</td>
                        <td className="px-4 py-3 font-semibold" style={{color:r.approved_amount?'#15803d':'#9ca3af'}}>{fmtAmt(r.approved_amount)}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(r.expense_date)}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{background:c.bg,color:c.color}}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            {r.status==='pending'&&<>
                              <button onClick={()=>setExpAction({row:r,type:'approve'})} className="text-xs px-2 py-1 rounded-lg font-semibold text-white" style={{background:'#15803d'}}>Approve</button>
                              <button onClick={()=>setExpAction({row:r,type:'reject'})} className="text-xs px-2 py-1 rounded-lg font-semibold bg-red-50 text-red-600">Reject</button>
                            </>}
                            {r.status==='approved'&&<button onClick={()=>setExpAction({row:r,type:'pay'})} className="text-xs px-2 py-1 rounded-lg font-semibold text-white" style={{background:'#7c3aed'}}>Mark Paid</button>}
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

      {/* ── Tab: Warnings ──────────────────────────────────────────────────── */}
      {tab === 'Warnings' && (
        <div className="space-y-5">
          {/* PIP banner */}
          {pip && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-3">
              <Shield size={18} className="text-red-500 mt-0.5 flex-shrink-0"/>
              <div className="flex-1">
                <p className="font-bold text-red-700 text-sm">On Performance Improvement Plan (PIP)</p>
                <p className="text-xs text-red-600 mt-1">{fmtDate(pip.start_date)} → {fmtDate(pip.end_date)}</p>
                {pip.goals && <p className="text-xs text-red-500 mt-1 italic">"{pip.goals}"</p>}
              </div>
              <select value={pip.status}
                onChange={async e => { const u = await api.updatePip(pip.id, { status: e.target.value }); setPip(u.status === 'active' ? u : null); }}
                className="text-xs border border-red-200 rounded-lg px-2 py-1.5 bg-white text-red-600 focus:outline-none">
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </div>
          )}

          {/* Issue warning */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm text-gray-800">Warnings</p>
                {warnings.length > 0 && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${warnings.length >= 3 ? 'bg-red-100 text-red-700' : warnings.length === 2 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
                    {warnings.length}
                  </span>
                )}
              </div>
              <button onClick={() => setShowWarnForm(v => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100">
                <AlertTriangle size={11}/> Issue Warning
                {showWarnForm ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
              </button>
            </div>

            {showWarnForm && (
              <div className="mb-4 p-4 bg-amber-50 border border-amber-100 rounded-xl space-y-3">
                <div className="flex gap-2">
                  {(['warning','serious','final'] as const).map(s => (
                    <button key={s} onClick={() => setWarnSeverity(s)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border capitalize transition-all ${warnSeverity === s
                        ? s==='final'?'bg-red-500 text-white border-red-500':s==='serious'?'bg-orange-500 text-white border-orange-500':'bg-amber-500 text-white border-amber-500'
                        : 'bg-white text-gray-600 border-gray-200'}`}>{s}</button>
                  ))}
                </div>
                <textarea value={warnReason} onChange={e => setWarnReason(e.target.value)} rows={2}
                  placeholder="Reason for this warning…"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none"/>
                <div className="flex gap-2">
                  <button onClick={() => setShowWarnForm(false)} className="flex-1 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-600">Cancel</button>
                  <button onClick={handleIssueWarning} disabled={issuingWarn || !warnReason.trim()}
                    className="flex-1 py-1.5 text-white rounded-lg text-xs font-semibold disabled:opacity-50" style={{background:'#d97706'}}>
                    {issuingWarn ? 'Issuing…' : 'Issue Warning'}
                  </button>
                </div>
              </div>
            )}

            {warnLoading ? <p className="text-xs text-gray-400">Loading…</p> : warnings.length === 0 ? (
              <p className="text-xs text-gray-400">No warnings on record.</p>
            ) : (
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <div key={w.id} className={`flex items-start gap-3 p-3 rounded-xl border ${w.severity==='final'?'border-red-200 bg-red-50':w.severity==='serious'?'border-orange-200 bg-orange-50':'border-amber-100 bg-amber-50'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${w.severity==='final'?'bg-red-500 text-white':w.severity==='serious'?'bg-orange-500 text-white':'bg-amber-400 text-white'}`}>{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${w.severity==='final'?'bg-red-100 text-red-700':w.severity==='serious'?'bg-orange-100 text-orange-700':'bg-amber-100 text-amber-700'}`}>{w.severity}</span>
                      </div>
                      <p className="text-xs text-gray-700 mt-1 leading-snug">{w.reason}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{w.issued_by ? `By ${w.issued_by} · ` : ''}{fmtDate(w.created_at)}</p>
                    </div>
                    <button onClick={async () => { await api.deleteWarning(w.id); setWarnings(prev => prev.filter(x => x.id !== w.id)); }}
                      className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0">
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
          emp={emp}
          allEmployees={allEmps}
          departments={departments}
          designations={designations}
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
            <p className="text-sm text-gray-500 mb-6">This will permanently remove the employee record and cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDelete(false)} disabled={deleting}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
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
          info={`${incAction.row.client_name} — ${incAction.row.service_description}${incAction.row.deal_value ? ` (Deal: ${fmtAmt(incAction.row.deal_value)})` : ''}`}
          type={incAction.type} isIncentive={true}
          onClose={() => setIncAction(null)}
          onConfirm={async (d) => {
            const updated = await api.reviewUpsell(incAction.row.id, { ...d, reviewed_by: currentUser?.name });
            setIncentives(prev => prev.map(r => r.id === updated.id ? updated : r));
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
          onConfirm={async (d) => {
            const updated = await api.reviewExpense(expAction.row.id, { ...d, reviewed_by: currentUser?.name });
            setExpenses(prev => prev.map(r => r.id === updated.id ? updated : r));
            setExpAction(null);
          }}
        />
      )}
    </div>
  );
}
