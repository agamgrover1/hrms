import { useMemo, useState } from 'react';

interface Day {
  dateStr: string; // YYYY-MM-DD
  present: number;
  total: number;
  ratio: number; // 0..1
  inFuture: boolean;
}

interface Props {
  /** Records with dateStr + status (status === 'present' | 'late' counts as present). */
  records: Array<{ dateStr: string; status: string }>;
  /** Active employee count used as the denominator for daily attendance %. */
  activeEmployees: number;
  /** Total cells to render (default 35 = 7 weeks). */
  days?: number;
}

const WEEK_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function fmtLong(iso: string) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function colorFor(ratio: number, inFuture: boolean): { bg: string; border?: string } {
  if (inFuture) return { bg: 'rgb(var(--outline) / 0.35)' };
  if (ratio === 0) return { bg: 'rgb(var(--outline) / 0.55)' };
  // Brand gradient: low = warning, mid = accent-soft, high = success/brand
  if (ratio < 0.4)  return { bg: 'rgb(var(--warning) / 0.65)' };
  if (ratio < 0.7)  return { bg: 'rgb(var(--accent) / 0.55)' };
  if (ratio < 0.9)  return { bg: 'rgb(var(--accent) / 0.80)' };
  return                  { bg: 'rgb(var(--success) / 0.85)' };
}

/**
 * Last `days` days laid out as a 7-row × N-col grid (rows = Mon..Sun, oldest left → newest right).
 * Like a GitHub-style contribution heatmap but tuned for attendance %.
 */
export default function AttendanceHeatmap({ records, activeEmployees, days = 35 }: Props) {
  const [hover, setHover] = useState<Day | null>(null);

  const grid = useMemo(() => {
    // Build the rolling window of N days ending today
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const arr: Day[] = [];
    const presentByDate = new Map<string, number>();
    for (const r of records) {
      if (r.status === 'present' || r.status === 'late') {
        presentByDate.set(r.dateStr, (presentByDate.get(r.dateStr) ?? 0) + 1);
      }
    }
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const present = presentByDate.get(iso) ?? 0;
      const total = activeEmployees;
      const ratio = total > 0 ? Math.min(present / total, 1) : 0;
      arr.push({ dateStr: iso, present, total, ratio, inFuture: false });
    }
    return arr;
  }, [records, activeEmployees, days]);

  // Reshape into rows (weekday) × cols (week index). Mon = row 0.
  const rows: (Day | null)[][] = Array.from({ length: 7 }, () => []);
  const firstDate = new Date(grid[0].dateStr + 'T12:00:00Z');
  // 0=Sun..6=Sat → convert so Mon=0..Sun=6
  const firstWeekday = (firstDate.getDay() + 6) % 7;
  // Pad leading empties so weekday alignment is correct
  for (let p = 0; p < firstWeekday; p++) rows[p].push(null);
  for (const day of grid) {
    const dt = new Date(day.dateStr + 'T12:00:00Z');
    const wd = (dt.getDay() + 6) % 7;
    rows[wd].push(day);
  }
  // Pad trailing nulls so all rows are equal length
  const maxLen = Math.max(...rows.map(r => r.length));
  for (const r of rows) while (r.length < maxLen) r.push(null);

  // Summary metrics
  const realDays = grid.filter(d => d.total > 0);
  const avg = realDays.length ? Math.round(realDays.reduce((s, d) => s + d.ratio, 0) / realDays.length * 100) : 0;
  const bestDay = realDays.length ? realDays.reduce((a, b) => a.ratio > b.ratio ? a : b) : null;
  const worstDay = realDays.length ? realDays.reduce((a, b) => a.ratio < b.ratio ? a : b) : null;

  return (
    <div>
      {/* Header summary */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Avg rate</p>
            <p className="num-mono text-2xl font-semibold text-on-surface mt-0.5 leading-none">{avg}<span className="text-base text-on-surface-muted">%</span></p>
          </div>
          {bestDay && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Best day</p>
              <p className="num-mono text-2xl font-semibold text-success mt-0.5 leading-none">{Math.round(bestDay.ratio * 100)}%</p>
              <p className="text-[10px] text-on-surface-subtle mt-0.5">{fmtLong(bestDay.dateStr)}</p>
            </div>
          )}
          {worstDay && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Lowest</p>
              <p className="num-mono text-2xl font-semibold text-danger mt-0.5 leading-none">{Math.round(worstDay.ratio * 100)}%</p>
              <p className="text-[10px] text-on-surface-subtle mt-0.5">{fmtLong(worstDay.dateStr)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="relative">
        <div className="flex gap-2">
          {/* Weekday labels */}
          <div className="flex flex-col gap-1 pt-0.5 pr-1">
            {WEEK_LABELS.map((d, i) => (
              <div key={i} className="h-4 flex items-center text-[9px] font-bold text-on-surface-subtle font-mono tracking-tighter">{d}</div>
            ))}
          </div>
          {/* Cell grid */}
          <div className="flex-1 overflow-x-auto">
            <div className="flex flex-col gap-1">
              {rows.map((row, ri) => (
                <div key={ri} className="flex gap-1">
                  {row.map((day, ci) => (
                    <div
                      key={`${ri}-${ci}`}
                      className="heat-cell w-4 h-4 flex-shrink-0"
                      style={day ? colorFor(day.ratio, day.inFuture) : { background: 'transparent' }}
                      onMouseEnter={() => day && setHover(day)}
                      onMouseLeave={() => setHover(null)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-2 mt-4 text-[10px] font-semibold text-on-surface-subtle">
          <span>Less</span>
          {[0.2, 0.45, 0.65, 0.85, 0.97].map(r => (
            <span key={r} className="w-3 h-3 rounded heat-cell" style={colorFor(r, false)} />
          ))}
          <span>More</span>
        </div>

        {/* Hover info */}
        {hover && (
          <div className="absolute top-0 right-0 text-right">
            <p className="text-[11px] font-semibold text-on-surface">{fmtLong(hover.dateStr)}</p>
            <p className="text-xs text-on-surface-muted">
              <span className="num-mono font-semibold text-on-surface">{hover.present}</span>
              <span className="text-on-surface-subtle"> / {hover.total} present · </span>
              <span className="num-mono font-semibold">{Math.round(hover.ratio * 100)}%</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
