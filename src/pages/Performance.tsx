import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import {
  Target, TrendingUp, Award, Calendar, Plus, X, Trash2,
  ChevronDown, MessageSquare, Edit3, CheckCircle, AlertCircle, Info,
  FileText, ChevronRight, Circle, RefreshCw, Minus, Check, Lock, Unlock,
  Search, ArrowUpDown, ChevronUp,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PulseContextPanel from '../components/PulseContextPanel';
import ReviewSignalsPanel from '../components/ReviewSignalsPanel';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CATEGORIES = [
  { key: 'productivity',        label: 'Productivity' },
  { key: 'quality',             label: 'Quality of Work' },
  { key: 'teamwork',            label: 'Teamwork' },
  { key: 'attendance_score',    label: 'Attendance' },
  { key: 'initiative',          label: 'Initiative' },
  { key: 'client_satisfaction', label: 'Client Handling', hint: 'Messaging quality · handling tough clients · interaction · retention. Feeds the Client Handling pillar on Pulse.' },
  { key: 'ai_usage',            label: 'AI Usage' },
  // Phase-1 additions — dimensions the original 7 missed.
  { key: 'communication',       label: 'Communication',     hint: 'Responsiveness to project queries, approval pings, and team messages. Separate from teamwork — this is about reachability and clarity.' },
  { key: 'ownership',           label: 'Ownership',         hint: 'Drives existing work to closure without nudging. Different from Initiative (starts new things) — this is about following through.' },
  { key: 'planning_accuracy',   label: 'Planning Accuracy', hint: 'How close were their week-1 estimates to actuals? Tracks self-awareness and ability to scope work.' },
  { key: 'learning_growth',     label: 'Learning & Growth', hint: 'What did they level up this month? Anchors retention conversations.' },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];
// Number = rated, null = N/A (pillar doesn't apply to this employee —
// e.g. Client Handling for a junior IC). N/A pillars are excluded from
// the overall_score denominator so juniors aren't penalised for a
// dimension that isn't relevant to their role.
type Scores = Record<CategoryKey, number | null>;

// ─── Goal status config (shared across admin + employee views) ───────────────
export const GOAL_STATUSES = ['not_started', 'touched', 'in_progress', 'completed'] as const;
export type GoalStatus = typeof GOAL_STATUSES[number];

export const GOAL_STATUS_CONFIG: Record<GoalStatus, { label: string; color: string; bg: string; border: string; icon: any; tone: 'neutral' | 'warning' | 'brand' | 'success' }> = {
  not_started: { label: 'Not Started', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb', icon: Circle,    tone: 'neutral' },
  touched:     { label: 'Touched',     color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: Minus,     tone: 'warning' },
  in_progress: { label: 'In Progress', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', icon: RefreshCw, tone: 'brand'   },
  completed:   { label: 'Completed',   color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: Check,     tone: 'success' },
};

// Tailwind class sets for goal status pills (matches GOAL_STATUS_CONFIG tones)
const GOAL_STATUS_CLASSES: Record<GoalStatus, { active: string; inactive: string }> = {
  not_started: {
    active:   'bg-surface-2 text-on-surface-muted border-outline',
    inactive: 'bg-surface-2 text-on-surface-subtle border-outline',
  },
  touched: {
    active:   'bg-warning-container text-warning border-warning/30',
    inactive: 'bg-surface-2 text-on-surface-subtle border-outline',
  },
  in_progress: {
    active:   'bg-brand-container text-on-brand-container border-brand/20',
    inactive: 'bg-surface-2 text-on-surface-subtle border-outline',
  },
  completed: {
    active:   'bg-success-container text-success border-success/20',
    inactive: 'bg-surface-2 text-on-surface-subtle border-outline',
  },
};

// ─── Read-only goal card (used on both admin view + employee MyPortal) ───────
export function GoalCard({ goal, index }: { goal: any; index: number }) {
  const managerStatus: GoalStatus = goal.status ?? 'not_started';
  const empStatus: GoalStatus    = goal.employee_status ?? 'not_started';
  const managerCfg = GOAL_STATUS_CONFIG[managerStatus];
  const empCfg     = GOAL_STATUS_CONFIG[empStatus];
  const ManagerIcon = managerCfg.icon;
  const EmpIcon     = empCfg.icon;

  const hasEmployeeStatus = !!goal.employee_status && goal.employee_status !== 'not_started';
  const hasManagerStatus  = !!goal.status && goal.status !== 'not_started';

  return (
    <div className="flex gap-3 p-4 rounded-xl-2 border border-outline bg-surface-2">
      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 num-mono bg-accent/15 text-accent">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-on-surface">{goal.title}</p>
        {goal.description && <p className="text-xs text-on-surface-muted mt-1">{goal.description}</p>}
        {goal.success_criteria && (
          <p className="text-xs text-on-surface-subtle mt-1 italic">Target: {goal.success_criteria}</p>
        )}

        {/* Status badges */}
        {(hasEmployeeStatus || hasManagerStatus) && (
          <div className="flex flex-wrap gap-2 mt-2.5">
            {hasEmployeeStatus && (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${GOAL_STATUS_CLASSES[empStatus].active}`}>
                <EmpIcon size={10} /> Self: {empCfg.label}
              </span>
            )}
            {hasManagerStatus && (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${GOAL_STATUS_CLASSES[managerStatus].active}`}>
                <ManagerIcon size={10} /> Manager: {managerCfg.label}
              </span>
            )}
          </div>
        )}

        {goal.reviewer_comment && (
          <div className="mt-2 px-3 py-2 rounded-lg text-xs bg-brand/5 text-on-surface-muted">
            <span className="font-semibold text-on-surface">Reviewer: </span>
            {goal.reviewer_comment}
          </div>
        )}
      </div>
    </div>
  );
}

// Hex score colors retained for Recharts (Cells / inline SVG fill props)
function scoreColor(score: number) {
  if (score >= 85) return '#16a34a';
  if (score >= 70) return '#192250';
  if (score >= 50) return '#d97706';
  return '#dc2626';
}

// Token-class equivalent for HTML text usage
function scoreColorClass(score: number) {
  if (score >= 85) return 'text-success';
  if (score >= 70) return 'text-brand';
  if (score >= 50) return 'text-warning';
  return 'text-danger';
}

function scoreBadge(score: number) {
  if (score >= 85) return { bg: '#dcfce7', text: '#15803d', label: 'Excellent', className: 'bg-success-container text-success' };
  if (score >= 70) return { bg: '#e0e4f5', text: '#192250', label: 'Good',       className: 'bg-brand-container text-on-brand-container' };
  if (score >= 50) return { bg: '#fef3c7', text: '#92400e', label: 'Average',    className: 'bg-warning-container text-warning' };
  return            { bg: '#fee2e2', text: '#991b1b', label: 'Needs Work', className: 'bg-danger-container text-danger' };
}

// ─── Reviewer comments + per-pillar notes panel ─────────────────────────
// Rendered inside the monthly review row when the user expands it.
// Shows everything the reviewer typed but the historical grid was
// hiding — the overall Comments plus every per-pillar note that had
// text in it. Same panel is used across the Performance page,
// MyPortal, and MyTeam so admin / employee / reviewer all get the
// same detail on the same click.
export function ReviewCommentsPanel({ record }: { record: any }) {
  const notes = record?.parameter_notes ?? {};
  // Match every note key to its human-readable label from CATEGORIES;
  // ignore keys the reviewer left blank so the panel doesn't render a
  // row of empty labels.
  const noteRows = CATEGORIES
    .map(c => ({ key: c.key, label: c.label, note: String(notes[c.key] ?? '').trim() }))
    .filter(r => r.note !== '');
  const hasComments = record?.comments && String(record.comments).trim() !== '';
  const hasAny = hasComments || noteRows.length > 0;

  if (!hasAny) {
    return (
      <p className="text-xs text-on-surface-subtle italic">
        No comments or per-pillar notes recorded on this review.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {hasComments && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle mb-1">
            Reviewer's overall feedback
          </p>
          <div className="rounded-lg bg-surface border border-outline px-3 py-2 text-sm text-on-surface whitespace-pre-line">
            {record.comments}
          </div>
        </div>
      )}
      {noteRows.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle mb-1">
            Per-pillar notes
          </p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {noteRows.map(r => (
              <li key={r.key} className="rounded-lg bg-surface border border-outline px-3 py-2">
                <p className="text-[11px] font-semibold text-on-surface-muted">{r.label}</p>
                <p className="text-sm text-on-surface whitespace-pre-line mt-0.5">{r.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {record?.reviewer_name && (
        <p className="text-[11px] text-on-surface-subtle">
          Reviewed by <span className="font-semibold text-on-surface-muted">{record.reviewer_name}</span>
          {record.updated_at && <> · {new Date(record.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
        </p>
      )}
    </div>
  );
}

// ─── Slider + text input combo ───────────────────────────────────────────────
function ScoreInput({
  label, value, onChange, note, onNoteChange, noteRequired,
}: {
  label: string; value: number | null; onChange: (v: number | null) => void;
  note?: string; onNoteChange?: (v: string) => void;
  // Whether a note is required (true for RATED pillars). Missing notes
  // paint the textarea with a danger outline so the reviewer knows which
  // fields they still owe before the save button will accept them.
  noteRequired?: boolean;
}) {
  const isNA = value === null;
  const [raw, setRaw] = useState(String(value ?? 75));

  useEffect(() => { setRaw(String(value ?? 75)); }, [value]);

  const handleText = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setRaw(v);
    const n = Number(v);
    if (!isNaN(n) && n >= 0 && n <= 100) onChange(n);
  };

  const handleBlur = () => {
    const n = Math.min(100, Math.max(0, Number(raw) || 0));
    setRaw(String(n));
    onChange(n);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-semibold flex-1 text-on-surface">{label}</label>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => onChange(isNA ? 75 : null)}
            title={isNA ? 'Include this pillar' : 'Not applicable — excludes from overall'}
            className={`text-[10px] font-semibold px-2 py-0.5 rounded border transition-colors ${
              isNA
                ? 'bg-accent text-on-accent border-accent'
                : 'text-on-surface-subtle border-outline hover:border-accent/50 hover:text-on-surface-muted'}`}>
            {isNA ? 'N/A ✓' : 'N/A'}
          </button>
          <input
            type="number" min={0} max={100}
            value={raw}
            disabled={isNA}
            onChange={handleText}
            onBlur={handleBlur}
            className={`w-16 text-center bg-surface border border-outline rounded-lg px-2 py-1 text-sm font-bold focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 num-mono disabled:opacity-30 ${isNA ? '' : scoreColorClass(value as number)}`}
          />
        </div>
      </div>
      <input
        type="range" min={0} max={100}
        value={isNA ? 75 : (value as number)}
        disabled={isNA}
        onChange={e => onChange(Number(e.target.value))}
        className="score-slider"
      />
      {isNA && (
        <p className="text-[11px] text-on-surface-subtle italic">Excluded from overall score.</p>
      )}
      {onNoteChange !== undefined && !isNA && (() => {
        const isMissing = !!noteRequired && !(note ?? '').trim();
        return (
          <textarea
            value={note ?? ''}
            onChange={e => onNoteChange(e.target.value)}
            rows={1}
            placeholder={`Note for ${label}${noteRequired ? ' (required)' : ' (optional)'}…`}
            className={`w-full bg-surface rounded-lg px-2.5 py-1.5 text-xs resize-none focus:outline-none leading-relaxed text-on-surface-muted border ${
              isMissing
                ? 'border-danger/40 focus:border-danger focus:ring-2 focus:ring-danger/20'
                : 'border-outline focus:border-accent focus:ring-2 focus:ring-accent/20'
            }`}
            onFocus={e => { (e.target as HTMLTextAreaElement).rows = 2; }}
            onBlur={e => { if (!e.target.value) (e.target as HTMLTextAreaElement).rows = 1; }}
          />
        );
      })()}
    </div>
  );
}

// ─── Add Review Modal ────────────────────────────────────────────────────────
function AddReviewModal({
  employee, month, year, existing, reviewer, onSave, onClose,
}: {
  employee: any; month: number; year: number; existing?: any; reviewer: any;
  onSave: () => void; onClose: () => void;
}) {
  // Prefill from the saved review when editing. `existing[key]` is null
  // when the reviewer previously marked that pillar N/A; keep it null.
  // Only fall back to 75 when the field is truly absent (new review).
  const initial = (key: string): number | null => {
    if (!existing) return 75;
    const v = (existing as any)[key];
    return v == null ? null : Number(v);
  };
  const [scores, setScores] = useState<Scores>({
    productivity:        initial('productivity'),
    quality:             initial('quality'),
    teamwork:            initial('teamwork'),
    attendance_score:    initial('attendance_score'),
    initiative:          initial('initiative'),
    client_satisfaction: initial('client_satisfaction'),
    ai_usage:            initial('ai_usage'),
    communication:       initial('communication'),
    ownership:           initial('ownership'),
    planning_accuracy:   initial('planning_accuracy'),
    learning_growth:     initial('learning_growth'),
  });
  const [paramNotes, setParamNotes] = useState<Record<string, string>>(existing?.parameter_notes ?? {});
  const [comments, setComments] = useState(existing?.comments ?? '');
  const [saving, setSaving] = useState(false);

  // Overall = mean of the non-N/A pillars. All-N/A collapses to null and
  // save is blocked below.
  const _nums = Object.values(scores).filter((v): v is number => v != null);
  const overall = _nums.length ? Math.round(_nums.reduce((s, n) => s + n, 0) / _nums.length) : null;
  const naCount = CATEGORIES.length - _nums.length;
  const isEditing = !!existing;
  const isLocked = !!existing?.is_locked;
  // Notes are mandatory for every RATED pillar. N/A pillars are excluded
  // — they need no justification because they don't contribute to the
  // score. Track the missing set so we can gate save + highlight fields.
  const missingNoteKeys = CATEGORIES
    .filter(c => (scores as any)[c.key] != null && !((paramNotes[c.key] ?? '').trim()))
    .map(c => c.key);
  const [validationError, setValidationError] = useState('');

  const handleSave = async () => {
    if (overall == null) return; // every slider was N/A — button is disabled anyway
    if (isLocked) return;
    if (missingNoteKeys.length) {
      const missingLabels = CATEGORIES.filter(c => missingNoteKeys.includes(c.key)).map(c => c.label);
      setValidationError(`Add a note for every rated pillar. Missing: ${missingLabels.join(', ')}.`);
      return;
    }
    setValidationError('');
    setSaving(true);
    try {
      await api.saveMonthlyPerformance({
        employee_id: employee.id,
        reviewer_id: reviewer?.id,
        reviewer_name: reviewer?.name,
        month, year,
        ...scores, // null values pass through as NULL to the backend
        overall_score: overall,
        comments,
        parameter_notes: paramNotes,
        requester_role: reviewer?.role,
      });
      onSave();
      onClose();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/55 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-outline">
          <div>
            <h3 className="font-display text-base font-bold tracking-tight text-on-surface">
              {existing ? 'Edit Review' : 'Add Review'}
            </h3>
            <p className="text-xs text-on-surface-subtle mt-0.5">
              {employee.name} · {MONTHS[month - 1]} {year}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors">
            <X size={16} className="text-on-surface-subtle" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Overall score preview — average of the non-N/A pillars. */}
          <div className="rounded-xl-2 p-4 text-center bg-surface-2 border border-outline">
            <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-subtle mb-1">Overall Score</p>
            {overall == null ? (
              <>
                <p className="num-mono text-4xl font-bold text-on-surface-subtle">—</p>
                <p className="text-xs text-danger mt-1">At least one pillar must be scored.</p>
              </>
            ) : (
              <>
                <p className={`num-mono text-4xl font-bold ${scoreColorClass(overall)}`}>{overall}</p>
                <p className={`text-xs font-semibold mt-1 ${scoreColorClass(overall)}`}>{scoreBadge(overall).label}</p>
                <p className="text-xs text-on-surface-subtle mt-1">
                  Average of <span className="num-mono">{CATEGORIES.length - naCount}</span> of <span className="num-mono">{CATEGORIES.length}</span> parameters
                  {naCount > 0 && <> · <span className="num-mono">{naCount}</span> marked N/A</>}
                </p>
              </>
            )}
            {isLocked && <p className="text-[11px] font-semibold uppercase tracking-wider text-warning mt-2">Locked by HR — unlock to edit</p>}
          </div>

          {/* Pulse pillars (computed view) + raw signals (facts view).
              Together these give the reviewer everything they need to
              score against data instead of memory. */}
          <PulseContextPanel employeeId={employee?.id ?? null} />
          <ReviewSignalsPanel employeeId={employee?.id ?? null} month={month} year={year} />

          {/* Self-review summary — shown only if the employee submitted
              theirs. Helps the reviewer spot blind spots both ways
              before locking in their numbers. */}
          {existing?.self_submitted_at && existing?.self_scores && (
            <div className="rounded-xl-2 border border-brand/30 bg-brand-container/30 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-on-brand-container">Self-review on file</p>
                <span className="text-[10px] text-on-surface-subtle">
                  Submitted {new Date(existing.self_submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {CATEGORIES.map(({ key, label }) => {
                  const self = Number(existing.self_scores?.[key] ?? 75);
                  const mine = scores[key];
                  const delta = mine - self;
                  return (
                    <div key={key} className="flex items-center justify-between bg-surface rounded px-2 py-1">
                      <span className="text-on-surface-muted truncate">{label}</span>
                      <span className="num-mono font-semibold">
                        <span className="text-on-surface-subtle">{self}</span>
                        <span className="text-on-surface-subtle mx-1">→</span>
                        <span className="text-on-surface">{mine}</span>
                        {delta !== 0 && (
                          <span className={`ml-1 text-[10px] ${delta > 0 ? 'text-success' : 'text-danger'}`}>
                            {delta > 0 ? '+' : ''}{delta}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              {existing.self_went_well && (
                <div className="mt-3 text-[11px]">
                  <p className="font-semibold text-on-brand-container mb-0.5">What went well (their words):</p>
                  <p className="text-on-surface italic whitespace-pre-line">"{existing.self_went_well}"</p>
                </div>
              )}
              {existing.self_would_do_differently && (
                <div className="mt-2 text-[11px]">
                  <p className="font-semibold text-on-brand-container mb-0.5">What they'd do differently:</p>
                  <p className="text-on-surface italic whitespace-pre-line">"{existing.self_would_do_differently}"</p>
                </div>
              )}
            </div>
          )}

          {CATEGORIES.map(({ key, label, hint }: any) => (
            <div key={key}>
              <ScoreInput
                label={label}
                value={scores[key]}
                onChange={v => setScores(s => ({ ...s, [key]: v }))}
                note={paramNotes[key] ?? ''}
                onNoteChange={v => setParamNotes(n => ({ ...n, [key]: v }))}
                noteRequired={scores[key] != null}
              />
              {hint && <p className="text-[10px] text-on-surface-subtle leading-snug mt-1 ml-1">{hint}</p>}
            </div>
          ))}

          <div>
            <label className="text-sm font-semibold mb-1.5 block text-on-surface">Comments (optional)</label>
            <textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              rows={3}
              placeholder="Overall feedback for this month..."
              className="w-full bg-surface border border-outline rounded-xl-2 px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-on-surface"
            />
          </div>
        </div>

        {validationError && (
          <div className="mx-5 mb-2 px-3 py-2 rounded-lg text-xs font-semibold bg-danger-container/60 text-danger border border-danger/25 flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}
        <div className="flex gap-3 p-5 border-t border-outline">
          <button onClick={onClose} className="flex-1 py-2.5 border border-outline rounded-xl-2 text-sm font-semibold text-on-surface-muted hover:bg-surface-2 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || overall == null || isLocked}
            title={isLocked ? 'HR has locked this review' : overall == null ? 'At least one pillar must be scored' : missingNoteKeys.length ? `Missing notes on ${missingNoteKeys.length} pillar${missingNoteKeys.length === 1 ? '' : 's'}` : ''}
            className="flex-1 py-2.5 bg-accent text-on-accent rounded-xl-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 shadow-elev-1 hover:shadow-elev-2 transition-all"
          >
            {saving ? 'Saving…' : isEditing ? 'Update Review' : 'Save Review'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Note Modal ──────────────────────────────────────────────────────────
function AddNoteModal({ employee, reviewer, onSave, onClose }: {
  employee: any; reviewer: any; onSave: (note: any) => void; onClose: () => void;
}) {
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<'positive' | 'negative' | 'neutral'>('neutral');
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const result = await api.addPerformanceNote({
        employee_id: employee.id,
        note_date: noteDate,
        note_text: noteText.trim(),
        note_type: noteType,
        created_by_id: reviewer?.id,
        created_by_name: reviewer?.name,
      });
      onSave(result);
      onClose();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const typeClasses: Record<'positive' | 'neutral' | 'negative', { active: string; inactive: string; label: string }> = {
    positive: { label: 'Positive', active: 'bg-success-container text-success border-success/30',                  inactive: 'bg-surface-2 text-on-surface-subtle border-outline' },
    neutral:  { label: 'Neutral',  active: 'bg-brand-container text-on-brand-container border-brand/20',           inactive: 'bg-surface-2 text-on-surface-subtle border-outline' },
    negative: { label: 'Negative', active: 'bg-danger-container text-danger border-danger/30',                     inactive: 'bg-surface-2 text-on-surface-subtle border-outline' },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/55 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-outline">
          <div>
            <h3 className="font-display text-base font-bold tracking-tight text-on-surface">Add Private Note</h3>
            <p className="text-xs text-on-surface-subtle mt-0.5">{employee.name} · Not visible to employee</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors"><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide mb-2 block text-on-surface">Note Type</label>
            <div className="flex gap-2">
              {(['positive', 'neutral', 'negative'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setNoteType(t)}
                  className={`flex-1 py-2 rounded-xl-2 text-xs font-semibold border transition-all ${noteType === t ? typeClasses[t].active : typeClasses[t].inactive}`}
                >
                  {typeClasses[t].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide mb-1.5 block text-on-surface">Date</label>
            <input
              type="date" value={noteDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setNoteDate(e.target.value)}
              className="w-full bg-surface border border-outline rounded-xl-2 px-3 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-on-surface num-mono"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide mb-1.5 block text-on-surface">Note</label>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={4}
              placeholder="Write your observation here..."
              className="w-full bg-surface border border-outline rounded-xl-2 px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-on-surface"
            />
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-outline">
          <button onClick={onClose} className="flex-1 py-2.5 border border-outline rounded-xl-2 text-sm font-semibold text-on-surface-muted hover:bg-surface-2 transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !noteText.trim()}
            className="flex-1 py-2.5 bg-accent text-on-accent rounded-xl-2 text-sm font-semibold disabled:opacity-60 hover:opacity-90 shadow-elev-1 hover:shadow-elev-2 transition-all"
          >
            {saving ? 'Saving…' : 'Save Note'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Appraisal Goals Editor Modal (admin) ────────────────────────────────────
function AdminGoalsModal({ record, onSave, onClose }: {
  record: any; onSave: () => void; onClose: () => void;
}) {
  const [goals, setGoals] = useState<any[]>(record.goals ?? []);
  const [saving, setSaving] = useState(false);

  const update = (i: number, field: string, val: string) =>
    setGoals(g => g.map((x, j) => j === i ? { ...x, [field]: val } : x));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.adminSaveAppraisalGoals({ employee_id: record.employee_id, year: record.year, month: record.month, goals });
      onSave();
      onClose();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/55 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-outline">
          <div>
            <h3 className="font-display text-base font-bold tracking-tight text-on-surface">Review Appraisal Goals</h3>
            <p className="text-xs text-on-surface-subtle mt-0.5">
              {record.employee_name} · {MONTHS[record.month - 1]} {record.year} · Update status and add comments
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors"><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="p-5 space-y-5">
          {goals.map((g, i) => (
            <div key={i} className="border border-outline rounded-xl-2 overflow-hidden bg-surface-2">
              {/* Goal header */}
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
                <div className="flex items-start gap-2.5 flex-1">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 num-mono bg-accent/15 text-accent">{i + 1}</div>
                  <div className="flex-1">
                    <input
                      value={g.title ?? ''}
                      onChange={e => update(i, 'title', e.target.value)}
                      placeholder="Goal title"
                      className="w-full font-semibold text-sm bg-transparent border-b border-outline focus:outline-none focus:border-accent pb-1 text-on-surface"
                    />
                    <input
                      value={g.description ?? ''}
                      onChange={e => update(i, 'description', e.target.value)}
                      placeholder="Description"
                      className="w-full text-xs text-on-surface-muted bg-transparent border-b border-outline focus:outline-none focus:border-accent pb-1 mt-1"
                    />
                    {g.success_criteria && (
                      <p className="text-xs text-on-surface-subtle mt-1 italic">Target: {g.success_criteria}</p>
                    )}
                  </div>
                </div>
                <button onClick={() => setGoals(g => g.filter((_, j) => j !== i))} className="p-1 hover:bg-danger-container rounded flex-shrink-0 transition-colors">
                  <Trash2 size={13} className="text-danger" />
                </button>
              </div>

              {/* Employee self-status (read-only reference) */}
              {g.employee_status && g.employee_status !== 'not_started' && (() => {
                const empCfg = GOAL_STATUS_CONFIG[g.employee_status as GoalStatus];
                const EmpIcon = empCfg?.icon;
                return empCfg ? (
                  <div className="px-4 pb-2">
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1.5 text-on-surface-subtle">Employee Self-Assessment</p>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${GOAL_STATUS_CLASSES[g.employee_status as GoalStatus].active}`}>
                      <EmpIcon size={11} /> {empCfg.label}
                    </span>
                  </div>
                ) : null;
              })()}

              {/* Manager status selector */}
              <div className="px-4 pb-3">
                <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-on-surface-subtle">Final Status (Manager)</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {GOAL_STATUSES.map(s => {
                    const cfg = GOAL_STATUS_CONFIG[s];
                    const Icon = cfg.icon;
                    const active = (g.status ?? 'not_started') === s;
                    return (
                      <button
                        key={s}
                        onClick={() => update(i, 'status', s)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${active ? GOAL_STATUS_CLASSES[s].active : GOAL_STATUS_CLASSES[s].inactive}`}
                      >
                        <Icon size={11} /> {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Reviewer comment */}
              <div className="px-4 pb-4">
                <textarea
                  value={g.reviewer_comment ?? ''}
                  onChange={e => update(i, 'reviewer_comment', e.target.value)}
                  rows={2}
                  placeholder="Reviewer comment (visible to employee)…"
                  className="w-full bg-surface border border-outline rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-on-surface-muted"
                />
              </div>
            </div>
          ))}

          {goals.length < 6 && (
            <button
              onClick={() => setGoals(g => [...g, { title: '', description: '', success_criteria: '', status: 'not_started' }])}
              className="w-full py-2.5 border-2 border-dashed border-outline rounded-xl-2 text-sm font-semibold text-on-surface-subtle hover:border-accent/40 hover:text-accent transition-colors"
            >+ Add Goal</button>
          )}
        </div>
        <div className="flex gap-3 p-5 border-t border-outline">
          <button onClick={onClose} className="flex-1 py-2.5 border border-outline rounded-xl-2 text-sm font-semibold text-on-surface-muted hover:bg-surface-2 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-accent text-on-accent rounded-xl-2 text-sm font-semibold disabled:opacity-60 hover:opacity-90 shadow-elev-1 hover:shadow-elev-2 transition-all">
            {saving ? 'Saving…' : 'Save Review'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────
function CustomBarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const score = payload[0]?.value;
  if (score == null) return null;
  const badge = scoreBadge(score);
  return (
    <div className="bg-surface border border-outline rounded-xl-2 shadow-elev-3 px-4 py-3 text-sm">
      <p className="font-bold text-on-surface">{label}</p>
      <p className={`num-mono text-2xl font-black mt-0.5 ${scoreColorClass(score)}`}>{score}</p>
      <p className={`text-xs font-semibold mt-0.5 ${scoreColorClass(score)}`}>{badge.label}</p>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
type PageView = 'monthly' | 'appraisal';

export default function Performance() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isHROrAdmin = user?.role === 'admin' || user?.role === 'hr_manager';

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [view, setView] = useState<PageView>('monthly');
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  // Which month row is expanded to show comments + per-pillar notes.
  // Only one row open at a time so the historical table doesn't blow
  // out vertically when the user is scanning. null = all collapsed.
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  // Sort key + direction for the Monthly Reviews table. 'month' is the
  // default and renders the calendar order (Jan→Dec). Any other key sorts
  // months that have a review first, ranked by the chosen field, then
  // appends unrated months at the bottom in calendar order.
  type SortKey = 'month' | 'overall_score' | 'productivity' | 'quality' | 'teamwork' | 'attendance_score' | 'initiative' | 'client_satisfaction' | 'ai_usage' | 'reviewer_name';
  const [sortKey, setSortKey] = useState<SortKey>('month');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'month' || k === 'reviewer_name' ? 'asc' : 'desc'); }
  };
  const [notes, setNotes] = useState<any[]>([]);
  const [loadingPerf, setLoadingPerf] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [showAddReview, setShowAddReview] = useState<{ month: number; existing?: any } | null>(null);
  const [showAddNote, setShowAddNote] = useState(false);

  // Appraisal goals
  const [appraisalRecords, setAppraisalRecords] = useState<any[]>([]);
  const [loadingAppraisal, setLoadingAppraisal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<any | null>(null);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [appraisalEmpFilter, setAppraisalEmpFilter] = useState('');

  useEffect(() => {
    api.getEmployees().then(emps => {
      setEmployees(emps);
      if (emps.length) setSelectedEmpId(emps[0].id);
    });
  }, []);

  const loadPerformance = useCallback(() => {
    if (!selectedEmpId) return;
    setLoadingPerf(true);
    api.getMonthlyPerformance(selectedEmpId, selectedYear)
      .then(setMonthlyData)
      .finally(() => setLoadingPerf(false));
  }, [selectedEmpId, selectedYear]);

  const loadNotes = useCallback(() => {
    if (!selectedEmpId || !isHROrAdmin) return;
    setLoadingNotes(true);
    api.getPerformanceNotes(selectedEmpId)
      .then(setNotes)
      .finally(() => setLoadingNotes(false));
  }, [selectedEmpId, isHROrAdmin]);

  const loadAppraisal = useCallback(() => {
    if (!isHROrAdmin) return;
    setLoadingAppraisal(true);
    api.getAppraisalGoals({ year: selectedYear })
      .then(data => setAppraisalRecords(Array.isArray(data) ? data : []))
      .finally(() => setLoadingAppraisal(false));
  }, [selectedYear, isHROrAdmin]);

  useEffect(() => { loadPerformance(); }, [loadPerformance]);
  useEffect(() => { loadNotes(); }, [loadNotes]);
  useEffect(() => { if (view === 'appraisal') loadAppraisal(); }, [view, loadAppraisal]);

  const selectedEmp = employees.find(e => e.id === selectedEmpId);

  const chartData = MONTHS.map((m, idx) => {
    const record = monthlyData.find(r => r.month === idx + 1);
    return { month: m, score: record ? record.overall_score : null, record };
  });

  const reviewedMonths = monthlyData.length;
  // Sorted [(monthIdx 0-11, record-or-null)] list driving the table body.
  // Default 'month' just walks Jan→Dec. For any score-based sort, months
  // without a review are pushed to the bottom (they can't be ranked).
  const sortedMonthRows = useMemo(() => {
    const rows = MONTHS.map((_, idx) => {
      const monthNum = idx + 1;
      const record = monthlyData.find(r => r.month === monthNum);
      return { idx, monthNum, record };
    });
    if (sortKey === 'month') {
      return sortDir === 'asc' ? rows : [...rows].reverse();
    }
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const ar = a.record, br = b.record;
      if (!ar && !br) return a.monthNum - b.monthNum;
      if (!ar) return 1;
      if (!br) return -1;
      if (sortKey === 'reviewer_name') {
        return sign * String(ar.reviewer_name ?? '').localeCompare(String(br.reviewer_name ?? ''));
      }
      return sign * (Number(ar[sortKey] ?? 0) - Number(br[sortKey] ?? 0));
    });
  }, [monthlyData, sortKey, sortDir]);
  const avgScore = reviewedMonths > 0
    ? Math.round(monthlyData.reduce((a, r) => a + r.overall_score, 0) / reviewedMonths)
    : 0;
  const bestMonth = monthlyData.length
    ? monthlyData.reduce((a, b) => a.overall_score > b.overall_score ? a : b)
    : null;
  const currentMonthRecord = monthlyData.find(r => r.month === currentMonth && r.year === currentYear);

  const handleDeleteNote = async (id: string) => {
    if (!confirm('Delete this note?')) return;
    await api.deletePerformanceNote(id);
    setNotes(n => n.filter(x => x.id !== id));
  };

  const noteTypeConfig: Record<string, { icon: any; className: string; iconClass: string }> = {
    positive: { icon: CheckCircle, className: 'bg-success-container border-success/20', iconClass: 'text-success' },
    neutral:  { icon: Info,        className: 'bg-brand-container border-brand/15',     iconClass: 'text-on-brand-container' },
    negative: { icon: AlertCircle, className: 'bg-danger-container border-danger/20',   iconClass: 'text-danger' },
  };

  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - i);

  return (
    <><div className="space-y-6">
        {/* ── Page view tabs ── */}
        {isHROrAdmin && (
          <div className="flex gap-1 bg-surface rounded-xl-2 p-1 border border-outline shadow-elev-1 w-fit">
            {([
              { key: 'monthly',   label: 'Monthly Reviews',  icon: TrendingUp },
              { key: 'appraisal', label: 'Appraisal Goals',  icon: FileText },
            ] as { key: PageView; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${view === key ? 'bg-brand text-on-brand' : 'text-on-surface-muted hover:bg-surface-2'}`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            MONTHLY REVIEWS VIEW
        ══════════════════════════════════════════════════════════════════ */}
        {view === 'monthly' && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <EmployeeSearchSelect
                employees={employees}
                value={selectedEmpId}
                onChange={setSelectedEmpId}
              />

              <div className="relative">
                <select
                  value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value))}
                  className="appearance-none bg-surface border border-outline rounded-lg px-4 pr-9 py-2.5 text-sm font-semibold focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 shadow-elev-1 text-on-surface num-mono"
                >
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
              </div>

              {isHROrAdmin && (
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => setShowAddNote(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl-2 text-sm font-semibold border border-outline bg-surface text-on-surface transition-all hover:bg-surface-2 shadow-elev-1"
                  >
                    <MessageSquare size={15} /> Add Note
                  </button>
                  <button
                    onClick={() => setShowAddReview({ month: currentMonth })}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl-2 text-sm font-semibold bg-accent text-on-accent transition-all hover:opacity-90 shadow-elev-1 hover:shadow-elev-2"
                  >
                    <Plus size={15} /> Add Review
                  </button>
                </div>
              )}
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Avg YTD Score', value: reviewedMonths ? avgScore : '—', sub: reviewedMonths ? scoreBadge(avgScore).label : 'No reviews yet', icon: TrendingUp, iconBg: 'bg-brand-container',   iconColor: 'text-on-brand-container', blob: 'bg-brand/15',   subClass: 'text-on-surface-muted' },
                { label: 'Reviews Done',  value: `${reviewedMonths}/12`, sub: `${12 - reviewedMonths} remaining`, icon: Target, iconBg: 'bg-accent/15',      iconColor: 'text-accent',              blob: 'bg-accent/15',  subClass: 'text-accent' },
                { label: 'Best Month',    value: bestMonth ? MONTHS[bestMonth.month - 1] : '—', sub: bestMonth ? `Score: ${bestMonth.overall_score}` : 'No data', icon: Award,   iconBg: 'bg-success-container', iconColor: 'text-success', blob: 'bg-success/15', subClass: 'text-success' },
                { label: 'This Month',    value: currentMonthRecord ? currentMonthRecord.overall_score : '—', sub: currentMonthRecord ? scoreBadge(currentMonthRecord.overall_score).label : 'Not reviewed', icon: Calendar, iconBg: 'bg-warning-container', iconColor: 'text-warning', blob: 'bg-warning/15', subClass: 'text-warning' },
              ].map(({ label, value, sub, icon: Icon, iconBg, iconColor, blob, subClass }, i) => {
                const isNumber = typeof value === 'number' || (typeof value === 'string' && /^\d/.test(value));
                return (
                  <div key={label} className={`group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up stagger-${i + 1}`}>
                    <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full ${blob} blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500`} />
                    <div className="relative">
                      <div className="flex items-start justify-between mb-3">
                        <div className={`w-10 h-10 rounded-xl-2 flex items-center justify-center ${iconBg} shadow-elev-1 group-hover:scale-110 transition-transform duration-300`}>
                          <Icon size={18} className={iconColor} strokeWidth={1.75} />
                        </div>
                      </div>
                      <p className={`text-2xl font-black text-on-surface ${isNumber ? 'num-mono' : 'font-display tracking-tight'}`}>{value}</p>
                      <p className="text-xs text-on-surface-subtle mt-1">{label}</p>
                      <p className={`text-xs font-semibold mt-0.5 ${subClass}`}>{sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Bar chart */}
              <div className="xl:col-span-2 relative bg-surface rounded-xl-2 p-6 border border-outline shadow-elev-2 overflow-hidden group hover:shadow-elev-3 transition-shadow">
                <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h2 className="font-display text-xl font-bold tracking-tight text-on-surface">Monthly Performance — <span className="num-mono">{selectedYear}</span></h2>
                      <p className="text-xs text-on-surface-muted mt-0.5">Overall score out of <span className="num-mono">100</span></p>
                    </div>
                    <div className="flex gap-3 text-xs flex-wrap">
                      {[
                        { c: '#16a34a', cls: 'bg-success',  l: '≥85'    },
                        { c: '#192250', cls: 'bg-brand',    l: '70–84'  },
                        { c: '#d97706', cls: 'bg-warning',  l: '50–69'  },
                        { c: '#dc2626', cls: 'bg-danger',   l: '<50'    },
                      ].map(({ cls, l }) => (
                        <div key={l} className="flex items-center gap-1.5">
                          <div className={`w-2.5 h-2.5 rounded-sm ${cls}`} />
                          <span className="text-on-surface-muted num-mono">{l}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {loadingPerf ? (
                    <div className="h-56 flex items-center justify-center text-on-surface-subtle text-sm">Loading…</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={chartData} barSize={28}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8', fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8', fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} width={28} />
                        <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
                        <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                          {chartData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.score != null ? scoreColor(entry.score) : 'rgb(var(--surface-2))'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Notes / Category breakdown */}
              {isHROrAdmin ? (
                <div className="relative bg-surface rounded-xl-2 p-6 border border-outline shadow-elev-2 overflow-hidden group hover:shadow-elev-3 transition-shadow flex flex-col">
                  <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-accent/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
                  <div className="relative flex flex-col flex-1 min-h-0">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="font-display text-xl font-bold tracking-tight text-on-surface">Private Notes</h2>
                        <p className="text-xs text-on-surface-muted mt-0.5">Not visible to employee</p>
                      </div>
                      <button onClick={() => setShowAddNote(true)} className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors">
                        <Plus size={15} className="text-accent" />
                      </button>
                    </div>
                    {loadingNotes ? (
                      <div className="flex-1 flex items-center justify-center text-on-surface-subtle text-sm">Loading…</div>
                    ) : notes.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
                        <MessageSquare size={28} className="text-on-surface-subtle mb-2" />
                        <p className="text-sm text-on-surface-muted">No notes yet</p>
                      </div>
                    ) : (
                      <div className="space-y-3 overflow-y-auto flex-1" style={{ maxHeight: 260 }}>
                        {notes.map(note => {
                          const cfg = noteTypeConfig[note.note_type] ?? noteTypeConfig.neutral;
                          const Icon = cfg.icon;
                          return (
                            <div key={note.id} className={`rounded-xl-2 p-3 border ${cfg.className}`}>
                              <div className="flex items-start gap-2">
                                <Icon size={14} className={`${cfg.iconClass} flex-shrink-0 mt-0.5`} />
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs font-semibold ${cfg.iconClass}`}>
                                    {new Date(note.note_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                  </p>
                                  <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">{note.note_text}</p>
                                  {note.created_by_name && <p className="text-xs text-on-surface-subtle mt-1.5">— {note.created_by_name}</p>}
                                </div>
                                <button onClick={() => handleDeleteNote(note.id)} className="flex-shrink-0 p-1 hover:bg-surface/60 rounded transition-colors">
                                  <Trash2 size={12} className={cfg.iconClass} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="relative bg-surface rounded-xl-2 p-6 border border-outline shadow-elev-2 overflow-hidden group hover:shadow-elev-3 transition-shadow flex flex-col">
                  <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
                  <div className="relative">
                    <h2 className="font-display text-xl font-bold tracking-tight text-on-surface mb-4">Category Avg (YTD)</h2>
                    {monthlyData.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-on-surface-subtle text-sm">No reviews yet</div>
                    ) : (
                      <div className="space-y-3">
                        {CATEGORIES.map(({ key, label }) => {
                          // Skip nulls (N/A) — averaging over 0 for
                          // pillars the reviewer marked "not applicable"
                          // would drag every category to near-zero as
                          // soon as one N/A entry landed.
                          const rated = monthlyData.map(r => r[key]).filter((v): v is number => v != null);
                          const avg = rated.length ? Math.round(rated.reduce((a, n) => a + n, 0) / rated.length) : null;
                          return (
                            <div key={key}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="font-medium text-on-surface-muted">{label}</span>
                                {avg == null
                                  ? <span className="font-bold text-on-surface-subtle">N/A</span>
                                  : <span className={`font-bold num-mono ${scoreColorClass(avg)}`}>{avg}</span>}
                              </div>
                              <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all bg-accent" style={{ width: `${avg ?? 0}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Monthly table */}
            <div className="bg-surface rounded-xl-2 shadow-elev-1 border border-outline overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-outline">
                <h2 className="font-display text-xl font-bold tracking-tight text-on-surface">Monthly Reviews — <span className="num-mono">{selectedYear}</span></h2>
                <span className="text-xs text-on-surface-muted"><span className="num-mono">{reviewedMonths}</span> of <span className="num-mono">12</span> months reviewed</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2">
                      <SortHeader label="Month"   k="month"          align="left"   curKey={sortKey} curDir={sortDir} onClick={toggleSort} />
                      {CATEGORIES.map(c => (
                        <SortHeader key={c.key} label={c.label.split(' ')[0]} k={c.key as SortKey} align="center" curKey={sortKey} curDir={sortDir} onClick={toggleSort} />
                      ))}
                      <SortHeader label="Overall" k="overall_score"  align="center" curKey={sortKey} curDir={sortDir} onClick={toggleSort} />
                      <SortHeader label="Reviewer" k="reviewer_name" align="left"   curKey={sortKey} curDir={sortDir} onClick={toggleSort} />
                      {isHROrAdmin && <th className="text-right px-5 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMonthRows.map(({ idx, monthNum, record }) => {
                      const m = MONTHS[idx];
                      const isFuture = selectedYear === currentYear && monthNum > currentMonth;
                      // Row is expandable only when there's an actual
                      // record — collapsed rows for un-reviewed months
                      // stay simple text.
                      const isExpanded = expandedMonth === monthNum;
                      const hasNotes = !!record && (
                        (record.comments && record.comments.trim() !== '') ||
                        Object.values(record.parameter_notes ?? {}).some((v: any) => v && String(v).trim() !== '')
                      );
                      // Number of category columns + Overall + Reviewer +
                      // (optional) Action → for the expanded sub-row's
                      // colSpan.
                      const spanCols = 1 + CATEGORIES.length + 2 + (isHROrAdmin ? 1 : 0);
                      return (
                        <Fragment key={m}>
                        <tr className="border-t border-outline hover:bg-surface-2 transition-colors">
                          <td className="px-5 py-3.5 font-semibold text-on-surface">
                            {record ? (
                              <button
                                onClick={() => setExpandedMonth(cur => cur === monthNum ? null : monthNum)}
                                title={hasNotes ? 'Show reviewer comments + per-pillar notes' : 'No comments recorded for this month'}
                                className="inline-flex items-center gap-1.5 hover:text-accent transition-colors group"
                              >
                                {isExpanded ? <ChevronDown size={14} className="text-accent" /> : <ChevronRight size={14} className="text-on-surface-subtle group-hover:text-accent" />}
                                <span>{m} <span className="num-mono">{selectedYear}</span></span>
                                {hasNotes && !isExpanded && (
                                  <MessageSquare size={11} className="text-accent" />
                                )}
                              </button>
                            ) : (
                              <span>{m} <span className="num-mono">{selectedYear}</span></span>
                            )}
                          </td>
                          {CATEGORIES.map(c => (
                            <td key={c.key} className="px-2 py-3.5 text-center">
                              {record
                                ? <span className={`font-bold num-mono ${scoreColorClass(record[c.key])}`}>{record[c.key]}</span>
                                : <span className="text-on-surface-subtle">—</span>}
                            </td>
                          ))}
                          <td className="px-3 py-3.5 text-center">
                            {record ? (
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold num-mono ${scoreBadge(record.overall_score).className}`}>
                                {record.overall_score}
                              </span>
                            ) : <span className="text-on-surface-subtle">—</span>}
                          </td>
                          <td className="px-3 py-3.5 text-xs text-on-surface-muted">{record?.reviewer_name ?? '—'}</td>
                          {isHROrAdmin && (
                            <td className="px-5 py-3.5 text-right">
                              {!isFuture && record && (
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* Lock / unlock (HR & admin see lock; only admin sees unlock) */}
                                  {!record.is_locked ? (
                                    <button
                                      onClick={async () => {
                                        await api.lockPerformanceReview(record.id, true, user?.name, user?.role);
                                        loadPerformance();
                                      }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-outline bg-surface-2 text-warning hover:bg-warning-container transition-colors"
                                      title="Lock this review — prevents manager/employee edits"
                                    >
                                      <Lock size={11} /> Lock
                                    </button>
                                  ) : (
                                    isAdmin && (
                                      <button
                                        onClick={async () => {
                                          await api.lockPerformanceReview(record.id, false, undefined, user?.role);
                                          loadPerformance();
                                        }}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-outline bg-surface-2 text-success hover:bg-success-container transition-colors"
                                        title="Unlock this review (admin only)"
                                      >
                                        <Unlock size={11} /> Unlock
                                      </button>
                                    )
                                  )}
                                  {/* Edit — disabled when locked (unless admin) */}
                                  {(!record.is_locked || isAdmin) && (
                                    <button
                                      onClick={() => setShowAddReview({ month: monthNum, existing: record })}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-outline text-on-surface hover:bg-surface-2 transition-colors"
                                    >
                                      <Edit3 size={11} /> Edit
                                    </button>
                                  )}
                                  {/* Locked indicator */}
                                  {record.is_locked && (
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg bg-warning-container text-warning">
                                      <Lock size={10} /> Locked
                                    </span>
                                  )}
                                </div>
                              )}
                              {!isFuture && !record && (
                                <button
                                  onClick={() => setShowAddReview({ month: monthNum, existing: record })}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-outline text-on-surface hover:bg-surface-2 transition-colors"
                                >
                                  <Edit3 size={11} /> Add
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                        {isExpanded && record && (
                          <tr className="bg-surface-2/40 border-t border-outline">
                            <td colSpan={spanCols} className="px-5 py-4">
                              <ReviewCommentsPanel record={record} />
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            APPRAISAL GOALS VIEW (admin/hr only)
        ══════════════════════════════════════════════════════════════════ */}
        {view === 'appraisal' && isHROrAdmin && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <select
                  value={selectedYear}
                  onChange={e => { setSelectedYear(Number(e.target.value)); }}
                  className="appearance-none bg-surface border border-outline rounded-lg px-4 pr-9 py-2.5 text-sm font-semibold focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 shadow-elev-1 text-on-surface num-mono"
                >
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
              </div>
              <div className="relative">
                <select
                  value={appraisalEmpFilter}
                  onChange={e => setAppraisalEmpFilter(e.target.value)}
                  className="appearance-none bg-surface border border-outline rounded-lg px-4 pr-9 py-2.5 text-sm font-semibold focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 shadow-elev-1 text-on-surface"
                  style={{ minWidth: 180 }}
                >
                  <option value="">All Employees</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
              </div>
              <p className="text-sm text-on-surface-muted">
                <span className="num-mono">{(appraisalEmpFilter
                  ? appraisalRecords.filter(r => r.employee_id === appraisalEmpFilter)
                  : appraisalRecords
                ).length}</span> submission{appraisalRecords.length !== 1 ? 's' : ''} for <span className="num-mono">{selectedYear}</span>
              </p>
            </div>

            {loadingAppraisal ? (
              <div className="bg-surface rounded-xl-2 p-12 text-center text-on-surface-subtle shadow-elev-1 border border-outline">Loading…</div>
            ) : (appraisalEmpFilter ? appraisalRecords.filter(r => r.employee_id === appraisalEmpFilter) : appraisalRecords).length === 0 ? (
              <div className="bg-surface rounded-xl-2 p-12 text-center shadow-elev-1 border border-outline">
                <FileText size={32} className="text-on-surface-subtle mx-auto mb-3" />
                <p className="text-on-surface-muted font-medium">No appraisal goals submitted for <span className="num-mono">{selectedYear}</span>{appraisalEmpFilter ? ` for ${employees.find(e => e.id === appraisalEmpFilter)?.name}` : ''}</p>
                <p className="text-sm text-on-surface-subtle mt-1">Employees submit their goals from My Portal</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(appraisalEmpFilter
                  ? appraisalRecords.filter(r => r.employee_id === appraisalEmpFilter)
                  : appraisalRecords
                ).map(record => {
                  const key = `${record.employee_id}-${record.year}`;
                  const isExpanded = expandedGoal === key;
                  return (
                    <div key={key} className="bg-surface rounded-xl-2 shadow-elev-1 border border-outline overflow-hidden hover:bg-surface-2 transition-colors">
                      <button
                        onClick={() => setExpandedGoal(isExpanded ? null : key)}
                        className="w-full flex items-center gap-4 px-5 py-4 transition-colors text-left"
                      >
                        <div className="w-9 h-9 rounded-xl-2 flex items-center justify-center text-xs font-bold flex-shrink-0 bg-brand-container text-on-brand-container">
                          {record.employee_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm truncate text-on-surface">{record.employee_name}</p>
                          <p className="text-xs text-on-surface-muted">{record.designation} · {record.department}</p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${record.submitted ? 'bg-success-container text-success' : 'bg-warning-container text-warning'}`}>
                            {record.submitted ? '✓ Submitted' : 'Draft'}
                          </span>
                          {record.submitted && (
                            <span className="text-xs text-on-surface-muted">
                              {new Date(record.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          )}
                          <span className="text-xs text-on-surface-muted"><span className="num-mono">{record.goals?.length ?? 0}</span> goals</span>
                          {isAdmin && (
                            <button
                              onClick={e => { e.stopPropagation(); setEditingGoal(record); }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
                            >
                              <Edit3 size={11} /> Review
                            </button>
                          )}
                          <ChevronRight size={16} className={`text-on-surface-subtle transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-outline px-5 py-4 bg-surface">
                          {!record.goals?.length ? (
                            <p className="text-sm text-on-surface-muted">No goals entered.</p>
                          ) : (
                            <div className="space-y-3">
                              {record.goals.map((g: any, i: number) => (
                                <GoalCard key={i} goal={g} index={i} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showAddReview && selectedEmp && (
        <AddReviewModal
          employee={selectedEmp}
          month={showAddReview.month}
          year={selectedYear}
          existing={showAddReview.existing}
          reviewer={{ id: user?.id, name: user?.name, role: user?.role }}
          onSave={loadPerformance}
          onClose={() => setShowAddReview(null)}
        />
      )}
      {showAddNote && selectedEmp && (
        <AddNoteModal
          employee={selectedEmp}
          reviewer={{ id: user?.id, name: user?.name, role: user?.role }}
          onSave={note => setNotes(n => [note, ...n])}
          onClose={() => setShowAddNote(false)}
        />
      )}
      {editingGoal && (
        <AdminGoalsModal
          record={editingGoal}
          onSave={loadAppraisal}
          onClose={() => setEditingGoal(null)}
        />
      )}
    </>
  );
}

// ── Searchable employee combobox ──────────────────────────────────────────
// Replaces the long native <select> on the Performance picker. Type-to-
// filter for orgs that have grown past "scroll the dropdown is fine"
// size, while still letting users open the full list with a click.
// Outside-click + Escape close the panel. Selecting an item commits and
// closes. Default selected name is shown in the input until the user
// starts typing.
function EmployeeSearchSelect({ employees, value, onChange }: {
  employees: Array<{ id: string; name: string; department?: string | null; designation?: string | null }>;
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = employees.find(e => e.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e =>
      e.name.toLowerCase().includes(q) ||
      (e.department ?? '').toLowerCase().includes(q) ||
      (e.designation ?? '').toLowerCase().includes(q)
    );
  }, [employees, query]);
  return (
    <div className="relative" ref={wrapRef} style={{ minWidth: 240 }}>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
        <input
          value={open ? query : (selected?.name ?? '')}
          onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(''); }}
          placeholder="Search employee…"
          className="w-full appearance-none bg-surface border border-outline rounded-lg pl-9 pr-9 py-2.5 text-sm font-semibold focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 shadow-elev-1 text-on-surface"
        />
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-surface border border-outline rounded-lg shadow-elev-3 max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-xs text-on-surface-subtle text-center">No matches for "{query}"</div>
          ) : filtered.map(e => (
            <button
              key={e.id}
              onClick={() => { onChange(e.id); setQuery(''); setOpen(false); }}
              className={`w-full text-left px-3 py-2 hover:bg-surface-2 transition-colors ${e.id === value ? 'bg-accent/5' : ''}`}
            >
              <p className="text-sm font-semibold text-on-surface">{e.name}</p>
              {(e.department || e.designation) && (
                <p className="text-[11px] text-on-surface-subtle truncate">
                  {[e.designation, e.department].filter(Boolean).join(' · ')}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Sortable <th>. Click to set this column as the active sort; click again
// to flip direction. Renders a ↕ glyph when inactive and ↑/↓ when active
// so the table tells you what it's sorted by at a glance.
function SortHeader<K extends string>({ label, k, align, curKey, curDir, onClick }: {
  label: string;
  k: K;
  align: 'left' | 'center' | 'right';
  curKey: string;
  curDir: 'asc' | 'desc';
  onClick: (k: K) => void;
}) {
  const active = curKey === k;
  const justify = align === 'left' ? 'justify-start' : align === 'right' ? 'justify-end' : 'justify-center';
  const textAlign = align === 'left' ? 'text-left' : align === 'right' ? 'text-right' : 'text-center';
  return (
    <th className={`${textAlign} px-3 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 w-full ${justify} ${active ? 'text-on-surface' : 'text-on-surface-subtle hover:text-on-surface'} transition-colors`}
      >
        {label}
        {active
          ? (curDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
          : <ArrowUpDown size={10} className="opacity-50" />}
      </button>
    </th>
  );
}
