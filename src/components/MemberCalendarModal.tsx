import { useMemo, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Clock } from 'lucide-react';

interface AttendanceRow {
  date: string;          // YYYY-MM-DD
  status: string;        // present | late | absent | weekend | leave_full | leave_half | wfh | wfh_half | …
  check_in?: string | null;
  check_out?: string | null;
  total_hours?: number | null;
}

interface LeaveRow {
  id: string;
  employee_id: string;
  type: string;
  from_date: string;
  to_date: string;
  days: number;
  reason?: string | null;
  status: string;          // pending | approved | rejected | cancelled
  manager_status?: string;
}

const DAYS_OF_WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isLeaveStatus(s: string | undefined): boolean {
  if (!s) return false;
  return s.startsWith('leave_') || s === 'leave';
}
function isWfhStatus(s: string | undefined): boolean {
  if (!s) return false;
  return s === 'wfh' || s === 'wfh_half';
}

function dayLabel(status: string | undefined): { label: string; cls: string; dotCls?: string } {
  if (!status) return { label: '', cls: '' };
  if (status === 'present') return { label: 'Present', cls: 'bg-success-container text-success', dotCls: 'bg-success' };
  if (status === 'late')    return { label: 'Late',    cls: 'bg-warning-container text-warning', dotCls: 'bg-warning' };
  if (status === 'absent')  return { label: 'Absent',  cls: 'bg-danger-container text-danger',   dotCls: 'bg-danger' };
  if (status === 'weekend') return { label: 'Weekend', cls: 'bg-surface-3 text-on-surface-subtle' };
  if (status === 'holiday') return { label: 'Holiday', cls: 'bg-accent-container text-accent' };
  if (isLeaveStatus(status)) return { label: status === 'leave_half' ? 'Half day leave' : 'Leave', cls: 'bg-brand-container text-brand', dotCls: 'bg-brand' };
  if (isWfhStatus(status))   return { label: status === 'wfh_half' ? 'Half day WFH' : 'WFH', cls: 'bg-accent-container/60 text-accent', dotCls: 'bg-accent' };
  return { label: status, cls: 'bg-surface-2 text-on-surface-muted' };
}

export default function MemberCalendarModal({ member, attendance, leaves, onClose }: {
  member: { id: string; name: string; designation?: string };
  attendance: AttendanceRow[];
  leaves: LeaveRow[];
  onClose: () => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState<{ m: number; y: number }>({ m: today.getMonth() + 1, y: today.getFullYear() });

  // Build a date → row map. Slice to first 10 chars to handle full-ISO timestamps.
  const byDate = useMemo(() => {
    const m = new Map<string, AttendanceRow>();
    for (const r of attendance) m.set((r.date ?? '').slice(0, 10), r);
    return m;
  }, [attendance]);

  // Pre-compute the set of dates that overlap an approved leave, so days
  // without an attendance row but inside a leave span still show as leave.
  const leaveDates = useMemo(() => {
    const out = new Map<string, LeaveRow>();
    for (const l of leaves) {
      if (l.status !== 'approved') continue;
      const from = new Date((l.from_date ?? '').slice(0, 10) + 'T00:00:00');
      const to = new Date((l.to_date ?? '').slice(0, 10) + 'T00:00:00');
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        out.set(d.toISOString().slice(0, 10), l);
      }
    }
    return out;
  }, [leaves]);

  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.y, cursor.m - 1, 1);
    const daysInMonth = new Date(cursor.y, cursor.m, 0).getDate();
    const startDay = firstOfMonth.getDay(); // 0 = Sunday
    const rows: Array<{ date: string; day: number } | null> = [];
    for (let i = 0; i < startDay; i++) rows.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${cursor.y}-${String(cursor.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      rows.push({ date, day: d });
    }
    while (rows.length % 7 !== 0) rows.push(null);
    return rows;
  }, [cursor]);

  const monthLeaves = useMemo(() => {
    const ym = `${cursor.y}-${String(cursor.m).padStart(2, '0')}`;
    return leaves.filter(l => {
      const f = (l.from_date ?? '').slice(0, 7);
      const t = (l.to_date ?? '').slice(0, 7);
      return f === ym || t === ym;
    });
  }, [leaves, cursor]);

  const counts = useMemo(() => {
    const ym = `${cursor.y}-${String(cursor.m).padStart(2, '0')}`;
    let present = 0, late = 0, absent = 0, leave = 0, wfh = 0, weekend = 0;
    for (const [date, row] of byDate.entries()) {
      if (!date.startsWith(ym)) continue;
      if (leaveDates.has(date) || isLeaveStatus(row.status)) leave++;
      else if (row.status === 'present') present++;
      else if (row.status === 'late') late++;
      else if (row.status === 'absent') absent++;
      else if (isWfhStatus(row.status)) wfh++;
      else if (row.status === 'weekend') weekend++;
    }
    return { present, late, absent, leave, wfh, weekend };
  }, [byDate, cursor, leaveDates]);

  const prevMonth = () => setCursor(({ m, y }) => m === 1 ? { m: 12, y: y - 1 } : { m: m - 1, y });
  const nextMonth = () => setCursor(({ m, y }) => m === 12 ? { m: 1, y: y + 1 } : { m: m + 1, y });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-brand-container/40 to-surface flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">{member.name}</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">{member.designation ?? 'Team member'} · monthly calendar</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors">
            <X size={18} className="text-on-surface-muted" />
          </button>
        </div>

        {/* Month navigation */}
        <div className="px-5 py-3 border-b border-outline flex items-center justify-between bg-surface-2/30">
          <button onClick={prevMonth} className="p-1.5 rounded hover:bg-surface-2 transition-colors">
            <ChevronLeft size={16} className="text-on-surface-muted" />
          </button>
          <p className="font-display text-base font-bold text-on-surface">{MONTHS[cursor.m - 1]} {cursor.y}</p>
          <button onClick={nextMonth} className="p-1.5 rounded hover:bg-surface-2 transition-colors">
            <ChevronRight size={16} className="text-on-surface-muted" />
          </button>
        </div>

        {/* Counts strip */}
        <div className="px-5 py-2.5 border-b border-outline grid grid-cols-3 sm:grid-cols-5 gap-2 text-xs">
          <CountChip label="Present" value={counts.present} cls="text-success" />
          <CountChip label="Late" value={counts.late} cls="text-warning" />
          <CountChip label="Leave" value={counts.leave} cls="text-brand" />
          <CountChip label="WFH" value={counts.wfh} cls="text-accent" />
          <CountChip label="Absent" value={counts.absent} cls="text-danger" />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1.5">
            {DAYS_OF_WEEK.map((d, i) => (
              <div key={i} className="text-center text-[10px] font-bold uppercase tracking-wide text-on-surface-subtle py-1">{d}</div>
            ))}
            {cells.map((c, i) => {
              if (!c) return <div key={i} className="aspect-square" />;
              const rec = byDate.get(c.date);
              const leaveRow = leaveDates.get(c.date);
              const status = leaveRow ? 'leave_full' : rec?.status;
              const info = dayLabel(status);
              const isToday = c.date === today.toISOString().slice(0, 10);
              return (
                <div key={i}
                  className={`aspect-square rounded-lg border ${info.cls || 'bg-surface-2/30 text-on-surface-muted'} ${isToday ? 'border-accent ring-2 ring-accent/30' : 'border-outline/40'} relative flex flex-col items-center justify-center p-1 transition-colors hover:shadow-elev-1`}
                  title={[
                    `${MONTHS[cursor.m-1]} ${c.day}`,
                    info.label,
                    rec?.check_in ? `Check-in: ${rec.check_in}` : null,
                    rec?.check_out ? `Check-out: ${rec.check_out}` : null,
                    leaveRow ? `Leave: ${leaveRow.type}${leaveRow.reason ? ` · ${leaveRow.reason}` : ''}` : null,
                  ].filter(Boolean).join(' · ')}>
                  <span className="num-mono text-xs font-bold">{c.day}</span>
                  {info.dotCls && <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${info.dotCls}`} />}
                  {rec?.check_in && !isLeaveStatus(rec.status) && !rec.status?.startsWith('leave') && (
                    <span className="text-[8px] num-mono opacity-80 mt-0.5">{rec.check_in?.slice(0, 5)}</span>
                  )}
                  {rec?.check_out && !isLeaveStatus(rec.status) && !rec.status?.startsWith('leave') && (
                    <span className="text-[8px] num-mono opacity-60">{rec.check_out?.slice(0, 5)}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Leave list this month */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle mb-2">Leaves this month</p>
            {monthLeaves.length === 0 ? (
              <p className="text-xs text-on-surface-subtle">No leaves scheduled.</p>
            ) : (
              <div className="space-y-1.5">
                {monthLeaves.map(l => {
                  const fromDate = (l.from_date ?? '').slice(0, 10);
                  const toDate = (l.to_date ?? '').slice(0, 10);
                  return (
                    <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface-2/30 border border-outline text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-on-surface capitalize">{l.type.replace(/_/g, ' ')}</p>
                        <p className="text-on-surface-muted num-mono">{fromDate}{fromDate !== toDate ? ` → ${toDate}` : ''} · {l.days} day{l.days === 1 ? '' : 's'}</p>
                        {l.reason && <p className="text-on-surface-subtle mt-0.5">{l.reason}</p>}
                      </div>
                      <StatusPill status={l.status} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-2.5 border-t border-outline bg-surface-2/30 text-[11px] text-on-surface-subtle inline-flex items-center gap-2">
          <Clock size={11} />
          Today highlighted with accent ring. Each working day shows check-in/check-out times below the date; hover for full details.
        </div>
      </div>
    </div>
  );
}

function CountChip({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-lg bg-surface-2/40 border border-outline px-2 py-1.5 text-center">
      <p className={`num-mono text-lg font-bold ${cls}`}>{value}</p>
      <p className="text-[10px] text-on-surface-muted">{label}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls = status === 'approved' ? 'bg-success-container text-success'
    : status === 'pending' ? 'bg-warning-container text-warning'
    : status === 'rejected' ? 'bg-danger-container text-danger'
    : 'bg-surface-3 text-on-surface-subtle';
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${cls}`}>{status}</span>;
}
