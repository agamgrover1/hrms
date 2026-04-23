import { useState, useEffect } from 'react';
import { Clock, Calendar, DollarSign, User, CheckCircle, XCircle, AlertCircle, Plus, X, Target, FileText, Lock, Trash2, Save, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { GoalCard, GOAL_STATUSES, GOAL_STATUS_CONFIG } from '../Performance';
import type { GoalStatus } from '../Performance';

const baseTabs = [
  { key: 'overview',     label: 'Overview',     icon: User },
  { key: 'attendance',   label: 'Attendance',   icon: Clock },
  { key: 'leave',        label: 'My Leaves',    icon: Calendar },
  { key: 'payslip',      label: 'Pay Slip',     icon: DollarSign },
  { key: 'performance',  label: 'Performance',  icon: Target },
];

const SCORE_CATEGORIES = [
  { key: 'productivity',        label: 'Productivity' },
  { key: 'quality',             label: 'Quality of Work' },
  { key: 'teamwork',            label: 'Teamwork' },
  { key: 'attendance_score',    label: 'Attendance' },
  { key: 'initiative',          label: 'Initiative' },
  { key: 'client_satisfaction', label: 'Client Satisfaction' },
] as const;

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PERF_COLS = ['Prod.', 'Quality', 'Teamwork', 'Attend.', 'Initiative', 'Client Sat.'];
const PERF_KEYS = ['productivity','quality','teamwork','attendance_score','initiative','client_satisfaction'];

function perfColor(s: number) {
  if (s >= 85) return '#16a34a';
  if (s >= 70) return '#192250';
  if (s >= 50) return '#d97706';
  return '#dc2626';
}

const statusConfig = {
  present:  { label: 'Present',  color: 'bg-green-50 text-green-600',  dot: 'bg-green-500' },
  absent:   { label: 'Absent',   color: 'bg-red-50 text-red-500',      dot: 'bg-red-500' },
  late:     { label: 'Late',     color: 'bg-amber-50 text-amber-600',  dot: 'bg-amber-500' },
  'half-day': { label: 'Half Day', color: 'bg-blue-50 text-blue-600', dot: 'bg-blue-500' },
  weekend:  { label: 'Weekend',  color: 'bg-gray-50 text-gray-400',    dot: 'bg-gray-300' },
  holiday:  { label: 'Holiday',  color: 'bg-purple-50 text-purple-500',dot: 'bg-purple-400' },
};

const leaveStatusConfig = {
  pending:  { color: 'bg-amber-50 text-amber-600 border-amber-200',  icon: AlertCircle },
  approved: { color: 'bg-green-50 text-green-600 border-green-200',  icon: CheckCircle },
  rejected: { color: 'bg-red-50 text-red-500 border-red-200',        icon: XCircle },
};

function ApplyLeaveModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (d: any) => void }) {
  const [form, setForm] = useState({ type: 'casual', from: '', to: '', reason: '' });
  const handleSubmit = () => {
    if (!form.from || !form.to || !form.reason) return;
    const days = Math.max(1, Math.ceil((new Date(form.to).getTime() - new Date(form.from).getTime()) / 86400000) + 1);
    onSubmit({ ...form, days, from_date: form.from, to_date: form.to });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-900">Apply for Leave</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Leave Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none bg-white">
              {['casual', 'sick', 'earned'].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)} Leave</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">From</label>
              <input type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">To</label>
              <input type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Reason</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              rows={3} placeholder="Briefly describe the reason..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none resize-none" />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={handleSubmit} className="flex-1 py-2.5 text-white rounded-lg text-sm font-medium" style={{ background: '#192250' }}>Submit</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MyPortal() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [applyLeave, setApplyLeave] = useState(false);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any | null>(null);
  const [balance, setBalance] = useState<any>({ casual: 0, sick: 0, earned: 0 });
  const [monthlyPerf, setMonthlyPerf] = useState<any[]>([]);
  const [empDbId, setEmpDbId] = useState('');

  // Appraisal goals state
  const [allAppraisals, setAllAppraisals] = useState<any[]>([]);
  const [goalsDraft, setGoalsDraft] = useState<any[]>([{ title: '', description: '', success_criteria: '' }]);
  const [savingGoals, setSavingGoals] = useState(false);
  const [submittingGoals, setSubmittingGoals] = useState(false);
  const [goalsError, setGoalsError] = useState('');
  const [empRecord, setEmpRecord] = useState<any | null>(null);

  // Self-status edits: key = "year-month", value = array of employee_status strings
  const [selfStatusEdits, setSelfStatusEdits] = useState<Record<string, string[]>>({});
  const [savingSelfStatus, setSavingSelfStatus] = useState<Record<string, boolean>>({});

  // My Team state (shown when this employee is a reporting manager for others)
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [teamPendingLeaves, setTeamPendingLeaves] = useState<any[]>([]);
  const [teamPerf, setTeamPerf] = useState<Record<string, any[]>>({});
  const [approvingLeave, setApprovingLeave] = useState<Record<string, boolean>>({});
  const [showTeamReview, setShowTeamReview] = useState<any | null>(null); // employee record
  const [teamReviewScores, setTeamReviewScores] = useState<Record<string, number>>({
    productivity: 75, quality: 75, teamwork: 75, attendance_score: 75, initiative: 75, client_satisfaction: 75,
  });
  const [teamReviewComment, setTeamReviewComment] = useState('');
  const [savingTeamReview, setSavingTeamReview] = useState(false);

  const empRef = user?.employee_id_ref;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  useEffect(() => {
    if (!empRef) return;
    api.getEmployees().then(emps => {
      const emp = emps.find(e => e.employee_id === empRef);
      if (!emp) return;
      setEmpDbId(emp.id);
      setEmpRecord(emp);
      Promise.all([
        api.getAttendance({ employee_id: emp.id, month: currentMonth, year: currentYear }),
        api.getLeaveRequests({ employee_id: emp.id }),
        api.getEmployeePayroll(emp.id),
        api.getLeaveBalance(emp.id).catch(() => ({ casual: 10, sick: 7, earned: 15 })),
        api.getMonthlyPerformance(emp.id, currentYear),
        api.getAppraisalGoals({ employee_id: emp.id }),
      ]).then(([att, lv, pay, bal, perf, appraisals]) => {
        setAttendance(att);
        setLeaves(lv);
        setPayroll(Array.isArray(pay) ? pay[0] : pay);
        setBalance(bal);
        setMonthlyPerf(perf);
        const list = Array.isArray(appraisals) ? appraisals : [];
        setAllAppraisals(list);
        // Pre-load draft for the current appraisal window if any exists
        const currAppraisal = list.find(
          a => a.month === currentMonth && a.year === currentYear
        );
        setGoalsDraft(currAppraisal?.goals?.length ? currAppraisal.goals : [{ title: '', description: '', success_criteria: '' }]);
      });
    });
  }, [empRef, currentYear, currentMonth]);

  // Is there an appraisal window open for this employee right now?
  const appraisalWindowOpen =
    empRecord?.next_appraisal_month === currentMonth &&
    empRecord?.next_appraisal_year === currentYear;

  // Existing record for the current window (if any)
  const currentAppraisal = allAppraisals.find(
    a => a.month === currentMonth && a.year === currentYear
  );
  const isSubmitted = currentAppraisal?.submitted === true;

  // Past appraisals = everything that is NOT the current open window
  const pastAppraisals = allAppraisals.filter(
    a => !(a.month === currentMonth && a.year === currentYear)
  );

  const presentDays = attendance.filter(r => r.status === 'present').length;
  const lateDays    = attendance.filter(r => r.status === 'late').length;
  const absentDays  = attendance.filter(r => r.status === 'absent').length;

  const handleApplyLeave = async (data: any) => {
    if (!empRef) return;
    const emps = await api.getEmployees();
    const emp = emps.find(e => e.employee_id === empRef);
    if (!emp) return;
    await api.applyLeave({ ...data, employee_id: emp.id, employee_name: user?.name });
    api.getLeaveRequests({ employee_id: emp.id }).then(setLeaves);
  };

  const updateGoal = (i: number, field: string, val: string) =>
    setGoalsDraft(g => g.map((x, j) => j === i ? { ...x, [field]: val } : x));

  const handleSaveDraft = async () => {
    if (!empDbId || isSubmitted) return;
    setSavingGoals(true);
    setGoalsError('');
    try {
      const result = await api.saveAppraisalGoals({ employee_id: empDbId, year: currentYear, month: currentMonth, goals: goalsDraft });
      setAllAppraisals(prev => {
        const without = prev.filter(a => !(a.month === currentMonth && a.year === currentYear));
        return [result, ...without];
      });
    } catch (e: any) {
      setGoalsError(e.message ?? 'Save failed');
    } finally { setSavingGoals(false); }
  };

  const handleSubmitGoals = async () => {
    if (!empDbId || isSubmitted) return;
    const filledGoals = goalsDraft.filter(g => g.title?.trim());
    if (!filledGoals.length) { setGoalsError('Add at least one goal before submitting.'); return; }
    if (!confirm('Once submitted, you cannot edit your goals. Are you sure?')) return;
    setSubmittingGoals(true);
    setGoalsError('');
    try {
      const result = await api.submitAppraisalGoals({ employee_id: empDbId, year: currentYear, month: currentMonth, goals: filledGoals });
      setAllAppraisals(prev => {
        const without = prev.filter(a => !(a.month === currentMonth && a.year === currentYear));
        return [result, ...without];
      });
      setGoalsDraft(result.goals ?? []);
    } catch (e: any) {
      setGoalsError(e.message ?? 'Submit failed');
    } finally { setSubmittingGoals(false); }
  };

  const handleSaveSelfStatus = async (appraisal: any) => {
    const key = `${appraisal.year}-${appraisal.month}`;
    const statuses = selfStatusEdits[key];
    if (!statuses || !empDbId) return;
    setSavingSelfStatus(s => ({ ...s, [key]: true }));
    try {
      const employee_statuses = statuses.map((employee_status, index) => ({ index, employee_status }));
      const updated = await api.selfUpdateGoalStatuses({
        employee_id: empDbId,
        year: appraisal.year,
        month: appraisal.month,
        employee_statuses,
      });
      setAllAppraisals(prev => prev.map(a =>
        a.year === appraisal.year && a.month === appraisal.month ? updated : a
      ));
    } catch { /* ignore */ } finally {
      setSavingSelfStatus(s => ({ ...s, [key]: false }));
    }
  };

  const renderGoalSelfEditor = (appraisal: any) => {
    const apKey = `${appraisal.year}-${appraisal.month}`;
    const goals: any[] = appraisal.goals ?? [];
    const statuses: GoalStatus[] = (selfStatusEdits[apKey] ?? goals.map((g: any) => g.employee_status ?? 'not_started')) as GoalStatus[];
    const isSaving = savingSelfStatus[apKey] ?? false;
    return (
      <div className="space-y-3">
        {goals.map((g: any, i: number) => {
          const empStatus = statuses[i] ?? 'not_started';
          const managerStatus: GoalStatus | null = g.status ?? null;
          const managerCfg = managerStatus ? GOAL_STATUS_CONFIG[managerStatus] : null;
          const ManagerIcon = managerCfg?.icon;
          return (
            <div key={i} className="border rounded-xl overflow-hidden" style={{ borderColor: '#e2e4ed', background: '#fafbff' }}>
              <div className="flex gap-2.5 p-4 pb-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: 'rgba(238,39,112,0.12)', color: '#EE2770' }}>{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: '#192250' }}>{g.title}</p>
                  {g.description && <p className="text-xs text-gray-500 mt-1">{g.description}</p>}
                  {g.success_criteria && <p className="text-xs text-gray-400 mt-1 italic">Target: {g.success_criteria}</p>}
                </div>
              </div>
              <div className="px-4 pb-3">
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#6b7280' }}>Your Progress</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {GOAL_STATUSES.map(s => {
                    const cfg = GOAL_STATUS_CONFIG[s];
                    const Icon = cfg.icon;
                    const active = empStatus === s;
                    return (
                      <button key={s}
                        onClick={() => setSelfStatusEdits(prev => ({
                          ...prev,
                          [apKey]: statuses.map((x, j) => j === i ? s : x),
                        }))}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all"
                        style={active
                          ? { background: cfg.bg, color: cfg.color, borderColor: cfg.border }
                          : { background: '#f9fafb', color: '#9ca3af', borderColor: '#e5e7eb' }}>
                        <Icon size={11} /> {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {(managerCfg || g.reviewer_comment) && (
                <div className="px-4 pb-4 space-y-2">
                  {managerCfg && ManagerIcon && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 font-semibold">Manager:</span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: managerCfg.bg, color: managerCfg.color, border: `1px solid ${managerCfg.border}` }}>
                        <ManagerIcon size={10} /> {managerCfg.label}
                      </span>
                    </div>
                  )}
                  {g.reviewer_comment && (
                    <div className="px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(25,34,80,0.05)', color: '#374151' }}>
                      <span className="font-semibold" style={{ color: '#192250' }}>Reviewer: </span>{g.reviewer_comment}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className="flex justify-end pt-1">
          <button onClick={() => handleSaveSelfStatus(appraisal)} disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-60 shadow-sm"
            style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
            <Save size={14} /> {isSaving ? 'Saving…' : 'Save My Progress'}
          </button>
        </div>
      </div>
    );
  };

  const chartData = MONTHS_SHORT.map((m, idx) => {
    const rec = monthlyPerf.find(r => r.month === idx + 1);
    return { month: m, score: rec ? rec.overall_score : null };
  });

  // Load team data once empDbId is known
  useEffect(() => {
    if (!empDbId) return;
    api.getTeamMembers(empDbId).then(members => {
      setTeamMembers(members);
      if (members.length === 0) return;
      api.getLeaveRequests({ reporting_manager_id: empDbId }).then(leavs =>
        setTeamPendingLeaves(leavs.filter((l: any) => l.manager_status === 'pending'))
      );
      members.forEach((m: any) => {
        api.getMonthlyPerformance(m.id, currentYear).then(perf =>
          setTeamPerf(prev => ({ ...prev, [m.id]: perf }))
        );
      });
    });
  }, [empDbId, currentYear]);

  const tabs = [
    ...baseTabs,
    ...(teamMembers.length > 0 ? [{ key: 'myteam', label: 'My Team', icon: Users }] : []),
  ];

  const handleManagerApproveLeave = async (leaveId: string, status: 'approved' | 'rejected') => {
    setApprovingLeave(prev => ({ ...prev, [leaveId]: true }));
    try {
      await api.managerApproveLeave(leaveId, { status, manager_id: empDbId });
      setTeamPendingLeaves(prev => prev.filter(l => l.id !== leaveId));
    } catch { /* ignore */ } finally {
      setApprovingLeave(prev => ({ ...prev, [leaveId]: false }));
    }
  };

  const handleSaveTeamReview = async () => {
    if (!showTeamReview || !empDbId) return;
    setSavingTeamReview(true);
    try {
      const overall = Math.round(Object.values(teamReviewScores).reduce((a, b) => a + b, 0) / SCORE_CATEGORIES.length);
      await api.saveMonthlyPerformance({
        employee_id: showTeamReview.id,
        reviewer_id: empDbId,
        reviewer_name: user?.name,
        month: currentMonth,
        year: currentYear,
        productivity: teamReviewScores.productivity,
        quality: teamReviewScores.quality,
        teamwork: teamReviewScores.teamwork,
        attendance_score: teamReviewScores.attendance_score,
        initiative: teamReviewScores.initiative,
        client_satisfaction: teamReviewScores.client_satisfaction,
        overall_score: overall,
        comments: teamReviewComment,
      });
      api.getMonthlyPerformance(showTeamReview.id, currentYear).then(perf =>
        setTeamPerf(prev => ({ ...prev, [showTeamReview.id]: perf }))
      );
      setShowTeamReview(null);
      setTeamReviewComment('');
      setTeamReviewScores({ productivity: 75, quality: 75, teamwork: 75, attendance_score: 75, initiative: 75, client_satisfaction: 75 });
    } catch { /* ignore */ } finally {
      setSavingTeamReview(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Profile Header */}
      <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold border-2"
            style={{ background: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.25)' }}>
            {user?.avatar}
          </div>
          <div>
            <h2 className="text-xl font-bold">{user?.name}</h2>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>{user?.designation} · {user?.department}</p>
            <p className="text-xs mt-1 font-semibold" style={{ color: '#EE2770' }}>{user?.employee_id_ref}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-white rounded-xl p-1 border border-gray-100 shadow-sm w-fit">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all"
            style={tab === key
              ? { background: '#192250', color: '#fff' }
              : { color: '#6b7280' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Personal Info</p>
            {[
              { label: 'Email',       value: user?.email },
              { label: 'Department',  value: user?.department },
              { label: 'Designation', value: user?.designation },
              { label: 'Employee ID', value: user?.employee_id_ref },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-500">{label}</span>
                <span className="text-sm font-medium text-gray-800">{value ?? '—'}</span>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">This Month</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center"><p className="text-2xl font-bold text-green-600">{presentDays}</p><p className="text-xs text-gray-400">Present</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-amber-500">{lateDays}</p><p className="text-xs text-gray-400">Late</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-red-500">{absentDays}</p><p className="text-xs text-gray-400">Absent</p></div>
              </div>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Leave Balance</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center"><p className="text-2xl font-bold text-blue-600">{balance.casual}</p><p className="text-xs text-gray-400">Casual</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-red-500">{balance.sick}</p><p className="text-xs text-gray-400">Sick</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-green-600">{balance.earned}</p><p className="text-xs text-gray-400">Earned</p></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Attendance ── */}
      {tab === 'attendance' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">My Attendance — {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {attendance.filter(r => r.status !== 'weekend').map(r => {
              const cfg = statusConfig[r.status as keyof typeof statusConfig];
              return (
                <div key={r.date} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50/50">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${cfg?.dot}`} />
                    <span className="text-sm text-gray-700">
                      {new Date(r.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg?.color}`}>{cfg?.label}</span>
                  </div>
                  <span className="text-sm text-gray-400">
                    {r.check_in ? `${r.check_in} – ${r.check_out ?? '—'} (${r.total_hours}h)` : '—'}
                  </span>
                </div>
              );
            })}
            {attendance.filter(r => r.status !== 'weekend').length === 0 && (
              <p className="text-center text-gray-400 text-sm py-12">No records yet this month</p>
            )}
          </div>
        </div>
      )}

      {/* ── Leaves ── */}
      {tab === 'leave' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setApplyLeave(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
              style={{ background: 'linear-gradient(135deg, #EE2770 0%, #d11f62 100%)' }}>
              <Plus size={15} /> Apply Leave
            </button>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {leaves.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-16">No leave requests found.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Type', 'From', 'To', 'Days', 'Reason', 'Status'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leaves.map(l => {
                    const cfg = leaveStatusConfig[l.status as keyof typeof leaveStatusConfig];
                    return (
                      <tr key={l.id} className="border-b border-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-800 capitalize">{l.type}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{new Date(l.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{new Date(l.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-700">{l.days}d</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{l.reason}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium ${cfg?.color}`}>
                            <cfg.icon size={11} /> {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {applyLeave && <ApplyLeaveModal onClose={() => setApplyLeave(false)} onSubmit={handleApplyLeave} />}
        </div>
      )}

      {/* ── Pay Slip ── */}
      {tab === 'payslip' && (
        <div className="max-w-lg">
          {payroll ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-5 text-white" style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
                <h3 className="font-bold text-lg">Salary Slip</h3>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>{payroll.month} {payroll.year}</p>
                <p className="text-xs mt-1" style={{ color: '#EE2770' }}>{user?.employee_id_ref} · {user?.designation}</p>
              </div>
              <div className="p-6 space-y-2.5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Earnings</p>
                {[
                  { label: 'Basic Pay', value: payroll.basic },
                  { label: 'HRA', value: payroll.hra },
                  { label: 'Special Allowance', value: payroll.special_allowance },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm border-b border-gray-50 pb-2">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-medium text-gray-800">₹{Number(value).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold pt-1 pb-3 border-b border-dashed border-gray-200">
                  <span>Gross Pay</span>
                  <span>₹{Number(payroll.gross_pay).toLocaleString('en-IN')}</span>
                </div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 pt-1">Deductions</p>
                {[
                  { label: 'Provident Fund', value: payroll.provident_fund },
                  { label: 'Professional Tax', value: payroll.professional_tax },
                  { label: 'Income Tax (TDS)', value: payroll.income_tax },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm border-b border-gray-50 pb-2">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-medium text-red-500">−₹{Number(value).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                <div className="mt-4 rounded-xl p-4 flex justify-between items-center" style={{ background: 'rgba(25,34,80,0.06)' }}>
                  <span className="font-bold text-gray-800">Net Pay</span>
                  <span className="text-xl font-bold" style={{ color: '#192250' }}>₹{Number(payroll.net_pay).toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-gray-400 text-sm py-16">No payroll data available</p>
          )}
        </div>
      )}

      {/* ── Performance ── */}
      {tab === 'performance' && (
        <div className="space-y-5">
          {/* KPI summary */}
          <div className="grid grid-cols-3 gap-3">
            {(() => {
              const reviewed = monthlyPerf.length;
              const avg = reviewed ? Math.round(monthlyPerf.reduce((a, r) => a + r.overall_score, 0) / reviewed) : 0;
              const best = monthlyPerf.length ? monthlyPerf.reduce((a, b) => a.overall_score > b.overall_score ? a : b) : null;
              return [
                { label: 'Avg YTD Score', value: reviewed ? avg : '—', color: reviewed ? perfColor(avg) : '#d1d5db' },
                { label: 'Reviews Done', value: `${reviewed}/12`, color: '#192250' },
                { label: 'Best Month', value: best ? MONTHS_SHORT[best.month - 1] : '—', color: '#16a34a' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
                  <p className="text-2xl font-black" style={{ color }}>{value}</p>
                  <p className="text-xs text-gray-400 mt-1">{label}</p>
                </div>
              ));
            })()}
          </div>

          {/* Bar chart */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-bold text-sm mb-4" style={{ color: '#192250' }}>Monthly Performance — {currentYear}</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={24} />
                <Tooltip
                  formatter={(val: any) => [val ?? '—', 'Score']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                />
                <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.score != null ? perfColor(entry.score) : '#e5e7eb'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Score breakdown table */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="font-bold text-sm" style={{ color: '#192250' }}>Score Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: '#f8f9fc' }}>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Month</th>
                    {PERF_COLS.map(h => (
                      <th key={h} className="text-center px-2 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyPerf.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-gray-400 text-sm py-10">No reviews yet for {currentYear}</td></tr>
                  ) : monthlyPerf.map(r => (
                    <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-semibold" style={{ color: '#192250' }}>{MONTHS_SHORT[r.month - 1]}</td>
                      {PERF_KEYS.map((k, i) => (
                        <td key={i} className="px-2 py-3 text-center font-bold tabular-nums" style={{ color: perfColor(r[k] ?? 0) }}>{r[k] ?? 0}</td>
                      ))}
                      <td className="px-3 py-3 text-center">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{ background: `${perfColor(r.overall_score)}18`, color: perfColor(r.overall_score) }}>
                          {r.overall_score}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Appraisal Goals ─── */}

          {/* Current appraisal window — only shown when admin has opened it */}
          {appraisalWindowOpen && (
            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: '#ffd6e8' }}>
              <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#ffd6e8', background: 'rgba(238,39,112,0.04)' }}>
                <div>
                  <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: '#192250' }}>
                    <FileText size={15} style={{ color: '#EE2770' }} />
                    Appraisal Goals — {MONTHS_SHORT[currentMonth - 1]} {currentYear}
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">Your appraisal window is open. Fill and submit your goals.</p>
                </div>
                {isSubmitted ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: '#dcfce7', color: '#15803d' }}>
                    <Lock size={11} /> Submitted
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                    Draft
                  </span>
                )}
              </div>

              <div className="p-5">
                {isSubmitted ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 rounded-xl text-sm" style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
                      <CheckCircle size={15} />
                      <span>Submitted on {new Date(currentAppraisal.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. Update your self-assessment below — admin sets the final status.</span>
                    </div>
                    {renderGoalSelfEditor(currentAppraisal)}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-xs text-gray-400">Add up to 6 goals. Save draft to continue later. Submit to lock for review.</p>
                    {goalsDraft.map((g, i) => (
                      <div key={i} className="border rounded-xl p-4 space-y-3" style={{ borderColor: '#e2e4ed' }}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#EE2770' }}>Goal {i + 1}</span>
                          {goalsDraft.length > 1 && (
                            <button onClick={() => setGoalsDraft(g => g.filter((_, j) => j !== i))} className="p-1 hover:bg-red-50 rounded">
                              <Trash2 size={13} className="text-red-400" />
                            </button>
                          )}
                        </div>
                        <input value={g.title ?? ''} onChange={e => updateGoal(i, 'title', e.target.value)}
                          placeholder="Goal title *"
                          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                          style={{ borderColor: '#e2e4ed' }}
                          onFocus={e => { e.target.style.borderColor = '#192250'; }}
                          onBlur={e => { e.target.style.borderColor = '#e2e4ed'; }} />
                        <textarea value={g.description ?? ''} onChange={e => updateGoal(i, 'description', e.target.value)}
                          rows={2} placeholder="Description (optional)"
                          className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none"
                          style={{ borderColor: '#e2e4ed' }}
                          onFocus={e => { e.target.style.borderColor = '#192250'; }}
                          onBlur={e => { e.target.style.borderColor = '#e2e4ed'; }} />
                        <input value={g.success_criteria ?? ''} onChange={e => updateGoal(i, 'success_criteria', e.target.value)}
                          placeholder="Success criteria / measurable outcome"
                          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                          style={{ borderColor: '#e2e4ed' }}
                          onFocus={e => { e.target.style.borderColor = '#192250'; }}
                          onBlur={e => { e.target.style.borderColor = '#e2e4ed'; }} />
                      </div>
                    ))}
                    {goalsDraft.length < 6 && (
                      <button
                        onClick={() => setGoalsDraft(g => [...g, { title: '', description: '', success_criteria: '' }])}
                        className="w-full py-2.5 border-2 border-dashed rounded-xl text-sm font-semibold text-gray-400 transition-colors"
                        style={{ borderColor: '#e2e4ed' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#EE2770'; (e.currentTarget as HTMLElement).style.color = '#EE2770'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e2e4ed'; (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
                      >+ Add Another Goal</button>
                    )}
                    {goalsError && (
                      <p className="text-xs text-red-500 flex items-center gap-1.5"><AlertCircle size={13} /> {goalsError}</p>
                    )}
                    <div className="flex gap-3 pt-2">
                      <button onClick={handleSaveDraft} disabled={savingGoals}
                        className="flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
                        style={{ color: '#192250', borderColor: '#e2e4ed' }}>
                        <Save size={14} /> {savingGoals ? 'Saving…' : 'Save Draft'}
                      </button>
                      <button onClick={handleSubmitGoals} disabled={submittingGoals}
                        className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-60"
                        style={{ background: 'linear-gradient(135deg, #EE2770 0%, #d11f62 100%)' }}>
                        <CheckCircle size={14} /> {submittingGoals ? 'Submitting…' : 'Submit for Appraisal'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Past Appraisal Submissions */}
          {(pastAppraisals.length > 0 || (!appraisalWindowOpen && allAppraisals.length > 0)) && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: '#192250' }}>
                  <FileText size={15} /> Past Appraisal Submissions
                </h3>
              </div>
              <div className="divide-y divide-gray-50">
                {(appraisalWindowOpen ? pastAppraisals : allAppraisals).map((appraisal: any) => (
                  <details key={`${appraisal.year}-${appraisal.month}`} className="group">
                    <summary className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-50/50 list-none">
                      <div className="flex-1 flex items-center gap-3">
                        <span className="font-semibold text-sm" style={{ color: '#192250' }}>
                          {MONTHS_SHORT[appraisal.month - 1]} {appraisal.year}
                        </span>
                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                          style={appraisal.submitted
                            ? { background: '#dcfce7', color: '#15803d' }
                            : { background: '#fef3c7', color: '#92400e' }}>
                          {appraisal.submitted ? '✓ Submitted' : 'Draft'}
                        </span>
                        <span className="text-xs text-gray-400">{appraisal.goals?.length ?? 0} goals</span>
                      </div>
                      {appraisal.submitted_at && (
                        <span className="text-xs text-gray-400">
                          {new Date(appraisal.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </summary>
                    <div className="px-5 pb-4 pt-2">
                      {appraisal.submitted
                        ? renderGoalSelfEditor(appraisal)
                        : <div className="space-y-3">{(appraisal.goals ?? []).map((g: any, i: number) => <GoalCard key={i} goal={g} index={i} />)}</div>
                      }
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* No appraisal window open and no past records */}
          {!appraisalWindowOpen && allAppraisals.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
              <FileText size={28} className="mx-auto text-gray-200 mb-3" />
              <p className="font-medium text-gray-400 text-sm">No appraisal scheduled</p>
              <p className="text-xs text-gray-300 mt-1">Your manager will open the appraisal window when it's time</p>
            </div>
          )}
        </div>
      )}

      {/* ── My Team ── */}
      {tab === 'myteam' && (
        <div className="space-y-5">

          {/* Pending leave approvals */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: '#192250' }}>
                <Calendar size={15} style={{ color: '#EE2770' }} /> Pending Leave Requests
              </h3>
              {teamPendingLeaves.length > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                  {teamPendingLeaves.length} pending
                </span>
              )}
            </div>
            {teamPendingLeaves.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">No pending leave requests from your team.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {teamPendingLeaves.map(l => (
                  <div key={l.id} className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold"
                        style={{ background: 'rgba(25,34,80,0.08)', color: '#192250' }}>
                        {l.employee_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{l.employee_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5 capitalize">
                          {l.type} leave · {l.days}d ·{' '}
                          {new Date(l.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {l.from_date !== l.to_date && ` – ${new Date(l.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                        </p>
                        {l.reason && <p className="text-xs text-gray-400 mt-0.5 italic">"{l.reason}"</p>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleManagerApproveLeave(l.id, 'approved')}
                        disabled={approvingLeave[l.id]}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                        style={{ background: '#dcfce7', color: '#15803d' }}>
                        {approvingLeave[l.id] ? '…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleManagerApproveLeave(l.id, 'rejected')}
                        disabled={approvingLeave[l.id]}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                        style={{ background: '#fee2e2', color: '#dc2626' }}>
                        {approvingLeave[l.id] ? '…' : 'Reject'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Team members + performance */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: '#192250' }}>
                <Users size={15} style={{ color: '#EE2770' }} /> Team Members
              </h3>
            </div>
            <div className="divide-y divide-gray-50">
              {teamMembers.map(member => {
                const perf = teamPerf[member.id] ?? [];
                const latest = perf.length ? perf.reduce((a: any, b: any) => (a.month > b.month ? a : b)) : null;
                return (
                  <div key={member.id} className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
                        style={{ background: 'rgba(25,34,80,0.08)', color: '#192250' }}>
                        {member.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{member.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{member.designation} · {member.department}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {latest ? (
                        <div className="text-center">
                          <p className="text-lg font-black" style={{ color: perfColor(latest.overall_score) }}>
                            {latest.overall_score}
                          </p>
                          <p className="text-xs text-gray-400">
                            {MONTHS_SHORT[latest.month - 1]} score
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-300">No review yet</p>
                      )}
                      <button
                        onClick={() => {
                          setShowTeamReview(member);
                          setTeamReviewScores({ productivity: 75, quality: 75, teamwork: 75, attendance_score: 75, initiative: 75, client_satisfaction: 75 });
                          setTeamReviewComment('');
                        }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors"
                        style={{ background: 'rgba(25,34,80,0.07)', color: '#192250' }}>
                        + Review
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Team Review Modal */}
      {showTeamReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-5 text-white flex items-center justify-between"
              style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
              <div>
                <h3 className="font-bold text-base">Monthly Review</h3>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {showTeamReview.name} · {MONTHS_SHORT[currentMonth - 1]} {currentYear}
                </p>
              </div>
              <button onClick={() => setShowTeamReview(null)}>
                <X size={18} className="text-white/60 hover:text-white" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {SCORE_CATEGORIES.map(({ key, label }) => (
                <div key={key}>
                  <div className="flex justify-between mb-1.5">
                    <label className="text-xs font-semibold text-gray-600">{label}</label>
                    <span className="text-xs font-bold" style={{ color: perfColor(teamReviewScores[key]) }}>
                      {teamReviewScores[key]}
                    </span>
                  </div>
                  <input type="range" min={0} max={100}
                    value={teamReviewScores[key]}
                    onChange={e => setTeamReviewScores(s => ({ ...s, [key]: Number(e.target.value) }))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{ accentColor: perfColor(teamReviewScores[key]) }}
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Overall Score</label>
                <div className="text-2xl font-black" style={{ color: perfColor(Math.round(Object.values(teamReviewScores).reduce((a, b) => a + b, 0) / SCORE_CATEGORIES.length)) }}>
                  {Math.round(Object.values(teamReviewScores).reduce((a, b) => a + b, 0) / SCORE_CATEGORIES.length)}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Comments (optional)</label>
                <textarea value={teamReviewComment} onChange={e => setTeamReviewComment(e.target.value)}
                  rows={3} placeholder="Add feedback for this team member..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-gray-300" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowTeamReview(null)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={handleSaveTeamReview} disabled={savingTeamReview}
                  className="flex-1 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
                  {savingTeamReview ? 'Saving…' : 'Save Review'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
