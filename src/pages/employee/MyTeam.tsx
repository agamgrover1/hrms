import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Users, Calendar, TrendingUp, CheckCircle, XCircle, AlertCircle,
  X, Save, RefreshCw, Clock, UserCheck, Monitor, Info } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import MemberCalendarModal from '../../components/MemberCalendarModal';
import PulseContextPanel from '../../components/PulseContextPanel';
import MonthSelector, { monthLabel } from '../../components/MonthSelector';
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
  { key: 'client_satisfaction', label: 'Client Handling', hint: 'Messaging · handling tough clients · interaction · retention. Feeds the Client Handling pillar on Pulse.' },
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
// Score slider with an N/A toggle. Marking a slider N/A stores null on
// the parent so:
//   1) that pillar doesn't drag the overall_score (denominator drops)
//   2) downstream pulse / trend readers see "no rating" instead of 0/75
// Use this when a pillar genuinely doesn't apply — a junior IC on
// Client Handling, an admin on Team Stewardship (they have no manager),
// etc. Any slider left as a number contributes normally.
function ScoreSlider({ label, value, onChange }: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const isNA = value === null;
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-xs font-semibold text-on-surface-muted">{label}</label>
        <div className="flex items-center gap-2">
          {!isNA && (
            <span className="num-mono text-xs font-bold" style={{ color: perfColor(value) }}>{value}</span>
          )}
          <button type="button"
            onClick={() => onChange(isNA ? 75 : null)}
            title={isNA ? 'Include this pillar' : 'Mark not applicable — excludes from overall'}
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors ${
              isNA
                ? 'bg-accent text-on-accent border-accent'
                : 'text-on-surface-subtle border-outline hover:border-accent/50 hover:text-on-surface-muted'}`}>
            {isNA ? 'N/A ✓' : 'N/A'}
          </button>
        </div>
      </div>
      <input
        type="range" min={0} max={100}
        value={isNA ? 75 : (value as number)}
        disabled={isNA}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ accentColor: 'rgb(var(--accent))' }}
      />
      {isNA && (
        <p className="text-[10px] text-on-surface-subtle italic mt-0.5">
          Excluded from overall score. Use when this pillar doesn't apply to this employee.
        </p>
      )}
    </div>
  );
}

// Overall = mean of the non-N/A pillar scores. Returns null when EVERY
// slider is N/A (defensive; UI stops the reviewer from submitting in
// that case).
function computeOverall(scores: Record<string, number | null>): number | null {
  const nums = Object.values(scores).filter((v): v is number => v != null);
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

// ── Main component ────────────────────────────────────────────────────────────
type SubTab = 'overview' | 'leaves' | 'performance' | 'pulse';

const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Monthly history grid scoped to the manager's reports. Backend role-scopes
// /performance/pulse/monthly already so we just hit it as the logged-in user.
function TeamMonthlyTrends() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.getPulseMonthly({ months: 6 })
      .then(r => setRows(Array.isArray(r?.rows) ? r.rows : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date();
  const monthKeys: Array<{ y: number; m: number; label: string }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
    monthKeys.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, label: `${MONTH_NAMES_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}` });
  }
  const byEmp = new Map<string, { name: string; designation: string | null; scores: Map<string, number> }>();
  for (const r of rows) {
    const key = r.employee_id;
    if (!byEmp.has(key)) byEmp.set(key, { name: r.name, designation: r.designation, scores: new Map() });
    byEmp.get(key)!.scores.set(`${r.year}-${r.month}`, Number(r.total_score));
  }
  const emps = [...byEmp.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-1 overflow-hidden">
      <div className="px-5 py-3 border-b border-outline flex items-center justify-between">
        <p className="font-display text-base font-bold text-on-surface">Monthly trends · last 6 months</p>
        <p className="text-[11px] text-on-surface-subtle">Closed at month-end</p>
      </div>
      {loading ? (
        <div className="px-5 py-10 text-center text-on-surface-subtle text-sm">Loading…</div>
      ) : emps.length === 0 ? (
        <div className="px-5 py-10 text-center text-on-surface-subtle text-sm">No closed months yet. Admin can close months from the Pulse page to seed history.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-outline">
                <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Employee</th>
                {monthKeys.map(mk => (
                  <th key={`${mk.y}-${mk.m}`} className="text-right px-3 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide whitespace-nowrap">{mk.label}</th>
                ))}
                <th className="text-right px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Δ vs prev</th>
              </tr>
            </thead>
            <tbody>
              {emps.map(emp => {
                const values = monthKeys.map(mk => emp.scores.get(`${mk.y}-${mk.m}`) ?? null);
                const last = values[values.length - 1];
                const prev = values[values.length - 2];
                const delta = last != null && prev != null ? last - prev : null;
                return (
                  <tr key={emp.id} className="border-b border-outline hover:bg-surface-2/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-on-surface">{emp.name}</p>
                      <p className="text-[11px] text-on-surface-subtle">{emp.designation ?? '—'}</p>
                    </td>
                    {values.map((v, i) => (
                      <td key={i} className="px-3 py-3 text-right num-mono text-xs font-semibold"
                        style={{ color: v == null ? '#94a3b8' : v >= 85 ? '#16a34a' : v >= 70 ? '#3730a3' : v >= 50 ? '#d97706' : '#dc2626' }}>
                        {v == null ? '—' : Math.round(v)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right num-mono text-xs font-bold">
                      {delta == null ? <span className="text-on-surface-subtle">—</span>
                        : delta > 0 ? <span className="text-success">↑ {Math.round(delta)}</span>
                        : delta < 0 ? <span className="text-danger">↓ {Math.round(Math.abs(delta))}</span>
                        : <span className="text-on-surface-subtle">→ 0</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function pillarColorMyTeam(score: number | null): string {
  if (score == null) return '#94a3b8';
  if (score >= 85) return '#16a34a';
  if (score >= 70) return '#3730a3';
  if (score >= 50) return '#d97706';
  return '#dc2626';
}
const PULSE_PILLAR_DEFS = [
  { key: 'discipline',        label: 'Discipline' },
  { key: 'hours_hygiene',     label: 'Hours' },
  { key: 'output',            label: 'Output' },
  { key: 'contribution',      label: 'Contribution' },
  { key: 'manager_pulse',     label: 'Manager pulse' },
  { key: 'team_stewardship',  label: 'Team stewardship' },
  { key: 'project_hygiene',   label: 'Project hygiene' },
  { key: 'client_handling',   label: 'Client handling' },
] as const;
function PulsePillarList({ snapshot }: { snapshot: any }) {
  const bd = snapshot.breakdown ?? {};
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 p-4 rounded-xl-2 border border-outline bg-surface-2/40">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center font-display font-bold text-3xl num-mono"
          style={{
            background: snapshot.band === 'excellent' ? '#dcfce7' : snapshot.band === 'strong' ? '#e0e7ff' : snapshot.band === 'building' ? '#fef3c7' : snapshot.band === 'needs_support' ? '#fee2e2' : '#f1f5f9',
            color: snapshot.band === 'excellent' ? '#15803d' : snapshot.band === 'strong' ? '#3730a3' : snapshot.band === 'building' ? '#92400e' : snapshot.band === 'needs_support' ? '#b91c1c' : '#475569',
          }}>
          {snapshot.total_score}
        </div>
        <div>
          <p className="text-sm font-bold text-on-surface capitalize">{(snapshot.band ?? '').replace('_', ' ')}</p>
          <p className="text-xs text-on-surface-muted mt-0.5">Equal-weighted average across pillars below.</p>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle">Pillars</p>
        {PULSE_PILLAR_DEFS.map(p => {
          const v = snapshot[p.key];
          if (v == null) return null;
          const c = pillarColorMyTeam(v);
          return (
            <div key={p.key} className="py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-on-surface">{p.label}</p>
                <p className="text-xs num-mono font-bold" style={{ color: c }}>{v}</p>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${v}%`, background: c }} />
              </div>
            </div>
          );
        })}
      </div>
      {/* Recent signals */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle">Recent signals</p>
        <ul className="text-xs text-on-surface-muted space-y-1">
          {bd.discipline_misses && <li>Discipline: <strong>{bd.discipline_misses.absences}</strong> absent · <strong>{bd.discipline_misses.leave_without_notice}</strong> last-minute</li>}
          {bd.hygiene && <li>Hours: <strong>{bd.hygiene.days_logged}/{bd.hygiene.working_days}</strong> days logged · <strong>{bd.hygiene.days_with_notes}</strong> with notes</li>}
          {bd.output_detail && (
            bd.output_detail.no_allocation
              ? <li>Output: <em className="text-on-surface-subtle">no project allocation</em> · pillar redistributed</li>
              : <li>Output: <strong>{bd.output_detail.project_logged}h</strong> of <strong>{bd.output_detail.allocated_hours}h</strong> ({bd.output_detail.allocation_pct}%) · <strong>{bd.output_detail.approval_rate_pct}%</strong> approvals{bd.output_detail.extra_effort_bonus > 0 && <> · <strong>+{bd.output_detail.extra_effort_bonus}</strong> extra</>}</li>
          )}
          {bd.contribution_detail && <li>Contribution: <strong>{bd.contribution_detail.upsells}</strong> upsell{bd.contribution_detail.upsells === 1 ? '' : 's'} raised</li>}
          {bd.team_stewardship_detail && (
            <li>Team stewardship:
              {' '}<strong>{bd.team_stewardship_detail.approval_timeliness}%</strong> approvals on time
              {bd.team_stewardship_detail.team_logging_hygiene != null && <>
                {' '}· <strong>{bd.team_stewardship_detail.team_logging_hygiene}%</strong> team logging
              </>}
              {bd.team_stewardship_detail.review_check_active && bd.team_stewardship_detail.review_timeliness != null && <>
                {' '}· <strong>{bd.team_stewardship_detail.review_timeliness}%</strong> reviews
                {bd.team_stewardship_detail.reviews_missing_count > 0 && <span className="text-danger"> ({bd.team_stewardship_detail.reviews_missing_count} missing)</span>}
              </>}
            </li>
          )}
          {bd.project_hygiene_detail && <li>Project hygiene: <strong>{bd.project_hygiene_detail.logging_coverage}%</strong> coverage · <strong>{bd.project_hygiene_detail.approval_flow_through}%</strong> flow-through</li>}
          {bd.client_handling_detail && (
            bd.client_handling_detail.no_rating_yet
              ? <li>Client handling: <em className="text-on-surface-subtle">no rating yet</em></li>
              : <li>Client handling: <strong>{bd.client_handling_detail.latest_score}/100</strong> from {bd.client_handling_detail.rated_month}</li>
          )}
        </ul>
      </div>
    </div>
  );
}

export default function MyTeam() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const subTab = useMemo<SubTab>(() => {
    const t = searchParams.get('tab');
    if (t === 'performance') return 'performance';
    if (t === 'leaves') return 'leaves';
    if (t === 'pulse') return 'pulse';
    return 'overview';
  }, [searchParams]);

  // Resolved DB id of the logged-in employee (manager)
  const [empDbId, setEmpDbId] = useState('');
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Team scope toggle. 'direct' = only people whose reporting_manager_id
  // is you; 'branch' = recursive sub-tree (everyone below you in the
  // org chart). Persisted to localStorage so the choice sticks across
  // page reloads. Default is 'direct' — that's what the user expects
  // for a top-of-tree manager whose full branch is most of the org.
  const [teamScope, setTeamScope] = useState<'direct' | 'branch'>(() => {
    try { return (localStorage.getItem('myTeamScope') as 'direct' | 'branch') || 'direct'; }
    catch { return 'direct'; }
  });
  useEffect(() => {
    try { localStorage.setItem('myTeamScope', teamScope); } catch {/* private mode */}
  }, [teamScope]);
  // Per-member toggle for the Performance Score Trend lines. Clicking a
  // name in the legend (or the quick-action chips) flips that member's
  // line. Set tracks HIDDEN ids — empty set = all visible (default).
  const [hiddenPerfLines, setHiddenPerfLines] = useState<Set<string>>(new Set());
  const toggleHiddenLine = (id: string) => {
    setHiddenPerfLines(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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
  // Scores hold either a number (0-100) OR null (N/A — pillar excluded
  // from overall_score, downstream consumers see "not rated").
  const [scores, setScores] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(SCORE_CATEGORIES.map(c => [c.key, 75]))
  );
  // Track whether the modal is editing an existing review vs adding one —
  // drives button label ("Save Review" vs "Update Review") and the header
  // affordance so Vansh knows he's editing, not writing a fresh one.
  const [editingExisting, setEditingExisting] = useState(false);
  const [existingLocked, setExistingLocked] = useState(false);
  const [reviewComment, setReviewComment] = useState('');
  // Review period picker — defaults to LAST month since managers usually add
  // reviews in the first week of the new month for the prior month's work.
  const [reviewMonth, setReviewMonth] = useState(() => {
    const n = new Date();
    return n.getMonth() === 0 ? 12 : n.getMonth();
  });
  const [reviewYear, setReviewYear] = useState(() => {
    const n = new Date();
    return n.getMonth() === 0 ? n.getFullYear() - 1 : n.getFullYear();
  });
  const [paramNotes, setParamNotes] = useState<Record<string, string>>({});

  // ── Pulse state ────────────────────────────────────────────────────────
  const [teamPulse, setTeamPulse] = useState<any[]>([]);
  const [pulseWeekStart, setPulseWeekStart] = useState<string>('');
  const [submittingPulse, setSubmittingPulse] = useState<Record<string, boolean>>({});
  const [pulseDrawerFor, setPulseDrawerFor] = useState<any | null>(null);
  const [pulseDrawerData, setPulseDrawerData] = useState<{ latest: any; trend: any[] } | null>(null);

  // Month selector for the Team Pulse view. Defaults to current month.
  const _now1 = new Date();
  const [teamPulseMonth, setTeamPulseMonth] = useState(_now1.getUTCMonth() + 1);
  const [teamPulseYear,  setTeamPulseYear]  = useState(_now1.getUTCFullYear());
  // Load team pulse whenever we land on the tab or the month changes
  useEffect(() => {
    if (subTab !== 'pulse') return;
    api.getTeamPulse({ month: teamPulseMonth, year: teamPulseYear })
      .then(d => { setTeamPulse(d.team); setPulseWeekStart(d.week_start); })
      .catch(() => {});
  }, [subTab, teamPulseMonth, teamPulseYear]);

  async function ratePulse(employeeId: string, rating: 'good' | 'ok' | 'concern') {
    setSubmittingPulse(s => ({ ...s, [employeeId]: true }));
    try {
      await api.submitPulseRating({ employee_id: employeeId, rating, week_start: pulseWeekStart });
      setTeamPulse(prev => prev.map(t => t.id === employeeId ? { ...t, pulse_rated_this_week: true, _last_rating: rating } : t));
    } finally {
      setSubmittingPulse(s => ({ ...s, [employeeId]: false }));
    }
  }
  async function openPulseDrawer(member: any) {
    setPulseDrawerFor(member);
    setPulseDrawerData(null);
    try {
      const data = await api.getEmployeePulse(member.id);
      setPulseDrawerData({ latest: data.latest, trend: data.trend });
    } catch {
      setPulseDrawerData({ latest: null, trend: [] });
    }
  }
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
      // Scope is user-controlled via the toggle near the tab bar.
      //   'direct' → just people whose reporting_manager_id is you
      //   'branch' → recursive sub-tree (your direct reports + theirs).
      // For top-of-tree managers, 'direct' avoids the "I see the whole
      // office" problem; 'branch' is there for HR-style managers who
      // legitimately need the full picture.
      api.getTeamMembers(eid, teamScope === 'branch').then(members => {
        setTeamMembers(members);
        setLoading(false);
        // Reset per-member maps when team scope changes so stale data
        // from the prior scope doesn't bleed in (someone in the branch
        // view who isn't in the direct view would otherwise linger).
        setTeamAttendance({}); setTeamPerf({}); setTeamAllLeaves([]); setAppraisals({});
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
  }, [user?.employee_id_ref, currentYear, teamScope]);

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
  // Look up a saved review for (member, month, year) and hydrate the
  // modal state from it. Called on open AND whenever the reviewer flips
  // the month picker — otherwise editing a different month started with
  // stale slider values from whatever was open before.
  const loadReviewFor = (member: any, month: number, year: number) => {
    const perf = teamPerf[member.id] ?? [];
    const existing = perf.find((r: any) => r.month === month && r.year === year);
    if (existing) {
      // Prefill sliders from the saved row. null (from the DB or a
      // deliberate N/A) survives as null so the toggle renders correctly.
      const filled: Record<string, number | null> = {};
      for (const c of SCORE_CATEGORIES) {
        const v = existing[c.key as keyof typeof existing];
        filled[c.key] = v == null ? null : Number(v);
      }
      setScores(filled);
      setReviewComment(existing.comments ?? '');
      setParamNotes(existing.parameter_notes ?? {});
      setEditingExisting(true);
      setExistingLocked(!!existing.is_locked);
    } else {
      setScores(Object.fromEntries(SCORE_CATEGORIES.map(c => [c.key, 75])));
      setReviewComment('');
      setParamNotes({});
      setEditingExisting(false);
      setExistingLocked(false);
    }
    setReviewError('');
  };

  const openReview = (member: any) => {
    setShowReview(member);
    loadReviewFor(member, reviewMonth, reviewYear);
  };

  // Re-hydrate whenever the reviewer changes the month/year picker while
  // the modal is open — otherwise flipping from Jun to May shows Jun's
  // saved values, which is worse than showing nothing.
  useEffect(() => {
    if (showReview) loadReviewFor(showReview, reviewMonth, reviewYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMonth, reviewYear]);

  const handleSaveReview = async () => {
    if (!showReview || !empDbId) return;
    if (existingLocked) { setReviewError('HR has locked this review. Ask HR to unlock it to make changes.'); return; }
    const overall = computeOverall(scores);
    if (overall == null) { setReviewError('At least one pillar must be scored. All sliders are marked N/A.'); return; }
    setSavingReview(true);
    setReviewError('');
    try {
      await api.saveMonthlyPerformance({
        employee_id: showReview.id, reviewer_id: empDbId, reviewer_name: user?.name,
        month: reviewMonth, year: reviewYear,
        // Send each field through as-is (including null for N/A). Backend
        // stores NULL and skips it in aggregate math.
        ...Object.fromEntries(SCORE_CATEGORIES.map(c => [c.key, scores[c.key]])) as any,
        overall_score: overall, comments: reviewComment,
        parameter_notes: paramNotes,
        requester_role: user?.role,
      });
      api.getMonthlyPerformance(showReview.id, reviewYear)
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
  // Key each member's score by their id so two people with the same first
  // name don't collide (e.g. two Vinays would have stomped each other when
  // we used first name as the dataKey).
  const perfTrendData = last6.map(({ month, year, label }) => {
    const point: any = { label };
    teamMembers.forEach(m => {
      const rec = (teamPerf[m.id] ?? []).find((r: any) => r.month === month && r.year === year);
      if (rec) point[m.id] = rec.overall_score;
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
      {/* Sub-tab switcher + scope toggle (right-aligned) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-surface rounded-xl-2 p-1 border border-outline shadow-elev-1 w-fit">
          {([
            { key: 'overview',    label: 'Overview',    icon: Users      },
            { key: 'leaves',      label: 'Leaves',      icon: Calendar   },
            { key: 'performance', label: 'Performance', icon: TrendingUp },
            { key: 'pulse',       label: 'Pulse',       icon: TrendingUp },
          ] as { key: SubTab; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => navigate(`/my-team?tab=${key}`)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                subTab === key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'
              }`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {/* Scope toggle: direct reports vs. full reporting branch. Sticky
            preference via localStorage — reads once on mount, writes on
            every change. */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider font-bold text-on-surface-subtle">Scope</span>
          <div className="flex gap-0.5 bg-surface rounded-xl-2 p-1 border border-outline shadow-elev-1">
            {([
              { key: 'direct', label: 'Direct reports', hint: 'Only people who report to you' },
              { key: 'branch', label: 'Full branch',    hint: 'Direct reports + everyone below them' },
            ] as { key: 'direct' | 'branch'; label: string; hint: string }[]).map(({ key, label, hint }) => (
              <button key={key} onClick={() => setTeamScope(key)} title={hint}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  teamScope === key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
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
                  // Height scales with member count so every team member has a
                  // visible row + label. Was hard-coded 220px → Recharts auto-
                  // skipped Y-axis labels when 7+ members couldn't fit.
                  <ResponsiveContainer width="100%" height={Math.max(220, attBarData.length * 32 + 40)}>
                    <BarChart data={attBarData} barSize={18} layout="vertical"
                      margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" interval={0} tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 600 }}
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
                <div className="flex items-center gap-1.5 mb-1">
                  <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Leave Distribution</h3>
                  <Link to="/help/how-it-works?section=my-team" title="What does this card show?"
                    className="text-on-surface-subtle hover:text-accent transition-colors">
                    <Info size={13} />
                  </Link>
                </div>
                <p className="text-xs text-on-surface-muted mb-4">
                  Share of your team's leaves this month by type — Full Day, Half Day, Short Leave, Optional.
                </p>
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
              <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
                <div>
                  <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Performance Score Trend</h3>
                  <p className="text-xs text-on-surface-muted">Overall monthly scores — last 6 months · click a name to toggle</p>
                </div>
                {hiddenPerfLines.size > 0 && (
                  <button onClick={() => setHiddenPerfLines(new Set())}
                    className="text-[11px] font-semibold text-accent hover:underline whitespace-nowrap">
                    Show all
                  </button>
                )}
              </div>
              {teamMembers.every(m => !(teamPerf[m.id] ?? []).length) ? (
                <div className="flex items-center justify-center h-40 text-on-surface-subtle text-sm">No performance reviews yet</div>
              ) : (
                <>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={perfTrendData} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip
                      contentStyle={{ background: 'rgb(var(--surface-3))', borderRadius: 12, border: '1px solid rgb(var(--outline))', boxShadow: 'var(--elev-3)', color: 'rgb(var(--on-surface))', fontSize: 12 }}
                      // Recharts passes the dataKey (member id) as the second
                      // arg by default — map it back to the first name for the
                      // tooltip label so it reads naturally.
                      formatter={(val: any, key: any) => {
                        const m = teamMembers.find(x => x.id === key);
                        return [`${val}/100`, m?.name.split(' ')[0] ?? key];
                      }}
                    />
                    {teamMembers.map((m, i) => (
                      <Line key={m.id} type="monotone" dataKey={m.id} name={m.name.split(' ')[0]}
                        stroke={memberColors[i]} strokeWidth={2.5} dot={{ r: 4, fill: memberColors[i] }}
                        activeDot={{ r: 6 }} connectNulls={false}
                        hide={hiddenPerfLines.has(m.id)} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>

                {/* Custom clickable legend. The default Recharts Legend
                    supports onClick but its hit area is tiny (just the icon)
                    and accessibility is poor. A row of pill chips is much
                    easier to tap, especially on mobile. */}
                <div className="flex flex-wrap gap-1.5 mt-4 justify-center">
                  {teamMembers.map((m, i) => {
                    const hidden = hiddenPerfLines.has(m.id);
                    const firstName = m.name?.split(' ')[0] ?? '—';
                    return (
                      <button key={m.id} onClick={() => toggleHiddenLine(m.id)}
                        title={hidden ? `Show ${firstName}'s line` : `Hide ${firstName}'s line`}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                          hidden
                            ? 'border-outline text-on-surface-subtle bg-surface line-through hover:bg-surface-2'
                            : 'border-outline text-on-surface bg-surface hover:bg-surface-2'
                        }`}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: hidden ? 'rgba(148,163,184,0.35)' : memberColors[i] }} />
                        {firstName}
                      </button>
                    );
                  })}
                </div>
                </>
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
                      ) : todayRec?.check_in ? (
                        <>
                          <span>{todayRec.check_in}</span>
                          <span className="text-on-surface-subtle mx-1">→</span>
                          <span className={todayRec.check_out ? 'text-on-surface' : 'text-success font-semibold'}>
                            {todayRec.check_out || 'still in'}
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
          currentUser={{ name: user?.name, role: user?.role }}
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
                        {l.reason && <p className="text-xs text-on-surface-muted mt-0.5 italic whitespace-pre-line break-words">"{l.reason}"</p>}
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

          {/* Pending WFH requests — always-visible container so an empty
              list shows "no pending" instead of the whole section vanishing
              (the latter looked like a visibility bug to reporting managers). */}
          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
            <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
              <h3 className="font-display text-xl font-bold tracking-tight text-on-surface flex items-center gap-2">
                <span className="text-brand">⊡</span> Pending WFH Requests
              </h3>
              {pendingWfh.length > 0 && (
                <span className="num-mono text-xs font-bold px-2 py-0.5 rounded-full bg-brand-container text-on-brand-container">{pendingWfh.length} pending</span>
              )}
            </div>
            {pendingWfh.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-10 text-on-surface-muted">
                <CheckCircle size={20} className="text-success/60" />
                <p className="text-sm">No pending WFH requests</p>
                <p className="text-[11px] text-on-surface-subtle">If a report applied recently and you don't see it here, ask them to confirm they weren't on probation when applying.</p>
              </div>
            ) : (
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
            )}
          </div>

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
                                        <td className="px-3 py-2.5 text-on-surface-subtle max-w-[120px] truncate" title={l.reason ?? ''}>{l.reason}</td>
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
                    {(() => {
                      // Show "Edit" when a review already exists for the
                      // currently-selected review period, so the reviewer
                      // knows the button won't erase their previous entry.
                      const memberPerf = teamPerf[member.id] ?? [];
                      const hasCurrent = memberPerf.some((r: any) => r.month === reviewMonth && r.year === reviewYear);
                      return (
                        <button onClick={() => openReview(member)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-outline text-on-surface hover:bg-surface-2 transition-colors">
                          <TrendingUp size={12} /> {hasCurrent ? 'Edit Review' : 'Add Review'}
                        </button>
                      );
                    })()}
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
                <h3 className="font-display text-xl font-bold tracking-tight">
                  {editingExisting ? 'Edit Monthly Review' : 'Monthly Review'}
                  {existingLocked && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full align-middle">Locked by HR</span>}
                </h3>
                <p className="text-sm mt-0.5 text-white/60">
                  {showReview.name} · for <span className="font-semibold text-white">{MONTHS_SHORT[reviewMonth - 1]} <span className="num-mono">{reviewYear}</span></span>
                  {editingExisting && !existingLocked && <span className="ml-2 text-[11px] text-white/70">· editing your saved review</span>}
                </p>
              </div>
              <button onClick={() => setShowReview(null)}><X size={18} className="text-white/60 hover:text-white" /></button>
            </div>
            <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              {/* Review period picker — defaults to last month since the typical
                  case is writing it in week 1 of the new month. */}
              <div className="rounded-xl-2 p-3 bg-surface-2 border border-outline flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-muted">Review period</p>
                  <p className="text-xs text-on-surface-subtle mt-0.5">Pick the month this review is for.</p>
                </div>
                <div className="flex items-center gap-2">
                  <select value={reviewMonth} onChange={e => setReviewMonth(Number(e.target.value))}
                    className="text-sm bg-surface border border-outline rounded-lg px-2.5 py-1.5 text-on-surface focus:outline-none focus:border-accent">
                    {MONTHS_SHORT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                  <select value={reviewYear} onChange={e => setReviewYear(Number(e.target.value))}
                    className="text-sm bg-surface border border-outline rounded-lg px-2.5 py-1.5 text-on-surface focus:outline-none focus:border-accent num-mono">
                    {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              {/* Overall preview — mean of the non-N/A pillars. If every
                  pillar is N/A we show "—" instead of NaN, and the save
                  button below is disabled with a helpful error. */}
              <div className="rounded-xl-2 p-3 text-center bg-surface-2 border border-outline">
                <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-muted mb-1">Overall Score</p>
                {(() => {
                  const overall = computeOverall(scores);
                  const naCount = Object.values(scores).filter(v => v === null).length;
                  return (
                    <>
                      {overall == null
                        ? <p className="num-mono text-3xl font-semibold text-on-surface-subtle">—</p>
                        : <p className="num-mono text-3xl font-semibold" style={{ color: perfColor(overall) }}>{overall}</p>}
                      {naCount > 0 && (
                        <p className="text-[11px] text-on-surface-subtle mt-1">
                          Averaged across {SCORE_CATEGORIES.length - naCount} of {SCORE_CATEGORIES.length} pillars · {naCount} marked N/A
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
              {/* Pulse context — data view for the reviewer to reference */}
              <PulseContextPanel employeeId={showReview?.id ?? null} />
              {SCORE_CATEGORIES.map(({ key, label, hint }: any) => (
                <div key={key} className="space-y-1.5">
                  <ScoreSlider label={label} value={scores[key] ?? 75}
                    onChange={v => setScores(p => ({ ...p, [key]: v }))} />
                  {hint && <p className="text-[10px] text-on-surface-subtle leading-snug -mt-1">{hint}</p>}
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
              <button onClick={handleSaveReview} disabled={savingReview || existingLocked}
                className="flex-1 py-2.5 text-on-accent rounded-xl-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-accent hover:opacity-90 transition-opacity">
                {savingReview
                  ? <><RefreshCw size={14} className="animate-spin" /> Saving…</>
                  : <><Save size={14} /> {editingExisting ? 'Update Review' : 'Save Review'}</>}
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

      {/* ── PULSE TAB ─────────────────────────────────────────────────────── */}
      {subTab === 'pulse' && (
        <div className="space-y-5">
          {/* Monday rating prompt — appears only if any report isn't rated yet */}
          {teamPulse.some(t => !t.pulse_rated_this_week) && (
            <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-1 p-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle">Weekly pulse</p>
                <p className="text-[10px] text-on-surface-subtle num-mono">
                  week of {pulseWeekStart ? new Date(pulseWeekStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                </p>
              </div>
              <p className="font-display text-base font-bold text-on-surface mb-3">
                How is each of your reports doing this week?
              </p>
              <p className="text-xs text-on-surface-muted mb-4">
                One tap each. This feeds the &ldquo;Manager pulse&rdquo; pillar of their automated score. Honest beats kind here &mdash; concerns trigger a conversation, not a punishment.
              </p>
              <div className="space-y-2">
                {teamPulse.filter(t => !t.pulse_rated_this_week).map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-3 p-3 rounded-xl-2 bg-surface-2/40 border border-outline">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-brand-container/50 flex items-center justify-center font-semibold text-brand text-sm">
                        {t.name.split(' ').map((s: string) => s[0]).slice(0, 2).join('')}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-on-surface truncate">{t.name}</p>
                        <p className="text-xs text-on-surface-subtle">{t.designation ?? '—'}</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {[
                        { r: 'good',    emoji: '🙂', label: 'Doing great' },
                        { r: 'ok',      emoji: '😐', label: 'Steady'      },
                        { r: 'concern', emoji: '😞', label: 'Concerned'   },
                      ].map(b => (
                        <button key={b.r}
                          disabled={!!submittingPulse[t.id]}
                          onClick={() => ratePulse(t.id, b.r as any)}
                          title={b.label}
                          className="w-10 h-10 rounded-xl border border-outline hover:border-accent hover:bg-accent-container/30 transition text-lg disabled:opacity-50">
                          {b.emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monthly trends — historical context for the team */}
          <TeamMonthlyTrends />

          {/* Team grid */}
          <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-1 overflow-hidden">
            <div className="px-5 py-3 border-b border-outline flex items-center justify-between">
              <div className="flex items-center gap-3">
                <p className="font-display text-base font-bold text-on-surface">Team pulse — {monthLabel(teamPulseMonth, teamPulseYear)}</p>
                <MonthSelector month={teamPulseMonth} year={teamPulseYear} onChange={(m, y) => { setTeamPulseMonth(m); setTeamPulseYear(y); }} />
              </div>
              <p className="text-[11px] text-on-surface-subtle">Sorted by score</p>
            </div>
            {teamPulse.length === 0 ? (
              <div className="px-5 py-10 text-center text-on-surface-subtle text-sm">No team data yet.</div>
            ) : (
              <div className="divide-y divide-outline">
                {teamPulse.map(t => {
                  const total = t.total_score;
                  const tone =
                    t.band === 'excellent' ? 'bg-success-container text-success' :
                    t.band === 'strong'    ? 'bg-brand-container text-brand' :
                    t.band === 'building'  ? 'bg-warning-container text-warning' :
                    t.band === 'needs_support' ? 'bg-danger-container text-danger' :
                                                'bg-surface-2 text-on-surface-subtle';
                  return (
                    <button key={t.id} onClick={() => openPulseDrawer(t)} className="w-full px-5 py-4 hover:bg-surface-2/40 transition text-left flex items-center gap-4">
                      <div className="w-9 h-9 rounded-full bg-brand-container/50 flex items-center justify-center font-semibold text-brand text-xs flex-shrink-0">
                        {t.name.split(' ').map((s: string) => s[0]).slice(0, 2).join('')}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-on-surface truncate">{t.name}</p>
                        <p className="text-[11px] text-on-surface-subtle truncate">{t.designation ?? '—'}</p>
                      </div>
                      <div className="hidden sm:flex items-center gap-2.5 num-mono">
                        {['discipline','hours_hygiene','output','contribution'].map(k => (
                          <div key={k} className="text-center min-w-[36px]">
                            <p className="text-[10px] text-on-surface-subtle uppercase tracking-wide">{k === 'hours_hygiene' ? 'Hygiene' : k.slice(0,4)}</p>
                            <p className="text-xs font-bold" style={{ color: pillarColorMyTeam(t[k]) }}>{t[k] ?? '—'}</p>
                          </div>
                        ))}
                      </div>
                      <div className={`px-3 py-1.5 rounded-lg text-xs font-bold num-mono ${tone}`}>
                        {total != null ? total : '—'}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="px-5 py-3 bg-surface-2/40 border-t border-outline">
              <p className="text-[11px] text-on-surface-subtle">
                Coaching tool, not a punishment. Tap any row for the breakdown. ·{' '}
                <a href="/help/pulse" className="text-accent hover:underline font-semibold">How is this calculated?</a>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Pulse drawer (manager view of a report's pulse) */}
      {pulseDrawerFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setPulseDrawerFor(null)}>
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
              <div>
                <h2 className="font-display font-bold text-lg" style={{ color: '#192250' }}>{pulseDrawerFor.name}</h2>
                <p className="text-xs text-on-surface-subtle mt-0.5">Performance Pulse breakdown — {monthLabel(teamPulseMonth, teamPulseYear)}</p>
              </div>
              <button onClick={() => setPulseDrawerFor(null)}><X size={18} className="text-on-surface-subtle" /></button>
            </div>
            <div className="overflow-y-auto px-6 py-5">
              {!pulseDrawerData ? (
                <p className="text-sm text-on-surface-subtle py-8 text-center">Loading…</p>
              ) : !pulseDrawerData.latest ? (
                <p className="text-sm text-on-surface-subtle py-8 text-center">No snapshot yet — runs nightly.</p>
              ) : (
                <PulsePillarList snapshot={pulseDrawerData.latest} />
              )}
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
