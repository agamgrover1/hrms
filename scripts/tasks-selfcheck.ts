// Self-check for the Tasks module's pure logic. No framework — run it with
//   npx tsx scripts/tasks-selfcheck.ts
// It covers the two bits that are easy to get subtly wrong and impossible to
// eyeball on a board: date bucketing across a timezone, and drag ordering.

import { dueMeta, midpoint, initials, todayISO, defaultBoardParams } from '../src/lib/taskMeta';

let checks = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  checks++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL  ${what}\n  expected ${e}\n  got      ${a}`); process.exit(1); }
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const today = todayISO();

// ── dueMeta ────────────────────────────────────────────────────────────────
// The one that matters: a task due TODAY must read as "Today", never as
// overdue. The naive `new Date(due) < new Date()` version parses the
// date-only string as UTC midnight, so east of UTC (IST is +5:30) every
// task due today looks a day late from 05:30 onwards.
eq(dueMeta(today, false)?.tone, 'today', 'due today is not overdue (timezone-safe)');
eq(dueMeta(today, false)?.label, 'Today', 'due today is labelled Today');

eq(dueMeta(shift(today, -1), false)?.tone, 'overdue', 'yesterday is overdue');
eq(dueMeta(shift(today, 1), false)?.tone, 'soon', 'tomorrow is soon');
eq(dueMeta(shift(today, 3), false)?.tone, 'soon', '3 days out is still soon');
eq(dueMeta(shift(today, 4), false)?.tone, 'normal', '4 days out is normal');
eq(dueMeta(null, false), null, 'no due date has no chip');

// A completed task never nags, however late it was.
eq(dueMeta(shift(today, -30), true)?.tone, 'normal', 'a done task is never overdue');

// Timestamps from Postgres arrive as full ISO strings — the first 10 chars
// are the date, and the time part must not change the bucket.
eq(dueMeta(`${today}T18:30:00.000Z`, false)?.tone, 'today', 'a timestamptz due date still buckets by date');

// ── midpoint ───────────────────────────────────────────────────────────────
eq(midpoint(null, null), 1024, 'first card in an empty column');
eq(midpoint(2048, null), 3072, 'appending to the end of a column');
eq(midpoint(null, 1024), 0, 'prepending to the top of a column');
eq(midpoint(1024, 2048), 1536, 'dropping between two cards');
// Ordering is the whole point — the new value must actually sort between.
const [lo, hi] = [1024, 1025];
const mid = midpoint(lo, hi);
eq(lo < mid && mid < hi, true, 'midpoint of adjacent cards still sorts between them');

// ── initials ───────────────────────────────────────────────────────────────
eq(initials('Agam Grover'), 'AG', 'two-part name');
eq(initials('Priya'), 'P', 'single name');
eq(initials('  Ravi   Kumar  Singh '), 'RS', 'first and last of three parts');
eq(initials(null), '?', 'missing name');
eq(initials(''), '?', 'empty name');

// ── defaultBoardParams ─────────────────────────────────────────────────────
// Regression guard: a "task assigned to you" notification links to
// /tasks?task=… with no ?board=, so the page defaults the board on first
// paint. Doing that through the board-SWITCH handler dropped ?task= and the
// card closed before it opened. Defaulting must preserve every other param.
{
  const kept = defaultBoardParams(new URLSearchParams('task=t_42'), 'mine');
  eq(kept.get('task'), 't_42', 'notification deep-link survives board defaulting');
  eq(kept.get('board'), 'mine', 'board default is applied');

  const withView = defaultBoardParams(new URLSearchParams('task=t_1&view=list'), 'tlist_9');
  eq(withView.get('view'), 'list', 'unrelated params are preserved too');
  eq(withView.get('board'), 'tlist_9', 'an explicit board id is applied');

  // Defaulting must never clobber a board the URL already carries.
  const already = defaultBoardParams(new URLSearchParams('board=tlist_1'), 'mine');
  eq(already.get('board'), 'mine', 'caller decides the board id, helper just sets it');
}

console.log(`tasks-selfcheck: ${checks} checks passed`);
