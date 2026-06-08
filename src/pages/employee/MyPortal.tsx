import { useState, useEffect, useMemo, Component, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Calendar, DollarSign, User, CheckCircle, XCircle, AlertCircle, Plus, X, Target, FileText, Lock, Trash2, Save, Users, Monitor, Briefcase, Edit2, BookOpen, Wrench } from 'lucide-react';
import MyRoleTab from '../../components/MyRoleTab';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { financeApi } from '../../services/financeApi';

function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  if (dateStr.includes('T')) {
    const d = new Date(dateStr);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtHours(h: number | string | null | undefined): string {
  const total = Number(h) || 0;
  const hrs = Math.floor(total);
  const mins = Math.round((total - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { GoalCard, GOAL_STATUSES, GOAL_STATUS_CONFIG } from '../Performance';
import type { GoalStatus } from '../Performance';

class TabErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(err: any) { return { error: err?.message ?? 'Render error' }; }
  componentDidCatch() { this.setState(s => s); }
  reset() { this.setState({ error: null }); }
  render() {
    if (this.state.error) {
      return (
        <div className="bg-danger-container border border-red-100 rounded-xl p-6 text-center">
          <p className="text-sm font-semibold text-danger mb-2">Something went wrong loading this tab</p>
          <p className="text-xs text-danger mb-4 font-mono">{this.state.error}</p>
          <button onClick={() => this.reset()} className="px-4 py-2 text-xs font-semibold bg-danger text-white rounded-lg hover:bg-red-600">
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Small hub-tile components defined inline so they don't sprawl into a
// separate file (only used here). HubStat is a 1-up KPI cell, hubHints
// maps tab keys to dynamic badge data (e.g. "3 pending").
function HubStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-surface rounded-xl-2 border border-outline p-4 shadow-elev-1">
      <p className={`num-mono text-2xl font-bold ${tone}`}>{value}</p>
      <p className="text-xs text-on-surface-subtle mt-0.5">{label}</p>
    </div>
  );
}

// Pulse: score → band label/colors
function bandLabel(b?: string | null) {
  switch (b) {
    case 'excellent':     return 'Excellent';
    case 'strong':        return 'Strong';
    case 'building':      return 'Building';
    case 'needs_support': return 'Needs support';
    case 'baseline':      return 'Building baseline';
    default:              return '—';
  }
}
function pulseTileTone(band?: string | null): React.CSSProperties {
  switch (band) {
    case 'excellent':     return { background: '#dcfce7', color: '#15803d' };
    case 'strong':        return { background: '#e0e7ff', color: '#3730a3' };
    case 'building':      return { background: '#fef3c7', color: '#92400e' };
    case 'needs_support': return { background: '#fee2e2', color: '#b91c1c' };
    default:              return { background: '#f1f5f9', color: '#475569' };
  }
}
function pillarColor(score: number | null): string {
  if (score == null) return '#94a3b8';
  if (score >= 85) return '#16a34a';
  if (score >= 70) return '#3730a3';
  if (score >= 50) return '#d97706';
  return '#dc2626';
}
function PulseSparkline({ trend }: { trend: Array<{ snapshot_date: string; total_score: number }> }) {
  // sample to 12 points so it stays readable
  const points = trend.length > 12 ? trend.filter((_, i) => i % Math.ceil(trend.length / 12) === 0) : trend;
  const W = 140, H = 48, P = 4;
  const min = Math.min(...points.map(p => p.total_score), 40);
  const max = Math.max(...points.map(p => p.total_score), 90);
  const span = Math.max(1, max - min);
  const xy = points.map((p, i) => {
    const x = P + (i / Math.max(1, points.length - 1)) * (W - P * 2);
    const y = H - P - ((p.total_score - min) / span) * (H - P * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = points[points.length - 1];
  const prev = points[points.length - 2] ?? last;
  const delta = last && prev ? last.total_score - prev.total_score : 0;
  return (
    <div className="hidden sm:flex flex-col items-end">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
        <polyline points={xy.join(' ')} fill="none" stroke="#192250" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {last && (
          <circle cx={xy[xy.length - 1]?.split(',')[0]} cy={xy[xy.length - 1]?.split(',')[1]} r="3" fill="#192250" />
        )}
      </svg>
      <p className={`text-[10px] num-mono mt-0.5 ${delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-on-surface-subtle'}`}>
        {delta > 0 ? '+' : ''}{delta.toFixed(0)} vs last
      </p>
    </div>
  );
}
const PULSE_PILLARS = [
  { key: 'discipline',        label: 'Discipline',        hint: 'Punctuality, attendance, leave notice' },
  { key: 'hours_hygiene',     label: 'Hours hygiene',     hint: 'Daily hours logged + notes filled' },
  { key: 'output',            label: 'Output',            hint: 'Utilization + manager approval rate' },
  { key: 'contribution',      label: 'Contribution',      hint: 'Goals on track + upsells raised' },
  { key: 'manager_pulse',     label: 'Manager pulse',     hint: 'Weekly 1-tap rating from your manager' },
  { key: 'team_stewardship',  label: 'Team stewardship',  hint: 'Your team\'s logging + your approval speed' },
  { key: 'project_hygiene',   label: 'Project hygiene',   hint: 'Logging coverage + approval flow across projects' },
] as const;
function PulseBreakdownDrawer({
  open, onClose, snapshot, trend,
}: {
  open: boolean; onClose: () => void;
  snapshot: any | null;
  trend: Array<{ snapshot_date: string; total_score: number }>;
}) {
  if (!open || !snapshot) return null;
  const bd = snapshot.breakdown ?? {};
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div>
            <h2 className="font-display font-bold text-lg" style={{ color: '#192250' }}>Performance Pulse — 30 day</h2>
            <p className="text-xs text-on-surface-subtle mt-0.5">Automated score, computed nightly. Manual reviews continue alongside.</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-on-surface-subtle" /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {/* Headline */}
          <div className="flex items-center gap-4 p-4 rounded-xl-2 border border-outline" style={{ background: 'linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%)' }}>
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center font-display font-bold text-3xl num-mono" style={pulseTileTone(snapshot.band)}>
              {snapshot.is_baseline ? '…' : snapshot.total_score}
            </div>
            <div>
              <p className="text-sm font-bold text-on-surface">{snapshot.is_baseline ? 'Building baseline' : bandLabel(snapshot.band)}</p>
              <p className="text-xs text-on-surface-muted mt-0.5">
                {snapshot.is_baseline ? 'Your score will appear after 30 days at the company.' : 'Score is the equal-weighted average of the pillars below.'}
              </p>
              {trend.length > 1 && !snapshot.is_baseline && <PulseSparkline trend={trend} />}
            </div>
          </div>
          {/* Pillars */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle">Pillars</p>
            {PULSE_PILLARS.map(p => {
              const v = snapshot[p.key] as number | null;
              if (v == null) return null; // skip role pillars that don't apply
              const color = pillarColor(v);
              return (
                <div key={p.key} className="flex items-center gap-3 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-on-surface">{p.label}</p>
                      <p className="text-xs num-mono font-bold" style={{ color }}>{v}</p>
                    </div>
                    <p className="text-[11px] text-on-surface-subtle">{p.hint}</p>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: color }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Specifics — what dragged the score */}
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle">Recent signals (last 30 days)</p>
            <ul className="text-xs text-on-surface-muted space-y-1">
              {bd.discipline_misses && (
                <li>Discipline: <strong>{bd.discipline_misses.late}</strong> late, <strong>{bd.discipline_misses.absences}</strong> absent, <strong>{bd.discipline_misses.leave_without_notice}</strong> last-minute leave</li>
              )}
              {bd.hygiene && (
                <li>Hours hygiene: <strong>{bd.hygiene.days_logged}/{bd.hygiene.working_days}</strong> days logged · <strong>{bd.hygiene.days_with_notes}</strong> with notes</li>
              )}
              {bd.output_detail && (
                <li>Output: <strong>{bd.output_detail.utilization_pct}%</strong> utilization · <strong>{bd.output_detail.approval_rate_pct}%</strong> approval rate</li>
              )}
              {bd.contribution_detail && (
                <li>Contribution: <strong>{bd.contribution_detail.goals_on_track}/{bd.contribution_detail.goals_total}</strong> goals on track · <strong>{bd.contribution_detail.upsells}</strong> upsells</li>
              )}
              {bd.manager_pulse_detail?.ratings_in_window > 0 && (
                <li>Manager pulse: <strong>{bd.manager_pulse_detail.ratings_in_window}</strong> ratings · avg <strong>{bd.manager_pulse_detail.avg}</strong></li>
              )}
              {bd.team_stewardship_detail && (
                <li>Team: <strong>{bd.team_stewardship_detail.team_logging_hygiene}%</strong> team logging · <strong>{bd.team_stewardship_detail.approval_timeliness}%</strong> approvals within 48h</li>
              )}
              {bd.project_hygiene_detail && (
                <li>Projects: <strong>{bd.project_hygiene_detail.logging_coverage}%</strong> coverage · <strong>{bd.project_hygiene_detail.approval_flow_through}%</strong> flow-through</li>
              )}
            </ul>
          </div>
        </div>
        <div className="px-6 py-3 border-t border-outline flex justify-end">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg font-medium border border-outline hover:bg-surface-2">Close</button>
        </div>
      </div>
    </div>
  );
}


function hubHints(ctx: { key: string; pendingLeaves: number; pendingWfh: number; fullDay: number; shortLeave: number; performance: any }): { badge?: string | number; badgeTone?: string; sub?: string } | null {
  switch (ctx.key) {
    case 'role':       return { sub: 'Your playbook' };
    case 'attendance': return { sub: 'Clock-in history' };
    case 'leave':      return ctx.pendingLeaves > 0
      ? { badge: ctx.pendingLeaves, badgeTone: 'bg-warning text-on-accent', sub: `${ctx.fullDay + ctx.shortLeave} left` }
      : { sub: `${ctx.fullDay + ctx.shortLeave} days available` };
    case 'wfh':        return ctx.pendingWfh > 0
      ? { badge: ctx.pendingWfh, badgeTone: 'bg-warning text-on-accent', sub: 'Pending approval' }
      : { sub: 'Apply for WFH' };
    case 'my-hours':   return { sub: 'Log project hours' };
    case 'incentives': return { sub: 'Upsell rewards' };
    case 'expenses':   return { sub: 'Reimbursements' };
    case 'device':     return { sub: 'Assigned assets' };
    case 'payslip':    return { sub: 'Salary history' };
    case 'performance':return { sub: 'Reviews & goals' };
    case 'myteam':     return { sub: 'Direct reports' };
    default: return null;
  }
}

const baseTabs = [
  { key: 'overview',     label: 'Overview',     icon: User },
  { key: 'role',         label: 'My Role',      icon: BookOpen },
  { key: 'attendance',   label: 'Attendance',   icon: Clock },
  { key: 'leave',        label: 'My Leaves',    icon: Calendar },
  { key: 'wfh',          label: 'Work From Home', icon: Monitor },
  { key: 'my-hours',     label: 'My Hours',     icon: Briefcase },
  { key: 'incentives',   label: 'Incentives',     icon: Target  },
  { key: 'expenses',    label: 'Expenses',       icon: DollarSign },
  { key: 'device',       label: 'My Device',    icon: Monitor },
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
  { key: 'ai_usage',            label: 'AI Usage' },
] as const;

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PERF_COLS = ['Prod.', 'Quality', 'Teamwork', 'Attend.', 'Initiative', 'Client Sat.', 'AI Usage'];
const PERF_KEYS = ['productivity','quality','teamwork','attendance_score','initiative','client_satisfaction','ai_usage'];

function perfColor(s: number) {
  if (s >= 85) return '#16a34a';
  if (s >= 70) return '#192250';
  if (s >= 50) return '#d97706';
  return '#dc2626';
}

const statusConfig = {
  present:      { label: 'Present',      color: 'bg-success-container text-success',   dot: 'bg-success' },
  absent:       { label: 'Absent',       color: 'bg-danger-container text-danger',       dot: 'bg-danger' },
  late:         { label: 'Late',         color: 'bg-warning-container text-warning',   dot: 'bg-warning' },
  'half-day':   { label: 'Half Day',     color: 'bg-blue-50 text-blue-600',     dot: 'bg-blue-500' },
  short_leave:  { label: 'Short Leave',  color: 'bg-orange-50 text-orange-600', dot: 'bg-orange-400' },
  on_leave:     { label: 'On Leave',     color: 'bg-violet-50 text-violet-600', dot: 'bg-violet-400' },
  unpaid_leave: { label: 'Unpaid Leave', color: 'bg-danger-container text-danger',     dot: 'bg-rose-400' },
  weekend:      { label: 'Weekend',      color: 'bg-surface-2 text-on-surface-subtle',     dot: 'bg-gray-300' },
  holiday:      { label: 'Holiday',      color: 'bg-purple-50 text-purple-500', dot: 'bg-purple-400' },
  wfh:          { label: 'Work From Home',    color: 'bg-[#192250]/10 text-[#192250]',  dot: 'bg-[#192250]' },
  wfh_half:     { label: 'Half Day WFH',      color: 'bg-[#EE2770]/10 text-[#EE2770]', dot: 'bg-[#EE2770]' },
};

const leaveStatusConfig = {
  pending:   { color: 'bg-warning-container text-warning border-amber-200',  icon: AlertCircle },
  approved:  { color: 'bg-success-container text-success border-green-200',  icon: CheckCircle },
  rejected:  { color: 'bg-danger-container text-danger border-red-200',        icon: XCircle },
  cancelled: { color: 'bg-surface-2 text-on-surface-subtle border-outline',    icon: XCircle },
};

function ApplyLeaveModal({ onClose, onSubmit, balance }: { onClose: () => void; onSubmit: (d: any) => void; balance: any }) {
  const onProbation = balance?.on_probation ?? false;
  const availableTypes = onProbation
    ? [{ key: 'half_day', label: 'Half Day' }, { key: 'short_leave', label: 'Short Leave' }, { key: 'unpaid', label: 'Unpaid Leave' }]
    : [{ key: 'full_day', label: 'Full Day' }, { key: 'half_day', label: 'Half Day' }, { key: 'short_leave', label: 'Short Leave' }, { key: 'unpaid', label: 'Unpaid Leave' }];

  const [form, setForm] = useState({ type: availableTypes[0].key, from: '', to: '', reason: '' });
  const isSingleDay = form.type === 'half_day' || form.type === 'short_leave';

  const handleSubmit = () => {
    if (!form.from || !form.reason?.trim()) return;
    const countWorkingDays = (from: string, to: string) => {
      let count = 0, cur = from;
      while (cur <= to) {
        const dow = new Date(cur + 'T12:00:00Z').getUTCDay();
        if (dow !== 0 && dow !== 6) count++;
        const d = new Date(cur + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
        cur = d.toISOString().slice(0, 10);
      }
      return Math.max(1, count);
    };
    const days = isSingleDay ? 1 : countWorkingDays(form.from, form.to);
    onSubmit({ ...form, days, from_date: form.from, to_date: isSingleDay ? form.from : form.to });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-on-surface">Apply for Leave</h3>
          <button onClick={onClose}><X size={18} className="text-on-surface-subtle" /></button>
        </div>
        {onProbation && (
          <div className="mb-4 px-3 py-2.5 rounded-xl text-xs font-medium" style={{ background: '#fef3c7', color: '#92400e' }}>
            You are on probation — only Short Leave (×2) or Half Day allowed during this period.
            Remaining: {balance?.probation_short_remaining ?? 0} short leave credit(s).
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">Leave Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm focus:outline-none bg-surface">
              {availableTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            {form.type === 'full_day' && <p className="text-xs text-blue-600 mt-1">Balance: {balance?.full_day ?? 0} day(s) — carries forward</p>}
            {form.type === 'half_day' && <p className="text-xs text-purple-600 mt-1">Costs 2 short leave credits — this month: {balance?.short_leave ?? 0} remaining</p>}
            {form.type === 'short_leave' && <p className="text-xs text-warning mt-1">Costs 1 short leave credit — this month: {balance?.short_leave ?? 0} remaining</p>}
            {form.type === 'unpaid' && <p className="text-xs text-danger mt-1">No credits deducted — attendance will be marked as Unpaid Leave</p>}
          </div>
          <div className={isSingleDay ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">{isSingleDay ? 'Date' : 'From'}</label>
              <input type="date" value={form.from}
                onChange={e => setForm(f => ({ ...f, from: e.target.value, to: isSingleDay ? e.target.value : f.to }))}
                className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
            </div>
            {!isSingleDay && (
              <div>
                <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">To</label>
                <input type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                  className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">Reason</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              rows={3} placeholder="Briefly describe the reason..."
              className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm focus:outline-none resize-none" />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 border border-outline rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
            <button onClick={handleSubmit} className="flex-1 py-2.5 text-white rounded-lg text-sm font-medium" style={{ background: '#192250' }}>Submit</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MyPortal() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get('tab') ?? 'hub');
  // Keep tab in sync if user navigates via notification while already on this page
  useEffect(() => { const t = searchParams.get('tab'); if (t) setTab(t); }, [searchParams]);
  const [applyLeave, setApplyLeave] = useState(false);
  // Optional leave
  const [optionalLeaveData, setOptionalLeaveData] = useState<{dates:any[];used_count:number;remaining:number}|null>(null);
  const [optionalLeaveLoaded, setOptionalLeaveLoaded] = useState(false);
  const [applyingOptional, setApplyingOptional] = useState<string|null>(null); // date string being applied
  const [optionalReason, setOptionalReason] = useState('');
  const [optionalError, setOptionalError] = useState('');
  const [myIncentives, setMyIncentives] = useState<any[]>([]);
  const [showUpsellForm, setShowUpsellForm] = useState(false);
  const [upsellForm, setUpsellForm] = useState({ client_name: '', service_description: '', deal_value: '', currency: 'INR', notes: '' });
  const [upsellFxRate, setUpsellFxRate] = useState<number | null>(null);
  // Refetch FX rate whenever the upsell modal is open and the currency changes.
  useEffect(() => {
    if (!showUpsellForm) return;
    if (upsellForm.currency === 'INR') { setUpsellFxRate(1); return; }
    financeApi.getFxRate({ from: upsellForm.currency, to: 'INR' })
      .then(r => setUpsellFxRate(r.rate))
      .catch(() => setUpsellFxRate(null));
  }, [showUpsellForm, upsellForm.currency]);
  const [myExpenses, setMyExpenses] = useState<any[]>([]);
  const [myAssets, setMyAssets] = useState<any[]>([]);
  const [myRepairTickets, setMyRepairTickets] = useState<any[]>([]);
  // "Raise repair ticket" flow for employees with at least one assigned
  // asset. The modal is opened with a specific asset pre-selected.
  const [reportingRepairFor, setReportingRepairFor] = useState<any | null>(null);
  const [repairForm, setRepairForm] = useState({ issue: '', notes: '' });
  const [repairSubmitting, setRepairSubmitting] = useState(false);
  const [repairError, setRepairError] = useState('');
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expCategories, setExpCategories] = useState<string[]>([]);
  const [expenseForm, setExpenseForm] = useState({ category: '', description: '', amount: '', receipt_note: '', expense_date: '' });
  const [submittingExp, setSubmittingExp] = useState(false);
  const [submittingUpsell, setSubmittingUpsell] = useState(false);
  const [upsellError, setUpsellError] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const [myWarnings, setMyWarnings] = useState<any[]>([]);
  const [myPip, setMyPip] = useState<any | null>(null);
  const [wfhRequests, setWfhRequests] = useState<any[]>([]);
  const [applyWfh, setApplyWfh] = useState(false);
  const [wfhForm, setWfhForm] = useState({ date: '', type: 'full_day', reason: '' });
  const [savingWfh, setSavingWfh] = useState(false);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any | null>(null);
  const [balance, setBalance] = useState<any>({ casual: 0, sick: 0, earned: 0 });
  const [monthlyPerf, setMonthlyPerf] = useState<any[]>([]);
  const [empDbId, setEmpDbId] = useState('');
  // Performance Pulse — automated score
  const [pulse, setPulse] = useState<any | null>(null);
  const [pulseTrend, setPulseTrend] = useState<Array<{ snapshot_date: string; total_score: number; band: string }>>([]);
  const [showPulseDrawer, setShowPulseDrawer] = useState(false);

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
  const [rejectLeaveTarget, setRejectLeaveTarget] = useState<string | null>(null);
  // Team member leave viewer
  const [viewLeavesFor, setViewLeavesFor] = useState<any | null>(null); // employee record
  const [teamMemberLeaves, setTeamMemberLeaves] = useState<any[]>([]);
  const [teamMemberBalance, setTeamMemberBalance] = useState<any | null>(null);
  const [loadingMemberLeaves, setLoadingMemberLeaves] = useState(false);
  const [cancelLeaveTarget, setCancelLeaveTarget] = useState<string | null>(null);
  const [showTeamReview, setShowTeamReview] = useState<any | null>(null); // employee record
  const [teamReviewScores, setTeamReviewScores] = useState<Record<string, number>>({
    productivity: 75, quality: 75, teamwork: 75, attendance_score: 75, initiative: 75, client_satisfaction: 75, ai_usage: 75,
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
        api.getWfhRequests({ employee_id: emp.id }),
      ]).then(([att, lv, pay, bal, perf, appraisals, wfh]) => {
        api.getWarnings(emp.id).then(setMyWarnings).catch(() => {});
        api.getPips(emp.id).then(pips => setMyPip((pips as any[]).find(p => p.status === 'active') ?? null)).catch(() => {});
        api.getUpsellRequests(emp.id).then(setMyIncentives).catch(() => {});
        api.getExpenses(emp.id).then(setMyExpenses).catch(() => {});
        // My laptop/asset + active repair tickets
        api.getAssets(emp.id).then(setMyAssets).catch(() => {});
        api.getRepairTickets(emp.id).then(setMyRepairTickets).catch(() => {});
        api.getMyPulse()
          .then(p => { setPulse(p.latest ?? null); setPulseTrend(p.trend ?? []); })
          .catch(() => {});
        // Optional leave pool for current year
        api.getOptionalLeaveAvailable(emp.id, new Date().getFullYear())
          .then(d => { setOptionalLeaveData(d); setOptionalLeaveLoaded(true); })
          .catch(() => setOptionalLeaveLoaded(true));
        api.getExpenseCategories().then(setExpCategories).catch(() => {});
        setAttendance(att);
        setLeaves(lv);
        setWfhRequests(Array.isArray(wfh) ? wfh : []);
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

  // Late employees ARE present — they just arrived after the cutoff. So the
  // "Present" headline tile counts both, and "Late" is a sub-stat of present.
  const onTimeDays  = attendance.filter(r => r.status === 'present').length;
  const lateDays    = attendance.filter(r => r.status === 'late').length;
  const presentDays = onTimeDays + lateDays;
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
                  {g.description && <p className="text-xs text-on-surface-subtle mt-1">{g.description}</p>}
                  {g.success_criteria && <p className="text-xs text-on-surface-subtle mt-1 italic">Target: {g.success_criteria}</p>}
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
                      <span className="text-xs text-on-surface-subtle font-semibold">Manager:</span>
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

  // Load team data once empDbId is known. Descendants=true so an Nth-level
  // manager sees their full sub-tree (the My Team tab + drilldowns).
  useEffect(() => {
    if (!empDbId) return;
    api.getTeamMembers(empDbId, true).then(members => {
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

  const handleCancelMemberLeave = async (leaveId: string, reason: string) => {
    await api.cancelLeave(leaveId, user?.name ?? 'Manager', reason);
    setTeamMemberLeaves(prev => prev.map(l => l.id === leaveId ? {
      ...l, status: 'cancelled', cancelled_by: user?.name, cancelled_at: new Date().toISOString(), cancellation_reason: reason,
    } : l));
    if (viewLeavesFor) {
      api.getLeaveBalance(viewLeavesFor.id).then(setTeamMemberBalance).catch(() => {});
    }
  };

  const handleViewMemberLeaves = async (member: any) => {
    if (viewLeavesFor?.id === member.id) { setViewLeavesFor(null); return; }
    setViewLeavesFor(member);
    setLoadingMemberLeaves(true);
    try {
      const [leaves, bal] = await Promise.all([
        api.getLeaveRequests({ employee_id: member.id }),
        api.getLeaveBalance(member.id).catch(() => null),
      ]);
      setTeamMemberLeaves(leaves);
      setTeamMemberBalance(bal);
    } finally {
      setLoadingMemberLeaves(false);
    }
  };

  const handleManagerApproveLeave = async (leaveId: string, status: 'approved' | 'rejected', rejection_reason?: string) => {
    setApprovingLeave(prev => ({ ...prev, [leaveId]: true }));
    try {
      await api.managerApproveLeave(leaveId, { status, manager_id: empDbId, manager_name: user?.name, rejection_reason });
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
        ai_usage: teamReviewScores.ai_usage,
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

      {/* Hub-or-section nav: hub gets no strip; deep sections get a compact
          back-link so the user always has one tap home. */}
      {tab !== 'hub' && (() => {
        const current = tabs.find(t => t.key === tab);
        const Icon = current?.icon;
        return (
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-3">
              <button onClick={() => setTab('hub')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-outline bg-surface text-on-surface-muted hover:bg-surface-2 transition-colors">
                ← All sections
              </button>
              <div className="inline-flex items-center gap-2 text-on-surface">
                {Icon && <Icon size={16} className="text-brand" />}
                <span className="font-display text-base font-bold tracking-tight">{current?.label ?? 'Section'}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Hub — landing dashboard with section cards */}
      {tab === 'hub' && (() => {
        const present = presentDays, late = lateDays, absent = absentDays;
        const today = new Date();
        const todayStr = today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
        const hour = today.getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        const todayRec = attendance.find((a: any) => (a.date ?? '').slice(0, 10) === today.toISOString().slice(0, 10));
        const pendingLeaves = leaves.filter((l: any) => l.status === 'pending').length;
        const pendingWfh = wfhRequests.filter((w: any) => w.status === 'pending').length;
        const fullDay = (balance as any).full_day ?? 0;
        const shortLeave = (balance as any).short_leave ?? 0;
        const approvedWfh = wfhRequests.filter((w: any) => w.status === 'approved').length;

        return (
          <div className="space-y-5">
            {/* Hero */}
            <div className="relative overflow-hidden rounded-xl-3 border border-outline bg-surface shadow-elev-2">
              <div className="absolute inset-0 aurora-bg opacity-90" />
              <div className="absolute inset-0 grain-overlay" />
              <div className="relative px-6 py-6 text-white">
                <p className="text-sm opacity-80">{todayStr}</p>
                <h2 className="font-display text-2xl font-bold mt-1">{greeting}, {user?.name?.split(' ')[0] ?? 'there'}.</h2>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                  {todayRec ? (
                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur">
                      <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                      Clocked in {todayRec.clock_in ?? ''}
                      {todayRec.total_hours != null && <span className="opacity-80">· {Math.round(Number(todayRec.total_hours) * 10) / 10}h today</span>}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur">
                      <span className="w-2 h-2 rounded-full bg-warning" />
                      Not clocked in yet
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur">
                    {fullDay} full + {shortLeave} short leave left
                  </span>
                  {(pendingLeaves > 0 || pendingWfh > 0) && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warning/30 backdrop-blur text-white">
                      {pendingLeaves + pendingWfh} pending approval{pendingLeaves + pendingWfh === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* This-month stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <HubStat label="Present" value={present} tone="text-success" />
              <HubStat label="Late" value={late} tone="text-warning" />
              <HubStat label="Absent" value={absent} tone="text-danger" />
              <HubStat label="WFH days" value={approvedWfh} tone="text-on-surface" />
            </div>

            {/* Performance Pulse tile — automated 30-day score */}
            {pulse && (
              <button
                onClick={() => setShowPulseDrawer(true)}
                className="w-full text-left bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 hover:border-accent/40 transition-all p-5 group">
                <div className="flex items-center justify-between gap-5">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-16 h-16 rounded-2xl flex items-center justify-center font-display font-bold text-2xl tabular-nums"
                      style={pulseTileTone(pulse.band)}>
                      {pulse.is_baseline ? '…' : pulse.total_score}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle">Performance pulse · 30-day</p>
                      <p className="font-display text-lg font-bold text-on-surface mt-0.5">
                        {pulse.is_baseline ? 'Building baseline' : bandLabel(pulse.band)}
                      </p>
                      <p className="text-xs text-on-surface-muted mt-0.5">
                        {pulse.is_baseline
                          ? 'New joiner — score appears after 30 days'
                          : `Updated ${new Date(pulse.snapshot_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · tap to see breakdown`}
                      </p>
                    </div>
                  </div>
                  {pulseTrend.length > 1 && !pulse.is_baseline && (
                    <PulseSparkline trend={pulseTrend} />
                  )}
                </div>
              </button>
            )}

            {/* Section cards */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle mb-2">Quick access</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {tabs.filter(t => t.key !== 'overview').map(t => {
                  const Icon = t.icon;
                  const hint = hubHints({
                    key: t.key, pendingLeaves, pendingWfh, fullDay, shortLeave, performance: monthlyPerf,
                  });
                  return (
                    <button key={t.key} onClick={() => setTab(t.key)}
                      className="text-left group bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 hover:border-accent/40 transition-all p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-9 h-9 rounded-lg bg-brand-container/50 flex items-center justify-center group-hover:bg-accent-container transition-colors">
                          <Icon size={16} className="text-brand group-hover:text-accent transition-colors" />
                        </div>
                        {hint?.badge && (
                          <span className={`num-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full ${hint.badgeTone ?? 'bg-warning text-on-accent'}`}>{hint.badge}</span>
                        )}
                      </div>
                      <p className="mt-3 font-display text-sm font-bold text-on-surface group-hover:text-accent transition-colors">{t.label}</p>
                      {hint?.sub && <p className="text-[11px] text-on-surface-subtle mt-0.5">{hint.sub}</p>}
                    </button>
                  );
                })}
                <button onClick={() => setTab('overview')}
                  className="text-left group bg-surface-2 rounded-xl-2 border border-dashed border-outline hover:border-accent/40 transition-all p-4 flex items-center justify-center text-on-surface-muted hover:text-accent text-xs font-semibold">
                  See full overview →
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-surface rounded-xl p-5 border border-outline shadow-sm">
            <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-3">Personal Info</p>
            {[
              { label: 'Email',       value: user?.email },
              { label: 'Department',  value: user?.department },
              { label: 'Designation', value: user?.designation },
              { label: 'Employee ID', value: user?.employee_id_ref },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm text-on-surface-subtle">{label}</span>
                <span className="text-sm font-medium text-on-surface">{value ?? '—'}</span>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <div className="bg-surface rounded-xl p-5 border border-outline shadow-sm">
              <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-3">This Month</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center"><p className="text-2xl font-bold text-success">{presentDays}</p><p className="text-xs text-on-surface-subtle">Present</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-warning">{lateDays}</p><p className="text-xs text-on-surface-subtle">Late</p></div>
                <div className="text-center"><p className="text-2xl font-bold text-danger">{absentDays}</p><p className="text-xs text-on-surface-subtle">Absent</p></div>
              </div>
            </div>
            <div className="bg-surface rounded-xl p-5 border border-outline shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Leave Balance</p>
                {balance.on_probation && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>Probation</span>
                )}
              </div>
              {balance.on_probation ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-warning">{balance.probation_short_remaining ?? 0}</p>
                    <p className="text-xs text-on-surface-subtle">Short Leave Left</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-on-surface-subtle">0</p>
                    <p className="text-xs text-on-surface-subtle">Full Day (locked)</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center"><p className="text-2xl font-bold text-blue-600">{balance.full_day ?? 0}</p><p className="text-xs text-on-surface-subtle">Full Day</p></div>
                  <div className="text-center"><p className="text-2xl font-bold text-purple-600">{balance.short_leave ?? 0}</p><p className="text-xs text-on-surface-subtle">Short / Half Day</p></div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── My Role (read-only playbook for the employee's role) ── */}
      {tab === 'role' && <MyRoleTab role={user?.role} employeeId={empDbId || null} />}

      {/* ── Attendance ── */}
      {tab === 'attendance' && (
        <div className="bg-surface rounded-xl border border-outline shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-outline">
            <h3 className="font-semibold text-on-surface">My Attendance — {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {attendance.filter(r => r.status !== 'weekend').map(r => {
              const cfg = statusConfig[r.status as keyof typeof statusConfig];
              const isShortDay = (r.status === 'present' || r.status === 'late')
                && r.check_out && Number(r.total_hours) > 0 && Number(r.total_hours) < 9;
              return (
                <div key={r.date} className="flex items-center justify-between px-5 py-3 hover:bg-surface-2/50">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`w-2 h-2 rounded-full ${cfg?.dot} flex-shrink-0`} />
                    <span className="text-sm text-on-surface-muted">
                      {parseLocalDate(r.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg?.color}`}>{cfg?.label}</span>
                    {isShortDay && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}>
                        Short Day
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-on-surface-subtle whitespace-nowrap">
                    {r.check_in ? `${r.check_in} – ${r.check_out ?? '—'} (${fmtHours(r.total_hours)})` : '—'}
                  </span>
                </div>
              );
            })}
            {attendance.filter(r => r.status !== 'weekend').length === 0 && (
              <p className="text-center text-on-surface-subtle text-sm py-12">No records yet this month</p>
            )}
          </div>
        </div>
      )}

      {/* ── Leaves ── */}
      {tab === 'leave' && (
        <TabErrorBoundary>
        <div className="space-y-4">
          {/* Balance summary */}
          <div className="grid grid-cols-3 gap-3">
            {balance.on_probation ? (
              <>
                <div className="bg-warning-container border border-amber-100 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-warning">{balance.probation_short_remaining ?? 0}</p>
                  <p className="text-xs text-warning font-medium mt-1">Probation Credits Left</p>
                </div>
                <div className="bg-surface-2 border border-outline rounded-xl p-4 text-center col-span-2">
                  <p className="text-xs font-semibold text-warning mb-1">On Probation</p>
                  <p className="text-xs text-on-surface-subtle">Full day leave available after probation ends</p>
                  {balance.probation_end_date && (
                    <p className="text-xs text-warning mt-1 font-medium">Ends: {new Date(balance.probation_end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-blue-600">{balance.full_day ?? 0}</p>
                  <p className="text-xs text-blue-700 font-medium mt-1">Full Day</p>
                  {(Number(balance.prev_month_carry_full_day) > 0 || Number(balance.current_month_credit_full_day) > 0) ? (
                    <div className="mt-1.5 pt-1.5 border-t border-blue-100 space-y-0.5">
                      {Number(balance.current_month_credit_full_day) > 0 && (
                        <p className="text-[10px] text-blue-700">+{balance.current_month_credit_full_day} credited in {balance.current_month_label?.split(' ')[0] ?? 'this month'}</p>
                      )}
                      {Number(balance.prev_month_carry_full_day) > 0 && (
                        <p className="text-[10px] text-blue-600">+{balance.prev_month_carry_full_day} carried from {balance.prev_month_label?.split(' ')[0] ?? 'last month'}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-on-surface-subtle">carries forward</p>
                  )}
                </div>
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-purple-600">{balance.short_leave ?? 0}</p>
                  <p className="text-xs text-purple-700 font-medium mt-1">Short Leave / Half Day</p>
                  <p className="text-xs text-on-surface-subtle">resets monthly</p>
                </div>
                <div className="bg-success-container border border-green-100 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-success">✓</p>
                  <p className="text-xs text-success font-medium mt-1">Confirmed</p>
                  <p className="text-xs text-on-surface-subtle">past probation</p>
                </div>
              </>
            )}
          </div>
          <div className="flex justify-end">
            <button onClick={() => setApplyLeave(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
              style={{ background: 'linear-gradient(135deg, #EE2770 0%, #d11f62 100%)' }}>
              <Plus size={15} /> Apply Leave
            </button>
          </div>
          <div className="bg-surface rounded-xl border border-outline shadow-sm overflow-hidden">
            {leaves.length === 0 ? (
              <p className="text-center text-on-surface-subtle text-sm py-16">No leave requests found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-2 border-b border-outline">
                      {['Type', 'Duration', 'Days', 'Reason', 'Applied On', 'Status', 'Action Trail'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-on-surface-subtle px-4 py-3 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.map(l => {
                      const cfg = leaveStatusConfig[l.status as keyof typeof leaveStatusConfig];
                      const appliedAt = l.created_at ? new Date(l.created_at) : null;
                      const appliedStr = appliedAt
                        ? appliedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                          + ', ' + appliedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                        : '—';
                      return (
                        <tr key={l.id} className="border-b border-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-on-surface capitalize">{(l.type ?? '').replace('_', ' ')}</td>
                          <td className="px-4 py-3 text-sm text-on-surface-muted whitespace-nowrap">
                            {parseLocalDate(l.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            {l.from_date !== l.to_date && ` – ${parseLocalDate(l.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-on-surface-muted">{l.days}d</td>
                          <td className="px-4 py-3 text-sm text-on-surface-subtle max-w-[140px] truncate">{l.reason}</td>
                          <td className="px-4 py-3 text-xs text-on-surface-subtle whitespace-nowrap">{appliedStr}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium ${cfg?.color ?? 'bg-surface-2 text-on-surface-subtle border-outline'}`}>
                              {cfg && <cfg.icon size={11} />} {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3 min-w-[180px]">
                            <div className="space-y-1">
                              {(l.manager_status === 'approved' || l.manager_status === 'rejected') && (
                                <div className="text-xs leading-tight">
                                  <span className={`font-semibold ${l.manager_status === 'approved' ? 'text-success' : 'text-danger'}`}>
                                    {l.manager_status === 'approved' ? 'Mgr Approved' : 'Mgr Rejected'}
                                  </span>
                                  {l.manager_name && <span className="text-on-surface-subtle"> · {l.manager_name}</span>}
                                  {l.manager_approved_at && (
                                    <span className="text-on-surface-subtle block">
                                      {new Date(l.manager_approved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                      {', '}{new Date(l.manager_approved_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                    </span>
                                  )}
                                  {l.manager_rejection_reason && <span className="text-danger italic block">"{l.manager_rejection_reason}"</span>}
                                </div>
                              )}
                              {l.hr_actioned_at && (
                                <div className="text-xs leading-tight">
                                  <span className={`font-semibold ${l.status === 'approved' ? 'text-success' : 'text-danger'}`}>
                                    {l.status === 'approved' ? 'HR Approved' : 'HR Rejected'}
                                  </span>
                                  {l.hr_actioner_name && <span className="text-on-surface-subtle"> · {l.hr_actioner_name}</span>}
                                  <span className="text-on-surface-subtle block">
                                    {new Date(l.hr_actioned_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    {', '}{new Date(l.hr_actioned_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                  </span>
                                  {l.rejection_reason && <span className="text-danger italic block">"{l.rejection_reason}"</span>}
                                </div>
                              )}
                              {!l.manager_approved_at && !l.hr_actioned_at && <span className="text-xs text-on-surface-subtle">Pending</span>}
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
          {applyLeave && <ApplyLeaveModal onClose={() => setApplyLeave(false)} onSubmit={handleApplyLeave} balance={balance} />}

          {/* ── Optional Leaves ── */}
          {optionalLeaveLoaded && optionalLeaveData && (
            <div className="bg-surface rounded-xl border border-outline shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm text-on-surface">Optional Leaves</p>
                  <p className="text-xs text-on-surface-subtle mt-0.5">Pick any {optionalLeaveData.remaining > 0 ? optionalLeaveData.remaining : 0} more date{optionalLeaveData.remaining !== 1 ? 's' : ''} from the pool below — {2 - optionalLeaveData.used_count > 0 ? `${2 - optionalLeaveData.used_count} of 2 remaining this year` : '0 of 2 remaining — quota used'}</p>
                </div>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{ background: optionalLeaveData.remaining > 0 ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)', color: optionalLeaveData.remaining > 0 ? '#15803d' : '#dc2626' }}>
                  {optionalLeaveData.remaining}/2 left
                </span>
              </div>

              {balance?.on_probation && (
                <div className="mx-4 mt-4 mb-2 px-3 py-2.5 rounded-xl text-xs font-medium" style={{ background: '#fef3c7', color: '#92400e' }}>
                  Optional leave is available only after your probation period ends.
                </div>
              )}

              {optionalLeaveData.dates.length === 0 ? (
                <p className="text-sm text-on-surface-subtle text-center py-8">No optional leave dates have been set by HR for this year yet.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {optionalLeaveData.dates.map(d => {
                    const dateObj = new Date(d.date + 'T12:00:00Z');
                    const isPast = d.date < new Date().toISOString().slice(0,10);
                    const canApply = !d.already_applied && !balance?.on_probation && optionalLeaveData.remaining > 0 && !isPast;
                    const statusColors: Record<string,string> = {
                      pending: '#d97706', approved: '#15803d', rejected: '#dc2626',
                    };

                    return (
                      <div key={d.id}>
                        <div className="flex items-center gap-3 px-5 py-3.5">
                          <div className="w-11 h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0"
                            style={{ background: isPast ? '#f3f4f6' : d.is_birthday ? 'rgba(238,39,112,0.1)' : 'rgba(25,34,80,0.06)' }}>
                            <span className="text-[9px] font-bold uppercase" style={{ color: isPast ? '#9ca3af' : d.is_birthday ? '#EE2770' : '#192250' }}>
                              {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dateObj.getUTCMonth()]}
                            </span>
                            <span className="text-base font-black leading-none" style={{ color: isPast ? '#9ca3af' : '#192250' }}>
                              {dateObj.getUTCDate()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${isPast ? 'text-on-surface-subtle' : 'text-on-surface'}`}>{d.label}</p>
                            <p className="text-xs text-on-surface-subtle">{dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long' })}</p>
                          </div>
                          <div className="flex-shrink-0 flex items-center gap-2">
                            {d.already_applied ? (
                              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-warning-container text-warning border border-amber-100">Applied</span>
                            ) : isPast ? (
                              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-surface-2 text-on-surface-subtle">Past</span>
                            ) : canApply ? (
                              <button
                                onClick={() => { setApplyingOptional(d.date); setOptionalReason(''); setOptionalError(''); }}
                                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
                                style={{ background: 'linear-gradient(135deg,#192250 0%,#141c43 100%)' }}>
                                Apply
                              </button>
                            ) : (
                              <span className="text-xs text-on-surface-subtle italic">{balance?.on_probation ? 'On probation' : 'Quota used'}</span>
                            )}
                          </div>
                        </div>

                        {/* Inline apply form */}
                        {applyingOptional === d.date && (
                          <div className="mx-5 mb-3 p-4 bg-surface-2 border border-outline rounded-xl space-y-3">
                            <p className="text-xs font-semibold text-on-surface-muted">Applying optional leave for: <strong>{d.label}</strong> ({d.date})</p>
                            <div>
                              <label className="text-xs font-medium text-on-surface-subtle mb-1 block">Reason <span className="text-danger">*</span></label>
                              <textarea value={optionalReason} onChange={e => { setOptionalReason(e.target.value); setOptionalError(''); }}
                                rows={2} placeholder="Why are you taking this optional leave?"
                                className="w-full text-sm border border-outline rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary-200"/>
                            </div>
                            {optionalError && <p className="text-xs text-danger font-medium">{optionalError}</p>}
                            <div className="flex gap-2">
                              <button onClick={() => { setApplyingOptional(null); setOptionalError(''); }}
                                className="flex-1 py-2 border border-outline rounded-lg text-xs font-medium text-on-surface-muted hover:bg-surface">
                                Cancel
                              </button>
                              <button
                                disabled={!optionalReason.trim()}
                                onClick={async () => {
                                  setOptionalError('');
                                  try {
                                    const created = await api.applyLeave({
                                      employee_id: empDbId, employee_name: user?.name,
                                      type: 'optional', from_date: d.date, to_date: d.date,
                                      days: 1, reason: optionalReason.trim(),
                                    });
                                    setLeaves(prev => [created, ...prev]);
                                    // Refresh optional leave data
                                    api.getOptionalLeaveAvailable(empDbId, new Date().getFullYear())
                                      .then(setOptionalLeaveData).catch(() => {});
                                    setApplyingOptional(null);
                                  } catch (e: any) {
                                    setOptionalError(e.message ?? 'Failed to submit. Please try again.');
                                  }
                                }}
                                className="flex-1 py-2 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                                style={{ background: 'linear-gradient(135deg,#EE2770 0%,#d11f62 100%)' }}>
                                Submit Request
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        </TabErrorBoundary>
      )}

      {/* ── Work From Home ── */}
      {tab === 'wfh' && (
        <div className="space-y-4">
          {balance?.on_probation && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
              style={{ background: 'rgba(217,119,6,0.08)', color: '#92400e', border: '1px solid rgba(217,119,6,0.2)' }}>
              <AlertCircle size={15} />
              Work From Home is not available during the probation period.
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={() => { setApplyWfh(true); setWfhForm({ date: '', type: 'full_day', reason: '' }); }}
              className="flex items-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-xl shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
              <Plus size={15} /> Apply WFH
            </button>
          </div>

          {/* WFH request list */}
          <div className="bg-surface rounded-xl border border-outline shadow-sm overflow-hidden">
            {wfhRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Monitor size={32} className="text-gray-200" />
                <p className="text-sm text-on-surface-subtle">No WFH requests yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2 border-b border-outline">
                      {['Date', 'Type', 'Reason', 'Applied On', 'Status', 'Action'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-on-surface-subtle px-4 py-3 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wfhRequests.map(w => {
                      const statusColor: Record<string,string> = {
                        approved: 'bg-teal-50 text-teal-700 border-teal-200',
                        rejected: 'bg-danger-container text-danger border-red-200',
                        pending:  'bg-warning-container text-warning border-amber-200',
                        cancelled:'bg-surface-2 text-on-surface-subtle border-outline',
                      };
                      return (
                        <tr key={w.id} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-3 font-medium text-on-surface whitespace-nowrap">
                            {parseLocalDate(w.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-teal-50 text-teal-700">
                              {w.type === 'half_day' ? 'Half Day' : 'Full Day'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-on-surface-subtle max-w-[160px] truncate">{w.reason}</td>
                          <td className="px-4 py-3 text-xs text-on-surface-subtle whitespace-nowrap">
                            {new Date(w.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              <span className={`inline-flex items-center text-xs px-2.5 py-0.5 rounded-full border font-medium ${statusColor[w.status] ?? 'bg-surface-2 text-on-surface-subtle border-outline'}`}>
                                {w.status.charAt(0).toUpperCase() + w.status.slice(1)}
                              </span>
                              {w.manager_status === 'approved' && w.status === 'pending' && (
                                <p className="text-xs text-success">✓ Manager approved</p>
                              )}
                              {w.manager_status === 'rejected' && (
                                <p className="text-xs text-danger">✕ Manager rejected</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {(w.status === 'pending' || w.status === 'approved') && (
                              <button
                                onClick={async () => {
                                  const reason = prompt('Reason for cancellation (required):');
                                  if (!reason?.trim()) return;
                                  await api.cancelWfh(w.id, user?.name ?? 'Employee', reason.trim());
                                  setWfhRequests(prev => prev.map(x => x.id === w.id ? { ...x, status: 'cancelled' } : x));
                                }}
                                className="text-xs px-2.5 py-1 bg-surface-2 text-on-surface-muted rounded-md hover:bg-surface-3 font-medium whitespace-nowrap">
                                Cancel
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Apply WFH modal */}
          {applyWfh && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
              <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(25,34,80,0.08)' }}>
                      <Monitor size={17} style={{ color: '#192250' }} />
                    </div>
                    <h2 className="text-base font-semibold text-on-surface">Apply Work From Home</h2>
                  </div>
                  <button onClick={() => setApplyWfh(false)} className="p-1.5 hover:bg-surface-2 rounded-lg">
                    <X size={16} className="text-on-surface-subtle" />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="text-xs font-medium text-on-surface-muted mb-1 block">Date <span className="text-danger">*</span></label>
                    <input type="date" value={wfhForm.date}
                      onChange={e => setWfhForm(f => ({ ...f, date: e.target.value }))}
                      className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-200" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-on-surface-muted mb-1 block">Type</label>
                    <div className="flex gap-3">
                      {[{ key: 'full_day', label: 'Full Day' }, { key: 'half_day', label: 'Half Day' }].map(t => (
                        <button key={t.key} type="button"
                          onClick={() => setWfhForm(f => ({ ...f, type: t.key }))}
                          className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${wfhForm.type === t.key ? 'border-[#192250] bg-[#192250]/10 text-[#192250] font-semibold' : 'border-outline text-on-surface-muted hover:border-outline-strong'}`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-on-surface-muted mb-1 block">Reason <span className="text-danger">*</span></label>
                    <textarea value={wfhForm.reason} onChange={e => setWfhForm(f => ({ ...f, reason: e.target.value }))}
                      rows={3} placeholder="Briefly describe the reason for WFH..."
                      className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm focus:outline-none resize-none" />
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setApplyWfh(false)}
                      className="flex-1 py-2.5 border border-outline rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">
                      Cancel
                    </button>
                    <button
                      disabled={savingWfh || !wfhForm.date || !wfhForm.reason?.trim()}
                      onClick={async () => {
                        setSavingWfh(true);
                        try {
                          const created = await api.applyWfh({
                            employee_id: empDbId,
                            employee_name: user?.name,
                            date: wfhForm.date,
                            type: wfhForm.type,
                            reason: wfhForm.reason.trim(),
                          });
                          setWfhRequests(prev => [created, ...prev]);
                          setApplyWfh(false);
                        } catch { /* ignore */ }
                        finally { setSavingWfh(false); }
                      }}
                      className="flex-1 py-2.5 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
                      {savingWfh ? 'Submitting…' : 'Submit WFH Request'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Incentives ── */}
      {tab === 'incentives' && (() => {
        const STATUS_CFG: Record<string,{label:string;color:string;bg:string}> = {
          pending:  { label: 'Pending Review', color: '#d97706', bg: '#fffbeb' },
          approved: { label: 'Approved',       color: '#15803d', bg: '#f0fdf4' },
          rejected: { label: 'Not Approved',   color: '#dc2626', bg: '#fef2f2' },
          paid:     { label: 'Paid',           color: '#7c3aed', bg: '#f5f3ff' },
        };
        const fmtAmt = (n: any) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';
        return (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => { setShowUpsellForm(true); setUpsellForm({ client_name:'', service_description:'', deal_value:'', currency:'INR', notes:'' }); setUpsellFxRate(1); }}
                className="flex items-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-xl shadow-sm"
                style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
                <Plus size={15} /> Request Incentive
              </button>
            </div>

            {/* Incentive list */}
            <div className="bg-surface rounded-xl border border-outline shadow-sm overflow-hidden">
              {myIncentives.length === 0 ? (
                <div className="flex flex-col items-center py-16 gap-2">
                  <Target size={32} className="text-gray-200" />
                  <p className="text-sm text-on-surface-subtle">No incentive requests yet</p>
                  <p className="text-xs text-on-surface-subtle">Submit a request when you upsell a service to a client</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {myIncentives.map(r => {
                    const cfg = STATUS_CFG[r.status] ?? STATUS_CFG.pending;
                    return (
                      <div key={r.id} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-on-surface">{r.client_name}</p>
                            <p className="text-xs text-on-surface-subtle mt-0.5">{r.service_description}</p>
                            {r.notes && (
                              <p className="text-xs text-on-surface-muted mt-1 leading-snug whitespace-pre-line">{r.notes}</p>
                            )}
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                              {r.deal_value && (
                                <span className="text-xs text-on-surface-subtle">
                                  Deal:{' '}
                                  <strong style={{ color: '#192250' }}>
                                    {r.currency && r.currency !== 'INR'
                                      ? `${r.currency === 'USD' ? '$' : r.currency === 'EUR' ? '€' : r.currency === 'GBP' ? '£' : r.currency + ' '}${Number(r.deal_value).toLocaleString('en-IN')}`
                                      : fmtAmt(r.deal_value)}
                                  </strong>
                                  {r.currency && r.currency !== 'INR' && r.deal_value_inr && (
                                    <span className="text-on-surface-subtle"> (≈ ₹{Math.round(Number(r.deal_value_inr)).toLocaleString('en-IN')})</span>
                                  )}
                                </span>
                              )}
                              {r.approved_amount
                                ? <span className="text-xs font-semibold" style={{ color: '#15803d' }}>Incentive: {fmtAmt(r.approved_amount)}</span>
                                : <span className="text-xs text-on-surface-subtle italic">Incentive amount to be set by HR</span>}
                            </div>
                            {r.rejection_reason && <p className="text-xs text-danger mt-1 italic">"{r.rejection_reason}"</p>}
                            {r.payment_note && <p className="text-xs text-purple-500 mt-1">{r.payment_note}</p>}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                            <span className="text-[10px] text-on-surface-subtle">
                              {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Submit form modal */}
            {showUpsellForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
                <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
                    <h2 className="font-bold text-base" style={{ color: '#192250' }}>Request Upsell Incentive</h2>
                    <button onClick={() => setShowUpsellForm(false)}><X size={16} className="text-on-surface-subtle" /></button>
                  </div>
                  <div className="p-6 space-y-4">
                    {[
                      { key: 'client_name', label: 'Client Name', placeholder: 'e.g. Acme Corp', required: true },
                      { key: 'service_description', label: 'Service Upsold', placeholder: 'e.g. SEO Package upgraded to Premium', required: true },
                    ].map(({ key, label, placeholder, required }) => (
                      <div key={key}>
                        <label className="text-xs font-medium text-on-surface-muted mb-1 block">{label} {required && <span className="text-danger">*</span>}</label>
                        <input value={upsellForm[key as keyof typeof upsellForm]}
                          onChange={e => setUpsellForm(f => ({ ...f, [key]: e.target.value }))}
                          placeholder={placeholder}
                          className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-200" />
                      </div>
                    ))}
                    {/* Currency + deal value side-by-side */}
                    <div>
                      <label className="text-xs font-medium text-on-surface-muted mb-1 block">Total Deal Value <span className="text-danger">*</span></label>
                      <div className="flex gap-2">
                        <select value={upsellForm.currency}
                          onChange={e => setUpsellForm(f => ({ ...f, currency: e.target.value }))}
                          className="text-sm border border-outline rounded-lg px-2.5 py-2.5 bg-surface focus:outline-none focus:ring-2 focus:ring-primary-200">
                          {['INR','USD','EUR','GBP','AUD','CAD'].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input type="number" min="0" step="0.01" value={upsellForm.deal_value}
                          onChange={e => setUpsellForm(f => ({ ...f, deal_value: e.target.value }))}
                          placeholder="e.g. 1500"
                          className="flex-1 text-sm border border-outline rounded-lg px-3 py-2.5 num-mono focus:outline-none focus:ring-2 focus:ring-primary-200" />
                      </div>
                      {upsellForm.currency !== 'INR' && upsellForm.deal_value && Number(upsellForm.deal_value) > 0 && upsellFxRate && (
                        <p className="text-xs text-on-surface-muted mt-1 num-mono">
                          ≈ ₹{Math.round(Number(upsellForm.deal_value) * upsellFxRate).toLocaleString('en-IN')}
                          {' '}<span className="text-on-surface-subtle">(1 {upsellForm.currency} = ₹{upsellFxRate.toFixed(4)})</span>
                        </p>
                      )}
                      <p className="text-xs text-on-surface-subtle mt-1">HR will review and set your INR incentive amount based on this.</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-on-surface-muted mb-1 block">
                        What happened & what extras are we providing? <span className="text-danger">*</span>
                      </label>
                      <textarea value={upsellForm.notes} onChange={e => setUpsellForm(f => ({ ...f, notes: e.target.value }))}
                        rows={4} placeholder="e.g. Client asked for monthly content uplift. We added 4 extra blog posts/mo + premium keyword research at +$300/mo. Closed on the June kickoff call."
                        className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none resize-none focus:ring-2 focus:ring-primary-200 ${
                          upsellForm.notes.trim().length > 0 && upsellForm.notes.trim().length < 30
                            ? 'border-warning bg-warning-container/30'
                            : 'border-outline'
                        }`} />
                      <p className="text-xs text-on-surface-subtle mt-1">
                        Minimum 30 characters. HR needs this to understand the scenario before approving.
                        {upsellForm.notes.trim().length > 0 && (
                          <span className={`ml-1 num-mono ${upsellForm.notes.trim().length < 30 ? 'text-warning' : 'text-success'}`}>
                            ({upsellForm.notes.trim().length}/30)
                          </span>
                        )}
                      </p>
                    </div>
                    {upsellError && <p className="text-xs font-medium text-danger bg-danger-container border border-red-100 rounded-lg px-3 py-2">{upsellError}</p>}
                    <div className="flex gap-3 pt-1">
                      <button onClick={() => { setShowUpsellForm(false); setUpsellError(''); }}
                        className="flex-1 py-2.5 border border-outline rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
                      <button
                        disabled={
                          submittingUpsell
                          || !upsellForm.client_name.trim()
                          || !upsellForm.service_description.trim()
                          || !upsellForm.deal_value || Number(upsellForm.deal_value) <= 0
                          || upsellForm.notes.trim().length < 30
                        }
                        onClick={async () => {
                          setUpsellError('');
                          setSubmittingUpsell(true);
                          try {
                            const created = await api.submitUpsell({
                              employee_id: empDbId, employee_name: user?.name,
                              client_name: upsellForm.client_name.trim(),
                              service_description: upsellForm.service_description.trim(),
                              deal_value: Number(upsellForm.deal_value),
                              currency: upsellForm.currency,
                              fx_rate: upsellForm.currency === 'INR' ? 1 : (upsellFxRate ?? undefined),
                              notes: upsellForm.notes.trim(),
                            });
                            setMyIncentives(prev => [created, ...prev]);
                            setShowUpsellForm(false);
                          } catch (err: any) { setUpsellError(err.message ?? 'Failed to submit. Please try again.'); }
                          finally { setSubmittingUpsell(false); }
                        }}
                        className="flex-1 py-2.5 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
                        {submittingUpsell ? 'Submitting…' : 'Submit Request'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Expenses ── */}
      {tab === 'expenses' && (() => {
        const EXP_STATUS: Record<string,{label:string;color:string;bg:string}> = {
          pending:  {label:'Pending',  color:'#d97706',bg:'#fffbeb'},
          approved: {label:'Approved', color:'#15803d',bg:'#f0fdf4'},
          rejected: {label:'Rejected', color:'#dc2626',bg:'#fef2f2'},
          paid:     {label:'Paid',     color:'#7c3aed',bg:'#f5f3ff'},
        };
        const fmtAmt2 = (n: any) => n!=null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';
        return (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => { setShowExpenseForm(true); setExpenseForm({ category: expCategories[0]??'', description: '', amount: '', receipt_note: '', expense_date: '' }); }}
                className="flex items-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-xl shadow-sm"
                style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
                <Plus size={15} /> Submit Expense
              </button>
            </div>
            <div className="bg-surface rounded-xl border border-outline shadow-sm overflow-hidden">
              {myExpenses.length === 0 ? (
                <div className="flex flex-col items-center py-16 gap-2">
                  <DollarSign size={32} className="text-gray-200" />
                  <p className="text-sm text-on-surface-subtle">No expense claims yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {myExpenses.map(e => {
                    const cfg = EXP_STATUS[e.status] ?? EXP_STATUS.pending;
                    return (
                      <div key={e.id} className="px-5 py-4 flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(25,34,80,0.08)', color: '#192250' }}>{e.category}</span>
                            <span className="font-semibold text-on-surface">{fmtAmt2(e.amount)}</span>
                          </div>
                          <p className="text-xs text-on-surface-subtle mt-0.5">{e.description}</p>
                          {e.approved_amount && <p className="text-xs font-semibold mt-1" style={{ color: '#15803d' }}>Approved: {fmtAmt2(e.approved_amount)}</p>}
                          {e.rejection_reason && <p className="text-xs text-danger mt-1 italic">"{e.rejection_reason}"</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                          <span className="text-[10px] text-on-surface-subtle">
                            {new Date(e.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {showExpenseForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
                <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
                    <h2 className="font-bold text-base" style={{ color: '#192250' }}>Submit Expense Claim</h2>
                    <button onClick={() => setShowExpenseForm(false)}><X size={16} className="text-on-surface-subtle" /></button>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-on-surface-muted mb-1 block">Category <span className="text-danger">*</span></label>
                        <select value={expenseForm.category} onChange={e => setExpenseForm(f => ({ ...f, category: e.target.value }))}
                          className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 focus:outline-none bg-surface">
                          {expCategories.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-on-surface-muted mb-1 block">Amount (₹) <span className="text-danger">*</span></label>
                        <input type="number" value={expenseForm.amount} onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))}
                          placeholder="e.g. 2500"
                          className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 focus:outline-none" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-on-surface-muted mb-1 block">Description <span className="text-danger">*</span></label>
                      <input value={expenseForm.description} onChange={e => setExpenseForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="e.g. Cab to client meeting at Connaught Place"
                        className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 focus:outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-on-surface-muted mb-1 block">Expense Date</label>
                        <input type="date" value={expenseForm.expense_date} max={todayLocal()} onChange={e => setExpenseForm(f => ({ ...f, expense_date: e.target.value }))}
                          className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-on-surface-muted mb-1 block">Receipt / Reference</label>
                        <input value={expenseForm.receipt_note} onChange={e => setExpenseForm(f => ({ ...f, receipt_note: e.target.value }))}
                          placeholder="Bill no. / reference"
                          className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 focus:outline-none" />
                      </div>
                    </div>
                    {expenseError && <p className="text-xs font-medium text-danger bg-danger-container border border-red-100 rounded-lg px-3 py-2">{expenseError}</p>}
                    <div className="flex gap-3 pt-1">
                      <button onClick={() => { setShowExpenseForm(false); setExpenseError(''); }}
                        className="flex-1 py-2.5 border border-outline rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
                      <button
                        disabled={submittingExp || !expenseForm.category || !expenseForm.description.trim() || !expenseForm.amount || Number(expenseForm.amount) <= 0}
                        onClick={async () => {
                          setExpenseError('');
                          if (expenseForm.expense_date && expenseForm.expense_date > todayLocal()) {
                            setExpenseError('Expense date cannot be in the future');
                            return;
                          }
                          setSubmittingExp(true);
                          try {
                            const created = await api.submitExpense({
                              employee_id: empDbId, employee_name: user?.name,
                              category: expenseForm.category,
                              description: expenseForm.description.trim(),
                              amount: Number(expenseForm.amount),
                              receipt_note: expenseForm.receipt_note.trim() || undefined,
                              expense_date: expenseForm.expense_date || undefined,
                            });
                            setMyExpenses(prev => [created, ...prev]);
                            setShowExpenseForm(false);
                          } catch (err: any) { setExpenseError(err.message ?? 'Failed to submit. Please try again.'); }
                          finally { setSubmittingExp(false); }
                        }}
                        className="flex-1 py-2.5 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
                        {submittingExp ? 'Submitting…' : 'Submit Claim'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── My Device ── */}
      {tab === 'device' && (() => {
        const STATUS: Record<string,{label:string;bg:string;color:string}> = {
          reported:          { label: 'Reported',          bg: '#fffbeb', color: '#b45309' },
          picked_up:         { label: 'With Vendor',       bg: '#eff6ff', color: '#2563eb' },
          returned:          { label: 'Returned',          bg: '#f0fdf4', color: '#15803d' },
          awaiting_approval: { label: 'Awaiting Approval', bg: '#fef2f2', color: '#dc2626' },
          paid:              { label: 'Completed',         bg: '#f5f3ff', color: '#7c3aed' },
          cancelled:         { label: 'Cancelled',         bg: '#f3f4f6', color: '#6b7280' },
        };
        // Open-ticket lookup so the "Report issue" button knows when the
        // asset already has a repair in flight (one-open-ticket-per-asset
        // server constraint).
        const openByAsset = new Map<string, any>();
        for (const t of myRepairTickets) {
          if (t.asset_id && !['paid', 'cancelled'].includes(t.status)) openByAsset.set(t.asset_id, t);
        }

        const openRepairModal = (asset: any) => {
          setRepairForm({ issue: '', notes: '' });
          setRepairError('');
          setReportingRepairFor(asset);
        };

        return (
          <div className="space-y-5">
            {/* Assigned laptops */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-on-surface-subtle uppercase tracking-wider">My Assigned Devices</p>
                {myAssets.length > 0 && (
                  <button
                    onClick={() => {
                      // If only one asset, open the modal directly with it.
                      // If multiple, pick the first asset without an open ticket;
                      // employee can switch via the per-card button below.
                      const eligible = myAssets.find(a => !openByAsset.has(a.id)) ?? myAssets[0];
                      openRepairModal(eligible);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:opacity-90 transition-opacity">
                    <Wrench size={13} /> Raise repair ticket
                  </button>
                )}
              </div>
              {myAssets.length === 0 ? (
                <div className="bg-surface rounded-2xl border border-outline shadow-sm p-8 text-center">
                  <Monitor size={28} className="text-gray-200 mx-auto mb-2"/>
                  <p className="text-sm text-on-surface-subtle">No device assigned yet</p>
                  <p className="text-xs text-on-surface-subtle mt-1">If you've been issued a laptop, ask HR to add it to the registry.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {myAssets.map(a => {
                    const openTicket = openByAsset.get(a.id);
                    return (
                      <div key={a.id} className="bg-surface rounded-xl border border-outline shadow-sm p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
                            <Monitor size={18} className="text-primary-600"/>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-sm font-bold text-on-surface">{a.asset_tag}</p>
                            <p className="text-xs text-on-surface-subtle truncate">{a.model ?? 'Unknown model'}</p>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            a.status === 'active' ? 'bg-success-container text-success' :
                            a.status === 'in_repair' ? 'bg-warning-container text-warning' :
                                                       'bg-surface-2 text-on-surface-subtle'}`}>
                            {(a.status ?? '').replace('_',' ')}
                          </span>
                        </div>
                        {a.serial_no && <p className="text-[10px] text-on-surface-subtle font-mono mt-2">SN: {a.serial_no}</p>}
                        <div className="mt-3 pt-3 border-t border-outline flex items-center justify-between">
                          {openTicket ? (
                            <span className="text-[11px] text-warning inline-flex items-center gap-1">
                              <Clock size={11} /> Repair already in progress
                            </span>
                          ) : (
                            <span className="text-[11px] text-on-surface-subtle">Something not working?</span>
                          )}
                          <button onClick={() => openRepairModal(a)}
                            disabled={!!openTicket}
                            className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed inline-flex items-center gap-1">
                            <Wrench size={11} /> {openTicket ? 'View status' : 'Report issue'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Repair tickets */}
            <div>
              <p className="text-xs font-bold text-on-surface-subtle uppercase tracking-wider mb-3">Repair History</p>
              {myRepairTickets.length === 0 ? (
                <div className="bg-surface rounded-2xl border border-outline shadow-sm p-8 text-center">
                  <p className="text-sm text-on-surface-subtle">No repair tickets — your device hasn't needed any repairs</p>
                </div>
              ) : (
                <div className="bg-surface rounded-2xl border border-outline shadow-sm overflow-hidden">
                  <div className="divide-y divide-gray-50">
                    {myRepairTickets.map(t => {
                      const cfg = STATUS[t.status] ?? STATUS.reported;
                      return (
                        <div key={t.id} className="p-4">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-on-surface">{t.issue}</p>
                              <p className="text-[11px] text-on-surface-subtle mt-0.5">Reported {new Date(t.reported_at).toLocaleDateString('en-IN', { day:'numeric',month:'short',year:'numeric' })}</p>
                            </div>
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                          </div>
                          {(t.picked_up_at || t.returned_at || t.paid_at) && (
                            <div className="flex flex-wrap gap-3 text-[11px] text-on-surface-subtle mt-2">
                              {t.picked_up_at && <span>📦 Picked up: {new Date(t.picked_up_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>}
                              {t.returned_at && <span>✓ Returned: {new Date(t.returned_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>}
                              {t.paid_at && <span>✓ Settled: {new Date(t.paid_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>}
                            </div>
                          )}
                          {/* Repair cost intentionally hidden from the employee — they only
                              need status visibility, not the rupee amount. Admin/HR see costs
                              under /asset-repairs. */}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Raise repair ticket — picks the asset from state when opened */}
            {reportingRepairFor && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !repairSubmitting && setReportingRepairFor(null)}>
                <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-md" onClick={e => e.stopPropagation()}>
                  <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-bold text-on-surface">Raise repair ticket</h3>
                      <p className="text-xs text-on-surface-muted mt-0.5 num-mono">
                        {reportingRepairFor.asset_tag} · {reportingRepairFor.model ?? 'Unknown model'}
                      </p>
                    </div>
                    <button onClick={() => !repairSubmitting && setReportingRepairFor(null)} className="p-1.5 rounded-lg hover:bg-surface-2"><X size={16} className="text-on-surface-muted" /></button>
                  </div>
                  <div className="p-5 space-y-3">
                    {/* Asset picker — only shown when the employee has more than one device */}
                    {myAssets.length > 1 && (
                      <label className="block">
                        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">Which device?</span>
                        <select value={reportingRepairFor.id}
                          onChange={e => {
                            const a = myAssets.find(x => x.id === e.target.value);
                            if (a) setReportingRepairFor(a);
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
                          {myAssets.map(a => {
                            const taken = openByAsset.has(a.id);
                            return <option key={a.id} value={a.id} disabled={taken}>{a.asset_tag}{a.model ? ` · ${a.model}` : ''}{taken ? ' (repair already in progress)' : ''}</option>;
                          })}
                        </select>
                      </label>
                    )}
                    <label className="block">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">
                        What's wrong? <span className="text-danger">*</span>
                      </span>
                      <input value={repairForm.issue} onChange={e => setRepairForm(f => ({ ...f, issue: e.target.value }))}
                        placeholder="e.g. Screen flickering, battery drains fast"
                        className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">More detail (optional)</span>
                      <textarea value={repairForm.notes} onChange={e => setRepairForm(f => ({ ...f, notes: e.target.value }))} rows={3}
                        placeholder="When did it start? Steps to reproduce? Anything else IT should know?"
                        className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    </label>
                    <p className="text-[11px] text-on-surface-subtle">
                      HR / admin will see this ticket and arrange pickup. You'll get a notification when the status changes.
                    </p>
                    {repairError && <p className="text-xs text-danger">{repairError}</p>}
                  </div>
                  <div className="px-5 py-3 border-t border-outline flex items-center justify-end gap-2 bg-surface-2/30">
                    <button onClick={() => setReportingRepairFor(null)} disabled={repairSubmitting}
                      className="px-3 py-2 rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2 disabled:opacity-50">
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (!repairForm.issue.trim()) { setRepairError('Please describe the issue'); return; }
                        if (!empDbId) { setRepairError('Could not find your employee record — refresh the page'); return; }
                        if (openByAsset.has(reportingRepairFor.id)) {
                          setRepairError('A repair is already in progress for this device. Wait for it to close before reporting another issue.');
                          return;
                        }
                        setRepairSubmitting(true); setRepairError('');
                        try {
                          await api.createRepairTicket({
                            asset_id: reportingRepairFor.id,
                            laptop_info: reportingRepairFor.model || reportingRepairFor.asset_tag,
                            employee_id: empDbId,
                            employee_name: user?.name ?? null,
                            issue: repairForm.issue.trim(),
                            notes: repairForm.notes.trim() || null,
                            created_by: user?.name ?? null,
                          });
                          // Refetch tickets so the new one shows in Repair History
                          api.getRepairTickets(empDbId).then(setMyRepairTickets).catch(() => {});
                          setReportingRepairFor(null);
                          setRepairForm({ issue: '', notes: '' });
                        } catch (e: any) { setRepairError(e.message); }
                        finally { setRepairSubmitting(false); }
                      }}
                      disabled={repairSubmitting || !repairForm.issue.trim()}
                      className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5">
                      <Wrench size={13} />
                      {repairSubmitting ? 'Submitting…' : 'Submit ticket'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Pay Slip ── */}
      {tab === 'payslip' && (
        <div className="max-w-lg">
          {payroll ? (
            <div className="bg-surface rounded-2xl border border-outline shadow-sm overflow-hidden">
              <div className="px-6 py-5 text-white" style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
                <h3 className="font-bold text-lg">Salary Slip</h3>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>{payroll.month} {payroll.year}</p>
                <p className="text-xs mt-1" style={{ color: '#EE2770' }}>{user?.employee_id_ref} · {user?.designation}</p>
              </div>
              <div className="p-6 space-y-2.5">
                <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-2">Earnings</p>
                {[
                  { label: 'Basic Pay', value: payroll.basic },
                  { label: 'HRA', value: payroll.hra },
                  { label: 'Special Allowance', value: payroll.special_allowance },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm border-b border-gray-50 pb-2">
                    <span className="text-on-surface-muted">{label}</span>
                    <span className="font-medium text-on-surface">₹{Number(value).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold pt-1 pb-3 border-b border-dashed border-outline">
                  <span>Gross Pay</span>
                  <span>₹{Number(payroll.gross_pay).toLocaleString('en-IN')}</span>
                </div>
                <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-2 pt-1">Deductions</p>
                {[
                  { label: 'Provident Fund', value: payroll.provident_fund },
                  { label: 'Professional Tax', value: payroll.professional_tax },
                  { label: 'Income Tax (TDS)', value: payroll.income_tax },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm border-b border-gray-50 pb-2">
                    <span className="text-on-surface-muted">{label}</span>
                    <span className="font-medium text-danger">−₹{Number(value).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                <div className="mt-4 rounded-xl p-4 flex justify-between items-center" style={{ background: 'rgba(25,34,80,0.06)' }}>
                  <span className="font-bold text-on-surface">Net Pay</span>
                  <span className="text-xl font-bold" style={{ color: '#192250' }}>₹{Number(payroll.net_pay).toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-on-surface-subtle text-sm py-16">No payroll data available</p>
          )}
        </div>
      )}

      {/* ── Performance ── */}
      {tab === 'performance' && (
        <div className="space-y-5">

          {/* PIP Alert */}
          {myPip && (
            <div className="rounded-2xl p-4 border border-red-200" style={{ background: '#fff1f2' }}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-danger-container flex items-center justify-center flex-shrink-0">
                  <AlertCircle size={18} className="text-danger" />
                </div>
                <div>
                  <p className="font-bold text-sm text-red-800">You are on a Performance Improvement Plan (PIP)</p>
                  <p className="text-xs text-danger mt-1">
                    Active from {new Date(myPip.start_date + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                    {' '}until{' '}
                    {new Date(myPip.end_date + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  {myPip.goals && <p className="text-xs text-danger mt-1 italic">Goals: {myPip.goals}</p>}
                  <p className="text-xs text-danger mt-1">Please speak to your HR manager for guidance.</p>
                </div>
              </div>
            </div>
          )}

          {/* Warnings */}
          {myWarnings.length > 0 && (
            <div className="bg-surface rounded-2xl border border-outline shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-outline flex items-center gap-2">
                <AlertCircle size={15} className="text-warning" />
                <h3 className="font-bold text-sm" style={{ color: '#192250' }}>Warnings on Record</h3>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ml-auto ${myWarnings.length >= 3 ? 'bg-danger-container text-danger' : myWarnings.length === 2 ? 'bg-orange-100 text-orange-700' : 'bg-warning-container text-warning'}`}>
                  {myWarnings.length} {myWarnings.length === 1 ? 'warning' : 'warnings'}
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {myWarnings.map((w, i) => (
                  <div key={w.id} className="flex items-start gap-3 px-5 py-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5 ${w.severity === 'final' ? 'bg-danger text-white' : w.severity === 'serious' ? 'bg-orange-500 text-white' : 'bg-amber-400 text-white'}`}>{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-on-surface-muted">{w.reason}</p>
                      <p className="text-xs text-on-surface-subtle mt-0.5 capitalize">
                        {w.severity} · {w.issued_by ? `Issued by ${w.issued_by} · ` : ''}
                        {new Date(w.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                <div key={label} className="bg-surface rounded-xl p-4 border border-outline shadow-sm text-center">
                  <p className="text-2xl font-black" style={{ color }}>{value}</p>
                  <p className="text-xs text-on-surface-subtle mt-1">{label}</p>
                </div>
              ));
            })()}
          </div>

          {/* Bar chart */}
          <div className="bg-surface rounded-xl border border-outline shadow-sm p-5">
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
          <div className="bg-surface rounded-xl border border-outline shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-outline">
              <h3 className="font-bold text-sm" style={{ color: '#192250' }}>Score Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: '#f8f9fc' }}>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Month</th>
                    {PERF_COLS.map(h => (
                      <th key={h} className="text-center px-2 py-2.5 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyPerf.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-on-surface-subtle text-sm py-10">No reviews yet for {currentYear}</td></tr>
                  ) : monthlyPerf.map(r => (
                    <tr key={r.id} className="border-t border-gray-50 hover:bg-surface-2/50">
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
            <div className="bg-surface rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: '#ffd6e8' }}>
              <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#ffd6e8', background: 'rgba(238,39,112,0.04)' }}>
                <div>
                  <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: '#192250' }}>
                    <FileText size={15} style={{ color: '#EE2770' }} />
                    Appraisal Goals — {MONTHS_SHORT[currentMonth - 1]} {currentYear}
                  </h3>
                  <p className="text-xs text-on-surface-subtle mt-0.5">Your appraisal window is open. Fill and submit your goals.</p>
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
                    <p className="text-xs text-on-surface-subtle">Add up to 6 goals. Save draft to continue later. Submit to lock for review.</p>
                    {goalsDraft.map((g, i) => (
                      <div key={i} className="border rounded-xl p-4 space-y-3" style={{ borderColor: '#e2e4ed' }}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#EE2770' }}>Goal {i + 1}</span>
                          {goalsDraft.length > 1 && (
                            <button onClick={() => setGoalsDraft(g => g.filter((_, j) => j !== i))} className="p-1 hover:bg-danger-container rounded">
                              <Trash2 size={13} className="text-danger" />
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
                        className="w-full py-2.5 border-2 border-dashed rounded-xl text-sm font-semibold text-on-surface-subtle transition-colors"
                        style={{ borderColor: '#e2e4ed' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#EE2770'; (e.currentTarget as HTMLElement).style.color = '#EE2770'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e2e4ed'; (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
                      >+ Add Another Goal</button>
                    )}
                    {goalsError && (
                      <p className="text-xs text-danger flex items-center gap-1.5"><AlertCircle size={13} /> {goalsError}</p>
                    )}
                    <div className="flex gap-3 pt-2">
                      <button onClick={handleSaveDraft} disabled={savingGoals}
                        className="flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-semibold hover:bg-surface-2 disabled:opacity-60"
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
            <div className="bg-surface rounded-2xl border border-outline shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-outline">
                <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: '#192250' }}>
                  <FileText size={15} /> Past Appraisal Submissions
                </h3>
              </div>
              <div className="divide-y divide-gray-50">
                {(appraisalWindowOpen ? pastAppraisals : allAppraisals).map((appraisal: any) => (
                  <details key={`${appraisal.year}-${appraisal.month}`} className="group">
                    <summary className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-surface-2/50 list-none">
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
                        <span className="text-xs text-on-surface-subtle">{appraisal.goals?.length ?? 0} goals</span>
                      </div>
                      {appraisal.submitted_at && (
                        <span className="text-xs text-on-surface-subtle">
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
            <div className="bg-surface rounded-2xl border border-outline shadow-sm p-8 text-center">
              <FileText size={28} className="mx-auto text-gray-200 mb-3" />
              <p className="font-medium text-on-surface-subtle text-sm">No appraisal scheduled</p>
              <p className="text-xs text-on-surface-subtle mt-1">Your manager will open the appraisal window when it's time</p>
            </div>
          )}
        </div>
      )}

      {/* ── My Hours (project hours allocation + logs) ── */}
      {tab === 'my-hours' && empDbId && (
        <TabErrorBoundary>
          <MyHoursTab employeeId={empDbId} employeeName={user?.name ?? ''} />
        </TabErrorBoundary>
      )}

      {/* ── My Team ── */}
      {tab === 'myteam' && (
        <div className="space-y-5">

          {/* Pending leave approvals */}
          <div className="bg-surface rounded-2xl border border-outline shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
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
              <p className="text-center text-on-surface-subtle text-sm py-10">No pending leave requests from your team.</p>
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
                        <p className="text-sm font-semibold text-on-surface">{l.employee_name}</p>
                        <p className="text-xs text-on-surface-subtle mt-0.5 capitalize">
                          {l.type.replace('_', ' ')} leave · {l.days}d ·{' '}
                          {parseLocalDate(l.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {l.from_date !== l.to_date && ` – ${parseLocalDate(l.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                        </p>
                        {l.reason && <p className="text-xs text-on-surface-subtle mt-0.5 italic">"{l.reason}"</p>}
                        {l.created_at && (
                          <p className="text-xs text-on-surface-subtle mt-0.5">
                            Applied: {new Date(l.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {', '}{new Date(l.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                          </p>
                        )}
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
                        onClick={() => setRejectLeaveTarget(l.id)}
                        disabled={approvingLeave[l.id]}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                        style={{ background: '#fee2e2', color: '#dc2626' }}>
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Team members + performance */}
          <div className="bg-surface rounded-2xl border border-outline shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-outline">
              <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: '#192250' }}>
                <Users size={15} style={{ color: '#EE2770' }} /> Team Members
              </h3>
            </div>
            <div className="divide-y divide-gray-50">
              {teamMembers.map(member => {
                const perf = teamPerf[member.id] ?? [];
                const latest = perf.length ? perf.reduce((a: any, b: any) => (a.month > b.month ? a : b)) : null;
                const isViewingLeaves = viewLeavesFor?.id === member.id;
                return (
                  <div key={member.id}>
                    <div className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
                          style={{ background: 'rgba(25,34,80,0.08)', color: '#192250' }}>
                          {member.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-on-surface">{member.name}</p>
                          <p className="text-xs text-on-surface-subtle mt-0.5">{member.designation} · {member.department}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {latest ? (
                          <div className="text-center mr-2">
                            <p className="text-lg font-black" style={{ color: perfColor(latest.overall_score) }}>
                              {latest.overall_score}
                            </p>
                            <p className="text-xs text-on-surface-subtle">{MONTHS_SHORT[latest.month - 1]} score</p>
                          </div>
                        ) : (
                          <p className="text-xs text-on-surface-subtle mr-2">No review yet</p>
                        )}
                        <button
                          onClick={() => handleViewMemberLeaves(member)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors"
                          style={isViewingLeaves
                            ? { background: '#EE2770', color: '#fff' }
                            : { background: 'rgba(238,39,112,0.08)', color: '#EE2770' }}>
                          {isViewingLeaves ? 'Hide Leaves' : 'View Leaves'}
                        </button>
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

                    {/* Expanded leave view for this team member */}
                    {isViewingLeaves && (
                      <div className="border-t border-outline bg-surface-2/60 px-5 py-4">
                        {loadingMemberLeaves ? (
                          <div className="flex items-center gap-2 text-sm text-on-surface-subtle py-4">
                            <div className="w-4 h-4 border-2 border-outline border-t-primary-400 rounded-full animate-spin" />
                            Loading leaves…
                          </div>
                        ) : (
                          <>
                            {/* Balance summary */}
                            {teamMemberBalance && (
                              <div className="flex flex-wrap gap-2 mb-4">
                                {teamMemberBalance.on_probation ? (
                                  <>
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-warning-container text-warning">
                                      On Probation · {teamMemberBalance.probation_short_remaining ?? 0} credits left
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700">
                                      Full Day: {teamMemberBalance.full_day ?? 0}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-100 text-purple-700">
                                      Short/Half: {teamMemberBalance.short_leave ?? 0} credits
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-success-container text-success">
                                      Confirmed
                                    </span>
                                  </>
                                )}
                              </div>
                            )}

                            {/* Leave history table */}
                            {teamMemberLeaves.length === 0 ? (
                              <p className="text-sm text-on-surface-subtle py-2">No leave history found.</p>
                            ) : (
                              <div className="overflow-x-auto rounded-xl border border-outline bg-surface">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-surface-2 border-b border-outline">
                                      {['Type', 'Duration', 'Days', 'Reason', 'Applied On', 'Status', 'Action Trail', ''].map(h => (
                                        <th key={h} className="text-left text-xs font-semibold text-on-surface-subtle px-3 py-2.5 uppercase tracking-wide whitespace-nowrap">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {teamMemberLeaves.map(l => {
                                      const statusColors: Record<string, string> = {
                                        approved: 'bg-success-container text-success border-green-200',
                                        rejected: 'bg-danger-container text-danger border-red-200',
                                        pending: 'bg-warning-container text-warning border-amber-200',
                                        cancelled: 'bg-surface-2 text-on-surface-subtle border-outline',
                                      };
                                      const appliedAt = l.created_at ? new Date(l.created_at) : null;
                                      const appliedStr = appliedAt
                                        ? appliedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                                          + ', ' + appliedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                                        : '—';
                                      return (
                                        <tr key={l.id} className="border-b border-gray-50 last:border-0">
                                          <td className="px-3 py-2.5 capitalize text-on-surface-muted font-medium">{l.type.replace('_', ' ')}</td>
                                          <td className="px-3 py-2.5 text-on-surface-muted whitespace-nowrap">
                                            {parseLocalDate(l.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                            {l.from_date !== l.to_date && ` – ${parseLocalDate(l.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                                          </td>
                                          <td className="px-3 py-2.5 text-on-surface-muted font-medium">{l.days}d</td>
                                          <td className="px-3 py-2.5 text-on-surface-subtle max-w-[140px] truncate">{l.reason}</td>
                                          <td className="px-3 py-2.5 text-xs text-on-surface-subtle whitespace-nowrap">{appliedStr}</td>
                                          <td className="px-3 py-2.5">
                                            <span className={`text-xs px-2 py-1 rounded-full border font-medium ${statusColors[l.status] ?? 'bg-surface-2 text-on-surface-subtle border-outline'}`}>
                                              {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                                            </span>
                                          </td>
                                          <td className="px-3 py-2.5 min-w-[180px]">
                                            <div className="space-y-1">
                                              {(l.manager_status === 'approved' || l.manager_status === 'rejected') && (
                                                <div className="text-xs leading-tight">
                                                  <span className={`font-semibold ${l.manager_status === 'approved' ? 'text-success' : 'text-danger'}`}>
                                                    {l.manager_status === 'approved' ? 'Mgr Approved' : 'Mgr Rejected'}
                                                  </span>
                                                  {l.manager_name && <span className="text-on-surface-subtle"> · {l.manager_name}</span>}
                                                  {l.manager_approved_at && (
                                                    <span className="text-on-surface-subtle block">
                                                      {new Date(l.manager_approved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                      {', '}{new Date(l.manager_approved_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                    </span>
                                                  )}
                                                  {l.manager_rejection_reason && <span className="text-danger italic block">"{l.manager_rejection_reason}"</span>}
                                                </div>
                                              )}
                                              {l.hr_actioned_at && (
                                                <div className="text-xs leading-tight">
                                                  <span className={`font-semibold ${l.status === 'approved' || l.status === 'cancelled' ? 'text-success' : 'text-danger'}`}>
                                                    {l.status === 'cancelled' ? 'HR Approved' : l.status === 'approved' ? 'HR Approved' : 'HR Rejected'}
                                                  </span>
                                                  {l.hr_actioner_name && <span className="text-on-surface-subtle"> · {l.hr_actioner_name}</span>}
                                                  <span className="text-on-surface-subtle block">
                                                    {new Date(l.hr_actioned_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                    {', '}{new Date(l.hr_actioned_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                  </span>
                                                  {l.rejection_reason && <span className="text-danger italic block">"{l.rejection_reason}"</span>}
                                                </div>
                                              )}
                                              {l.cancelled_at && (
                                                <div className="text-xs leading-tight">
                                                  <span className="font-semibold text-on-surface-subtle">Cancelled</span>
                                                  {l.cancelled_by && <span className="text-on-surface-subtle"> · {l.cancelled_by}</span>}
                                                  <span className="text-on-surface-subtle block">
                                                    {new Date(l.cancelled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                    {', '}{new Date(l.cancelled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                  </span>
                                                  {l.cancellation_reason && <span className="text-on-surface-subtle italic block">"{l.cancellation_reason}"</span>}
                                                </div>
                                              )}
                                              {!l.manager_approved_at && !l.hr_actioned_at && !l.cancelled_at && (
                                                <span className="text-xs text-on-surface-subtle">Pending</span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="px-3 py-2.5">
                                            {l.status === 'approved' && (
                                              <button
                                                onClick={() => setCancelLeaveTarget(l.id)}
                                                className="px-2.5 py-1 text-xs bg-surface-2 text-on-surface-muted rounded-md hover:bg-surface-3 font-medium whitespace-nowrap">
                                                Cancel Leave
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
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

      {/* Team Review Modal */}
      {showTeamReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
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
                    <label className="text-xs font-semibold text-on-surface-muted">{label}</label>
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
                <label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Overall Score</label>
                <div className="text-2xl font-black" style={{ color: perfColor(Math.round(Object.values(teamReviewScores).reduce((a, b) => a + b, 0) / SCORE_CATEGORIES.length)) }}>
                  {Math.round(Object.values(teamReviewScores).reduce((a, b) => a + b, 0) / SCORE_CATEGORIES.length)}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Comments (optional)</label>
                <textarea value={teamReviewComment} onChange={e => setTeamReviewComment(e.target.value)}
                  rows={3} placeholder="Add feedback for this team member..."
                  className="w-full border border-outline rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-outline-strong" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowTeamReview(null)}
                  className="flex-1 py-2.5 border border-outline rounded-xl text-sm font-semibold text-on-surface-muted hover:bg-surface-2">
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

      {rejectLeaveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-on-surface">Reason for Rejection</h3>
              <button onClick={() => setRejectLeaveTarget(null)}><X size={16} className="text-on-surface-subtle" /></button>
            </div>
            <RejectReasonInput
              onClose={() => setRejectLeaveTarget(null)}
              onConfirm={reason => {
                handleManagerApproveLeave(rejectLeaveTarget, 'rejected', reason);
                setRejectLeaveTarget(null);
              }}
            />
          </div>
        </div>
      )}
      {cancelLeaveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-on-surface">Reason for Cancellation</h3>
              <button onClick={() => setCancelLeaveTarget(null)}><X size={16} className="text-on-surface-subtle" /></button>
            </div>
            <RejectReasonInput
              placeholder="Enter reason for cancelling this approved leave..."
              confirmLabel="Confirm Cancel"
              confirmClass="bg-gray-700 hover:bg-gray-800"
              onClose={() => setCancelLeaveTarget(null)}
              onConfirm={reason => {
                handleCancelMemberLeave(cancelLeaveTarget, reason);
                setCancelLeaveTarget(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Floating Quick Actions — always-visible bottom-right speed dial.
          One tap on the main FAB expands a vertical stack of actions going
          up: Apply Leave / Log Hours / Apply WFH / Submit Expense. Each
          action opens the relevant flow and closes the dial. */}
      <PulseBreakdownDrawer
        open={showPulseDrawer}
        onClose={() => setShowPulseDrawer(false)}
        snapshot={pulse}
        trend={pulseTrend}
      />
      <QuickActionsFab
        leaveBalance={(balance as any).full_day ?? 0}
        shortBalance={(balance as any).short_leave ?? 0}
        onLeave={() => { setTab('leave'); setApplyLeave(true); }}
        onHours={() => setTab('my-hours')}
        onWfh={() => {
          setTab('wfh');
          setWfhForm(f => ({ ...f, date: f.date || new Date().toISOString().slice(0, 10) }));
        }}
        onExpense={() => {
          setTab('expenses');
          setExpenseForm({ category: expCategories[0] ?? '', description: '', amount: '', receipt_note: '', expense_date: '' });
          setShowExpenseForm(true);
        }}
      />
    </div>
  );
}

// Speed-dial FAB. Closed state shows a single accent-colored circle with a
// "+". Tapping it rotates the icon to "×" and reveals labeled action buttons
// stacked above with a stagger animation. Backdrop closes the menu.
function QuickActionsFab({ leaveBalance, shortBalance, onLeave, onHours, onWfh, onExpense }: {
  leaveBalance: number; shortBalance: number;
  onLeave: () => void; onHours: () => void; onWfh: () => void; onExpense: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const wrap = (fn: () => void) => () => { fn(); close(); };

  const actions = [
    { key: 'leave',   label: 'Apply Leave',     sub: `${leaveBalance + shortBalance} days available`, icon: Calendar,    color: 'bg-brand text-on-brand',          ringColor: 'rgba(238,39,112,0.35)', onClick: onLeave },
    { key: 'hours',   label: 'Log Hours',       sub: 'Enter daily hours',                            icon: Briefcase,   color: 'bg-accent text-on-accent',        ringColor: 'rgba(124,92,255,0.35)', onClick: onHours },
    { key: 'wfh',     label: 'Apply WFH',       sub: 'Work from home',                                icon: Monitor,     color: 'bg-success text-on-accent',       ringColor: 'rgba(34,197,94,0.35)',  onClick: onWfh },
    { key: 'expense', label: 'Submit Expense',  sub: 'Reimbursement claim',                          icon: DollarSign,  color: 'bg-warning text-on-accent',       ringColor: 'rgba(234,179,8,0.35)',  onClick: onExpense },
  ];

  return (
    <>
      {/* Backdrop — click anywhere to close */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] animate-fade-up" style={{ animationDuration: '120ms' }} onClick={close} />
      )}

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {/* Action chips, rendered in reverse so the first action appears nearest the FAB */}
        {open && (
          <div className="flex flex-col items-end gap-3">
            {actions.slice().reverse().map((a, i) => {
              const Icon = a.icon;
              return (
                <div key={a.key} className="flex items-center gap-3 animate-fade-up" style={{ animationDuration: '180ms', animationDelay: `${i * 35}ms`, animationFillMode: 'backwards' }}>
                  <div className="bg-surface border border-outline rounded-xl-2 shadow-elev-2 px-3 py-2 text-right">
                    <p className="text-sm font-bold text-on-surface leading-tight">{a.label}</p>
                    {a.sub && <p className="text-[11px] text-on-surface-muted leading-tight mt-0.5">{a.sub}</p>}
                  </div>
                  <button onClick={wrap(a.onClick)}
                    title={a.label}
                    className={`w-12 h-12 rounded-full ${a.color} shadow-elev-3 hover:scale-110 active:scale-95 transition-transform flex items-center justify-center`}
                    style={{ boxShadow: `0 6px 20px ${a.ringColor}` }}>
                    <Icon size={18} strokeWidth={2.25} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Main FAB */}
        <button onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close quick actions' : 'Open quick actions'}
          className="w-14 h-14 rounded-full bg-accent text-on-accent shadow-elev-3 hover:scale-110 active:scale-95 transition-all flex items-center justify-center"
          style={{ boxShadow: '0 8px 28px rgba(238,39,112,0.45)' }}>
          <Plus size={22} strokeWidth={2.5} className={`transition-transform duration-200 ${open ? 'rotate-45' : ''}`} />
        </button>
      </div>
    </>
  );
}

function RejectReasonInput({
  onClose, onConfirm,
  placeholder = 'Enter reason (required)...',
  confirmLabel = 'Confirm Reject',
  confirmClass = 'bg-danger hover:bg-red-600',
}: {
  onClose: () => void;
  onConfirm: (reason: string) => void;
  placeholder?: string;
  confirmLabel?: string;
  confirmClass?: string;
}) {
  const [reason, setReason] = useState('');
  return (
    <>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 resize-none mb-4"
        autoFocus
      />
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 border border-outline text-on-surface-muted rounded-lg text-sm font-medium hover:bg-surface-2">Cancel</button>
        <button
          onClick={() => { if (reason.trim()) onConfirm(reason.trim()); }}
          disabled={!reason.trim()}
          className={`flex-1 py-2.5 disabled:opacity-40 text-white rounded-lg text-sm font-medium ${confirmClass}`}>
          {confirmLabel}
        </button>
      </div>
    </>
  );
}

// ── My Hours Tab ───────────────────────────────────────────────────────────
const MH_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

interface MHAssignment {
  id: string;
  project_id: string;
  project_name?: string;
  project_client_name?: string | null;
  month: number; year: number;
  monthly_hours: number;
  w1_hours: number; w2_hours: number; w3_hours: number; w4_hours: number; w5_hours: number;
}

interface MHLog {
  id: string;
  project_id: string;
  assignment_id?: string;
  month: number; year: number; week_num: number;
  hours_logged: number;
  work_description: string | null;
  effective_description?: string | null;
  status: string;
  rejection_reason: string | null;
  reviewed_by_name: string | null;
}

function MyHoursTab({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [assignments, setAssignments] = useState<MHAssignment[]>([]);
  const [logs, setLogs] = useState<MHLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState<{ assignment: MHAssignment; weekNum: number; existing?: MHLog } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.getProjectAssignments({ employee_id: employeeId, month, year }).then(d => setAssignments(d as MHAssignment[])).catch(() => {}),
      api.getHourLogs({ employee_id: employeeId, month, year }).then(d => setLogs(d as MHLog[])).catch(() => {}),
    ]).finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [employeeId, month, year]);

  const logByKey = new Map<string, MHLog>();
  for (const l of logs) logByKey.set(`${l.project_id}_${l.week_num}`, l);

  const totalAlloc = assignments.reduce((sum, a) => sum + Number(a.monthly_hours), 0);
  const totalLoggedApproved = logs.filter(l => l.status === 'approved').reduce((s, l) => s + Number(l.hours_logged), 0);
  const totalLoggedPending = logs.filter(l => l.status === 'pending').reduce((s, l) => s + Number(l.hours_logged), 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-surface rounded-lg border border-outline px-2 py-1">
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="text-sm bg-transparent focus:outline-none px-1 py-1">
            {MH_MONTHS.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="text-sm bg-transparent focus:outline-none px-1 py-1">
            {[year-1, year, year+1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Allocated" value={`${totalAlloc} h`} />
        <Tile label="Approved" value={`${totalLoggedApproved} h`} color="#15803d" />
        <Tile label="Pending review" value={`${totalLoggedPending} h`} color="#b45309" />
        <Tile label="Projects" value={String(assignments.length)} />
      </div>

      {/* Project rows */}
      <div className="bg-surface rounded-xl border border-outline shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 border-b border-outline">
            <tr className="text-left text-xs font-semibold text-on-surface-subtle uppercase tracking-wider">
              <th className="px-3 py-3">Project</th>
              {[1,2,3,4,5].map(w => <th key={w} className="px-3 py-3 text-center">W{w}</th>)}
              <th className="px-3 py-3 text-center bg-surface-2">M total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-on-surface-subtle">Loading…</td></tr>
            ) : assignments.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-12 text-center">
                <Briefcase size={28} className="mx-auto text-on-surface-subtle mb-2" />
                <p className="text-sm text-on-surface-subtle">No projects assigned for {MH_MONTHS[month-1]} {year}.</p>
                <p className="text-xs text-on-surface-subtle mt-0.5">Your coordinator hasn't planned this month yet.</p>
              </td></tr>
            ) : assignments.map(a => {
              const weekAllocs = [a.w1_hours, a.w2_hours, a.w3_hours, a.w4_hours, a.w5_hours];
              const totalLogged = weekAllocs.reduce((sum, _, i) => {
                const l = logByKey.get(`${a.project_id}_${i+1}`);
                return sum + (l ? Number(l.hours_logged) : 0);
              }, 0);
              return (
                <tr key={a.id}>
                  <td className="px-3 py-3">
                    <p className="font-semibold text-on-surface">{a.project_name}</p>
                    {a.project_client_name && <p className="text-xs text-on-surface-subtle">{a.project_client_name}</p>}
                  </td>
                  {weekAllocs.map((alloc, i) => {
                    const weekNum = i + 1;
                    const log = logByKey.get(`${a.project_id}_${weekNum}`);
                    const allocN = Number(alloc);
                    const showCell = allocN > 0 || !!log;
                    if (!showCell) return <td key={i} className="px-3 py-3 text-center text-on-surface-subtle">—</td>;
                    return (
                      <td key={i} className="px-3 py-3 text-center">
                        <WeekCell alloc={allocN} log={log} onClick={() => setLogging({ assignment: a, weekNum, existing: log })} />
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-center font-bold text-on-surface bg-surface-2">
                    {totalLogged} / {Number(a.monthly_hours)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Rejected logs surfaced */}
      {logs.filter(l => l.status === 'rejected').length > 0 && (
        <div className="bg-danger-container border border-outline rounded-xl p-4">
          <p className="text-sm font-bold text-danger mb-2">Rejected logs need your attention</p>
          <div className="space-y-1.5">
            {logs.filter(l => l.status === 'rejected').map(l => {
              const a = assignments.find(x => x.project_id === l.project_id);
              return (
                <div key={l.id} className="flex items-start justify-between gap-3 text-sm bg-surface rounded-lg p-3 border border-outline">
                  <div>
                    <p className="font-medium text-on-surface">{a?.project_name ?? 'Project'} · W{l.week_num}</p>
                    <p className="text-xs text-danger mt-0.5">{l.rejection_reason || 'No reason given'}</p>
                  </div>
                  {a && (
                    <button onClick={() => setLogging({ assignment: a, weekNum: l.week_num, existing: l })}
                      className="text-xs font-semibold text-primary-600 hover:underline">Resubmit</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {logging && (
        <HourLogModal
          assignment={logging.assignment}
          weekNum={logging.weekNum}
          existing={logging.existing}
          employeeId={employeeId}
          employeeName={employeeName}
          onClose={() => setLogging(null)}
          onSaved={() => { setLogging(null); load(); }}
        />
      )}
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-surface rounded-xl p-4 border border-outline shadow-sm">
      <p className="text-2xl font-bold" style={{ color: color ?? '#0f172a' }}>{value}</p>
      <p className="text-xs text-on-surface-subtle mt-0.5">{label}</p>
    </div>
  );
}

function WeekCell({ alloc, log, onClick }: { alloc: number; log?: MHLog; onClick: () => void }) {
  if (!log) {
    return (
      <button onClick={onClick}
        className="inline-flex flex-col items-center px-2 py-1 rounded-md text-xs hover:bg-primary-50 group">
        <span className="font-semibold text-on-surface-subtle">— / {alloc}</span>
        <span className="text-[10px] text-primary-600 opacity-0 group-hover:opacity-100">Log hours</span>
      </button>
    );
  }
  const pillCfg = log.status === 'approved'
    ? { dot: '#15803d', text: 'text-success' }
    : log.status === 'rejected'
    ? { dot: '#dc2626', text: 'text-danger' }
    : { dot: '#d97706', text: 'text-warning' };
  // Surface the description so the employee can see what they (or their
  // daily entries) recorded without having to re-open the modal. Hover
  // tooltip shows the full text, the cell shows a one-line preview.
  const desc = (log.effective_description ?? log.work_description ?? '').trim();
  return (
    <button onClick={onClick}
      title={desc ? `What you logged: ${desc}` : undefined}
      className={`inline-flex flex-col items-stretch min-w-[80px] gap-0.5 px-2.5 py-1.5 rounded-md text-xs hover:bg-surface-2 ${pillCfg.text} font-semibold`}>
      <span className="inline-flex items-center justify-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: pillCfg.dot }} />
        {Number(log.hours_logged)} / {alloc}
        <Edit2 size={10} className="opacity-50" />
      </span>
      {desc && (
        <span className="text-[10px] font-normal text-on-surface-muted leading-snug truncate max-w-[120px]">
          {desc}
        </span>
      )}
    </button>
  );
}

// Returns the dates within the given month that belong to a 1..5 "week" using
// CEIL(day_of_month / 7) — same rule the backend uses for week_num.
function daysOfWeek(month: number, year: number, weekNum: number): string[] {
  const out: string[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDay = (weekNum - 1) * 7 + 1;
  const endDay = Math.min(startDay + 6, daysInMonth);
  for (let d = startDay; d <= endDay; d++) {
    out.push(`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  }
  return out;
}

const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function HourLogModal({
  assignment, weekNum, existing, employeeId, employeeName, onClose, onSaved,
}: {
  assignment: MHAssignment;
  weekNum: number;
  existing?: MHLog;
  employeeId: string;
  employeeName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const allocKey = `w${weekNum}_hours` as 'w1_hours' | 'w2_hours' | 'w3_hours' | 'w4_hours' | 'w5_hours';
  const alloc = Number(assignment[allocKey] ?? 0);
  const dates = useMemo(() => daysOfWeek(assignment.month, assignment.year, weekNum), [assignment.month, assignment.year, weekNum]);
  // Per-day draft state: { date → { id?, hours: string, notes: string } }
  const [days, setDays] = useState<Record<string, { id?: string; hours: string; notes: string; existing?: boolean }>>(() => {
    const init: Record<string, { id?: string; hours: string; notes: string; existing?: boolean }> = {};
    for (const d of dates) init[d] = { hours: '', notes: '' };
    return init;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load any existing day entries for this assignment+week
  useEffect(() => {
    setLoading(true);
    api.getHourLogDays({ assignment_id: assignment.id })
      .then(rows => {
        setDays(prev => {
          const next = { ...prev };
          for (const r of rows) {
            const iso = String(r.log_date).slice(0, 10);
            if (next[iso] !== undefined) {
              next[iso] = { id: r.id, hours: String(r.hours), notes: r.notes ?? '', existing: true };
            }
          }
          return next;
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment.id]);

  const setDay = (iso: string, patch: Partial<{ hours: string; notes: string }>) => {
    setDays(prev => ({ ...prev, [iso]: { ...prev[iso], ...patch } }));
  };

  const total = Object.values(days).reduce((s, d) => s + (Number(d.hours) || 0), 0);

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const ops: Promise<any>[] = [];
      for (const iso of dates) {
        const d = days[iso];
        const h = Number(d.hours);
        const validHours = !Number.isNaN(h) && h > 0;
        if (validHours) {
          ops.push(api.upsertHourLogDay({
            assignment_id: assignment.id,
            log_date: iso,
            hours: h,
            notes: d.notes.trim() || undefined,
            employee_id: employeeId,
            employee_name: employeeName,
          }));
        } else if (d.existing && d.id) {
          // Was logged before but the employee zeroed it out → remove the day
          ops.push(api.deleteHourLogDay(d.id));
        }
      }
      await Promise.all(ops);
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const weeklyDelta = total - alloc;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Log hours · Week {weekNum}</h3>
            <p className="text-xs text-on-surface-muted mt-0.5 truncate">{assignment.project_name} · {MH_MONTHS[assignment.month-1]} {assignment.year}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg flex-shrink-0"><X size={16} className="text-on-surface-muted" /></button>
        </div>

        {/* Summary row */}
        <div className="px-6 py-3 border-b border-outline bg-surface-2/40 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Allocated</p>
            <p className="num-mono text-lg font-bold text-on-surface">{alloc}<span className="text-xs text-on-surface-muted">h</span></p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Total logged</p>
            <p className={`num-mono text-lg font-bold ${total > alloc ? 'text-warning' : total > 0 && total < alloc ? 'text-danger' : 'text-on-surface'}`}>
              {total}<span className="text-xs text-on-surface-muted">h</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Delta</p>
            <p className={`num-mono text-lg font-bold ${weeklyDelta > 0 ? 'text-warning' : weeklyDelta < 0 ? 'text-danger' : 'text-success'}`}>
              {weeklyDelta > 0 ? '+' : ''}{weeklyDelta}<span className="text-xs text-on-surface-muted">h</span>
            </p>
          </div>
          {existing?.status === 'approved' && (
            <p className="text-[10px] inline-flex items-center gap-1 px-2 py-1 rounded-full bg-warning-container text-warning font-semibold">
              Changing will re-submit
            </p>
          )}
        </div>

        {/* Per-day inputs */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {loading ? (
            <div className="text-center text-on-surface-subtle py-8 text-sm">Loading…</div>
          ) : dates.map(iso => {
            const dt = new Date(iso + 'T12:00:00Z');
            const dayLabel = DAY_LABELS[dt.getUTCDay()];
            const isWeekend = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
            const d = days[iso];
            const h = Number(d.hours) || 0;
            return (
              <div key={iso} className={`rounded-xl-2 border ${isWeekend ? 'border-outline bg-surface-2/30' : 'border-outline bg-surface'} px-3 py-2.5`}>
                <div className="flex items-center gap-3">
                  <div className="w-12 text-center flex-shrink-0">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-muted">{dayLabel}</p>
                    <p className="num-mono text-lg font-bold text-on-surface leading-none">{dt.getUTCDate()}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input
                      type="number" step="0.5" min="0" inputMode="decimal"
                      value={d.hours}
                      onChange={e => setDay(iso, { hours: e.target.value })}
                      placeholder="0"
                      className="num-mono w-16 text-center text-base font-semibold bg-surface border border-outline rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    <span className="text-xs text-on-surface-muted">h</span>
                  </div>
                  <input
                    type="text"
                    value={d.notes}
                    onChange={e => setDay(iso, { notes: e.target.value })}
                    placeholder={h > 0 ? 'What did you work on?' : '—'}
                    disabled={h === 0 && !d.existing}
                    className={`flex-1 min-w-0 text-sm rounded-lg px-2.5 py-1.5 transition-colors placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50 ${
                      h > 0
                        ? (d.notes.trim()
                            ? 'bg-surface border border-outline focus:border-accent'
                            // Empty + hours filled → soft amber hint so the employee notices
                            : 'bg-warning-container/30 border border-warning/40 focus:border-accent')
                        : 'bg-transparent border border-transparent'
                    }`}
                  />
                </div>
              </div>
            );
          })}
          {existing?.status === 'rejected' && existing.rejection_reason && (
            <div className="text-xs bg-danger-container border border-danger/20 rounded-xl-2 p-3 text-danger mt-3">
              <p className="font-semibold mb-0.5">Last rejection</p>
              <p>{existing.rejection_reason}</p>
            </div>
          )}
          {error && <p className="text-sm text-danger bg-danger-container px-3 py-2 rounded-lg mt-3">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2 bg-surface">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg transition-colors">Cancel</button>
          <button onClick={save} disabled={saving || loading}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
            {saving ? 'Saving…' : 'Save week'}
          </button>
        </div>
      </div>
    </div>
  );
}
