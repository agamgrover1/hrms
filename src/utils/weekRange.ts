// Helpers for the W1..W5 column headers used across the hours grids.
//
// IMPORTANT: weeks are CALENDAR-MONTH-SCOPED and Mon-Sun aligned. The
// backend derives `week_num` from `log_date` using the same rule
// (api/index.ts `weekNumOfDate`).
//
//   W1 = day 1 of the month → first Sunday of the month (partial if
//        the month doesn't start on Sunday)
//   W2 = first Monday → its Sunday (always 7 days when fully inside
//        the month)
//   W3 / W4 = subsequent Mon-Sun spans
//   W5 = last Monday in the month → end of month. Absorbs any orphan
//        day at the tail when a Sat/Sun-start 31-day month would
//        otherwise produce a stray W6.
//
// Weeks never span months. Jan 29-31 belongs to Jan-W5; Feb 1 starts a
// fresh Feb-W1. Each month always has at most 5 buckets, matching the
// w1..w5 columns on project_assignments.
//
// Examples (June 2026 starts Mon, July 2026 starts Wed, Aug 2026 starts
// Sat):
//   Jun: W1 1-7, W2 8-14, W3 15-21, W4 22-28, W5 29-30
//   Jul: W1 1-5, W2 6-12, W3 13-19, W4 20-26, W5 27-31
//   Aug: W1 1-2, W2 3-9, W3 10-16, W4 17-23, W5 24-31 (8 days, absorbs
//        the orphan Aug 31)

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export interface WeekDateRange {
  startDay: number;
  endDay: number;
  /** True when the bucket has fewer than 7 days (W1/W5 stubs are common). */
  isStub: boolean;
  monthIndex: number; // 0..11
  year: number;
}

/** Day-of-month of the first Sunday in the given month. */
function firstSundayDayOf(month: number, year: number): number {
  const dow1 = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun..6=Sat
  return dow1 === 0 ? 1 : 8 - dow1;
}

/** Last day of the month. */
function lastDayOf(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/** Returns the calendar day range for a Mon-Sun-aligned week-of-month bucket. */
export function weekDateRange(month: number, year: number, weekNum: number): WeekDateRange {
  const lastDay = lastDayOf(month, year);
  const firstSundayDay = firstSundayDayOf(month, year);
  const w2Start = firstSundayDay + 1;

  let start: number;
  let end: number;
  if (weekNum === 1) {
    start = 1;
    end = firstSundayDay;
  } else if (weekNum === 2) {
    start = w2Start;
    end = w2Start + 6;
  } else if (weekNum === 3) {
    start = w2Start + 7;
    end = w2Start + 13;
  } else if (weekNum === 4) {
    start = w2Start + 14;
    end = w2Start + 20;
  } else {
    // W5 absorbs everything from the last Monday → end of month.
    // (Could be longer than 7 days when a Sat/Sun-start 31-day month
    // would otherwise overflow into a W6.)
    start = w2Start + 21;
    end = lastDay;
  }
  end = Math.min(end, lastDay);
  if (start > lastDay) {
    // Empty bucket — e.g., a month that fits in 4 weeks.
    return { startDay: start, endDay: start - 1, isStub: true, monthIndex: month - 1, year };
  }
  return {
    startDay: start,
    endDay: end,
    isStub: end - start + 1 < 7,
    monthIndex: month - 1,
    year,
  };
}

/** "1–7" / "27–31" — compact for inline use under W-headers. */
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

/** Compute the week-of-month bucket (1..5) for a YYYY-MM-DD date. */
export function weekNumForDate(iso: string): number {
  const d = new Date(iso + 'T12:00:00Z');
  const day = d.getUTCDate();
  const firstSundayDay = firstSundayDayOf(d.getUTCMonth() + 1, d.getUTCFullYear());
  if (day <= firstSundayDay) return 1;
  const w2Start = firstSundayDay + 1;
  if (day < w2Start + 7)  return 2;
  if (day < w2Start + 14) return 3;
  if (day < w2Start + 21) return 4;
  return 5;
}

/** True when this (month, year, week) is the bucket containing today. */
export function isCurrentWeekOfMonth(month: number, year: number, weekNum: number, now: Date = new Date()): boolean {
  if (now.getFullYear() !== year) return false;
  if (now.getMonth() + 1 !== month) return false;
  const today = `${year}-${String(month).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return weekNumForDate(today) === weekNum;
}

/** True when the week bucket has zero days (rare — e.g. month fits in 4 weeks). */
export function isEmptyWeek(month: number, year: number, weekNum: number): boolean {
  const r = weekDateRange(month, year, weekNum);
  return r.startDay > r.endDay;
}
