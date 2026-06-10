import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';

// Compact month/year picker used by the Pulse views. Default is "current
// month" (which the API treats as the live month-to-date). Arrows step
// back/forward one month at a time. A "Today" button jumps back to current.

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function isCurrentMonth(month: number, year: number) {
  const now = new Date();
  return month === now.getUTCMonth() + 1 && year === now.getUTCFullYear();
}

export function monthLabel(month: number, year: number, opts?: { withYear?: boolean }) {
  return `${MONTHS[month - 1]}${opts?.withYear === false ? '' : ` ${year}`}`;
}

export default function MonthSelector({
  month, year, onChange, allowFuture = false,
}: {
  month: number;
  year: number;
  onChange: (month: number, year: number) => void;
  allowFuture?: boolean;
}) {
  const step = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    if (!allowFuture) {
      const now = new Date();
      if (y > now.getUTCFullYear() || (y === now.getUTCFullYear() && m > now.getUTCMonth() + 1)) return;
    }
    onChange(m, y);
  };
  const goCurrent = () => {
    const now = new Date();
    onChange(now.getUTCMonth() + 1, now.getUTCFullYear());
  };
  const cur = isCurrentMonth(month, year);
  const nextDisabled = !allowFuture && cur;

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-outline bg-surface px-1 py-0.5 shadow-elev-1">
      <button onClick={() => step(-1)}
        className="p-1.5 rounded-md hover:bg-surface-2 text-on-surface-muted">
        <ChevronLeft size={14} />
      </button>
      <button onClick={goCurrent}
        className={`min-w-[110px] text-center text-xs font-semibold px-2 py-1 rounded-md flex items-center justify-center gap-1.5 ${cur ? 'text-accent' : 'text-on-surface'} hover:bg-surface-2`}
        title="Jump to current month">
        <CalendarDays size={12} />
        {monthLabel(month, year)}
        {cur && <span className="text-[9px] uppercase tracking-wide opacity-70">live</span>}
      </button>
      <button onClick={() => step(1)} disabled={nextDisabled}
        className="p-1.5 rounded-md hover:bg-surface-2 text-on-surface-muted disabled:opacity-30 disabled:hover:bg-transparent">
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
