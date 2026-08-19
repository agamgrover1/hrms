// Single source of truth for the hiring pipeline stages. Every UI surface
// (kanban columns, stage select dropdowns, profile pills) imports from
// here so re-ordering or renaming happens in one place. Order matches
// the workflow PDF's Complete Hiring Flow diagram.

export type HiringStage =
  | 'sourced'
  | 'screening_pending'
  | 'tech_review'
  | 'screening_call'
  | 'details_captured'
  | 'interview_scheduled'
  | 'interviewing'
  | 'decision_pending'
  | 'offer'
  | 'final';

export type CandidateStatus = 'active' | 'rejected' | 'hold' | 'joined' | 'withdrawn';

// Pipeline stages — shown as kanban columns in canonical left-to-right
// order. Excludes terminal statuses (rejected/hold), which live outside
// the flow and get their own column at the far right of the board.
export const HIRING_STAGES: { key: HiringStage; label: string; hint: string }[] = [
  { key: 'sourced',             label: 'Sourced',           hint: 'Resume in, awaiting screening' },
  { key: 'screening_pending',   label: 'Screening',         hint: 'HR reviewing resume fit' },
  { key: 'tech_review',         label: 'Tech Review',       hint: 'Team lead validating the profile' },
  { key: 'screening_call',      label: 'Screening Call',    hint: 'HR call scheduled / done' },
  { key: 'details_captured',   label: 'Details Captured',  hint: 'Post-call fields filled in' },
  { key: 'interview_scheduled', label: 'Interview Set',     hint: 'Round(s) on the calendar' },
  { key: 'interviewing',        label: 'Interviewing',      hint: 'Rounds in progress' },
  { key: 'decision_pending',    label: 'Decision Pending',  hint: 'Feedback received, choice being made' },
  { key: 'offer',               label: 'Offer',             hint: 'Offer drafted / released' },
  { key: 'final',               label: 'Final',             hint: 'Accepted, declined, or joined' },
];

// Terminal columns — shown separately on the kanban after the pipeline.
export const TERMINAL_STAGES = [
  { key: 'hold' as const,     label: 'On Hold',   hint: 'Paused / future consideration' },
  { key: 'rejected' as const, label: 'Rejected',  hint: 'Not moving forward' },
];

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return '—';
  const s = HIRING_STAGES.find(x => x.key === stage);
  if (s) return s.label;
  const t = TERMINAL_STAGES.find(x => x.key === stage);
  if (t) return t.label;
  return stage;
}

// Palette for stage pills / kanban column headers. Kept intentionally
// muted so the board reads as a pipeline, not a rainbow.
export const STAGE_COLOR: Record<string, { bg: string; text: string; ring: string }> = {
  sourced:              { bg: 'bg-slate-100 dark:bg-slate-800',       text: 'text-slate-700 dark:text-slate-300', ring: 'ring-slate-300' },
  screening_pending:    { bg: 'bg-blue-100 dark:bg-blue-900/40',      text: 'text-blue-700 dark:text-blue-300',   ring: 'ring-blue-300' },
  tech_review:          { bg: 'bg-indigo-100 dark:bg-indigo-900/40',  text: 'text-indigo-700 dark:text-indigo-300', ring: 'ring-indigo-300' },
  screening_call:       { bg: 'bg-cyan-100 dark:bg-cyan-900/40',      text: 'text-cyan-700 dark:text-cyan-300',   ring: 'ring-cyan-300' },
  details_captured:     { bg: 'bg-teal-100 dark:bg-teal-900/40',      text: 'text-teal-700 dark:text-teal-300',   ring: 'ring-teal-300' },
  interview_scheduled:  { bg: 'bg-purple-100 dark:bg-purple-900/40',  text: 'text-purple-700 dark:text-purple-300', ring: 'ring-purple-300' },
  interviewing:         { bg: 'bg-violet-100 dark:bg-violet-900/40',  text: 'text-violet-700 dark:text-violet-300', ring: 'ring-violet-300' },
  decision_pending:     { bg: 'bg-amber-100 dark:bg-amber-900/40',    text: 'text-amber-700 dark:text-amber-300', ring: 'ring-amber-300' },
  offer:                { bg: 'bg-orange-100 dark:bg-orange-900/40',  text: 'text-orange-700 dark:text-orange-300', ring: 'ring-orange-300' },
  final:                { bg: 'bg-green-100 dark:bg-green-900/40',    text: 'text-green-700 dark:text-green-300', ring: 'ring-green-300' },
  hold:                 { bg: 'bg-yellow-100 dark:bg-yellow-900/40',  text: 'text-yellow-700 dark:text-yellow-300', ring: 'ring-yellow-300' },
  rejected:             { bg: 'bg-rose-100 dark:bg-rose-900/40',      text: 'text-rose-700 dark:text-rose-300',   ring: 'ring-rose-300' },
};
