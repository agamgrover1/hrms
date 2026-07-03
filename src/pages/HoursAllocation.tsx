import { Fragment, useEffect, useMemo, useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Circle, Pencil, X, Layers, Building2 } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatWeekDays, isCurrentWeekOfMonth, isEmptyWeek } from '../utils/weekRange';

// Weekly billing allocation sheet — the direct HRMS replacement for the
// coordinator's Google Sheet. Rows = projects; grouped under the biller
// (Upwork ID holder OR a synthetic tracker tag like "Hubstaff"); columns
// W1..W5 with target vs actual per week and a Pending pill.

type Status = 'unset' | 'met' | 'partial' | 'missing';

interface WeekCell {
  week_num: number;
  target_hours: number;
  actual_hours: number;
  actual_computed: number;
  actual_override: number | null;
  pending: number;
  status: Status;
  notes: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

interface AllocRow {
  project_id: string;
  project_name: string;
  client_name: string | null;
  billing_account_id: string | null;
  billing_account_name: string | null;
  weeks: WeekCell[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SYNTHETIC_BILLERS = [
  { id: 'hubstaff', name: 'Hubstaff' },
  { id: 'direct',   name: 'Direct billing' },
];
const UNASSIGNED_KEY = '__unassigned__';

function fmtHM(hours: number): string {
  if (hours == null || Number.isNaN(hours)) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function statusPill(cell: WeekCell): { cls: string; label: string } {
  if (cell.status === 'unset') return { cls: 'bg-surface-3 text-on-surface-subtle', label: '—' };
  if (cell.status === 'met')     return { cls: 'bg-success/15 text-success border border-success/30',   label: fmtHM(cell.actual_hours) };
  if (cell.status === 'partial') return { cls: 'bg-warning/15 text-warning border border-warning/30',   label: fmtHM(cell.actual_hours) };
  return                          { cls: 'bg-danger/15 text-danger border border-danger/30',            label: fmtHM(cell.actual_hours) };
}

export default function HoursAllocation() {
  const { user } = useAuth();
  const role = user?.role;
  const canEdit = role === 'admin' || role === 'project_coordinator' || role === 'hr_manager';

  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [rows, setRows] = useState<AllocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<any[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{
    row: AllocRow; week: WeekCell;
    target: string; override: string; notes: string;
  } | null>(null);
  const [billingEdit, setBillingEdit] = useState<AllocRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getHoursAllocations(month, year)
      .then(d => setRows(d.rows))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.getEmployees().then(setEmployees).catch(() => {}); }, []);

  // Group rows by billing account. Preserve project name order within.
  const groups = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; rows: AllocRow[] }>();
    for (const r of rows) {
      const key = r.billing_account_id || UNASSIGNED_KEY;
      const label = r.billing_account_id
        ? (r.billing_account_name || r.billing_account_id)
        : 'Unassigned';
      if (!buckets.has(key)) buckets.set(key, { key, label, rows: [] });
      buckets.get(key)!.rows.push(r);
    }
    // Sort: employees alphabetically first, synthetic tags next, Unassigned last.
    return Array.from(buckets.values()).sort((a, b) => {
      if (a.key === UNASSIGNED_KEY) return 1;
      if (b.key === UNASSIGNED_KEY) return -1;
      const aSyn = SYNTHETIC_BILLERS.some(s => s.id === a.key);
      const bSyn = SYNTHETIC_BILLERS.some(s => s.id === b.key);
      if (aSyn !== bSyn) return aSyn ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
  }, [rows]);

  const groupTotals = (g: { rows: AllocRow[] }) => {
    const t = [0, 0, 0, 0, 0]; const a = [0, 0, 0, 0, 0];
    for (const r of g.rows) for (const w of r.weeks) {
      t[w.week_num - 1] += w.target_hours;
      a[w.week_num - 1] += w.actual_hours;
    }
    return { targets: t, actuals: a };
  };

  const openEdit = (row: AllocRow, week: WeekCell) => {
    if (!canEdit) return;
    setEditing({
      row, week,
      target: week.target_hours > 0 ? String(week.target_hours) : '',
      override: week.actual_override != null ? String(week.actual_override) : '',
      notes: week.notes || '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.saveHoursAllocation({
        project_id: editing.row.project_id,
        year, week_num: editing.week.week_num,
        target_hours: editing.target === '' ? 0 : Number(editing.target),
        actual_override: editing.override === '' ? null : Number(editing.override),
        notes: editing.notes || undefined,
      });
      setEditing(null);
      load();
    } finally { setSaving(false); }
  };

  const setBilling = async (billerId: string | null) => {
    if (!billingEdit) return;
    setSaving(true);
    try {
      await api.setProjectBillingAccount(billingEdit.project_id, billerId);
      setBillingEdit(null);
      load();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 p-6 max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-on-surface flex items-center gap-2">
            <Layers className="w-7 h-7 text-accent" />
            Hours Allocation
          </h1>
          <p className="text-on-surface-muted mt-1 text-sm">
            Weekly billing planner — set target hours per project, track against actuals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="px-3 py-2 bg-surface border border-outline rounded-lg text-sm text-on-surface">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-3 py-2 bg-surface border border-outline rounded-lg text-sm text-on-surface">
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-muted">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-success/40 border border-success/50" /> Met target</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-warning/40 border border-warning/50" /> Partial</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-danger/40 border border-danger/50" /> Missing / behind</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-surface-3 border border-outline" /> No target set</span>
        {canEdit && <span className="ml-auto text-on-surface-subtle">Click any cell to edit target / override actual.</span>}
      </div>

      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 border-b border-outline sticky top-0 z-10">
            <tr className="text-left text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
              <th className="px-3 py-3 min-w-[280px]">Project</th>
              {[1, 2, 3, 4, 5].map(w => {
                const empty = isEmptyWeek(month, year, w);
                const cur = isCurrentWeekOfMonth(month, year, w);
                return (
                  <th key={w} className={`px-3 py-3 text-center min-w-[130px] ${cur ? 'bg-accent/10' : ''}`}>
                    <div className="flex items-center justify-center gap-1">
                      <span>W{w}</span>
                      {cur && <span className="text-[10px] text-accent normal-case">(now)</span>}
                    </div>
                    <div className="text-[10px] text-on-surface-subtle mt-0.5 normal-case">
                      {empty ? '—' : formatWeekDays(month, year, w)}
                    </div>
                  </th>
                );
              })}
              <th className="px-3 py-3 text-center min-w-[100px]">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {loading && (
              <tr><td colSpan={7} className="py-12 text-center text-on-surface-muted">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-16 text-center text-on-surface-muted">
                  <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <div className="font-semibold text-on-surface">No projects</div>
                  <div className="text-xs mt-1">Add active projects to start planning weekly targets.</div>
                </td>
              </tr>
            )}
            {!loading && groups.map(g => {
              const isCollapsed = collapsed.has(g.key);
              const { targets, actuals } = groupTotals(g);
              return (
                <Fragment key={g.key}>
                  <tr className="bg-surface-2/60">
                    <td className="px-3 py-2">
                      <button
                        onClick={() => {
                          setCollapsed(cur => {
                            const nx = new Set(cur);
                            if (nx.has(g.key)) nx.delete(g.key); else nx.add(g.key);
                            return nx;
                          });
                        }}
                        className="flex items-center gap-2 font-semibold text-on-surface hover:text-accent">
                        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        <Building2 className="w-4 h-4 text-on-surface-muted" />
                        <span>{g.label}</span>
                        <span className="text-xs text-on-surface-subtle">({g.rows.length})</span>
                      </button>
                    </td>
                    {[0, 1, 2, 3, 4].map(i => (
                      <td key={i} className="px-3 py-2 text-center">
                        {targets[i] > 0 && (
                          <div className={`text-xs font-mono ${actuals[i] >= targets[i] ? 'text-success' : actuals[i] > 0 ? 'text-warning' : 'text-danger'}`}>
                            {fmtHM(actuals[i])}<span className="text-on-surface-subtle"> / {fmtHM(targets[i])}</span>
                          </div>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center font-mono text-xs">
                      {fmtHM(actuals.reduce((s, v) => s + v, 0))}
                      <span className="text-on-surface-subtle"> / {fmtHM(targets.reduce((s, v) => s + v, 0))}</span>
                    </td>
                  </tr>
                  {!isCollapsed && g.rows.map(r => {
                    const totalTarget = r.weeks.reduce((s, w) => s + w.target_hours, 0);
                    const totalActual = r.weeks.reduce((s, w) => s + w.actual_hours, 0);
                    return (
                      <tr key={r.project_id} className="hover:bg-surface-2/30">
                        <td className="px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-medium text-on-surface">{r.project_name}</div>
                              {r.client_name && <div className="text-xs text-on-surface-muted">{r.client_name}</div>}
                            </div>
                            {canEdit && (
                              <button
                                onClick={() => setBillingEdit(r)}
                                title="Change billing account"
                                className="opacity-0 group-hover:opacity-100 hover:opacity-100 text-on-surface-subtle hover:text-accent shrink-0">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        {r.weeks.map(w => {
                          const empty = isEmptyWeek(month, year, w.week_num);
                          const pill = statusPill(w);
                          return (
                            <td
                              key={w.week_num}
                              onClick={() => !empty && openEdit(r, w)}
                              className={`px-3 py-2 text-center ${!empty && canEdit ? 'cursor-pointer' : ''} ${empty ? 'bg-surface-2/40' : ''}`}>
                              {empty ? (
                                <span className="text-on-surface-subtle">—</span>
                              ) : (
                                <div className="space-y-0.5">
                                  <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono ${pill.cls}`}>
                                    {w.status === 'met' && <CheckCircle2 className="w-3 h-3" />}
                                    {w.status === 'missing' && <AlertTriangle className="w-3 h-3" />}
                                    {w.status === 'partial' && <Circle className="w-3 h-3" />}
                                    <span>{pill.label}</span>
                                  </div>
                                  {w.target_hours > 0 && (
                                    <div className="text-[10px] text-on-surface-subtle font-mono">
                                      / {fmtHM(w.target_hours)}
                                      {w.pending > 0 && <span className="text-danger ml-1">−{fmtHM(w.pending)}</span>}
                                    </div>
                                  )}
                                  {w.actual_override != null && (
                                    <div className="text-[9px] text-accent uppercase tracking-wider">override</div>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center font-mono text-xs text-on-surface-muted">
                          {totalTarget > 0
                            ? <>{fmtHM(totalActual)}<span className="text-on-surface-subtle"> / {fmtHM(totalTarget)}</span></>
                            : <span className="text-on-surface-subtle">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cell edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-3 max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-on-surface">{editing.row.project_name}</h3>
                <div className="text-xs text-on-surface-muted mt-0.5">
                  W{editing.week.week_num} · {formatWeekDays(month, year, editing.week.week_num)} {MONTHS[month - 1]} {year}
                </div>
              </div>
              <button onClick={() => setEditing(null)} className="text-on-surface-muted hover:text-on-surface">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-on-surface-muted uppercase tracking-wider">Target hours</label>
                <input type="number" step="0.25" min="0" value={editing.target}
                  onChange={e => setEditing({ ...editing, target: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-surface-2 border border-outline rounded-lg text-on-surface"
                  placeholder="0" autoFocus />
                <p className="text-[11px] text-on-surface-subtle mt-1">Weekly billing target. Set to 0 to clear.</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
                  Actual override <span className="text-on-surface-subtle normal-case">(optional)</span>
                </label>
                <input type="number" step="0.25" min="0" value={editing.override}
                  onChange={e => setEditing({ ...editing, override: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-surface-2 border border-outline rounded-lg text-on-surface"
                  placeholder={`Auto from hour logs: ${fmtHM(editing.week.actual_computed)}`} />
                <p className="text-[11px] text-on-surface-subtle mt-1">
                  Leave blank to use SUM of hour_logs ({fmtHM(editing.week.actual_computed)}).
                  Set only for Hubstaff / tracker-driven projects.
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-on-surface-muted uppercase tracking-wider">Notes</label>
                <input type="text" value={editing.notes}
                  onChange={e => setEditing({ ...editing, notes: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-surface-2 border border-outline rounded-lg text-on-surface"
                  placeholder="e.g. Retainer + extra scope" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-6">
              <button onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm text-on-surface-muted hover:text-on-surface">Cancel</button>
              <button onClick={saveEdit} disabled={saving}
                className="px-4 py-2 text-sm bg-accent text-on-accent rounded-lg font-semibold hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Billing account picker */}
      {billingEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setBillingEdit(null)}>
          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-3 max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-on-surface">Billing account</h3>
                <div className="text-xs text-on-surface-muted mt-0.5">{billingEdit.project_name}</div>
              </div>
              <button onClick={() => setBillingEdit(null)} className="text-on-surface-muted hover:text-on-surface">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-on-surface-muted mb-3">
              Who bills this project? Pick an employee (their Upwork ID) or a tracker.
            </p>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              <button
                onClick={() => setBilling(null)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2 text-on-surface-muted italic">
                — Unassigned —
              </button>
              <div className="text-[11px] font-semibold text-on-surface-subtle uppercase tracking-wider px-3 pt-3 pb-1">Trackers</div>
              {SYNTHETIC_BILLERS.map(s => (
                <button key={s.id} onClick={() => setBilling(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2 ${billingEdit.billing_account_id === s.id ? 'bg-accent/10 text-accent' : 'text-on-surface'}`}>
                  {s.name}
                </button>
              ))}
              <div className="text-[11px] font-semibold text-on-surface-subtle uppercase tracking-wider px-3 pt-3 pb-1">Employees</div>
              {employees
                .filter(e => e.status === 'active')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(emp => (
                  <button key={emp.id} onClick={() => setBilling(emp.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2 flex items-center justify-between ${billingEdit.billing_account_id === emp.id ? 'bg-accent/10 text-accent' : 'text-on-surface'}`}>
                    <span>{emp.name}</span>
                    <span className="text-[11px] text-on-surface-subtle">{emp.designation || ''}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
