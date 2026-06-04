import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Users, Calendar, TrendingUp, CheckCircle, XCircle, AlertCircle,
  X, Save, RefreshCw, Clock, UserCheck, Monitor } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import MemberCalendarModal from '../../components/MemberCalendarModal';
import { GOAL_STATUSES, GOAL_STATUS_CONFIG } from '../Performance';
import type { GoalStatus } from '../Performance';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';

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
  approved:  'bg-success-container text-success border-success/20',
  rejected:  'bg-danger-container text-danger border-danger/20',
  pending:   'bg-warning-container text-warning border-warning/20',
  cancelled: 'bg-surface-2 text-on-surface-subtle border-outline',
};

// ── Reject reason input ───────────────────────────────────────────────────────
function RejectInput({ onClose, onConfirm, placeholder = 'Enter reason…', confirmLabel = 'Confirm', confirmClass = 'bg-danger hover:opacity-90' }:
  { onClose: () => void; onConfirm: (r: string) => void; placeholder?: string; confirmLabel?: string; confirmClass?: string }) {
  const [reason, setReason] = useState('');
  return (
    <>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder={placeholder} autoFocus
        className="w-full bg-surface-2 border border-outline text-on-surface placeholder:text-on-surface-subtle caret-accent rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none mb-4" />
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 border border-outline text-on-surface-muted rounded-lg text-sm font-medium hover:bg-surface-2">Cancel</button>
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
        <label className="text-xs font-semibold text-on-surface-muted">{label}</label>
        <span className="num-mono text-xs font-bold" style={{ color: perfColor(value) }}>{value}</span>
      </div>
      <input type="range" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: 'rgb(var(--accent))' }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
type SubTab = 'overview' | 'leaves' | 'performance';

export default function MyTeam() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const subTab = useMemo<SubTab>(() => {
    const t = searchParams.get('tab');
    if (t === 'performance') return 'performance';
    if (t === 'leaves') return 'leaves';
    return 'overview';
  }, [searchParams]);

  // Resolved DB id of the logged-in employee (manager)
  const [empDbId, setEmpDbId] = useState('');
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // ── Overview / dashboard state ──────────────────────────────────────────────
  const [teamAttendance, setTeamAttendance] = useState<Record<string, any[]>>({});
  const [teamAllLeaves, setTeamAllLeaves] = useState<any[]>([]);

  // ── Leaves state ────────────────────────────────────────────────────────────
  const [pendingLeaves, setPendingLeaves] = useState<any[]>([]);
  const [approvingLeave, setApprovingLeave] = useState<Record<string, boolean>>({});
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [viewLeavesFor, setViewLeavesFor] = useState<any | null>(null);
  // Per-member calendar drill-in: a month grid showing every day color-coded
  // by attendance + leave status. Click a member card → opens this.
  const [calendarFor, setCalendarFor] = useState<any | null>(null);
  const [memberLeaves, setMemberLeaves] = useState<any[]>([]);
  const [memberBalance, setMemberBalance] = useState<any | null>(null);
  const [loadingMemberLeaves, setLoadingMemberLeaves] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  // ── WFH state ────────────────────────────────────────────────────────────────
  const [pendingWfh, setPendingWfh] = useState<any[]>([]);
  const [approvingWfh, setApprovingWfh] = useState<Record<string, boolean>>({});
  const [rejectWfhTarget, setRejectWfhTarget] = useState<string | null>(null);

  // ── Performance state ───────────────────────────────────────────────────────
  const [teamPerf, setTeamPerf] = useState<Record<string, any[]>>({});
  const [showReview, setShowReview] = useState<any | null>(null);
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(SCORE_CATEGORIES.map(c => [c.key, 75]))
  );
  const [reviewComment, setReviewComment] = useState('');
  const [paramNotes, setParamNotes] = useState<Record<string, string>>({});
  const [savingReview, setSavingReview] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [warnTarget, setWarnTarget] = useState<any | null>(null);
  const [warnReason, setWarnReason] = useState('');
  const [warnSeverity, setWarnSeverity] = useState('warning');
  const [issuingWarn, setIssuingWarn] = useState(false);
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
      // includeDescendants=true so a 2nd/3rd-level manager sees their entire
      // sub-tree, not just direct reports — they have the same responsibilities
      // for the whole branch.
      api.getTeamMembers(eid, true).then(members => {
        setTeamMembers(members);
        setLoading(false);
        if (!members.length) return;
        api.getLeaveRequests({ reporting_manager_id: eid })
          .then(lv => setPendingLeaves(lv.filter((l: any) => l.manager_status === 'pending')));
        api.getWfhRequests({ reporting_manager_id: eid })
          .then((wfh: any[]) => setPendingWfh(wfh.filter(w => w.manager_status === 'pending' && w.status === 'pending')));
        members.forEach((m: any) => {
          api.getMonthlyPerformance(m.id, currentYear)
            .then(perf => setTeamPerf(prev => ({ ...prev, [m.id]: perf })));
          api.getAppraisalGoals({ employee_id: m.id })
            .then(ap => setAppraisals(prev => ({ ...prev, [m.id]: Array.isArray(ap) ? ap : [] })));
          api.getAttendance({ employee_id: m.id, month: now.getMonth() + 1, year: now.getFullYear() })
            .then(att => setTeamAttendance(prev => ({ ...prev, [m.id]: att })));
          api.getLeaveRequests({ employee_id: m.id })
            .then(lv => setTeamAllLeaves(prev => [...prev, ...lv]));
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

  // ── WFH handler ──────────────────────────────────────────────────────────────
  const handleApproveWfh = async (id: string, status: 'approved' | 'rejected', reason?: string) => {
    setApprovingWfh(p => ({ ...p, [id]: true }));
    try {
      await api.managerApproveWfh(id, { status, manager_id: empDbId, manager_name: user?.name, rejection_reason: reason });
      setPendingWfh(p => p.filter(w => w.id !== id));
    } catch { /* ignore */ }
    finally { setApprovingWfh(p => ({ ...p, [id]: false })); }
  };

  // ── Performance handlers ────────────────────────────────────────────────────
  const openReview = (member: any) => {
    setShowReview(member);
    setScores(Object.fromEntries(SCORE_CATEGORIES.map(c => [c.key, 75])));
    setReviewComment('');
    setParamNotes({});
    setReviewError('');
  };

  const handleSaveReview = async () => {
    if (!showReview || !empDbId) return;
    setSavingReview(true);
    setReviewError('');
    try {
      const overall = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / SCORE_CATEGORIES.length);
      await api.saveMonthlyPerformance({
        employee_id: showReview.id, reviewer_id: empDbId, reviewer_name: user?.name,
        month: currentMonth, year: currentYear,
        ...Object.fromEntries(SCORE_CATEGORIES.map(c => [c.key, scores[c.key]])) as any,
        overall_score: overall, comments: reviewComment,
        parameter_notes: paramNotes,
        requester_role: user?.role,
      });
      api.getMonthlyPerformance(showReview.id, currentYear)
        .then(perf => setTeamPerf(prev => ({ ...prev, [showReview.id]: perf })));
      setShowReview(null);
    } catch (err: any) {
      setReviewError(err.message ?? 'Failed to save review');
    }
    finally { setSavingReview(false); }
  };

  const handleUpdateAppraisalGoal = async (memberId: string, appraisal: any, goalIdx: number, newStatus: GoalStatus) => {
    const updatedGoals = appraisal.goals.map((g: any, i: number) => i === goalIdx ? { ...g, status: newStatus } : g);
    await api.adminSaveAppraisalGoals({ employee_id: memberId, year: appraisal.year, month: appraisal.month, goals: updatedGoals });
    setAppraisals(prev => ({ ...prev, [memberId]: (prev[memberId] ?? []).map(a =>
      a.year === appraisal.year && a.month === appraisal.month ? { ...a, goals: updatedGoals } : a
    )}));
  };

  // ── Dashboard computed data ──────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split('T')[0];
  const leaveStatuses = new Set(['on_leave','half-day','short_leave','unpaid_leave']);

  const presentToday  = teamMembers.filter(m => ['present','late'].includes(teamAttendance[m.id]?.find((r: any) => r.date === todayStr)?.status ?? '')).length;
  const lateToday     = teamMembers.filter(m => teamAttendance[m.id]?.find((r: any) => r.date === todayStr)?.status === 'late').length;
  const onLeaveToday  = teamMembers.filter(m => leaveStatuses.has(teamAttendance[m.id]?.find((r: any) => r.date === todayStr)?.status ?? '')).length;

  // Attendance per member (stacked bar). Use a unique key per row so Recharts'
  // category axis doesn't collapse two team members who share a first name into
  // one bar — happens whenever the team has e.g. two Amrits or two Vivek+Vimla.
  const firstNameCounts: Record<string, number> = {};
  for (const m of teamMembers) {
    const first = (m.name || '').split(' ')[0] || '—';
    firstNameCounts[first] = (firstNameCounts[first] ?? 0) + 1;
  }
  const attBarData = teamMembers.map(m => {
    const att = teamAttendance[m.id] ?? [];
    const parts = (m.name || '').split(' ');
    const first = parts[0] || '—';
    // If multiple team members share the first name, append the last initial.
    const display = firstNameCounts[first] > 1 && parts[1]
      ? `${first} ${parts[1][0]}.`
      : first;
    return {
      // dataKey must be unique per row — fall back to employee id for the edge case
      // where two members still collide (same first name + same last initial).
      name: display,
      _key: m.id,
      Present: att.filter((r: any) => r.status === 'present').length,
      Late: att.filter((r: any) => r.status === 'late').length,
      WFH: att.filter((r: any) => ['wfh','wfh_half'].includes(r.status)).length,
      Leave: att.filter((r: any) => leaveStatuses.has(r.status)).length,
      Absent: att.filter((r: any) => r.status === 'absent').length,
    };
  });
  // Final dedupe pass — if two display labels still collide, suffix with #2, #3…
  const seen: Record<string, number> = {};
  for (const row of attBarData) {
    const c = (seen[row.name] ?? 0) + 1;
    seen[row.name] = c;
    if (c > 1) row.name = `${row.name} #${c}`;
  }

  const totalWfhToday = teamMembers.filter(m =>
    ['wfh','wfh_half'].includes(teamAttendance[m.id]?.find((r: any) => r.date === todayStr)?.status ?? '')
  ).length;

  // Leave distribution this month (donut)
  const leaveTypeLabels: Record<string,string> = { full_day:'Full Day', half_day:'Half Day', short_leave:'Short Leave', unpaid:'Unpaid' };
  const leaveCountMap: Record<string,number> = {};
  teamAllLeaves.forEach((l: any) => {
    if (l.status === 'cancelled' || l.status === 'rejected') return;
    const d = new Date(l.from_date);
    if (d.getMonth() + 1 !== now.getMonth() + 1 || d.getFullYear() !== now.getFullYear()) return;
    const label = leaveTypeLabels[l.type] ?? l.type.replace('_',' ');
    leaveCountMap[label] = (leaveCountMap[label] ?? 0) + 1;
  });
  const leaveDonutData = Object.entries(leaveCountMap).map(([name, value]) => ({ name, value }));

  // Performance trend – last 6 months
  const last6: { month: number; year: number; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    last6.push({ month: d.getMonth() + 1, year: d.getFullYear(), label: MONTHS_SHORT[d.getMonth()] });
  }
  const perfTrendData = last6.map(({ month, year, label }) => {
    const point: any = { label };
    teamMembers.forEach(m => {
      const rec = (teamPerf[m.id] ?? []).find((r: any) => r.month === month && r.year === year);
      if (rec) point[m.name.split(' ')[0]] = rec.overall_score;
    });
    return point;
  });

  const BRAND_COLORS = ['#EE2770','#192250','#f59e0b','#10b981','#6366f1','#ef4444'];
  const memberColors = teamMembers.map((_, i) => BRAND_COLORS[i % BRAND_COLORS.length]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-4 border-outline border-t-accent rounded-full animate-spin" />
    </div>
  );

  if (!loading && teamMembers.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <Users size={36} className="text-success/60" />
      <p className="font-semibold text-on-surface-muted">No team members yet</p>
      <p className="text-sm text-on-surface-subtle">You will see your direct reports here once assigned</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Sub-tab switcher */}
      <div className="flex gap-1 bg-surface rounded-xl-2 p-1 border border-outline shadow-elev-1 w-fit">
        {([
          { key: 'overview',    label: 'Overview',    icon: Users      },
          { key: 'leaves',      label: 'Leaves',      icon: Calendar   },
          { key: 'performance', label: 'Performance', icon: TrendingUp },
        ] as { key: SubTab; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => navigate(`/my-team?tab=${key}`)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              subTab === key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW / DASHBOARD TAB ─────────────────────────────────────── */}
      {subTab === 'overview' && (
        <div className="space-y-5">

          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { label: 'Team Size',     value: teamMembers.length, icon: Users,      iconBg: 'bg-brand-container',   iconColor: 'text-on-brand-container', blob: 'bg-brand/15'   },
              { label: 'Present Today', value: presentToday,       icon: UserCheck,  iconBg: 'bg-success-container', iconColor: 'text-success',            blob: 'bg-success/15' },
              { label: 'WFH Today',     value: totalWfhToday,      icon: Monitor,    iconBg: 'bg-brand-container',   iconColor: 'text-on-brand-container', blob: 'bg-brand/15'   },
              { label: 'Late Today',    value: lateToday,          icon: Clock,      iconBg: 'bg-warning-container', iconColor: 'text-warning',            blob: 'bg-warning/15' },
              { label: 'On Leave',      value: onLeaveToday,       icon: Calendar,   iconBg: 'bg-accent-container',  iconColor: 'text-on-accent-container',blob: 'bg-accent/15'  },
            ].map(({ label, value, icon: Icon, iconBg, iconColor, blob }, i) => (
              <div key={label}
                className={`group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up stagger-${i + 1}`}>
                <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full ${blob} blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500`} />
                <div className="relative">
                  <div className={`w-10 h-10 rounded-xl-2 flex items-center justify-center mb-3 ${iconBg}`}>
                    <Icon size={18} className={iconColor} strokeWidth={1.75} />
                  </div>
                  <p className={`num-mono text-2xl font-semibold text-on-surface`}>{value}</p>
                  <p className="text-xs text-on-surface-muted mt-1 font-medium">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Attendance per person + Leave distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Stacked bar — attendance per person this month */}
            <div className="group relative lg:col-span-2 bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-shadow overflow-hidden p-5">
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50" />
              <div className="relative">
                <h3 className="font-display text-xl font-bold tracking-tight text-on-surface mb-1">Attendance This Month</h3>
                <p className="text-xs text-on-surface-muted mb-4">Working days breakdown per team member</p>
                {attBarData.length === 0 || Object.keys(teamAttendance).length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-on-surface-subtle text-sm">Loading attendance data…</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={attBarData} barSize={18} layout="vertical"
                      margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 600 }}
                        axisLine={false} tickLine={false} width={64} />
                      <Tooltip contentStyle={{ background: 'rgb(var(--surface-3))', borderRadius: 12, border: '1px solid rgb(var(--outline))', boxShadow: 'var(--elev-3)', color: 'rgb(var(--on-surface))', fontSize: 12 }} />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Present" stackId="a" fill="#34d399" radius={[0,0,0,0]} />
                      <Bar dataKey="Late"    stackId="a" fill="#fbbf24" />
                      <Bar dataKey="WFH"     stackId="a" fill="rgb(var(--brand))" />
                      <Bar dataKey="Leave"   stackId="a" fill="#7c5cff" />
                      <Bar dataKey="Absent"  stackId="a" fill="#f87171" radius={[0,4,4,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Donut — leave type distribution */}
            <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-shadow overflow-hidden p-5">
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-accent/15 blur-2xl opacity-50" />
              <div className="relative">
                <h3 className="font-display text-xl font-bold tracking-tight text-on-surface mb-1">Leave Distribution</h3>
                <p className="text-xs text-on-surface-muted mb-4">By type this month</p>
                {leaveDonutData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <Calendar size={28} className="text-success/60" />
                    <p className="text-xs text-on-surface-subtle">No leaves this month</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={leaveDonutData} cx="50%" cy="50%" innerRadius={52} outerRadius={78}
                        paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}
                        labelLine={false} fontSize={10}>
                        {leaveDonutData.map((_, i) => (
                          <Cell key={i} fill={BRAND_COLORS[i % BRAND_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'rgb(var(--surface-3))', borderRadius: 12, border: '1px solid rgb(var(--outline))', boxShadow: 'var(--elev-3)', color: 'rgb(var(--on-surface))', fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Performance trend line chart */}
          <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-shadow overflow-hidden p-5">
            <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50" />
            <div className="relative">
              <h3 className="font-display text-xl font-bold tracking-tight text-on-surface mb-1">Performance Score Trend</h3>
              <p className="text-xs text-on-surface-muted mb-4">Overall monthly scores — last 6 months</p>
              {teamMembers.every(m => !(teamPerf[m.id] ?? []).length) ? (
                <div className="flex items-center justify-center h-40 text-on-surface-subtle text-sm">No performance reviews yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={perfTrendData} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip contentStyle={{ background: 'rgb(var(--surface-3))', borderRadius: 12, border: '1px solid rgb(var(--outline))', boxShadow: 'var(--elev-3)', color: 'rgb(var(--on-surface))', fontSize: 12 }}
                      formatter={(val: any) => [`${val}/100`, '']} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    {teamMembers.map((m, i) => (
                      <Line key={m.id} type="monotone" dataKey={m.name.split(' ')[0]}
                        stroke={memberColors[i]} strokeWidth={2.5} dot={{ r: 4, fill: memberColors[i] }}
                        activeDot={{ r: 6 }} connectNulls={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Per-member score summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teamMembers.map((m, i) => {
              const perf = teamPerf[m.id] ?? [];
              const latest = perf.length ? perf.reduce((a: any, b: any) => a.month > b.month ? a : b) : null;
              const prev = perf.find((r: any) => r.month === (latest?.month === 1 ? 12 : (latest?.month ?? 0) - 1));
              const trend = latest && prev ? latest.overall_score - prev.overall_score : 0;
              const att = teamAttendance[m.id] ?? [];
              const attRate = att.length ? Math.round(att.filter((r: any) => ['present','late'].includes(r.status)).length / Math.max(att.filter((r: any) => r.status !== 'weekend').length, 1) * 100) : null;
              // Today's clock-in / clock-out (if any). The Compliance page shows
              // who hasn't logged hours — this shows who hasn't clocked in.
              const todayRec = att.find((r: any) => (r.date ?? '').slice(0, 10) === todayStr);
              const todayStatus = todayRec?.status as string | undefined;
              return (
                <button key={m.id} onClick={() => setCalendarFor(m)}
                  className="text-left group bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 hover:border-accent/40 transition-all p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-xl-2 flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: memberColors[i] }}>
                      {m.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-on-surface truncate group-hover:text-accent transition-colors">{m.name}</p>
                      <p className="text-xs text-on-surface-muted truncate">{m.designation}</p>
                    </div>
                  </div>

                  {/* Today's clock-in / clock-out strip */}
                  <div className="rounded-lg bg-surface-2/60 border border-outline px-2.5 py-1.5 mb-2 flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 text-on-surface-muted">
                      <Clock size={11} className="text-on-surface-subtle" />
                      Today
                    </span>
                    <span className="num-mono text-on-surface">
                      {todayStatus && leaveStatuses.has(todayStatus) ? (
                        <span className="text-warning font-semibold">On leave</span>
                      ) : todayRec?.clock_in ? (
                        <>
                          <span>{todayRec.clock_in}</span>
                          <span className="text-on-surface-subtle mx-1">→</span>
                          <span className={todayRec.clock_out ? 'text-on-surface' : 'text-success font-semibold'}>
                            {todayRec.clock_out || 'still in'}
                          </span>
                        </>
                      ) : (
                        <span className="text-on-surface-subtle">Not in yet</span>
                      )}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl-2 p-2.5 text-center bg-surface-2">
                      <p className="num-mono text-lg font-semibold" style={{ color: latest ? perfColor(latest.overall_score) : 'rgb(var(--on-surface-subtle))' }}>
                        {latest ? latest.overall_score : '—'}
                      </p>
                      <p className="text-[10px] text-on-surface-muted">Perf score</p>
                    </div>
                    <div className="rounded-xl-2 p-2.5 text-center bg-surface-2">
                      <p className="num-mono text-lg font-semibold" style={{ color: attRate !== null ? (attRate >= 90 ? '#16a34a' : attRate >= 75 ? '#d97706' : '#dc2626') : 'rgb(var(--on-surface-subtle))' }}>
                        {attRate !== null ? `${attRate}%` : '—'}
                      </p>
                      <p className="text-[10px] text-on-surface-muted">Attendance</p>
                    </div>
                  </div>
                  {trend !== 0 && (
                    <p className={`num-mono text-xs font-semibold mt-2 ${trend > 0 ? 'text-success' : 'text-danger'}`}>
                      {trend > 0 ? '▲' : '▼'} {Math.abs(trend)} pts vs last month
                    </p>
                  )}
                  <p className="text-[10px] text-on-surface-subtle mt-2 inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    Click to view monthly calendar →
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-member calendar drill-in */}
      {calendarFor && (
        <MemberCalendarModal
          member={calendarFor}
          attendance={teamAttendance[calendarFor.id] ?? []}
          leaves={teamAllLeaves.filter((l: any) => l.employee_id === calendarFor.id)}
          onClose={() => setCalendarFor(null)}
        />
      )}

      {/* ── LEAVES TAB ────────────────────────────────────────────────────── */}
      {subTab === 'leaves' && (
        <div className="space-y-5">
          {/* Pending approvals */}
          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
            <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
              <h3 className="font-display text-xl font-bold tracking-tight text-on-surface flex items-center gap-2">
                <Calendar size={15} className="text-accent" /> Pending Leave Requests
              </h3>
              {pendingLeaves.length > 0 && (
                <span className="num-mono text-xs font-bold px-2 py-0.5 rounded-full bg-warning-container text-warning">
                  {pendingLeaves.length} pending
                </span>
              )}
            </div>
            {pendingLeaves.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-10 text-on-surface-muted">
                <CheckCircle size={20} className="text-success/60" />
                <p className="text-sm">No pending leave requests</p>
              </div>
            ) : (
              <div className="divide-y divide-outline">
                {pendingLeaves.map(l => (
                  <div key={l.id} className="flex items-start justify-between px-5 py-4 gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-xl-2 flex items-center justify-center text-sm font-bold flex-shrink-0 bg-brand-container text-on-brand-container">
                        {l.employee_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-on-surface">{l.employee_name}</p>
                        <p className="text-xs text-on-surface-muted mt-0.5 capitalize">
                          {l.type.replace('_', ' ')} · <span className="num-mono">{l.days}d</span> · {' '}
                          {parseLocalDate(l.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {l.from_date !== l.to_date && ` – ${parseLocalDate(l.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                        </p>
                        {l.reason && <p className="text-xs text-on-surface-muted mt-0.5 italic truncate">"{l.reason}"</p>}
                        {l.created_at && (
                          <p className="text-xs text-on-surface-subtle mt-0.5">
                            Applied: {new Date(l.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => handleApproveLeave(l.id, 'approved')}
                        disabled={approvingLeave[l.id]}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 bg-success-container text-success hover:opacity-80 transition-opacity">
                        <CheckCircle size={12} /> {approvingLeave[l.id] ? '…' : 'Approve'}
                      </button>
                      <button onClick={() => setRejectTarget(l.id)}
                        disabled={approvingLeave[l.id]}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 bg-danger-container text-danger hover:opacity-80 transition-opacity">
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending WFH requests */}
          {pendingWfh.length > 0 && (
            <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
              <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
                <h3 className="font-display text-xl font-bold tracking-tight text-on-surface flex items-center gap-2">
                  <span className="text-brand">⊡</span> Pending WFH Requests
                </h3>
                <span className="num-mono text-xs font-bold px-2 py-0.5 rounded-full bg-brand-container text-on-brand-container">{pendingWfh.length}</span>
              </div>
              <div className="divide-y divide-outline">
                {pendingWfh.map(w => (
                  <div key={w.id} className="flex items-start justify-between px-5 py-4 gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-on-surface">{w.employee_name}</p>
                      <p className="text-xs text-on-surface-muted mt-0.5">
                        {w.type === 'half_day' ? 'Half Day WFH' : 'Full Day WFH'} · {' '}
                        {parseLocalDate(w.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      {w.reason && <p className="text-xs text-on-surface-muted mt-0.5 italic">"{w.reason}"</p>}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => handleApproveWfh(w.id, 'approved')} disabled={approvingWfh[w.id]}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 bg-success-container text-success hover:opacity-80 transition-opacity">
                        <CheckCircle size={12} /> {approvingWfh[w.id] ? '…' : 'Approve'}
                      </button>
                      <button onClick={() => setRejectWfhTarget(w.id)} disabled={approvingWfh[w.id]}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 bg-danger-container text-danger hover:opacity-80 transition-opacity">
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-member leave history */}
          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
            <div className="px-5 py-4 border-b border-outline">
              <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Team Leave History</h3>
              <p className="text-xs text-on-surface-muted mt-0.5">Click a member to view their full leave record</p>
            </div>
            <div className="divide-y divide-outline">
              {teamMembers.map(member => {
                const isViewing = viewLeavesFor?.id === member.id;
                return (
                  <div key={member.id}>
                    <button onClick={() => handleViewLeaves(member)}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-surface-2 transition-colors text-left">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold bg-brand-container text-on-brand-container">
                          {member.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-on-surface">{member.name}</p>
                          <p className="text-xs text-on-surface-muted">{member.designation}</p>
                        </div>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                        isViewing ? 'bg-accent text-on-accent' : 'bg-accent-container text-on-accent-container'
                      }`}>
                        {isViewing ? 'Hide' : 'View Leaves'}
                      </span>
                    </button>

                    {isViewing && (
                      <div className="border-t border-outline bg-surface-2 px-5 py-4">
                        {loadingMemberLeaves ? (
                          <div className="flex items-center gap-2 text-sm text-on-surface-muted py-4">
                            <div className="w-4 h-4 border-2 border-outline border-t-accent rounded-full animate-spin" />
                            Loading…
                          </div>
                        ) : (
                          <>
                            {/* Balance */}
                            {memberBalance && (
                              <div className="flex flex-wrap gap-2 mb-4">
                                {memberBalance.on_probation ? (
                                  <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-warning-container text-warning">
                                    On Probation · <span className="num-mono">{memberBalance.probation_short_remaining ?? 0}</span> credits left
                                  </span>
                                ) : (
                                  <>
                                    <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-container text-on-brand-container">Full Day: <span className="num-mono">{memberBalance.full_day ?? 0}</span></span>
                                    <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-accent-container text-on-accent-container">Short/Half: <span className="num-mono">{memberBalance.short_leave ?? 0}</span></span>
                                    <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-success-container text-success">Confirmed</span>
                                  </>
                                )}
                              </div>
                            )}
                            {/* Leave table */}
                            {memberLeaves.length === 0 ? (
                              <p className="text-sm text-on-surface-muted py-2">No leave history</p>
                            ) : (
                              <div className="overflow-x-auto rounded-xl-2 border border-outline bg-surface">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-surface-2 border-b border-outline">
                                      {['Type','Duration','Days','Reason','Status',''].map(h => (
                                        <th key={h} className="text-left text-xs font-semibold text-on-surface-subtle px-3 py-2.5 uppercase tracking-wide whitespace-nowrap">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {memberLeaves.map(l => (
                                      <tr key={l.id} className="border-b border-outline last:border-0">
                                        <td className="px-3 py-2.5 capitalize text-on-surface-muted font-medium">{(l.type ?? '').replace('_', ' ')}</td>
                                        <td className="px-3 py-2.5 text-on-surface-muted whitespace-nowrap">
                                          {parseLocalDate(l.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                          {l.from_date !== l.to_date && ` – ${parseLocalDate(l.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                                        </td>
                                        <td className="px-3 py-2.5 text-on-surface-muted num-mono">{l.days}d</td>
                                        <td className="px-3 py-2.5 text-on-surface-subtle max-w-[120px] truncate">{l.reason}</td>
                                        <td className="px-3 py-2.5">
                                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${leaveStatusColors[l.status] ?? 'bg-surface-2 text-on-surface-subtle border-outline'}`}>
                                            {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2.5">
                                          {l.status === 'approved' && (
                                            <button onClick={() => setCancelTarget(l.id)}
                                              className="text-xs px-2 py-1 bg-surface-2 text-on-surface-muted rounded-md hover:bg-surface-3 font-medium whitespace-nowrap border border-outline">
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
              <div key={member.id} className="group bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-shadow overflow-hidden">
                {/* Member header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-outline">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl-2 flex items-center justify-center text-sm font-bold bg-brand-container text-on-brand-container">
                      {member.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <p className="font-semibold text-on-surface">{member.name}</p>
                      <p className="text-xs text-on-surface-muted">{member.designation} · {member.department}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {latest && (
                      <div className="text-center mr-2">
                        <p className="num-mono text-lg font-semibold" style={{ color: perfColor(latest.overall_score) }}>{latest.overall_score}</p>
                        <p className="text-xs text-on-surface-muted">{MONTHS_SHORT[latest.month - 1]}</p>
                      </div>
                    )}
                    <button onClick={() => openReview(member)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-outline text-on-surface hover:bg-surface-2 transition-colors">
                      <TrendingUp size={12} /> Add Review
                    </button>
                    <button onClick={() => setWarnTarget(member)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-warning/30 text-warning hover:bg-warning-container transition-colors">
                      <AlertCircle size={12} /> Warn
                    </button>
                  </div>
                </div>

                {/* Appraisal goals */}
                {memberAppraisals.filter((a: any) => a.submitted).length > 0 && (
                  <div className="px-5 py-4 border-t border-outline">
                    <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-3">Submitted Appraisal Goals</p>
                    {memberAppraisals.filter((a: any) => a.submitted).map((appraisal: any) => (
                      <details key={`${appraisal.year}-${appraisal.month}`} className="mb-2 border border-outline rounded-xl-2 overflow-hidden">
                        <summary className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface-2 list-none text-sm">
                          <span className="font-semibold text-on-surface-muted">{MONTHS_SHORT[appraisal.month - 1]} <span className="num-mono">{appraisal.year}</span></span>
                          <span className="text-xs text-on-surface-muted"><span className="num-mono">{appraisal.goals?.length ?? 0}</span> goals</span>
                        </summary>
                        <div className="px-4 pb-4 pt-2 space-y-3">
                          {(appraisal.goals ?? []).map((g: any, i: number) => {
                            const empStatus: GoalStatus = g.employee_status ?? 'not_started';
                            const empCfg = GOAL_STATUS_CONFIG[empStatus];
                            const EmpIcon = empCfg?.icon;
                            return (
                              <div key={i} className="border border-outline rounded-xl-2 p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1">
                                    <p className="font-semibold text-sm text-on-surface">{g.title}</p>
                                    {g.description && <p className="text-xs text-on-surface-muted mt-0.5">{g.description}</p>}
                                    {g.success_criteria && <p className="text-xs text-on-surface-subtle mt-0.5 italic">Target: {g.success_criteria}</p>}
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
                                  <p className="text-xs text-on-surface-muted mb-1.5 font-semibold">Set status:</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {GOAL_STATUSES.map(s => {
                                      const cfg = GOAL_STATUS_CONFIG[s];
                                      const Icon = cfg.icon;
                                      const active = (g.status ?? 'not_started') === s;
                                      return (
                                        <button key={s} onClick={() => handleUpdateAppraisalGoal(member.id, appraisal, i, s)}
                                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border transition-all ${
                                            active ? '' : 'bg-surface-2 text-on-surface-muted border-outline'
                                          }`}
                                          style={active
                                            ? { background: cfg.bg, color: cfg.color, borderColor: cfg.border }
                                            : undefined}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 text-white"
              style={{ background: 'linear-gradient(135deg, rgb(var(--brand)) 0%, rgb(var(--primary)) 100%)' }}>
              <div>
                <h3 className="font-display text-xl font-bold tracking-tight">Monthly Review</h3>
                <p className="text-sm mt-0.5 text-white/60">
                  {showReview.name} · {MONTHS_SHORT[currentMonth - 1]} <span className="num-mono">{currentYear}</span>
                </p>
              </div>
              <button onClick={() => setShowReview(null)}><X size={18} className="text-white/60 hover:text-white" /></button>
            </div>
            <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              {/* Overall preview */}
              <div className="rounded-xl-2 p-3 text-center bg-surface-2 border border-outline">
                <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-muted mb-1">Overall Score</p>
                {(() => {
                  const overall = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / SCORE_CATEGORIES.length);
                  return <p className="num-mono text-3xl font-semibold" style={{ color: perfColor(overall) }}>{overall}</p>;
                })()}
              </div>
              {SCORE_CATEGORIES.map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <ScoreSlider label={label} value={scores[key] ?? 75}
                    onChange={v => setScores(p => ({ ...p, [key]: v }))} />
                  <textarea
                    value={paramNotes[key] ?? ''}
                    onChange={e => setParamNotes(p => ({ ...p, [key]: e.target.value }))}
                    rows={1}
                    placeholder={`Note for ${label} (optional)…`}
                    className="w-full bg-surface text-on-surface border border-outline rounded-lg px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:border-accent leading-relaxed"
                    onFocus={e => { (e.target as HTMLTextAreaElement).rows = 2; }}
                    onBlur={e => { if (!e.target.value) (e.target as HTMLTextAreaElement).rows = 1; }}
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Comments (optional)</label>
                <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)} rows={3}
                  placeholder="Add feedback for this team member…"
                  className="w-full bg-surface text-on-surface border border-outline rounded-xl-2 px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-accent" />
              </div>
            </div>
            {reviewError && (
              <div className="mx-6 mb-2 px-4 py-2.5 rounded-xl-2 text-xs font-semibold bg-danger-container text-danger border border-danger/20 flex items-center gap-2">
                <AlertCircle size={13} /> {reviewError}
              </div>
            )}
            <div className="flex gap-3 px-6 py-4 border-t border-outline">
              <button onClick={() => setShowReview(null)} className="flex-1 py-2.5 border border-outline rounded-xl-2 text-sm font-semibold text-on-surface-muted hover:bg-surface-2 transition-colors">Cancel</button>
              <button onClick={handleSaveReview} disabled={savingReview}
                className="flex-1 py-2.5 text-on-accent rounded-xl-2 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 bg-accent hover:opacity-90 transition-opacity">
                {savingReview ? <><RefreshCw size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save Review</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject leave modal ───────────────────────────────────────────────── */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-on-surface">Reason for Rejection</h3>
              <button onClick={() => setRejectTarget(null)}><X size={16} className="text-on-surface-subtle" /></button>
            </div>
            <RejectInput onClose={() => setRejectTarget(null)} onConfirm={reason => { handleApproveLeave(rejectTarget, 'rejected', reason); setRejectTarget(null); }} />
          </div>
        </div>
      )}

      {/* ── Cancel leave modal ───────────────────────────────────────────────── */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-on-surface">Reason for Cancellation</h3>
              <button onClick={() => setCancelTarget(null)}><X size={16} className="text-on-surface-subtle" /></button>
            </div>
            <RejectInput placeholder="Enter reason for cancelling this leave…"
              confirmLabel="Confirm Cancel" confirmClass="bg-on-surface-muted hover:opacity-90"
              onClose={() => setCancelTarget(null)}
              onConfirm={reason => { handleCancelLeave(cancelTarget, reason); setCancelTarget(null); }} />
          </div>
        </div>
      )}

      {/* ── Issue Warning modal ──────────────────────────────────────────────── */}
      {warnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-on-surface">Issue Warning — {warnTarget.name}</h3>
              <button onClick={() => { setWarnTarget(null); setWarnReason(''); setWarnSeverity('warning'); }}>
                <X size={16} className="text-on-surface-subtle" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                {(['warning','serious','final'] as const).map(s => (
                  <button key={s} onClick={() => setWarnSeverity(s)}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg border capitalize transition-all ${warnSeverity === s
                      ? s === 'final' ? 'bg-danger text-white border-danger' : s === 'serious' ? 'bg-accent text-on-accent border-accent' : 'bg-warning text-white border-warning'
                      : 'bg-surface-2 text-on-surface-muted border-outline'}`}>
                    {s}
                  </button>
                ))}
              </div>
              <textarea value={warnReason} onChange={e => setWarnReason(e.target.value)} rows={3}
                placeholder="Describe the reason for this warning…"
                className="w-full bg-surface text-on-surface border border-outline rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none" />
              <div className="flex gap-3">
                <button onClick={() => { setWarnTarget(null); setWarnReason(''); }}
                  className="flex-1 py-2.5 border border-outline rounded-xl-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 transition-colors">Cancel</button>
                <button disabled={issuingWarn || !warnReason.trim()}
                  onClick={async () => {
                    setIssuingWarn(true);
                    try {
                      await api.issueWarning({ employee_id: warnTarget.id, employee_name: warnTarget.name, reason: warnReason.trim(), severity: warnSeverity, issued_by: user?.name, issued_by_role: 'manager' });
                      setWarnTarget(null); setWarnReason(''); setWarnSeverity('warning');
                    } catch { /* ignore */ }
                    finally { setIssuingWarn(false); }
                  }}
                  className="flex-1 py-2.5 text-white rounded-xl-2 text-sm font-semibold disabled:opacity-50 bg-warning hover:opacity-90 transition-opacity">
                  {issuingWarn ? 'Issuing…' : 'Issue Warning'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject WFH modal ─────────────────────────────────────────────────── */}
      {rejectWfhTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-on-surface">Reason for WFH Rejection</h3>
              <button onClick={() => setRejectWfhTarget(null)}><X size={16} className="text-on-surface-subtle" /></button>
            </div>
            <RejectInput onClose={() => setRejectWfhTarget(null)}
              onConfirm={reason => { handleApproveWfh(rejectWfhTarget, 'rejected', reason); setRejectWfhTarget(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}
