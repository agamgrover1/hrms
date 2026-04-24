import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, Calendar, TrendingUp, CheckCircle, XCircle, AlertCircle,
  X, Save, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { GOAL_STATUSES, GOAL_STATUS_CONFIG } from '../Performance';
import type { GoalStatus } from '../Performance';

const SCORE_CATEGORIES = [
  { key: 'productivity',        label: 'Productivity' },
  { key: 'quality',             label: 'Quality of Work' },
  { key: 'teamwork',            label: 'Teamwork' },
  { key: 'attendance_score',    label: 'Attendance' },
  { key: 'initiative',          label: 'Initiative' },
  { key: 'client_satisfaction', label: 'Client Satisfaction' },
  { key: 'ai_usage',            label: 'AI Usage' },
] as const;

// ── helpers ──────────────────────────────────────────────────────────────────
function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  if (dateStr.includes('T')) {
    const d = new Date(dateStr);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function perfColor(s: number) {
  if (s >= 85) return '#16a34a';
  if (s >= 70) return '#192250';
  if (s >= 50) return '#d97706';
  return '#dc2626';
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const leaveStatusColors: Record<string, string> = {
  approved:  'bg-green-50 text-green-700 border-green-200',
  rejected:  'bg-red-50 text-red-600 border-red-200',
  pending:   'bg-amber-50 text-amber-600 border-amber-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

// ── Reject reason input ───────────────────────────────────────────────────────
function RejectInput({ onClose, onConfirm, placeholder = 'Enter reason…', confirmLabel = 'Confirm', confirmClass = 'bg-red-500 hover:bg-red-600' }:
  { onClose: () => void; onConfirm: (r: string) => void; placeholder?: string; confirmLabel?: string; confirmClass?: string }) {
  const [reason, setReason] = useState('');
  return (
    <>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder={placeholder} autoFocus
        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none resize-none mb-4" />
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
        <button onClick={() => { if (reason.trim()) onConfirm(reason.trim()); }} disabled={!reason.trim()}
          className={`flex-1 py-2.5 disabled:opacity-40 text-white rounded-lg text-sm font-medium ${confirmClass}`}>
          {confirmLabel}
        </button>
      </div>
    </>
  );
}

// ── Score slider ──────────────────────────────────────────────────────────────
function ScoreSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <label className="text-xs font-semibold text-gray-600">{label}</label>
        <span className="text-xs font-bold" style={{ color: perfColor(value) }}>{value}</span>
      </div>
      <input type="range" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: perfColor(value) }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
type SubTab = 'leaves' | 'performance';

export default function MyTeam() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const subTab = useMemo<SubTab>(() => {
    const t = searchParams.get('tab');
    return t === 'performance' ? 'performance' : 'leaves';
  }, [searchParams]);

  // Resolved DB id of the logged-in employee (manager)
  const [empDbId, setEmpDbId] = useState('');
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // ── Leaves state ────────────────────────────────────────────────────────────
  const [pendingLeaves, setPendingLeaves] = useState<any[]>([]);
  const [approvingLeave, setApprovingLeave] = useState<Record<string, boolean>>({});
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [viewLeavesFor, setViewLeavesFor] = useState<any | null>(null);
  const [memberLeaves, setMemberLeaves] = useState<any[]>([]);
  const [memberBalance, setMemberBalance] = useState<any | null>(null);
  const [loadingMemberLeaves, setLoadingMemberLeaves] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  // ── Performance state ───────────────────────────────────────────────────────
  const [teamPerf, setTeamPerf] = useState<Record<string, any[]>>({});
  const [showReview, setShowReview] = useState<any | null>(null);
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(SCORE_CATEGORIES.map(c => [c.key, 75]))
  );
  const [reviewComment, setReviewComment] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [appraisals, setAppraisals] = useState<Record<string, any[]>>({});

  // ── Load team ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.employee_id_ref) return;
    setLoading(true);
    api.getEmployees().then(emps => {
      const emp = emps.find(e => e.employee_id === user.employee_id_ref);
      if (!emp) { setLoading(false); return; }
      const eid = emp.id;
      setEmpDbId(eid);
      api.getTeamMembers(eid).then(members => {
        setTeamMembers(members);
        setLoading(false);
        if (!members.length) return;
        api.getLeaveRequests({ reporting_manager_id: eid })
          .then(lv => setPendingLeaves(lv.filter((l: any) => l.manager_status === 'pending')));
        members.forEach((m: any) => {
          api.getMonthlyPerformance(m.id, currentYear)
            .then(perf => setTeamPerf(prev => ({ ...prev, [m.id]: perf })));
          api.getAppraisalGoals({ employee_id: m.id })
            .then(ap => setAppraisals(prev => ({ ...prev, [m.id]: Array.isArray(ap) ? ap : [] })));
        });
      });
    });
  }, [user?.employee_id_ref, currentYear]);

  // ── Leave handlers ──────────────────────────────────────────────────────────
  const handleApproveLeave = async (id: string, status: 'approved' | 'rejected', reason?: string) => {
    setApprovingLeave(p => ({ ...p, [id]: true }));
    try {
      await api.managerApproveLeave(id, { status, manager_id: empDbId, manager_name: user?.name, rejection_reason: reason });
      setPendingLeaves(p => p.filter(l => l.id !== id));
    } catch { /* ignore */ }
    finally { setApprovingLeave(p => ({ ...p, [id]: false })); }
  };

  const handleViewLeaves = async (member: any) => {
    if (viewLeavesFor?.id === member.id) { setViewLeavesFor(null); return; }
    setViewLeavesFor(member);
    setLoadingMemberLeaves(true);
    try {
      const [lv, bal] = await Promise.all([
        api.getLeaveRequests({ employee_id: member.id }),
        api.getLeaveBalance(member.id).catch(() => null),
      ]);
      setMemberLeaves(lv);
      setMemberBalance(bal);
    } finally { setLoadingMemberLeaves(false); }
  };

  const handleCancelLeave = async (leaveId: string, reason: string) => {
    await api.cancelLeave(leaveId, user?.name ?? 'Manager', reason);
    setMemberLeaves(p => p.map(l => l.id === leaveId
      ? { ...l, status: 'cancelled', cancelled_by: user?.name, cancelled_at: new Date().toISOString(), cancellation_reason: reason }
      : l));
    if (viewLeavesFor) api.getLeaveBalance(viewLeavesFor.id).then(setMemberBalance).catch(() => {});
  };

  // ── Performance handlers ────────────────────────────────────────────────────
  const openReview = (member: any) => {
    setShowReview(member);
    setScores(Object.fromEntries(SCORE_CATEGORIES.map(c => [c.key, 75])));
    setReviewComment('');
  };

  const handleSaveReview = async () => {
    if (!showReview || !empDbId) return;
    setSavingReview(true);
    try {
      const overall = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / SCORE_CATEGORIES.length);
      await api.saveMonthlyPerformance({
        employee_id: showReview.id, reviewer_id: empDbId, reviewer_name: user?.name,
        month: currentMonth, year: currentYear,
        ...Object.fromEntries(SCORE_CATEGORIES.map(c => [c.key, scores[c.key]])) as any,
        overall_score: overall, comments: reviewComment,
      });
      api.getMonthlyPerformance(showReview.id, currentYear)
        .then(perf => setTeamPerf(prev => ({ ...prev, [showReview.id]: perf })));
      setShowReview(null);
    } catch { /* ignore */ }
    finally { setSavingReview(false); }
  };

  const handleUpdateAppraisalGoal = async (memberId: string, appraisal: any, goalIdx: number, newStatus: GoalStatus) => {
    const updatedGoals = appraisal.goals.map((g: any, i: number) => i === goalIdx ? { ...g, status: newStatus } : g);
    await api.adminSaveAppraisalGoals({ employee_id: memberId, year: appraisal.year, month: appraisal.month, goals: updatedGoals });
    setAppraisals(prev => ({ ...prev, [memberId]: (prev[memberId] ?? []).map(a =>
      a.year === appraisal.year && a.month === appraisal.month ? { ...a, goals: updatedGoals } : a
    )}));
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
    </div>
  );

  if (!loading && teamMembers.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <Users size={36} className="text-gray-200" />
      <p className="font-semibold text-gray-400">No team members yet</p>
      <p className="text-sm text-gray-300">You will see your direct reports here once assigned</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Sub-tab switcher */}
      <div className="flex gap-1 bg-white rounded-xl p-1 border border-gray-100 shadow-sm w-fit">
        {([
          { key: 'leaves',      label: 'Leaves',      icon: Calendar   },
          { key: 'performance', label: 'Performance', icon: TrendingUp },
        ] as { key: SubTab; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => navigate(`/my-team?tab=${key}`)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={subTab === key ? { background: '#192250', color: '#fff' } : { color: '#6b7280' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── LEAVES TAB ────────────────────────────────────────────────────── */}
      {subTab === 'leaves' && (
        <div className="space-y-5">
          {/* Pending approvals */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: '#192250' }}>
                <Calendar size={15} style={{ color: '#EE2770' }} /> Pending Leave Requests
              </h3>
              {pendingLeaves.length > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                  {pendingLeaves.length} pending
                </span>
              )}
            </div>
            {pendingLeaves.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">No pending leave requests</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {pendingLeaves.map(l => (
                  <div key={l.id} className="flex items-start justify-between px-5 py-4 gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{ background: 'rgba(25,34,80,0.08)', color: '#192250' }}>
                        {l.employee_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{l.employee_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5 capitalize">
                          {l.type.replace('_', ' ')} · {l.days}d · {' '}
                          {parseLocalDate(l.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {l.from_date !== l.to_date && ` – ${parseLocalDate(l.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                        </p>
                        {l.reason && <p className="text-xs text-gray-400 mt-0.5 italic truncate">"{l.reason}"</p>}
                        {l.created_at && (
                          <p className="text-xs text-gray-300 mt-0.5">
                            Applied: {new Date(l.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => handleApproveLeave(l.id, 'approved')}
                        disabled={approvingLeave[l.id]}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50"
                        style={{ background: '#dcfce7', color: '#15803d' }}>
                        <CheckCircle size={12} /> {approvingLeave[l.id] ? '…' : 'Approve'}
                      </button>
                      <button onClick={() => setRejectTarget(l.id)}
                        disabled={approvingLeave[l.id]}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50"
                        style={{ background: '#fee2e2', color: '#dc2626' }}>
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per-member leave history */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-sm" style={{ color: '#192250' }}>Team Leave History</h3>
              <p className="text-xs text-gray-400 mt-0.5">Click a member to view their full leave record</p>
            </div>
            <div className="divide-y divide-gray-50">
              {teamMembers.map(member => {
                const isViewing = viewLeavesFor?.id === member.id;
                return (
                  <div key={member.id}>
                    <button onClick={() => handleViewLeaves(member)}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/50 transition-colors text-left">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                          style={{ background: 'rgba(25,34,80,0.08)', color: '#192250' }}>
                          {member.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{member.name}</p>
                          <p className="text-xs text-gray-400">{member.designation}</p>
                        </div>
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors"
                        style={isViewing
                          ? { background: '#EE2770', color: '#fff' }
                          : { background: 'rgba(238,39,112,0.08)', color: '#EE2770' }}>
                        {isViewing ? 'Hide' : 'View Leaves'}
                      </span>
                    </button>

                    {isViewing && (
                      <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4">
                        {loadingMemberLeaves ? (
                          <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                            <div className="w-4 h-4 border-2 border-gray-200 border-t-primary-400 rounded-full animate-spin" />
                            Loading…
                          </div>
                        ) : (
                          <>
                            {/* Balance */}
                            {memberBalance && (
                              <div className="flex flex-wrap gap-2 mb-4">
                                {memberBalance.on_probation ? (
                                  <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700">
                                    On Probation · {memberBalance.probation_short_remaining ?? 0} credits left
                                  </span>
                                ) : (
                                  <>
                                    <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700">Full Day: {memberBalance.full_day ?? 0}</span>
                                    <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-100 text-purple-700">Short/Half: {memberBalance.short_leave ?? 0}</span>
                                    <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-100 text-green-700">Confirmed</span>
                                  </>
                                )}
                              </div>
                            )}
                            {/* Leave table */}
                            {memberLeaves.length === 0 ? (
                              <p className="text-sm text-gray-400 py-2">No leave history</p>
                            ) : (
                              <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                      {['Type','Duration','Days','Reason','Status',''].map(h => (
                                        <th key={h} className="text-left text-xs font-semibold text-gray-500 px-3 py-2.5 uppercase tracking-wide whitespace-nowrap">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {memberLeaves.map(l => (
                                      <tr key={l.id} className="border-b border-gray-50 last:border-0">
                                        <td className="px-3 py-2.5 capitalize text-gray-700 font-medium">{(l.type ?? '').replace('_', ' ')}</td>
                                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                                          {parseLocalDate(l.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                          {l.from_date !== l.to_date && ` – ${parseLocalDate(l.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                                        </td>
                                        <td className="px-3 py-2.5 text-gray-600">{l.days}d</td>
                                        <td className="px-3 py-2.5 text-gray-500 max-w-[120px] truncate">{l.reason}</td>
                                        <td className="px-3 py-2.5">
                                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${leaveStatusColors[l.status] ?? 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                                            {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2.5">
                                          {l.status === 'approved' && (
                                            <button onClick={() => setCancelTarget(l.id)}
                                              className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 font-medium whitespace-nowrap">
                                              Cancel
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── PERFORMANCE TAB ────────────────────────────────────────────────── */}
      {subTab === 'performance' && (
        <div className="space-y-4">
          {teamMembers.map(member => {
            const perf = teamPerf[member.id] ?? [];
            const latest = perf.length ? perf.reduce((a: any, b: any) => a.month > b.month ? a : b) : null;
            const memberAppraisals = appraisals[member.id] ?? [];

            return (
              <div key={member.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Member header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
                      style={{ background: 'rgba(25,34,80,0.08)', color: '#192250' }}>
                      {member.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800">{member.name}</p>
                      <p className="text-xs text-gray-400">{member.designation} · {member.department}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {latest && (
                      <div className="text-center mr-2">
                        <p className="text-lg font-black" style={{ color: perfColor(latest.overall_score) }}>{latest.overall_score}</p>
                        <p className="text-xs text-gray-400">{MONTHS_SHORT[latest.month - 1]}</p>
                      </div>
                    )}
                    <button onClick={() => openReview(member)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border hover:bg-gray-50"
                      style={{ color: '#192250', borderColor: '#e2e4ed' }}>
                      <TrendingUp size={12} /> Add Review
                    </button>
                  </div>
                </div>

                {/* Appraisal goals */}
                {memberAppraisals.filter((a: any) => a.submitted).length > 0 && (
                  <div className="px-5 py-4 border-t border-gray-50">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Submitted Appraisal Goals</p>
                    {memberAppraisals.filter((a: any) => a.submitted).map((appraisal: any) => (
                      <details key={`${appraisal.year}-${appraisal.month}`} className="mb-2 border border-gray-100 rounded-xl overflow-hidden">
                        <summary className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50/50 list-none text-sm">
                          <span className="font-semibold text-gray-700">{MONTHS_SHORT[appraisal.month - 1]} {appraisal.year}</span>
                          <span className="text-xs text-gray-400">{appraisal.goals?.length ?? 0} goals</span>
                        </summary>
                        <div className="px-4 pb-4 pt-2 space-y-3">
                          {(appraisal.goals ?? []).map((g: any, i: number) => {
                            const empStatus: GoalStatus = g.employee_status ?? 'not_started';
                            const empCfg = GOAL_STATUS_CONFIG[empStatus];
                            const EmpIcon = empCfg?.icon;
                            return (
                              <div key={i} className="border rounded-xl p-3" style={{ borderColor: '#e2e4ed' }}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1">
                                    <p className="font-semibold text-sm" style={{ color: '#192250' }}>{g.title}</p>
                                    {g.description && <p className="text-xs text-gray-400 mt-0.5">{g.description}</p>}
                                    {g.success_criteria && <p className="text-xs text-gray-300 mt-0.5 italic">Target: {g.success_criteria}</p>}
                                    {empCfg && (
                                      <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-xs font-semibold"
                                        style={{ background: empCfg.bg, color: empCfg.color, border: `1px solid ${empCfg.border}` }}>
                                        {EmpIcon && <EmpIcon size={10} />} Self: {empCfg.label}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {/* Manager status buttons */}
                                <div className="mt-2">
                                  <p className="text-xs text-gray-400 mb-1.5 font-semibold">Set status:</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {GOAL_STATUSES.map(s => {
                                      const cfg = GOAL_STATUS_CONFIG[s];
                                      const Icon = cfg.icon;
                                      const active = (g.status ?? 'not_started') === s;
                                      return (
                                        <button key={s} onClick={() => handleUpdateAppraisalGoal(member.id, appraisal, i, s)}
                                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border transition-all"
                                          style={active
                                            ? { background: cfg.bg, color: cfg.color, borderColor: cfg.border }
                                            : { background: '#f9fafb', color: '#9ca3af', borderColor: '#e5e7eb' }}>
                                          <Icon size={9} /> {cfg.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Monthly Review Modal ─────────────────────────────────────────────── */}
      {showReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 text-white"
              style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
              <div>
                <h3 className="font-bold text-base">Monthly Review</h3>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {showReview.name} · {MONTHS_SHORT[currentMonth - 1]} {currentYear}
                </p>
              </div>
              <button onClick={() => setShowReview(null)}><X size={18} className="text-white/60 hover:text-white" /></button>
            </div>
            <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              {/* Overall preview */}
              <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(25,34,80,0.04)', border: '1px solid rgba(25,34,80,0.08)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Overall Score</p>
                {(() => {
                  const overall = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / SCORE_CATEGORIES.length);
                  return <p className="text-3xl font-black" style={{ color: perfColor(overall) }}>{overall}</p>;
                })()}
              </div>
              {SCORE_CATEGORIES.map(({ key, label }) => (
                <ScoreSlider key={key} label={label} value={scores[key] ?? 75}
                  onChange={v => setScores(p => ({ ...p, [key]: v }))} />
              ))}
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Comments (optional)</label>
                <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)} rows={3}
                  placeholder="Add feedback for this team member…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setShowReview(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSaveReview} disabled={savingReview}
                className="flex-1 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #EE2770 0%, #d11f62 100%)' }}>
                {savingReview ? <><RefreshCw size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save Review</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject leave modal ───────────────────────────────────────────────── */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Reason for Rejection</h3>
              <button onClick={() => setRejectTarget(null)}><X size={16} className="text-gray-400" /></button>
            </div>
            <RejectInput onClose={() => setRejectTarget(null)} onConfirm={reason => { handleApproveLeave(rejectTarget, 'rejected', reason); setRejectTarget(null); }} />
          </div>
        </div>
      )}

      {/* ── Cancel leave modal ───────────────────────────────────────────────── */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Reason for Cancellation</h3>
              <button onClick={() => setCancelTarget(null)}><X size={16} className="text-gray-400" /></button>
            </div>
            <RejectInput placeholder="Enter reason for cancelling this leave…"
              confirmLabel="Confirm Cancel" confirmClass="bg-gray-700 hover:bg-gray-800"
              onClose={() => setCancelTarget(null)}
              onConfirm={reason => { handleCancelLeave(cancelTarget, reason); setCancelTarget(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}
