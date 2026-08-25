import type { TaskPriority, TaskStatus } from '../services/api';

// Shared vocabulary for the Tasks module. Kept out of the page component so
// the board, the detail modal and any future report agree on what "urgent"
// looks like and when something counts as overdue.

export const TASK_PRIORITIES: Array<{ id: TaskPriority; label: string; color: string }> = [
  { id: 'urgent', label: 'Urgent', color: '#ef4444' },
  { id: 'high',   label: 'High',   color: '#f59e0b' },
  { id: 'normal', label: 'Normal', color: '#60a5fa' },
  { id: 'low',    label: 'Low',    color: '#94a3b8' },
  { id: 'none',   label: 'None',   color: 'transparent' },
];

export const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> =
  Object.fromEntries(TASK_PRIORITIES.map(p => [p.id, { label: p.label, color: p.color }])) as any;

// Mirrors DEFAULT_TASK_STATUSES in api/index.ts — used to preview columns in
// the new-board form before the server has assigned any.
export const DEFAULT_STATUSES: TaskStatus[] = [
  { id: 'todo',        label: 'To do',       color: '#94a3b8', type: 'open'   },
  { id: 'in_progress', label: 'In progress', color: '#60a5fa', type: 'active' },
  { id: 'review',      label: 'In review',   color: '#c084fc', type: 'active' },
  { id: 'done',        label: 'Done',        color: '#34d399', type: 'done'   },
];

/**
 * Human-readable duration from a decimal-hours number. Rules:
 *   0                → "0m"
 *   < 1 minute       → "<1m"
 *   < 1 hour         → "45m"
 *   >= 1 hour, exact → "2h"
 *   >= 1 hour, partial → "1h 30m"
 * Rounds to the nearest minute, never surfaces "0.04h" style output.
 */
export function formatHoursHuman(h: number | string | null | undefined): string {
  const num = Number(h ?? 0);
  if (!Number.isFinite(num) || num <= 0) return '0m';
  const totalMin = Math.round(num * 60);
  if (totalMin < 1) return '<1m';
  const H = Math.floor(totalMin / 60);
  const M = totalMin % 60;
  if (H === 0) return `${M}m`;
  if (M === 0) return `${H}h`;
  return `${H}h ${M}m`;
}

/** Today in the browser's local date, as YYYY-MM-DD — same basis the date inputs use. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * How a due date should read on a card. Compared as YYYY-MM-DD strings so a
 * date-only value is never shifted a day by a timezone conversion — the bug
 * you get from `new Date('2026-08-24') < new Date()` east of UTC.
 */
export function dueMeta(due: string | null, done: boolean): { label: string; tone: 'overdue' | 'today' | 'soon' | 'normal' } | null {
  if (!due) return null;
  const d = due.slice(0, 10);
  const today = todayISO();
  const fmt = new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (done) return { label: fmt, tone: 'normal' };
  if (d < today) return { label: `${fmt} · overdue`, tone: 'overdue' };
  if (d === today) return { label: 'Today', tone: 'today' };
  const soon = new Date(`${today}T00:00:00`);
  soon.setDate(soon.getDate() + 3);
  return { label: fmt, tone: d <= todayISOOf(soon) ? 'soon' : 'normal' };
}

function todayISOOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const DUE_TONE_CLASS: Record<'overdue' | 'today' | 'soon' | 'normal', string> = {
  overdue: 'bg-danger/15 text-danger',
  today:   'bg-warning/20 text-warning',
  soon:    'bg-surface-3 text-on-surface-muted',
  normal:  'bg-surface-3 text-on-surface-subtle',
};

/**
 * sort_order for a card dropped between `before` and `after` in a column.
 * Midpoint insertion, so one drag is one UPDATE instead of renumbering the
 * whole column. Gaps halve on each insert at the same spot; at ~50 repeated
 * drops into the identical gap the float runs out of room, which is why the
 * server hands out 1024-wide gaps to begin with.
 */
export function midpoint(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1024;
  if (before === null) return (after as number) - 1024;
  if (after === null) return before + 1024;
  return (before + after) / 2;
}

/**
 * URL params for first-paint board defaulting.
 *
 * Copies every existing param and only adds `board`. The one that matters is
 * `task`: a "task assigned to you" notification deep-links to `/tasks?task=…`
 * with no board, so anything that drops params here closes the card before
 * the modal can show it. The board-SWITCH handler clears `task` on purpose —
 * this is not that.
 */
export function defaultBoardParams(current: URLSearchParams, boardId: string): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set('board', boardId);
  return next;
}

/** Two-letter initials for the assignee bubble. */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
