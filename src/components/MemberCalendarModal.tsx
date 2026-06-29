import { useEffect, useMemo, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { api } from '../services/api';
import AttendanceNoteModal from './AttendanceNoteModal';

interface AttendanceRow {
  date: string;          // YYYY-MM-DD
  status: string;        // present | late | absent | weekend | leave_full | leave_half | wfh | wfh_half | holiday | …
  check_in?: string | null;
  check_out?: string | null;
  total_hours?: number | null;
  holiday_name?: string | null;
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

export default function MemberCalendarModal({ member, attendance, leaves, onClose, currentUser }: {
  member: { id: string; name: string; designation?: string };
  attendance: AttendanceRow[];
  leaves: LeaveRow[];
  onClose: () => void;
  // Optional — when provided, day cells become clickable and the manager
  // can add a personal note for that date. Backend already permits anyone
  // up the reporting chain (canTouchAttendanceNote), so the affordance is
  // safe to expose to whoever opened this modal — the API call enforces.
  currentUser?: { name?: string | null; role?: string | null };
}) {
  const today = new Date();
  // Local YYYY-MM-DD. toISOString() would shift IST late-night users back
  // a day (same root cause as the leave-bucket bug below).
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [cursor, setCursor] = useState<{ m: number; y: number }>({ m: today.getMonth() + 1, y: today.getFullYear() });
  // Attendance notes for the visible month. Loaded lazily on month change
  // so flipping back/forward doesn't refetch the entire history.
  const [notesByDate, setNotesByDate] = useState<Record<string, {
    note: string;
    author_name: string | null;
    author_role: string | null;
    updated_at: string;
    status?: string;
    approved_by_name?: string | null;
    rejection_reason?: string | null;
  }>>({});
  const [noteBusy, setNoteBusy] = useState<string | null>(null);
  const canActOnNotes = !!currentUser?.role && currentUser.role !== 'employee';
  const [editingNoteDate, setEditingNoteDate] = useState<string | null>(null);
  useEffect(() => {
    if (!member.id) return;
    api.getAttendanceNotes(member.id, cursor.m, cursor.y)
      .then(rows => {
        const byDate: Record<string, any> = {};
        (rows as any[]).forEach(n => { byDate[n.date] = n; });
        setNotesByDate(byDate);
      })
      .catch(() => setNotesByDate({}));
  }, [member.id, cursor.m, cursor.y]);

  // Build a date → row map. Slice to first 10 chars to handle full-ISO timestamps.
  const byDate = useMemo(() => {
    const m = new Map<string, AttendanceRow>();
    for (const r of attendance) m.set((r.date ?? '').slice(0, 10), r);
    return m;
  }, [attendance]);

  // Pre-compute the set of dates that overlap an approved leave, so days
  // without an attendance row but inside a leave span still show as leave.
  //
  // PREVIOUSLY: built `new Date('YYYY-MM-DD' + 'T00:00:00')` and walked it
  // with toISOString().slice(0,10). That round-trip is timezone-poisoned:
  // the Date constructor reads the string as LOCAL midnight, then
  // toISOString() converts to UTC, so in IST (UTC+5:30) the date silently
  // shifts back one day — Jun 26 local → Jun 25 UTC. Result: a Jun 26
  // leave was keyed against Jun 25 in this map, and Jun 26 itself fell
  // through to the attendance row (showing "absent" instead of "leave").
  // Fix: iterate the date strings directly with no Date / TZ math.
  const leaveDates = useMemo(() => {
    const out = new Map<string, LeaveRow>();
    const addDayStr = (s: string): string => {
      const [y, m, d] = s.split('-').map(Number);
      // Construct with local components, read back with local components —
      // both ends stay in the same calendar so DST / TZ never enters.
      const next = new Date(y, m - 1, d + 1);
      return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    };
    for (const l of leaves) {
      if (l.status !== 'approved') continue;
      const from = (l.from_date ?? '').slice(0, 10);
      const to   = (l.to_date   ?? '').slice(0, 10);
      if (!from || !to || from > to) continue;
      for (let cur = from; cur <= to; cur = addDayStr(cur)) {
        out.set(cur, l);
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
              const isToday = c.date === todayStr;
              const note = notesByDate[c.date];
              const isFuture = c.date > todayStr;
              const clickable = !!currentUser && !isFuture;
              return (
                <button key={i} type="button"
                  disabled={!clickable}
                  onClick={() => clickable && setEditingNoteDate(c.date)}
                  className={`aspect-square rounded-lg border ${info.cls || 'bg-surface-2/30 text-on-surface-muted'} ${isToday ? 'border-accent ring-2 ring-accent/30' : 'border-outline/40'} relative flex flex-col items-center justify-center p-1 transition-all ${clickable ? 'cursor-pointer hover:shadow-elev-1 hover:scale-[1.02]' : 'cursor-default'}`}
                  title={[
                    `${MONTHS[cursor.m-1]} ${c.day}`,
                    rec?.holiday_name ? `Holiday: ${rec.holiday_name}` : info.label,
                    rec?.check_in ? `Check-in: ${rec.check_in}` : null,
                    rec?.check_out ? `Check-out: ${rec.check_out}` : null,
                    leaveRow ? `Leave: ${leaveRow.type}${leaveRow.reason ? ` · ${leaveRow.reason}` : ''}` : null,
                    note ? `Note: ${note.note}` : (clickable ? 'Click to add a note' : null),
                  ].filter(Boolean).join(' · ')}>
                  <span className="num-mono text-xs font-bold">{c.day}</span>
                  {info.dotCls && <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${info.dotCls}`} />}
                  {rec?.check_in && !isLeaveStatus(rec.status) && !rec.status?.startsWith('leave') && (
                    <span className="text-[8px] num-mono opacity-80 mt-0.5">{rec.check_in?.slice(0, 5)}</span>
                  )}
                  {rec?.check_out && !isLeaveStatus(rec.status) && !rec.status?.startsWith('leave') && (
                    <span className="text-[8px] num-mono opacity-60">{rec.check_out?.slice(0, 5)}</span>
                  )}
                  {/* Note indicator — small 📝 in the corner so the manager
                      can see at a glance which days have an existing note. */}
                  {note && (
                    <span className="absolute top-0.5 right-0.5 text-[9px] leading-none">📝</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Notes this month — shows pending notes first so managers/HR
              can action them inline. Approved/rejected notes are listed
              below for context. */}
          {Object.keys(notesByDate).length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle mb-2">Attendance notes this month</p>
              <div className="space-y-1.5">
                {Object.entries(notesByDate)
                  .sort(([a, na], [b, nb]) => {
                    // Pending first, then by date desc.
                    const sa = na.status ?? 'approved';
                    const sb = nb.status ?? 'approved';
                    if (sa === 'pending' && sb !== 'pending') return -1;
                    if (sb === 'pending' && sa !== 'pending') return 1;
                    return b.localeCompare(a);
                  })
                  .map(([date, n]) => {
                    const status = n.status ?? 'approved';
                    const isManagerAuthored = n.author_role && n.author_role !== 'employee';
                    const tone = status === 'pending'
                      ? 'border-warning/40 bg-warning-container/30'
                      : status === 'rejected'
                      ? 'border-danger/40 bg-danger-container/30'
                      : isManagerAuthored
                        ? 'border-accent/50 bg-accent/10 ring-1 ring-accent/30'
                        : 'bg-surface-2/30 border-outline';
                    const approve = async () => {
                      setNoteBusy(date);
                      try {
                        const row = await api.approveAttendanceNote({ employee_id: member.id, date });
                        setNotesByDate(prev => ({ ...prev, [date]: { ...prev[date], ...row } }));
                      } catch {/* swallow — list refetches on month change */}
                      finally { setNoteBusy(null); }
                    };
                    const reject = async () => {
                      const reason = window.prompt('Reason for rejection (the employee sees this):');
                      if (!reason?.trim()) return;
                      setNoteBusy(date);
                      try {
                        const row = await api.rejectAttendanceNote({ employee_id: member.id, date, rejection_reason: reason.trim() });
                        setNotesByDate(prev => ({ ...prev, [date]: { ...prev[date], ...row } }));
                      } catch {/* swallow */}
                      finally { setNoteBusy(null); }
                    };
                    return (
                      <div key={date} className={`px-3 py-2 rounded-lg border text-xs ${tone}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="num-mono text-on-surface-muted text-[10px]">
                            {new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' })}
                          </p>
                          {status === 'pending' && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning text-on-accent">⏳ Pending</span>
                          )}
                          {status === 'approved' && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-success text-on-accent">
                              ✓ {n.approved_by_name ? `by ${n.approved_by_name}` : 'Approved'}
                            </span>
                          )}
                          {status === 'rejected' && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-danger text-on-accent">✕ Rejected</span>
                          )}
                        </div>
                        {isManagerAuthored && (
                          <p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-0.5 inline-flex items-center gap-1">
                            🛡 Added by {n.author_role === 'hr_manager' ? 'HR' : n.author_role === 'admin' ? 'Admin' : 'Reporting Manager'}
                          </p>
                        )}
                        <p className="text-on-surface whitespace-pre-line">{n.note}</p>
                        <p className="text-[10px] text-on-surface-subtle mt-0.5">
                          — {n.author_name ?? 'Unknown'}{n.author_role ? ` (${n.author_role})` : ''}
                        </p>
                        {status === 'rejected' && n.rejection_reason && (
                          <p className="text-[10px] text-danger italic mt-1">"{n.rejection_reason}"</p>
                        )}
                        {status === 'pending' && canActOnNotes && (
                          <div className="flex gap-1.5 mt-2">
                            <button onClick={approve} disabled={noteBusy === date}
                              className="text-[10px] font-bold px-2 py-1 rounded bg-success text-on-accent hover:opacity-90 disabled:opacity-50">
                              ✓ Approve
                            </button>
                            <button onClick={reject} disabled={noteBusy === date}
                              className="text-[10px] font-bold px-2 py-1 rounded text-danger border border-danger/30 hover:bg-danger-container disabled:opacity-50">
                              ✕ Reject
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

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
          {currentUser
            ? <>Click any past day to add a personal note for {member.name.split(' ')[0]}. Days with notes show a 📝.</>
            : 'Today highlighted with accent ring. Each working day shows check-in/check-out times; hover for full details.'}
        </div>
      </div>

      {/* Note editor — opens when the manager clicks a day cell. After save
          we re-fetch the visible month's notes so the 📝 indicator shows up
          immediately without closing the calendar. */}
      {editingNoteDate && (
        <AttendanceNoteModal
          employeeId={member.id}
          date={editingNoteDate}
          existing={notesByDate[editingNoteDate]?.note ?? ''}
          authorName={currentUser?.name ?? null}
          authorRole={currentUser?.role ?? null}
          onClose={() => setEditingNoteDate(null)}
          onSaved={(noteText) => {
            setEditingNoteDate(null);
            // Optimistic local update — backend already persisted, but the
            // refetch on month change is the safety net if author info
            // doesn't match what the server stamped.
            if (!noteText) {
              setNotesByDate(prev => {
                const next = { ...prev };
                delete next[editingNoteDate];
                return next;
              });
            } else {
              setNotesByDate(prev => ({
                ...prev,
                [editingNoteDate]: {
                  note: noteText,
                  author_name: currentUser?.name ?? null,
                  author_role: currentUser?.role ?? null,
                  updated_at: new Date().toISOString(),
                },
              }));
            }
          }}
        />
      )}
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
