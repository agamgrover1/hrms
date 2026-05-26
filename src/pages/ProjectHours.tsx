import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, X, Search, Copy, ExternalLink, Flag, ClipboardCheck, LayoutGrid, Pencil, Users as UsersIcon, ChevronRight, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import EmployeeHoursDetailModal from '../components/EmployeeHoursDetailModal';

interface Assignment {
  id: string;
  project_id: string;
  employee_id: string;
  employee_name: string | null;
  month: number;
  year: number;
  monthly_hours: number;
  w1_hours: number;
  w2_hours: number;
  w3_hours: number;
  w4_hours: number;
  w5_hours: number;
  notes: string | null;
  project_name?: string;
  project_client_name?: string | null;
  project_type?: string | null;
  dashboard_url?: string | null;
  project_flag?: string | null;
  project_reporting_id?: string | null;
  project_reporting_name?: string | null;
  project_lead_name?: string | null;
}

interface SummaryEmployee {
  employee_id: string;
  employee_name: string;
  w1: number; w2: number; w3: number; w4: number; w5: number; monthly: number;
  variance_w1: number; variance_w2: number; variance_w3: number; variance_w4: number; variance_w5: number;
  logged_approved?: number;
  logged_pending?: number;
  logged_within_plan?: number;
  logged_over_plan?: number;
  over_plan_log_count?: number;
  w1_logged?: number; w2_logged?: number; w3_logged?: number; w4_logged?: number; w5_logged?: number;
  w1_over?: number;   w2_over?: number;   w3_over?: number;   w4_over?: number;   w5_over?: number;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEK_KEYS: Array<keyof Assignment> = ['w1_hours', 'w2_hours', 'w3_hours', 'w4_hours', 'w5_hours'];
const TARGET_WEEKLY = 35;

function varianceClass(weeklyAlloc: number) {
  // Color the allocation against the 35h target
  if (weeklyAlloc === 0) return 'text-on-surface-subtle';
  if (weeklyAlloc >= 33 && weeklyAlloc <= 37) return 'text-success bg-success-container';
  if ((weeklyAlloc >= 28 && weeklyAlloc <= 32) || (weeklyAlloc >= 38 && weeklyAlloc <= 40)) return 'text-warning bg-warning-container';
  return 'text-danger bg-danger-container';
}

function num(v: any) { return Number(v ?? 0); }

export default function ProjectHours() {
  const { user } = useAuth();
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [summary, setSummary] = useState<{
    employees: SummaryEmployee[];
    total_allocated: number;
    pending_review_count: number;
    total_logged_within_plan?: number;
    total_logged_over_plan?: number;
    over_plan_log_count?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [detail, setDetail] = useState<{ employeeId: string; employeeName: string; focusWeek?: number } | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [view, setView] = useState<'capacity' | 'plan' | 'mine'>('capacity');

  // Determine viewer's identity for the "Mine" tab — direct reports + projects they review
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!user?.employee_id_ref) return;
    api.getEmployees()
      .then(emps => {
        const found = (emps as any[]).find(e => e.employee_id === user.employee_id_ref);
        if (found) setMe({ id: found.id, name: found.name });
      })
      .catch(() => {});
  }, [user?.employee_id_ref]);

  const reportsTo = useMemo(() => {
    if (!me) return new Set<string>();
    return new Set((employees as any[]).filter(e => e.reporting_manager_id === me.id).map(e => e.id));
  }, [employees, me]);
  const myProjects = useMemo(() => {
    if (!me) return [] as any[];
    return (projects as any[]).filter(p => p.project_reporting_id === me.id);
  }, [projects, me]);
  const hasMine = (reportsTo.size > 0) || (myProjects.length > 0);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getProjectAssignments({ month, year }).then(d => setAssignments(d as Assignment[])).catch(() => {}),
      api.getProjects({ status: 'active' }).then(setProjects).catch(() => {}),
      api.getEmployees().then(setEmployees).catch(() => {}),
      api.getHoursSummary(month, year).then(s => setSummary(s)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    if (!term) return assignments;
    return assignments.filter(a =>
      (a.project_name ?? '').toLowerCase().includes(term) ||
      (a.employee_name ?? '').toLowerCase().includes(term) ||
      (a.project_reporting_name ?? '').toLowerCase().includes(term)
    );
  }, [assignments, search]);

  const updateCell = async (a: Assignment, key: keyof Assignment, value: number) => {
    setSavingCell(`${a.id}_${key}`);
    const updated = { ...a, [key]: value };
    const sum = num(updated.w1_hours) + num(updated.w2_hours) + num(updated.w3_hours) + num(updated.w4_hours) + num(updated.w5_hours);
    updated.monthly_hours = sum;
    setAssignments(prev => prev.map(p => p.id === a.id ? updated : p));
    try {
      await api.updateProjectAssignment(a.id, {
        w1_hours: num(updated.w1_hours),
        w2_hours: num(updated.w2_hours),
        w3_hours: num(updated.w3_hours),
        w4_hours: num(updated.w4_hours),
        w5_hours: num(updated.w5_hours),
        notes: updated.notes ?? undefined,
      });
      // Refresh summary so right-rail recalculates
      api.getHoursSummary(month, year).then(s => setSummary(s)).catch(() => {});
    } catch {
      // best-effort: reload all
      load();
    } finally {
      setSavingCell(null);
    }
  };

  const handleDelete = async (a: Assignment) => {
    if (!confirm(`Remove assignment for ${a.employee_name} on ${a.project_name}?`)) return;
    await api.deleteProjectAssignment(a.id).catch(() => {});
    load();
  };

  const handleCopyPrev = async () => {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    if (!confirm(`Copy all assignments from ${MONTHS[prevMonth-1]} ${prevYear} into ${MONTHS[month-1]} ${year}? Hours will be blanked so you can refill them.`)) return;
    try {
      const res = await api.copyAssignmentsMonth({
        from_month: prevMonth, from_year: prevYear,
        to_month: month, to_year: year,
        blank_hours: true, created_by: user?.name,
      });
      alert(`Copied ${res.copied} assignments.`);
      load();
    } catch (err: any) {
      alert(err.message ?? 'Copy failed.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header / toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-surface rounded-lg border border-outline px-2 py-1">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="text-sm bg-transparent focus:outline-none px-1 py-1">
            {MONTHS.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="text-sm bg-transparent focus:outline-none px-1 py-1">
            {[year-1, year, year+1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter project, employee, reporting…"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface border border-outline rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <button onClick={handleCopyPrev}
          className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border border-outline bg-surface-2 text-on-surface hover:bg-surface-3 transition-colors">
          <Copy size={14} /> Copy from previous month
        </button>
        <button onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-accent text-on-accent">
          <Plus size={15} /> Add Assignment
        </button>
      </div>

      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryTile label="Allocated this month" value={`${summary.total_allocated} h`} blobClass="bg-brand/15" stagger={1} />
          <SummaryTile label="Pending review" value={String(summary.pending_review_count)} blobClass="bg-warning/20" stagger={2} accentClass={summary.pending_review_count > 0 ? 'text-danger' : undefined} />
          <SummaryTile
            label={Number(summary.total_logged_over_plan ?? 0) > 0 ? `Over plan · ${summary.over_plan_log_count ?? 0} logs` : 'Over plan'}
            value={`+${Math.round(Number(summary.total_logged_over_plan ?? 0))} h`}
            blobClass={Number(summary.total_logged_over_plan ?? 0) > 0 ? 'bg-danger/20' : 'bg-success/15'}
            stagger={3}
            accentClass={Number(summary.total_logged_over_plan ?? 0) > 0 ? 'text-warning' : 'text-on-surface-muted'}
          />
          <SummaryTile label="Employees on plan" value={String(summary.employees.length)} blobClass="bg-accent-container" stagger={4} />
        </div>
      )}

      {/* Tab bar */}
      <div className="inline-flex items-center gap-1 bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-1">
        <TabButton active={view === 'capacity'} onClick={() => setView('capacity')} icon={LayoutGrid} label="Capacity"
          sub="Who's working how much" />
        <TabButton active={view === 'plan'} onClick={() => setView('plan')} icon={Pencil} label="Plan"
          sub="Edit allocations" />
        {hasMine && (
          <TabButton active={view === 'mine'} onClick={() => setView('mine')} icon={UsersIcon} label="Mine"
            sub="My team & projects"
            badge={(reportsTo.size > 0 || myProjects.length > 0) ? (reportsTo.size + myProjects.length) : undefined} />
        )}
      </div>

      {/* ── Capacity view: full-width per-employee weekly table ─────────────── */}
      {view === 'capacity' && (
        <CapacityView
          summary={summary}
          loading={loading}
          search={search}
          month={month}
          year={year}
          openDetail={(employeeId, employeeName, focusWeek) =>
            setDetail({ employeeId, employeeName, focusWeek })
          }
        />
      )}

      {/* ── Plan view: inline-edit spreadsheet (the original grid, no rail) ── */}
      {view === 'plan' && (
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-b border-outline sticky top-0">
              <tr className="text-left text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
                <th className="px-3 py-3">Project</th>
                <th className="px-3 py-3">Employee</th>
                <th className="px-3 py-3">Reporting</th>
                <th className="px-3 py-3 text-center bg-surface-3">M</th>
                <th className="px-3 py-3 text-center">W1</th>
                <th className="px-3 py-3 text-center">W2</th>
                <th className="px-3 py-3 text-center">W3</th>
                <th className="px-3 py-3 text-center">W4</th>
                <th className="px-3 py-3 text-center">W5</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline">
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-on-surface-subtle">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-12 text-center">
                  <ClipboardCheck size={28} className="mx-auto text-on-surface-subtle mb-2" />
                  <p className="text-sm text-on-surface-muted">No assignments for {MONTHS[month-1]} {year}.</p>
                  <p className="text-xs text-on-surface-subtle mt-0.5">Use "Add Assignment" or "Copy from previous month".</p>
                </td></tr>
              ) : filtered.map(a => {
                const flagBg = a.project_flag === 'red' ? 'rgb(var(--danger-container) / 0.4)' : a.project_flag === 'yellow' ? 'rgb(var(--warning-container) / 0.4)' : 'transparent';
                return (
                  <tr key={a.id} style={{ background: flagBg }}>
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        {a.project_flag && (
                          <Flag size={12} className={`mt-0.5 ${a.project_flag === 'red' ? 'text-danger' : 'text-warning'}`} />
                        )}
                        <div>
                          <p className="font-medium text-on-surface leading-tight">{a.project_name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {a.project_client_name && <span className="text-[11px] text-on-surface-muted">{a.project_client_name}</span>}
                            {a.dashboard_url && (
                              <a href={a.dashboard_url} target="_blank" rel="noopener noreferrer"
                                className="text-[11px] text-brand hover:underline inline-flex items-center gap-0.5">
                                <ExternalLink size={9} />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-on-surface-muted">{a.employee_name}</td>
                    <td className="px-3 py-2 text-on-surface-muted text-xs">{a.project_reporting_name ?? '—'}</td>
                    <td className="px-3 py-2 text-center font-semibold text-on-surface bg-surface-2">
                      <span className="num-mono">{num(a.monthly_hours)}</span>
                    </td>
                    {WEEK_KEYS.map(k => (
                      <HoursCell key={k}
                        value={num(a[k])}
                        saving={savingCell === `${a.id}_${k}`}
                        onCommit={v => updateCell(a, k, v)}
                      />
                    ))}
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => handleDelete(a)} className="p-1.5 rounded hover:bg-danger-container" title="Delete">
                        <Trash2 size={13} className="text-danger" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-outline bg-surface-2 text-[11px] text-on-surface-muted">
            Click any W cell to edit. The month total updates automatically. To compare with what was actually logged, switch to the Capacity tab.
          </div>
        </div>
      )}

      {/* ── Mine view: people who report to me + projects I review ─────────── */}
      {view === 'mine' && me && (
        <MineView
          summary={summary}
          assignments={assignments}
          myProjects={myProjects}
          reportsToIds={reportsTo}
          loading={loading}
          month={month}
          year={year}
          openDetail={(employeeId, employeeName, focusWeek) =>
            setDetail({ employeeId, employeeName, focusWeek })
          }
        />
      )}

      {showAdd && (
        <AssignmentForm
          projects={projects}
          employees={employees}
          month={month}
          year={year}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
          createdBy={user?.name}
        />
      )}

      {detail && (
        <EmployeeHoursDetailModal
          employeeId={detail.employeeId}
          employeeName={detail.employeeName}
          month={month}
          year={year}
          focusWeek={detail.focusWeek}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value, accentClass, blobClass, stagger }: { label: string; value: string; accentClass?: string; blobClass?: string; stagger?: number }) {
  return (
    <div className={`group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden animate-fade-up stagger-${stagger ?? 1}`}>
      <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full ${blobClass ?? 'bg-brand/15'} blur-2xl opacity-50`} />
      <div className="relative">
        <p className={`num-mono text-2xl font-bold ${accentClass ?? 'text-on-surface'}`}>{value}</p>
        <p className="text-xs text-on-surface-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function HoursCell({ value, saving, onCommit }: { value: number; saving: boolean; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    setEditing(false);
    const n = Number(draft);
    if (!Number.isNaN(n) && n !== value) onCommit(Math.max(0, n));
  };
  return (
    <td className={`px-1 py-1 text-center ${saving ? 'opacity-60' : ''}`}>
      {editing ? (
        <input
          autoFocus
          type="number"
          step="0.5"
          min="0"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setDraft(String(value)); } }}
          className="num-mono w-14 text-center text-sm border border-accent rounded px-1 py-1 focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={`num-mono w-14 px-2 py-1 rounded text-sm font-medium hover:bg-surface-2 ${value === 0 ? 'text-on-surface-subtle' : 'text-on-surface'}`}
        >
          {value}
        </button>
      )}
    </td>
  );
}

function AssignmentForm({
  projects, employees, month, year, onClose, onSaved, createdBy,
}: {
  projects: any[];
  employees: any[];
  month: number;
  year: number;
  onClose: () => void;
  onSaved: () => void;
  createdBy?: string;
}) {
  const [form, setForm] = useState({
    project_id: projects[0]?.id ?? '',
    employee_id: '',
    w1_hours: '0', w2_hours: '0', w3_hours: '0', w4_hours: '0', w5_hours: '0',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setF = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const total = num(form.w1_hours) + num(form.w2_hours) + num(form.w3_hours) + num(form.w4_hours) + num(form.w5_hours);

  const handleSave = async () => {
    if (!form.project_id || !form.employee_id) { setError('Project and employee are required.'); return; }
    setSaving(true);
    const emp = employees.find(e => e.id === form.employee_id);
    try {
      await api.createProjectAssignment({
        project_id: form.project_id,
        employee_id: form.employee_id,
        employee_name: emp?.name ?? null,
        month, year,
        w1_hours: num(form.w1_hours), w2_hours: num(form.w2_hours),
        w3_hours: num(form.w3_hours), w4_hours: num(form.w4_hours),
        w5_hours: num(form.w5_hours),
        notes: form.notes || undefined,
        created_by: createdBy,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">New Assignment · {MONTHS[month-1]} {year}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Project *</label>
            <select value={form.project_id} onChange={e => setF('project_id', e.target.value)}
              className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface">
              <option value="">— Select project —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.client_name ? ` (${p.client_name})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Employee *</label>
            <select value={form.employee_id} onChange={e => setF('employee_id', e.target.value)}
              className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface">
              <option value="">— Select employee —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Weekly hours</label>
            <div className="grid grid-cols-5 gap-2">
              {(['w1_hours','w2_hours','w3_hours','w4_hours','w5_hours'] as Array<keyof typeof form>).map((k, i) => (
                <div key={k}>
                  <p className="text-[10px] text-on-surface-subtle mb-1">W{i+1}</p>
                  <input
                    type="number" step="0.5" min="0"
                    value={form[k]} onChange={e => setF(k, e.target.value)}
                    className="num-mono w-full border border-outline rounded-lg px-2 py-2 text-sm text-center bg-surface"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-on-surface-muted mt-2">Monthly total: <span className="num-mono font-semibold text-on-surface">{total} h</span></p>
          </div>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Notes</label>
            <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={2}
              className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none" />
          </div>
          {error && <p className="text-sm text-danger bg-danger-container px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Assignment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab button ─────────────────────────────────────────────────────────────
function TabButton({ active, onClick, icon: Icon, label, sub, badge }: {
  active: boolean; onClick: () => void; icon: any; label: string; sub?: string; badge?: number;
}) {
  return (
    <button onClick={onClick}
      className={`relative flex items-center gap-2.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
        active ? 'bg-accent text-on-accent shadow-elev-1' : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-2'
      }`}>
      <Icon size={15} strokeWidth={2.25} />
      <span className="text-left leading-tight">
        <span className="block">{label}</span>
        {sub && <span className={`block text-[10px] font-normal mt-0.5 ${active ? 'text-on-accent/75' : 'text-on-surface-subtle'}`}>{sub}</span>}
      </span>
      {badge !== undefined && badge > 0 && (
        <span className={`num-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-on-accent text-accent' : 'bg-accent text-on-accent'}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ── Capacity view (full-width per-employee weekly) ─────────────────────────
function CapacityView({ summary, loading, search, month, year, openDetail }: {
  summary: any;
  loading: boolean;
  search: string;
  month: number;
  year: number;
  openDetail: (employeeId: string, employeeName: string, focusWeek?: number) => void;
}) {
  const rows = useMemo(() => {
    if (!summary) return [] as any[];
    const term = (search ?? '').trim().toLowerCase();
    if (!term) return summary.employees;
    return summary.employees.filter((e: any) => (e.employee_name ?? '').toLowerCase().includes(term));
  }, [summary, search]);

  if (loading) {
    return <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 py-16 text-center text-on-surface-subtle">Loading capacity…</div>;
  }
  if (!summary || rows.length === 0) {
    return (
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 py-16 text-center">
        <UsersIcon size={28} className="mx-auto text-on-surface-subtle mb-2" />
        <p className="text-sm text-on-surface-muted">No employees on plan for {MONTHS[month-1]} {year}.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-2 overflow-hidden">
      <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-brand-container/40 to-surface flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Per-employee capacity · {MONTHS[month-1]} {year}</h3>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Cells show <span className="font-semibold">plan + approved over-plan</span>. Click any cell to drill into the actual logs. Target: <span className="num-mono">{TARGET_WEEKLY}h</span>/week.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-on-surface-muted">
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-success" />33–37h band</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-warning" />28–32 / 38–40</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-danger" />outside</span>
          <span className="inline-flex items-center gap-1.5 text-warning"><AlertTriangle size={11} /> over plan</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 border-b border-outline">
            <tr className="text-left text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.16em]">
              <th className="px-5 py-3 sticky left-0 bg-surface-2">Employee</th>
              {['W1','W2','W3','W4','W5'].map(w => <th key={w} className="px-4 py-3 text-center min-w-[88px]">{w}</th>)}
              <th className="px-4 py-3 text-center bg-surface-3 min-w-[96px]">Month</th>
              <th className="px-4 py-3 text-center min-w-[88px]">Over plan</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {rows.map((e: any) => {
              const weekPlans = [e.w1, e.w2, e.w3, e.w4, e.w5];
              const weekOvers = [e.w1_over ?? 0, e.w2_over ?? 0, e.w3_over ?? 0, e.w4_over ?? 0, e.w5_over ?? 0];
              const weekLogged = [e.w1_logged ?? 0, e.w2_logged ?? 0, e.w3_logged ?? 0, e.w4_logged ?? 0, e.w5_logged ?? 0];
              const monthlyDisplay = Number(e.monthly) + Number(e.logged_over_plan ?? 0);
              return (
                <tr key={e.employee_id} className="hover:bg-surface-2/60 transition-colors">
                  <td className="px-5 py-3 font-semibold text-on-surface whitespace-nowrap sticky left-0 bg-surface hover:bg-surface-2/60">
                    <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                      className="text-left hover:text-accent transition-colors">
                      {e.employee_name || '—'}
                    </button>
                  </td>
                  {weekPlans.map((p: number, i: number) => {
                    const over = Number(weekOvers[i]);
                    const display = Number(p) + over;
                    const logged = Number(weekLogged[i]);
                    return (
                      <td key={i} className="px-2 py-2 text-center">
                        <button
                          onClick={() => openDetail(e.employee_id, e.employee_name || '—', i + 1)}
                          title={`Plan ${p}h · Logged ${logged}h${over > 0 ? ` (+${over} over)` : ''}`}
                          className={`group num-mono inline-flex flex-col items-center justify-center w-full px-2 py-2 rounded-lg font-semibold transition-all ${
                            over > 0
                              ? 'bg-warning-container text-warning hover:shadow-elev-1 hover:scale-[1.04]'
                              : `${varianceClass(display)} hover:shadow-elev-1 hover:scale-[1.04]`
                          }`}
                        >
                          <span className="text-base leading-none">{display}</span>
                          {over > 0
                            ? <span className="text-[10px] font-bold mt-1 inline-flex items-center gap-0.5"><AlertTriangle size={9} />+{Math.round(over)}</span>
                            : logged > 0 && logged !== Number(p)
                              ? <span className="text-[10px] font-normal mt-1 opacity-70">{logged}/{p}</span>
                              : <span className="text-[10px] font-normal mt-1 opacity-0">·</span>
                          }
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-center bg-surface-2">
                    <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                      title={`Plan ${e.monthly}h${(e.logged_over_plan ?? 0) > 0 ? ` + ${Math.round(e.logged_over_plan ?? 0)}h over` : ''}`}
                      className={`num-mono inline-flex flex-col items-center justify-center w-full px-2 py-2 rounded-lg font-bold transition-all ${
                        (e.logged_over_plan ?? 0) > 0 ? 'text-warning hover:bg-warning-container hover:scale-[1.04]' : 'text-on-surface hover:bg-surface-3 hover:scale-[1.04]'
                      }`}>
                      <span className="text-lg leading-none">{monthlyDisplay}</span>
                      {(e.logged_over_plan ?? 0) > 0 && <span className="text-[10px] font-bold mt-1">+{Math.round(e.logged_over_plan ?? 0)}</span>}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {(e.logged_over_plan ?? 0) > 0 ? (
                      <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                        className="num-mono inline-flex items-center gap-1 font-bold text-warning bg-warning-container hover:opacity-80 px-2.5 py-1 rounded-full text-xs transition-opacity">
                        <AlertTriangle size={11} />+{Math.round(e.logged_over_plan ?? 0)}h
                        <span className="text-[9px] font-normal opacity-80">({e.over_plan_log_count ?? 0})</span>
                      </button>
                    ) : <span className="num-mono text-on-surface-subtle text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-on-surface-muted hover:text-accent transition-colors">
                      View <ChevronRight size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Mine view: my direct reports + projects I review ───────────────────────
function MineView({ summary, assignments, myProjects, reportsToIds, loading, month, year, openDetail }: {
  summary: any;
  assignments: any[];
  myProjects: any[];
  reportsToIds: Set<string>;
  loading: boolean;
  month: number;
  year: number;
  openDetail: (employeeId: string, employeeName: string, focusWeek?: number) => void;
}) {
  const teamRows = useMemo(() => {
    if (!summary) return [] as any[];
    if (reportsToIds.size === 0) return [] as any[];
    return summary.employees.filter((e: any) => reportsToIds.has(e.employee_id));
  }, [summary, reportsToIds]);

  // Aggregate per project: how many employees are assigned + their hours this month
  const projectStats = useMemo(() => {
    return myProjects.map(p => {
      const rows = assignments.filter(a => a.project_id === p.id);
      const totalPlanned = rows.reduce((s, a) => s + Number(a.monthly_hours || 0), 0);
      const employeeNames = Array.from(new Set(rows.map(a => a.employee_name).filter(Boolean)));
      return { project: p, totalPlanned, employees: employeeNames, rows };
    });
  }, [myProjects, assignments]);

  if (loading) {
    return <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 py-16 text-center text-on-surface-subtle">Loading…</div>;
  }

  const nothing = teamRows.length === 0 && projectStats.length === 0;
  if (nothing) {
    return (
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 py-16 text-center">
        <UsersIcon size={28} className="mx-auto text-on-surface-subtle mb-2" />
        <p className="text-sm text-on-surface-muted">Nothing under your responsibility this month.</p>
        <p className="text-xs text-on-surface-subtle mt-1">Once you're set as a Reporting person on a project or have direct reports, this view will populate.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* My direct reports' capacity */}
      {teamRows.length > 0 && (
        <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-2 overflow-hidden">
          <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-brand-container/40 to-surface">
            <h3 className="font-display text-lg font-bold tracking-tight text-on-surface">My team's capacity</h3>
            <p className="text-xs text-on-surface-muted mt-0.5"><span className="num-mono">{teamRows.length}</span> direct report{teamRows.length === 1 ? '' : 's'} · {MONTHS[month-1]} {year}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b border-outline">
                <tr className="text-left text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.16em]">
                  <th className="px-5 py-3">Employee</th>
                  {['W1','W2','W3','W4','W5'].map(w => <th key={w} className="px-3 py-3 text-center min-w-[72px]">{w}</th>)}
                  <th className="px-3 py-3 text-center bg-surface-3 min-w-[88px]">Month</th>
                  <th className="px-3 py-3 text-center min-w-[80px]">Over plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {teamRows.map((e: any) => {
                  const weekPlans = [e.w1, e.w2, e.w3, e.w4, e.w5];
                  const weekOvers = [e.w1_over ?? 0, e.w2_over ?? 0, e.w3_over ?? 0, e.w4_over ?? 0, e.w5_over ?? 0];
                  const monthlyDisplay = Number(e.monthly) + Number(e.logged_over_plan ?? 0);
                  return (
                    <tr key={e.employee_id} className="hover:bg-surface-2/60 transition-colors">
                      <td className="px-5 py-3 font-semibold text-on-surface">
                        <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')} className="hover:text-accent transition-colors">
                          {e.employee_name || '—'}
                        </button>
                      </td>
                      {weekPlans.map((p: number, i: number) => {
                        const over = Number(weekOvers[i]);
                        const display = Number(p) + over;
                        return (
                          <td key={i} className="px-2 py-2 text-center">
                            <button onClick={() => openDetail(e.employee_id, e.employee_name || '—', i + 1)}
                              className={`num-mono inline-flex items-center justify-center w-full px-2 py-1.5 rounded-md font-semibold transition-colors ${
                                over > 0 ? 'bg-warning-container text-warning' : varianceClass(display)
                              }`}>
                              {display}
                              {over > 0 && <span className="text-[9px] ml-0.5 font-bold">+{Math.round(over)}</span>}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-center bg-surface-2">
                        <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                          className={`num-mono inline-flex items-center justify-center w-full font-bold ${
                            (e.logged_over_plan ?? 0) > 0 ? 'text-warning' : 'text-on-surface'
                          }`}>
                          {monthlyDisplay}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-center">
                        {(e.logged_over_plan ?? 0) > 0 ? (
                          <span className="num-mono inline-flex items-center gap-1 font-bold text-warning bg-warning-container px-2 py-0.5 rounded-full text-xs">
                            <AlertTriangle size={10} />+{Math.round(e.logged_over_plan ?? 0)}h
                          </span>
                        ) : <span className="num-mono text-on-surface-subtle text-xs">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Projects I review */}
      {projectStats.length > 0 && (
        <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-2 overflow-hidden">
          <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-accent-container/40 to-surface flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-display text-lg font-bold tracking-tight text-on-surface">Projects I review</h3>
              <p className="text-xs text-on-surface-muted mt-0.5">You're the reporting person for <span className="num-mono">{projectStats.length}</span> project{projectStats.length === 1 ? '' : 's'} this month.</p>
            </div>
            <Link to="/hours/approvals" className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:opacity-90 transition-opacity">
              <ClipboardCheck size={14} /> Open approval queue
            </Link>
          </div>
          <div className="divide-y divide-outline">
            {projectStats.map(({ project, totalPlanned, employees: empNames, rows }: any) => (
              <div key={project.id} className="px-5 py-4 hover:bg-surface-2/40 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-display text-base font-bold text-on-surface tracking-tight">{project.name}</p>
                      {project.flag && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${project.flag === 'red' ? 'bg-danger-container text-danger' : 'bg-warning-container text-warning'}`}>
                          <Flag size={10} />{project.flag === 'red' ? 'At risk' : 'Watch'}
                        </span>
                      )}
                    </div>
                    {project.client_name && <p className="text-xs text-on-surface-muted mt-0.5">{project.client_name}</p>}
                    <p className="text-xs text-on-surface-subtle mt-2">
                      {empNames.length > 0
                        ? <>{empNames.length} on plan: <span className="text-on-surface">{empNames.slice(0,4).join(', ')}{empNames.length > 4 ? ` +${empNames.length - 4}` : ''}</span></>
                        : 'No one assigned yet this month'}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Planned</p>
                    <p className="num-mono text-xl font-bold text-on-surface mt-0.5">{totalPlanned}<span className="text-xs text-on-surface-muted ml-0.5">h</span></p>
                    <p className="text-[10px] text-on-surface-subtle mt-0.5">{rows.length} assignment{rows.length === 1 ? '' : 's'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
