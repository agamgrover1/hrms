// Helpers for the W1..W5 column headers used across the hours grids.
//
// IMPORTANT: weeks are CALENDAR-MONTH-SCOPED, not ISO weeks. The backend
// derives `week_num` as `Math.ceil(dayOfMonth / 7)` (api/index.ts
// `weekNumOfDate`). That means:
//
//   W1 = days  1- 7
//   W2 = days  8-14
//   W3 = days 15-21
//   W4 = days 22-28
//   W5 = days 29-EOM (often a 1-3 day stub)
//
// Weeks never span months. Jan 29-31 is Jan-W5; Feb 1 starts a fresh
// Feb-W1. That's the rule the entire schema is keyed on
// (hour_logs(assignment_id, week_num) within month/year), so this util
// matches it exactly.

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export interface WeekDateRange {
  startDay: number;
  endDay: number;
  /** True when the bucket is shorter than 7 days (only ever happens for W5). */
  isStub: boolean;
  monthIndex: number; // 0..11
  year: number;
}

/** Returns the calendar day range for a week-of-month bucket. */
export function weekDateRange(month: number, year: number, weekNum: number): WeekDateRange {
  const lastDay = new Date(year, month, 0).getDate(); // day 0 of next month = last of this month
  const start = (weekNum - 1) * 7 + 1;
  const endRaw = weekNum * 7;
  const end = Math.min(endRaw, lastDay);
  return {
    startDay: start,
    endDay: end,
    isStub: end - start + 1 < 7,
    monthIndex: month - 1,
    year,
  };
}

/** "1–7" / "29–31" — compact for inline use under W-headers. */
export function formatWeekDays(month: number, year: number, weekNum: number): string {
  const r = weekDateRange(month, year, weekNum);
  if (r.startDay > r.endDay) return '—';
  if (r.startDay === r.endDay) return String(r.startDay);
  return `${r.startDay}–${r.endDay}`;
}

/** "Mar 1–7" — when the month context isn't already on the page. */
export function formatWeekDaysWithMonth(month: number, year: number, weekNum: number): string {
  const r = weekDateRange(month, year, weekNum);
  if (r.startDay > r.endDay) return '—';
  return `${MONTH_SHORT[r.monthIndex]} ${formatWeekDays(month, year, weekNum)}`;
}

/** True when this (month, year, week) is the bucket containing today. */
export function isCurrentWeekOfMonth(month: number, year: number, weekNum: number, now: Date = new Date()): boolean {
  if (now.getFullYear() !== year) return false;
  if (now.getMonth() + 1 !== month) return false;
  return Math.ceil(now.getDate() / 7) === weekNum;
}

/** True when the week bucket has zero days (W5 can be empty for short months). */
export function isEmptyWeek(month: number, year: number, weekNum: number): boolean {
  const r = weekDateRange(month, year, weekNum);
  return r.startDay > r.endDay;
}
