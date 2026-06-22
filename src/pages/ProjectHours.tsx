import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, X, Search, Copy, ExternalLink, Flag, ClipboardCheck, LayoutGrid, Pencil, Users as UsersIcon, ChevronRight, AlertTriangle, CalendarDays, ArrowUpDown, ChevronUp, ChevronDown, History, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatWeekDays, isCurrentWeekOfMonth, isEmptyWeek } from '../utils/weekRange';
import EmployeeHoursDetailModal from '../components/EmployeeHoursDetailModal';
import { ProjectDailyActivityModal } from './Projects';

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
  // Approved internal-activity hours per week + month total. Surfaces
  // a third sub-column next to Plan / Log on Capacity + Mine.
  w1_internal?: number; w2_internal?: number; w3_internal?: number; w4_internal?: number; w5_internal?: number;
  month_internal?: number;
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

function formatAgo(ts: string | null | undefined): string {
  if (!ts) return '';
  const ms = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

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
  // Sort state for the Plan view's main allocations table. Default: project
  // name ASC. Clicking a header cycles ASC → DESC. Switching columns picks
  // the natural starting direction (ASC for strings, DESC for hour totals
  // since "biggest first" is the useful first read).
  type PlanSortKey = 'project_name' | 'employee_name' | 'project_reporting_name' | 'monthly_hours' | 'w1_hours' | 'w2_hours' | 'w3_hours' | 'w4_hours' | 'w5_hours';
  const [planSort, setPlanSort] = useState<{ key: PlanSortKey; dir: 'asc' | 'desc' }>({ key: 'project_name', dir: 'asc' });
  const onPlanSort = (key: PlanSortKey) => {
    setPlanSort(prev => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      const stringKeys: PlanSortKey[] = ['project_name', 'employee_name', 'project_reporting_name'];
      return { key, dir: stringKeys.includes(key) ? 'asc' : 'desc' };
    });
  };
  const [showAdd, setShowAdd] = useState(false);
  const [detail, setDetail] = useState<{ employeeId: string; employeeName: string; focusWeek?: number } | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [view, setView] = useState<'capacity' | 'plan' | 'mine' | 'activity'>('capacity');

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

  // Descendants of `me` in the reporting tree — direct reports AND everyone who
  // reports up through them, recursively. A 2nd/3rd-level manager sees their
  // entire sub-tree, not just direct reports.
  const reportsTo = useMemo(() => {
    if (!me) return new Set<string>();
    const childrenByManager = new Map<string, string[]>();
    for (const e of employees as any[]) {
      if (!e.reporting_manager_id) continue;
      const arr = childrenByManager.get(e.reporting_manager_id);
      if (arr) arr.push(e.id); else childrenByManager.set(e.reporting_manager_id, [e.id]);
    }
    const seen = new Set<string>();
    const stack = [me.id];
    while (stack.length) {
      const next = stack.pop()!;
      for (const child of childrenByManager.get(next) ?? []) {
        if (seen.has(child)) continue; // guard against any accidental cycle
        seen.add(child);
        stack.push(child);
      }
    }
    return seen;
  }, [employees, me]);
  // Projects this user is responsible for — either as reviewer (approves hour logs)
  // or as the project lead. Both relationships count for the Mine view.
  const myProjects = useMemo(() => {
    if (!me) return [] as any[];
    return (projects as any[]).filter(p =>
      p.project_reporting_id === me.id || p.project_lead_id === me.id
    );
  }, [projects, me]);
  const hasMine = (reportsTo.size > 0) || (myProjects.length > 0);

  // Role gating. Admin / HR / project_coordinator see all three tabs;
  // anyone else (a plain employee who got here because they lead/review projects)
  // only sees the Mine tab — they shouldn't see capacity or plan for everyone.
  const role = user?.role ?? 'employee';
  const isAdminLike = role === 'admin' || role === 'hr_manager' || role === 'project_coordinator';

  // Reset to Mine when a non-admin viewer lands here.
  useEffect(() => {
    if (!isAdminLike) setView('mine');
  }, [isAdminLike]);

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

  // Sorted view of the Plan rows — string keys use localeCompare, numeric
  // keys (weekly + monthly hours) use straight numeric compare.
  const sortedPlan = useMemo(() => {
    const stringKeys: PlanSortKey[] = ['project_name', 'employee_name', 'project_reporting_name'];
    const copy = [...filtered];
    copy.sort((a: any, b: any) => {
      if (stringKeys.includes(planSort.key)) {
        return (a[planSort.key] ?? '').localeCompare(b[planSort.key] ?? '');
      }
      return Number(a[planSort.key] ?? 0) - Number(b[planSort.key] ?? 0);
    });
    return planSort.dir === 'desc' ? copy.reverse() : copy;
  }, [filtered, planSort]);

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

      {/* Summary strip — non-admin viewers (and admin/coord on the Mine tab)
          ALWAYS get scoped numbers. Only admin on Capacity / Plan tabs sees
          the org-wide totals. We default scoped path to zero while `me` is
          still resolving so users never see org-wide numbers leak through. */}
      {summary && (() => {
        const isAdminOrgView = isAdminLike && view !== 'mine';
        const shouldScope = !isAdminOrgView;  // everyone else gets scoped

        let allocated: number;
        let pendingCount: number;
        let overPlan: number;
        let overPlanLogs: number;
        let empCount: number;
        let scopeLabel = '';

        if (!shouldScope) {
          // Admin viewing Capacity / Plan — org-wide numbers.
          allocated    = Number(summary.total_allocated || 0);
          pendingCount = Number(summary.pending_review_count || 0);
          overPlan     = Number(summary.total_logged_over_plan || 0);
          overPlanLogs = Number(summary.over_plan_log_count || 0);
          empCount     = summary.employees.length;
        } else if (!me) {
          // Mine-scope path but `me` hasn't resolved yet — show zeros, not
          // org-wide. The page re-renders the moment `me` lands.
          allocated = 0; pendingCount = 0; overPlan = 0; overPlanLogs = 0; empCount = 0;
        } else {
          // Iterate over ASSIGNMENTS — each row is one employee's hours on
          // one project. An assignment is in-scope when:
          //   - the employee is the viewer themselves, OR
          //   - the employee reports to them (descendants), OR
          //   - the project is one they review or lead.
          // Summing assignment.monthly_hours gives the actual planned hours
          // FOR work this user has visibility into, not the full org-wide
          // monthly of every employee who happens to touch their project.
          const myProjectIds = new Set(myProjects.map(p => p.id));
          const visibleAssignments = assignments.filter((a: any) =>
            a.employee_id === me.id ||
            reportsTo.has(a.employee_id) ||
            myProjectIds.has(a.project_id)
          );
          allocated = visibleAssignments.reduce((s: number, a: any) => s + Number(a.monthly_hours || 0), 0);
          empCount = new Set(visibleAssignments.map((a: any) => a.employee_id)).size;

          // Pending / Over plan still rely on summary.employees (per-employee
          // totals across all of their work). For a reviewer's tile this is an
          // over-approximation — those employees may have pending logs on
          // OTHER projects too — but it's the best signal available without a
          // per-project pending breakdown from the server, and erring high is
          // better than missing real pending work.
          const visibleEmpIds = new Set(visibleAssignments.map((a: any) => a.employee_id));
          const scopedEmps = summary.employees.filter((e: any) => visibleEmpIds.has(e.employee_id));
          pendingCount = Math.round(scopedEmps.reduce((s: number, e: any) => s + Number(e.logged_pending || 0), 0));
          overPlan = scopedEmps.reduce((s: number, e: any) => s + Number(e.logged_over_plan || 0), 0);
          overPlanLogs = scopedEmps.reduce((s: number, e: any) => s + Number(e.over_plan_log_count || 0), 0);
        }

        if (shouldScope) {
          if (reportsTo.size > 0) scopeLabel = '· my team';
          else if (myProjects.length > 0) scopeLabel = '· my projects';
          else scopeLabel = '· me';
        }
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryTile
              label={shouldScope ? `Allocated ${scopeLabel}` : "Allocated this month"}
              value={`${allocated} h`} blobClass="bg-brand/15" stagger={1}
            />
            <SummaryTile
              label={shouldScope ? `Pending review ${scopeLabel}` : "Pending review"}
              value={shouldScope ? `${pendingCount} h` : String(pendingCount)}
              blobClass="bg-warning/20" stagger={2}
              accentClass={pendingCount > 0 ? 'text-danger' : undefined}
            />
            <SummaryTile
              label={overPlan > 0 ? `Over plan · ${overPlanLogs} logs` : 'Over plan'}
              value={`+${Math.round(overPlan)} h`}
              blobClass={overPlan > 0 ? 'bg-danger/20' : 'bg-success/15'}
              stagger={3}
              accentClass={overPlan > 0 ? 'text-warning' : 'text-on-surface-muted'}
            />
            <SummaryTile
              label={shouldScope ? `On plan ${scopeLabel}` : "Employees on plan"}
              value={String(empCount)} blobClass="bg-accent-container" stagger={4}
            />
          </div>
        );
      })()}

      {/* Tab bar — non-admin viewers (team leads who got here because they
          lead/review a project) only see the Mine tab. Capacity & Plan are
          for admin / HR / coordinator. */}
      <div className="inline-flex items-center gap-1 bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-1">
        {isAdminLike && (
          <TabButton active={view === 'capacity'} onClick={() => setView('capacity')} icon={LayoutGrid} label="Capacity"
            sub="Who's working how much" />
        )}
        {isAdminLike && (
          <TabButton active={view === 'plan'} onClick={() => setView('plan')} icon={Pencil} label="Plan"
            sub="Edit allocations" />
        )}
        {hasMine && (
          <TabButton active={view === 'mine'} onClick={() => setView('mine')} icon={UsersIcon} label="Mine"
            sub="My team & projects"
            badge={(reportsTo.size > 0 || myProjects.length > 0) ? (reportsTo.size + myProjects.length) : undefined} />
        )}
        {isAdminLike && (
          <TabButton active={view === 'activity'} onClick={() => setView('activity')} icon={History} label="Activity"
            sub="Who edited what" />
        )}
      </div>

      {/* ── Capacity view: full-width per-employee weekly table ─────────────── */}
      {view === 'capacity' && (
        <CapacityView
          summary={summary}
          employees={employees}
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
                <SortableTh label="Project"   sortKey="project_name"          current={planSort} onSort={onPlanSort} className="px-3 py-3" align="left" />
                <SortableTh label="Employee"  sortKey="employee_name"         current={planSort} onSort={onPlanSort} className="px-3 py-3" align="left" />
                <SortableTh label="Reporting" sortKey="project_reporting_name" current={planSort} onSort={onPlanSort} className="px-3 py-3" align="left" />
                <SortableTh label="M"         sortKey="monthly_hours"         current={planSort} onSort={onPlanSort} className="px-3 py-3 bg-surface-3" align="center" />
                {[1,2,3,4,5].map(w => {
                  const empty = isEmptyWeek(month, year, w);
                  const cur   = isCurrentWeekOfMonth(month, year, w);
                  const key   = (`w${w}_hours`) as PlanSortKey;
                  return (
                    <th key={w} className={`px-3 py-2 text-center select-none ${cur ? 'bg-accent/10' : ''}`}>
                      <button onClick={() => onPlanSort(key)}
                        className={`inline-flex items-center gap-1 w-full justify-center hover:text-on-surface transition-colors ${planSort.key === key ? 'text-accent' : ''} ${empty ? 'opacity-40' : ''}`}>
                        <div className="leading-tight">
                          <div className={`text-xs font-bold ${cur ? 'text-accent' : ''}`}>W{w}</div>
                          <div className={`text-[9px] font-normal normal-case tracking-normal ${cur ? 'text-accent' : 'text-on-surface-subtle'}`}>
                            {empty ? '—' : formatWeekDays(month, year, w)}
                          </div>
                        </div>
                        {planSort.key === key
                          ? (planSort.dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)
                          : <ArrowUpDown size={10} className="opacity-40" />}
                      </button>
                    </th>
                  );
                })}
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline">
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-on-surface-subtle">Loading…</td></tr>
              ) : sortedPlan.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-12 text-center">
                  <ClipboardCheck size={28} className="mx-auto text-on-surface-subtle mb-2" />
                  <p className="text-sm text-on-surface-muted">No assignments for {MONTHS[month-1]} {year}.</p>
                  <p className="text-xs text-on-surface-subtle mt-0.5">Use "Add Assignment" or "Copy from previous month".</p>
                </td></tr>
              ) : sortedPlan.map(a => {
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
          search={search}
          openDetail={(employeeId, employeeName, focusWeek) =>
            setDetail({ employeeId, employeeName, focusWeek })
          }
        />
      )}

      {/* ── Activity view: edit audit log ──────────────────────────────────── */}
      {view === 'activity' && isAdminLike && (
        <ActivityView month={month} year={year} search={search} />
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
              {(['w1_hours','w2_hours','w3_hours','w4_hours','w5_hours'] as Array<keyof typeof form>).map((k, i) => {
                const w = i + 1;
                const empty = isEmptyWeek(month, year, w);
                const cur   = isCurrentWeekOfMonth(month, year, w);
                return (
                  <div key={k} className={cur ? 'rounded-lg ring-2 ring-accent/30 p-0.5 -m-0.5' : ''}>
                    <p className={`text-[10px] mb-1 leading-tight ${cur ? 'text-accent font-semibold' : 'text-on-surface-subtle'} ${empty ? 'opacity-40' : ''}`}>
                      W{w}<span className="ml-1 font-normal">{empty ? '—' : formatWeekDays(month, year, w)}</span>
                    </p>
                    <input
                      type="number" step="0.5" min="0" disabled={empty}
                      value={form[k]} onChange={e => setF(k, e.target.value)}
                      className="num-mono w-full border border-outline rounded-lg px-2 py-2 text-sm text-center bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </div>
                );
              })}
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
// "Team" = reporting manager — that's how the org defines teams. We expose
// a single Team toggle (not separate Department/Manager options) so the
// concept stays consistent across screens.
type GroupKey = 'none' | 'manager';

function CapacityView({ summary, employees, loading, search, month, year, openDetail }: {
  summary: any;
  employees: any[];
  loading: boolean;
  search: string;
  month: number;
  year: number;
  openDetail: (employeeId: string, employeeName: string, focusWeek?: number) => void;
}) {
  const [groupBy, setGroupBy] = useState<GroupKey>('none');

  // Map employee_id → manager name (the reporting manager defines the team).
  const empMeta = useMemo(() => {
    const m = new Map<string, { manager: string }>();
    for (const e of employees || []) {
      const mgr = (employees || []).find((x: any) => x.id === e.reporting_manager_id);
      m.set(e.id, { manager: mgr?.name || e.manager || 'No manager' });
    }
    return m;
  }, [employees]);

  const rows = useMemo(() => {
    if (!summary) return [] as any[];
    const term = (search ?? '').trim().toLowerCase();
    const base = !term
      ? summary.employees
      : summary.employees.filter((e: any) => (e.employee_name ?? '').toLowerCase().includes(term));
    return base.map((e: any) => {
      const meta = empMeta.get(e.employee_id);
      return { ...e, _manager: meta?.manager || 'No manager' };
    });
  }, [summary, search, empMeta]);

  // Group rows by reporting manager (when Team is on). Returns
  // [{ name, rows, subtotalMonth, subtotalOver, headcount }, …]
  const groups = useMemo(() => {
    if (groupBy === 'none') {
      return [{ name: null as string | null, rows, subtotalMonth: 0, subtotalOver: 0, headcount: rows.length }];
    }
    const buckets = new Map<string, any[]>();
    for (const r of rows) {
      const k = r._manager || 'No manager';
      const arr = buckets.get(k);
      if (arr) arr.push(r); else buckets.set(k, [r]);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, arr]) => ({
        name,
        rows: arr,
        subtotalMonth: arr.reduce((s, r) => s + Number(r.monthly || 0) + Number(r.logged_over_plan || 0), 0),
        subtotalOver: arr.reduce((s, r) => s + Number(r.logged_over_plan || 0), 0),
        headcount: arr.length,
      }));
  }, [rows, groupBy]);

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
            Each week splits into <span className="font-semibold">Plan</span> (allocated) · <span className="font-semibold">Log</span> (approved project hours) · <span className="font-semibold text-accent">Int</span> (approved internal-activity hours — training, recruiting, admin etc.). Log is tinted <span className="text-success font-semibold">green</span> for match · <span className="text-warning font-semibold">amber</span> over-plan · <span className="text-danger font-semibold">red</span> short. Target: <span className="num-mono">{TARGET_WEEKLY}h</span>/week.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-on-surface-muted flex-wrap">
          {/* Group-by selector — Team = reporting manager. */}
          <div className="inline-flex items-center gap-1.5 bg-surface-2 border border-outline rounded-lg px-1 py-0.5">
            <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-on-surface-subtle pl-1.5">Group</span>
            {([
              { key: 'none', label: 'None' },
              { key: 'manager', label: 'Team' },
            ] as Array<{ key: GroupKey; label: string }>).map(opt => (
              <button key={opt.key} onClick={() => setGroupBy(opt.key)}
                title={opt.key === 'manager' ? 'Group by reporting manager' : undefined}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                  groupBy === opt.key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-3'
                }`}>{opt.label}</button>
            ))}
          </div>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-success" />33–37h band</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-warning" />28–32 / 38–40</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-danger" />outside</span>
          <span className="inline-flex items-center gap-1.5 text-warning"><AlertTriangle size={11} /> +over plan</span>
          <span className="inline-flex items-center gap-1.5 text-danger"><AlertTriangle size={11} /> −under plan</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 border-b border-outline">
            {/* Grouped header — each week (and Month) splits into Plan +
                Log + Int sub-columns. Plan = allocated. Log = approved
                project hours. Int = approved internal-activity hours
                (training, recruiting, admin, etc.) — kept separate so
                the project-hours read stays clean. */}
            <tr className="text-left text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.16em]">
              <th rowSpan={2} className="px-5 py-3 sticky left-0 bg-surface-2 align-bottom">Employee</th>
              {[1,2,3,4,5].map(w => {
                const empty = isEmptyWeek(month, year, w);
                const cur   = isCurrentWeekOfMonth(month, year, w);
                return (
                  <th key={w} colSpan={3}
                      className={`px-3 py-2 text-center border-l border-outline ${cur ? 'bg-accent/10' : ''} ${empty ? 'opacity-40' : ''}`}>
                    <div className={`${cur ? 'text-accent' : ''}`}>W{w}</div>
                    <div className={`text-[9px] font-normal normal-case tracking-normal ${cur ? 'text-accent' : 'text-on-surface-subtle'}`}>
                      {empty ? '—' : formatWeekDays(month, year, w)}
                    </div>
                  </th>
                );
              })}
              <th colSpan={3} className="px-3 py-2 text-center bg-surface-3 border-l border-outline">Month</th>
              <th rowSpan={2} className="px-3 py-3 text-center min-w-[88px] align-bottom border-l border-outline">Over plan</th>
              <th rowSpan={2} className="px-3 py-3"></th>
            </tr>
            <tr className="text-[9px] font-semibold text-on-surface-subtle uppercase tracking-wider">
              {['W1','W2','W3','W4','W5'].map(w => (
                <Fragment key={w}>
                  <th className="px-1 py-1.5 text-center min-w-[44px] border-l border-outline">Plan</th>
                  <th className="px-1 py-1.5 text-center min-w-[48px]">Log</th>
                  <th className="px-1 py-1.5 text-center min-w-[44px]" title="Approved internal-activity hours">Int</th>
                </Fragment>
              ))}
              <th className="px-1 py-1.5 text-center min-w-[48px] bg-surface-3 border-l border-outline">Plan</th>
              <th className="px-1 py-1.5 text-center min-w-[52px] bg-surface-3">Log</th>
              <th className="px-1 py-1.5 text-center min-w-[48px] bg-surface-3" title="Approved internal-activity hours">Int</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {groups.map((g) => (
              <Fragment key={g.name ?? '__all__'}>
                {g.name !== null && (
                  <tr className="bg-gradient-to-r from-brand-container/50 to-transparent border-y-2 border-outline-strong">
                    <td className="px-5 py-2.5 sticky left-0 bg-gradient-to-r from-brand-container/80 to-brand-container/40">
                      <div className="flex items-center gap-2">
                        <UsersIcon size={13} className="text-brand" />
                        <span className="font-display text-sm font-bold text-on-surface">{g.name}</span>
                        <span className="num-mono text-[10px] font-semibold text-on-surface-muted bg-surface px-1.5 py-0.5 rounded-full">{g.headcount}</span>
                      </div>
                    </td>
                    <td colSpan={15} className="px-2 py-2.5"></td>
                    <td colSpan={3} className="px-2 py-2.5 text-center bg-surface-3/50">
                      <span className="num-mono text-sm font-bold text-on-surface">{Math.round(g.subtotalMonth)}<span className="text-[10px] font-normal text-on-surface-muted ml-0.5">h</span></span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {g.subtotalOver > 0 ? (
                        <span className="num-mono text-xs font-bold text-warning inline-flex items-center gap-0.5"><AlertTriangle size={10} />+{Math.round(g.subtotalOver)}h</span>
                      ) : <span className="num-mono text-on-surface-subtle text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2.5"></td>
                  </tr>
                )}
                {g.rows.map((e: any) => {
              const weekPlans = [e.w1, e.w2, e.w3, e.w4, e.w5];
              const weekOvers = [e.w1_over ?? 0, e.w2_over ?? 0, e.w3_over ?? 0, e.w4_over ?? 0, e.w5_over ?? 0];
              const weekLogged = [e.w1_logged ?? 0, e.w2_logged ?? 0, e.w3_logged ?? 0, e.w4_logged ?? 0, e.w5_logged ?? 0];
              const weekInternal = [e.w1_internal ?? 0, e.w2_internal ?? 0, e.w3_internal ?? 0, e.w4_internal ?? 0, e.w5_internal ?? 0];
              const monthPlan = Number(e.monthly);
              const monthLogged = weekLogged.reduce((s, v) => s + Number(v), 0);
              const monthInternal = Number(e.month_internal ?? weekInternal.reduce((s, v) => s + Number(v), 0));
              const monthOver = Number(e.logged_over_plan ?? 0);
              const monthUnder = (monthLogged > 0 && monthLogged < monthPlan && monthOver === 0) ? monthPlan - monthLogged : 0;
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
                    const logged = Number(weekLogged[i]);
                    const planN = Number(p);
                    const edits = Number((e as any)[`w${i+1}_edits`] ?? 0);
                    const lastEditAt = (e as any)[`w${i+1}_last_edit`] as string | null;
                    const under = (logged > 0 && logged < planN) ? planN - logged : 0;
                    // Log cell tone — only the LOG side carries the
                    // status color now, the Plan side stays neutral
                    // (it's just "what was allocated"). Cleaner read
                    // than tinting both halves.
                    const logCls =
                      over > 0  ? 'bg-warning-container text-warning'
                      : under > 0 ? 'bg-danger-container text-danger'
                      : logged === 0 ? 'text-on-surface-subtle'
                      : logged === planN ? 'bg-success-container text-success'
                      : 'text-on-surface';
                    const planCls = varianceClass(planN);
                    const tooltip = `Plan ${planN}h · Logged ${logged}h${over > 0 ? ` (+${over} over)` : under > 0 ? ` (−${under} short)` : ''}${edits > 0 ? ` · admin-edited ${edits}×` : ''}`;
                    return (
                      <Fragment key={i}>
                        {/* Plan sub-cell — neutral, just the allocated number. */}
                        <td className="px-1 py-2 text-center border-l border-outline relative">
                          <button onClick={() => openDetail(e.employee_id, e.employee_name || '—', i + 1)}
                            title={tooltip}
                            className={`group num-mono inline-flex items-center justify-center w-full px-1.5 py-1.5 rounded-md text-sm font-semibold transition-colors hover:shadow-elev-1 ${planCls}`}>
                            {planN}
                            {edits > 0 && (
                              <span className="absolute top-0.5 right-0.5 inline-flex items-center justify-center w-3 h-3 rounded-full bg-warning text-on-accent text-[7px]">
                                <Pencil size={6} strokeWidth={2.5} />
                              </span>
                            )}
                          </button>
                        </td>
                        {/* Log sub-cell — coloured by status (warning over /
                            danger short / success match / muted zero) and
                            carries the over/under delta inline. */}
                        <td className="px-1 py-2 text-center">
                          <button onClick={() => openDetail(e.employee_id, e.employee_name || '—', i + 1)}
                            title={tooltip}
                            className={`num-mono inline-flex items-center justify-center w-full px-1.5 py-1.5 rounded-md text-sm font-semibold transition-colors hover:shadow-elev-1 ${logCls}`}>
                            {logged}
                            {over > 0 && <span className="ml-0.5 text-[9px] font-bold inline-flex items-center gap-0.5"><AlertTriangle size={8} />+{Math.round(over)}</span>}
                            {under > 0 && <span className="ml-0.5 text-[9px] font-bold inline-flex items-center gap-0.5"><AlertTriangle size={8} />−{Math.round(under)}</span>}
                          </button>
                        </td>
                        {/* Int sub-cell — approved internal-activity hours
                            for this week. Subtle accent tint so it reads
                            as supplementary context, not as a target. */}
                        <td className="px-1 py-2 text-center">
                          <button onClick={() => openDetail(e.employee_id, e.employee_name || '—', i + 1)}
                            title={`Internal-activity hours (approved): ${Number(weekInternal[i])}h`}
                            className={`num-mono inline-flex items-center justify-center w-full px-1.5 py-1.5 rounded-md text-sm font-semibold transition-colors hover:shadow-elev-1 ${
                              Number(weekInternal[i]) > 0 ? 'bg-accent/10 text-accent' : 'text-on-surface-subtle'
                            }`}>
                            {Number(weekInternal[i])}
                          </button>
                        </td>
                      </Fragment>
                    );
                  })}
                  {/* Month plan / log pair — same split as the weekly cells. */}
                  <td className="px-1 py-2 text-center bg-surface-2 border-l border-outline">
                    <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                      title={`Plan ${monthPlan}h · Logged ${Math.round(monthLogged)}h${monthOver > 0 ? ` (+${Math.round(monthOver)} over)` : monthUnder > 0 ? ` (−${Math.round(monthUnder)} short)` : ''}`}
                      className="num-mono inline-flex items-center justify-center w-full px-2 py-2 rounded-md text-base font-bold text-on-surface hover:bg-surface-3 transition-colors">
                      {monthPlan}
                    </button>
                  </td>
                  <td className="px-1 py-2 text-center bg-surface-2">
                    <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                      title={`Plan ${monthPlan}h · Logged ${Math.round(monthLogged)}h${monthOver > 0 ? ` (+${Math.round(monthOver)} over)` : monthUnder > 0 ? ` (−${Math.round(monthUnder)} short)` : ''}`}
                      className={`num-mono inline-flex items-center justify-center w-full px-2 py-2 rounded-md text-base font-bold transition-colors ${
                        monthOver > 0 ? 'bg-warning-container text-warning'
                        : monthUnder > 0 ? 'bg-danger-container text-danger'
                        : monthLogged === 0 ? 'text-on-surface-subtle'
                        : monthLogged === monthPlan ? 'bg-success-container text-success'
                        : 'text-on-surface hover:bg-surface-3'
                      }`}>
                      {Math.round(monthLogged)}
                      {monthOver > 0 && <span className="ml-0.5 text-[9px] font-bold">+{Math.round(monthOver)}</span>}
                      {monthUnder > 0 && <span className="ml-0.5 text-[9px] font-bold">−{Math.round(monthUnder)}</span>}
                    </button>
                  </td>
                  <td className="px-1 py-2 text-center bg-surface-2">
                    <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                      title={`Internal-activity hours this month (approved): ${Math.round(monthInternal)}h`}
                      className={`num-mono inline-flex items-center justify-center w-full px-2 py-2 rounded-md text-base font-bold transition-colors ${
                        monthInternal > 0 ? 'bg-accent/10 text-accent' : 'text-on-surface-subtle'
                      }`}>
                      {Math.round(monthInternal)}
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
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Mine view: my direct reports + projects I review ───────────────────────
// Generic sortable column header for plain `<table>` markup. The chevron
// rotates between up / down / neutral based on the parent's current sort
// state. Click triggers the parent's cycle handler.
function SortableTh({ label, sortKey, current, onSort, className = '', align = 'left' }: {
  label: string;
  sortKey: string;
  current: { key: string; dir: 'asc' | 'desc' };
  onSort: (k: any) => void;
  className?: string;
  align?: 'left' | 'center' | 'right';
}) {
  const active = current.key === sortKey;
  const Icon = !active ? ArrowUpDown : current.dir === 'asc' ? ChevronUp : ChevronDown;
  const justify = align === 'left' ? 'justify-start' : align === 'right' ? 'justify-end' : 'justify-center';
  return (
    <th className={`${className} ${align === 'left' ? 'text-left' : align === 'right' ? 'text-right' : 'text-center'} select-none`}>
      <button onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 ${justify} w-full hover:text-on-surface transition-colors ${active ? 'text-accent' : ''}`}>
        <span>{label}</span>
        <Icon size={11} className={active ? 'opacity-100' : 'opacity-50'} />
      </button>
    </th>
  );
}

function MineView({ summary, assignments, myProjects, reportsToIds, loading, month, year, search, openDetail }: {
  summary: any;
  assignments: any[];
  myProjects: any[];
  reportsToIds: Set<string>;
  loading: boolean;
  month: number;
  year: number;
  search: string;
  openDetail: (employeeId: string, employeeName: string, focusWeek?: number) => void;
}) {
  const [drillProject, setDrillProject] = useState<{ id: string; name: string; rows: any[] } | null>(null);
  // Per-day activity grid (employees × days × hours) for a project — same
  // modal the Projects page uses. Surfaced here so project leads / reviewers
  // can see the daily breakdown without leaving /hours.
  const [dailyFor, setDailyFor] = useState<any | null>(null);

  // Sort state for the "My team's capacity" table. Default: name ASC.
  // Clicking a column header cycles ASC → DESC → ASC. Click a different
  // column to switch to it (always starts in the natural-first direction:
  // ASC for name, DESC for everything numeric since "biggest first" is the
  // useful starting view for capacity / overtime).
  type SortKey = 'name' | 'w1' | 'w2' | 'w3' | 'w4' | 'w5' | 'month' | 'over';
  const [teamSort, setTeamSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const onSort = (key: SortKey) => {
    setTeamSort(prev => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: key === 'name' ? 'asc' : 'desc' };
    });
  };

  const teamRows = useMemo(() => {
    if (!summary) return [] as any[];
    if (reportsToIds.size === 0) return [] as any[];
    const rows = summary.employees.filter((e: any) => reportsToIds.has(e.employee_id));
    const term = (search ?? '').trim().toLowerCase();
    const filtered = term ? rows.filter((r: any) => (r.employee_name ?? '').toLowerCase().includes(term)) : rows;
    // Apply sort. For week cells, sort by plan + over (what the user sees
    // in the cell) so the order matches what the eye picks up. Use a stable
    // copy so the underlying array isn't mutated.
    const numFor = (r: any, k: SortKey): number => {
      switch (k) {
        case 'w1': return Number(r.w1 ?? 0) + Number(r.w1_over ?? 0);
        case 'w2': return Number(r.w2 ?? 0) + Number(r.w2_over ?? 0);
        case 'w3': return Number(r.w3 ?? 0) + Number(r.w3_over ?? 0);
        case 'w4': return Number(r.w4 ?? 0) + Number(r.w4_over ?? 0);
        case 'w5': return Number(r.w5 ?? 0) + Number(r.w5_over ?? 0);
        case 'month': return Number(r.monthly ?? 0) + Number(r.logged_over_plan ?? 0);
        case 'over': return Number(r.logged_over_plan ?? 0);
        default: return 0;
      }
    };
    const sorted = [...filtered].sort((a: any, b: any) => {
      if (teamSort.key === 'name') {
        return (a.employee_name ?? '').localeCompare(b.employee_name ?? '');
      }
      return numFor(a, teamSort.key) - numFor(b, teamSort.key);
    });
    return teamSort.dir === 'desc' ? sorted.reverse() : sorted;
  }, [summary, reportsToIds, search, teamSort]);

  // Aggregate per project: how many employees are assigned + their hours this month
  const projectStats = useMemo(() => {
    const term = (search ?? '').trim().toLowerCase();
    const stats = myProjects.map(p => {
      const rows = assignments.filter(a => a.project_id === p.id);
      const totalPlanned = rows.reduce((s, a) => s + Number(a.monthly_hours || 0), 0);
      const employeeNames = Array.from(new Set(rows.map(a => a.employee_name).filter(Boolean)));
      return { project: p, totalPlanned, employees: employeeNames, rows };
    });
    if (!term) return stats;
    return stats.filter(s =>
      (s.project.name ?? '').toLowerCase().includes(term) ||
      (s.project.client_name ?? '').toLowerCase().includes(term) ||
      s.employees.some((n: string) => (n ?? '').toLowerCase().includes(term))
    );
  }, [myProjects, assignments, search]);

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
                {/* Grouped header — same Plan/Log split as the main
                    Capacity view so the two tables read the same. The
                    SortableTh on the top-level W label keeps its row by
                    spanning both subcolumns; sort still operates on the
                    week's planned total. */}
                <tr className="text-left text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.16em]">
                  <th rowSpan={2} className="px-5 py-3 align-bottom">
                    <SortableTh label="Employee" sortKey="name" current={teamSort} onSort={onSort}
                      className="" align="left" />
                  </th>
                  {(['w1','w2','w3','w4','w5'] as const).map((k, i) => {
                    const w = i + 1;
                    const empty = isEmptyWeek(month, year, w);
                    const cur   = isCurrentWeekOfMonth(month, year, w);
                    return (
                      <th key={k} colSpan={3}
                          className={`px-2 py-2 text-center border-l border-outline ${cur ? 'bg-accent/10' : ''} ${empty ? 'opacity-40' : ''}`}>
                        <SortableTh label={k.toUpperCase()} sortKey={k} current={teamSort} onSort={onSort}
                          className={cur ? 'text-accent' : ''} align="center" />
                        <div className={`text-[9px] font-normal normal-case tracking-normal ${cur ? 'text-accent' : 'text-on-surface-subtle'}`}>
                          {empty ? '—' : formatWeekDays(month, year, w)}
                        </div>
                      </th>
                    );
                  })}
                  <th colSpan={3} className="px-2 py-2 text-center bg-surface-3 border-l border-outline">
                    <SortableTh label="Month" sortKey="month" current={teamSort} onSort={onSort}
                      className="" align="center" />
                  </th>
                  <th rowSpan={2} className="px-3 py-3 min-w-[80px] align-bottom border-l border-outline">
                    <SortableTh label="Over plan" sortKey="over" current={teamSort} onSort={onSort}
                      className="" align="center" />
                  </th>
                </tr>
                <tr className="text-[9px] font-semibold text-on-surface-subtle uppercase tracking-wider">
                  {(['w1','w2','w3','w4','w5'] as const).map(k => (
                    <Fragment key={k}>
                      <th className="px-1 py-1.5 text-center min-w-[40px] border-l border-outline">Plan</th>
                      <th className="px-1 py-1.5 text-center min-w-[44px]">Log</th>
                      <th className="px-1 py-1.5 text-center min-w-[40px]" title="Approved internal-activity hours">Int</th>
                    </Fragment>
                  ))}
                  <th className="px-1 py-1.5 text-center min-w-[44px] bg-surface-3 border-l border-outline">Plan</th>
                  <th className="px-1 py-1.5 text-center min-w-[48px] bg-surface-3">Log</th>
                  <th className="px-1 py-1.5 text-center min-w-[44px] bg-surface-3" title="Approved internal-activity hours">Int</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {teamRows.map((e: any) => {
                  const weekPlans = [e.w1, e.w2, e.w3, e.w4, e.w5];
                  const weekOvers = [e.w1_over ?? 0, e.w2_over ?? 0, e.w3_over ?? 0, e.w4_over ?? 0, e.w5_over ?? 0];
                  const weekLogged = [e.w1_logged ?? 0, e.w2_logged ?? 0, e.w3_logged ?? 0, e.w4_logged ?? 0, e.w5_logged ?? 0];
                  const weekInternal = [e.w1_internal ?? 0, e.w2_internal ?? 0, e.w3_internal ?? 0, e.w4_internal ?? 0, e.w5_internal ?? 0];
                  const monthPlan = Number(e.monthly);
                  const monthLogged = weekLogged.reduce((s, v) => s + Number(v), 0);
                  const monthInternal = Number(e.month_internal ?? weekInternal.reduce((s, v) => s + Number(v), 0));
                  const monthOver = Number(e.logged_over_plan ?? 0);
                  const monthUnder = (monthLogged > 0 && monthLogged < monthPlan && monthOver === 0) ? monthPlan - monthLogged : 0;
                  return (
                    <tr key={e.employee_id} className="hover:bg-surface-2/60 transition-colors">
                      <td className="px-5 py-3 font-semibold text-on-surface">
                        <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')} className="hover:text-accent transition-colors">
                          {e.employee_name || '—'}
                        </button>
                      </td>
                      {weekPlans.map((p: number, i: number) => {
                        const over = Number(weekOvers[i]);
                        const planN = Number(p);
                        const logged = Number(weekLogged[i]);
                        const under = (logged > 0 && logged < planN) ? planN - logged : 0;
                        const logCls =
                          over > 0  ? 'bg-warning-container text-warning'
                          : under > 0 ? 'bg-danger-container text-danger'
                          : logged === 0 ? 'text-on-surface-subtle'
                          : logged === planN ? 'bg-success-container text-success'
                          : 'text-on-surface';
                        const planCls = varianceClass(planN);
                        const tooltip = `Plan ${planN}h · Logged ${logged}h${over > 0 ? ` (+${over} over)` : under > 0 ? ` (−${under} short)` : ''}`;
                        return (
                          <Fragment key={i}>
                            <td className="px-1 py-2 text-center border-l border-outline">
                              <button onClick={() => openDetail(e.employee_id, e.employee_name || '—', i + 1)}
                                title={tooltip}
                                className={`num-mono inline-flex items-center justify-center w-full px-1.5 py-1 rounded-md text-sm font-semibold transition-colors ${planCls}`}>
                                {planN}
                              </button>
                            </td>
                            <td className="px-1 py-2 text-center">
                              <button onClick={() => openDetail(e.employee_id, e.employee_name || '—', i + 1)}
                                title={tooltip}
                                className={`num-mono inline-flex items-center justify-center w-full px-1.5 py-1 rounded-md text-sm font-semibold transition-colors ${logCls}`}>
                                {logged}
                                {over > 0 && <span className="ml-0.5 text-[9px] font-bold inline-flex items-center gap-0.5"><AlertTriangle size={8} />+{Math.round(over)}</span>}
                                {under > 0 && <span className="ml-0.5 text-[9px] font-bold inline-flex items-center gap-0.5"><AlertTriangle size={8} />−{Math.round(under)}</span>}
                              </button>
                            </td>
                            <td className="px-1 py-2 text-center">
                              <button onClick={() => openDetail(e.employee_id, e.employee_name || '—', i + 1)}
                                title={`Internal-activity hours (approved): ${Number(weekInternal[i])}h`}
                                className={`num-mono inline-flex items-center justify-center w-full px-1.5 py-1 rounded-md text-sm font-semibold transition-colors ${
                                  Number(weekInternal[i]) > 0 ? 'bg-accent/10 text-accent' : 'text-on-surface-subtle'
                                }`}>
                                {Number(weekInternal[i])}
                              </button>
                            </td>
                          </Fragment>
                        );
                      })}
                      <td className="px-1 py-2 text-center bg-surface-2 border-l border-outline">
                        <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                          title={`Plan ${monthPlan}h · Logged ${Math.round(monthLogged)}h`}
                          className="num-mono inline-flex items-center justify-center w-full px-2 py-1 rounded-md text-base font-bold text-on-surface hover:bg-surface-3 transition-colors">
                          {monthPlan}
                        </button>
                      </td>
                      <td className="px-1 py-2 text-center bg-surface-2">
                        <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                          title={`Plan ${monthPlan}h · Logged ${Math.round(monthLogged)}h${monthOver > 0 ? ` (+${Math.round(monthOver)} over)` : monthUnder > 0 ? ` (−${Math.round(monthUnder)} short)` : ''}`}
                          className={`num-mono inline-flex items-center justify-center w-full px-2 py-1 rounded-md text-base font-bold transition-colors ${
                            monthOver > 0 ? 'bg-warning-container text-warning'
                            : monthUnder > 0 ? 'bg-danger-container text-danger'
                            : monthLogged === 0 ? 'text-on-surface-subtle'
                            : monthLogged === monthPlan ? 'bg-success-container text-success'
                            : 'text-on-surface hover:bg-surface-3'
                          }`}>
                          {Math.round(monthLogged)}
                          {monthOver > 0 && <span className="ml-0.5 text-[9px] font-bold">+{Math.round(monthOver)}</span>}
                          {monthUnder > 0 && <span className="ml-0.5 text-[9px] font-bold">−{Math.round(monthUnder)}</span>}
                        </button>
                      </td>
                      <td className="px-1 py-2 text-center bg-surface-2">
                        <button onClick={() => openDetail(e.employee_id, e.employee_name || '—')}
                          title={`Internal-activity hours this month (approved): ${Math.round(monthInternal)}h`}
                          className={`num-mono inline-flex items-center justify-center w-full px-2 py-1 rounded-md text-base font-bold transition-colors ${
                            monthInternal > 0 ? 'bg-accent/10 text-accent' : 'text-on-surface-subtle'
                          }`}>
                          {Math.round(monthInternal)}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-center">
                        {monthOver > 0 ? (
                          <span className="num-mono inline-flex items-center gap-1 font-bold text-warning bg-warning-container px-2 py-0.5 rounded-full text-xs">
                            <AlertTriangle size={10} />+{Math.round(monthOver)}h
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
              <div key={project.id} className="px-5 py-4 hover:bg-surface-2/60 transition-colors group">
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => setDrillProject({ id: project.id, name: project.name, rows })}
                    className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-display text-base font-bold text-on-surface tracking-tight group-hover:text-accent transition-colors">{project.name}</p>
                      <ChevronRight size={13} className="text-on-surface-subtle group-hover:text-accent transition-colors" />
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
                  </button>
                  <div className="text-right flex-shrink-0 flex flex-col items-end gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Planned</p>
                      <p className="num-mono text-xl font-bold text-on-surface mt-0.5">{totalPlanned}<span className="text-xs text-on-surface-muted ml-0.5">h</span></p>
                      <p className="text-[10px] text-on-surface-subtle mt-0.5">{rows.length} assignment{rows.length === 1 ? '' : 's'}</p>
                    </div>
                    <button onClick={() => setDailyFor(project)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-outline bg-surface text-on-surface-muted hover:bg-surface-2 hover:text-on-surface transition-colors"
                      title="See daily hours logged by employees on this project">
                      <CalendarDays size={11} /> Daily view
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Project drill-in: per-employee hours on this project for the month */}
      {drillProject && (
        <ProjectDrillModal
          project={drillProject}
          month={month}
          year={year}
          summary={summary}
          openDetail={(eid, ename, fw) => { setDrillProject(null); openDetail(eid, ename, fw); }}
          onClose={() => setDrillProject(null)}
        />
      )}

      {/* Per-day activity grid (same as Projects page) for project leads */}
      {dailyFor && (
        <ProjectDailyActivityModal
          project={dailyFor}
          onClose={() => setDailyFor(null)}
        />
      )}
    </div>
  );
}

// Drill-in modal: list the people assigned to a single project for the month,
// with their per-week plan + the team's running plan/logged total. Click a row
// to jump into the per-employee detail (which shows daily breakdown).
function ProjectDrillModal({ project, month, year, summary, openDetail, onClose }: {
  project: { id: string; name: string; rows: any[] };
  month: number;
  year: number;
  summary: any;
  openDetail: (employeeId: string, employeeName: string, focusWeek?: number) => void;
  onClose: () => void;
}) {
  // Per-employee logged-this-month numbers come from the summary; we look up
  // by employee_id. The per-project per-employee logged figure isn't a server
  // field, so we show the employee's TOTAL logged for the month as context.
  const summaryByEmp = useMemo(() => {
    const m = new Map<string, any>();
    if (summary?.employees) for (const e of summary.employees) m.set(e.employee_id, e);
    return m;
  }, [summary]);

  const rows = useMemo(() => {
    return [...project.rows].sort((a, b) => Number(b.monthly_hours || 0) - Number(a.monthly_hours || 0));
  }, [project.rows]);

  const totalPlanned = rows.reduce((s, a) => s + Number(a.monthly_hours || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-brand-container/40 to-surface flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">{project.name}</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              {MONTHS[month-1]} {year} · {rows.length} on plan · <span className="num-mono text-on-surface">{totalPlanned}h</span> total planned
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors">
            <X size={18} className="text-on-surface-muted" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-on-surface-muted">No one assigned to this project this month.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2/40 sticky top-0">
                <tr className="text-left text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.16em] border-b border-outline">
                  <th className="px-5 py-3">Employee</th>
                  {[1,2,3,4,5].map(w => {
                    const empty = isEmptyWeek(month, year, w);
                    const cur   = isCurrentWeekOfMonth(month, year, w);
                    return (
                      <th key={w} className={`px-2 py-3 text-center min-w-[56px] ${cur ? 'bg-accent/10' : ''} ${empty ? 'opacity-40' : ''}`}>
                        <div className={cur ? 'text-accent' : ''}>W{w}</div>
                        <div className={`text-[9px] font-normal normal-case tracking-normal ${cur ? 'text-accent' : 'text-on-surface-subtle'}`}>
                          {empty ? '—' : formatWeekDays(month, year, w)}
                        </div>
                      </th>
                    );
                  })}
                  <th className="px-3 py-3 text-center bg-surface-3 min-w-[80px]">Plan</th>
                  <th className="px-3 py-3 text-right">Logged (month)</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {rows.map((a: any) => {
                  const s = summaryByEmp.get(a.employee_id) || {};
                  const logged = Number(s.logged_approved ?? 0);
                  return (
                    <tr key={a.id} className="hover:bg-surface-2/40 cursor-pointer"
                      onClick={() => openDetail(a.employee_id, a.employee_name || '—')}>
                      <td className="px-5 py-3 font-semibold text-on-surface whitespace-nowrap">
                        {a.employee_name || '—'}
                      </td>
                      {[a.w1_hours, a.w2_hours, a.w3_hours, a.w4_hours, a.w5_hours].map((h: number, i: number) => (
                        <td key={i} className="px-2 py-3 text-center num-mono text-sm text-on-surface-muted">
                          {Number(h) > 0 ? Number(h) : <span className="text-on-surface-subtle">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-3 text-center num-mono font-bold text-on-surface bg-surface-2/30">
                        {Number(a.monthly_hours)}
                      </td>
                      <td className="px-3 py-3 text-right num-mono text-on-surface-muted">
                        {logged > 0 ? `${logged}h` : <span className="text-on-surface-subtle">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <ChevronRight size={14} className="text-on-surface-subtle" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-3 border-t border-outline bg-surface-2/30 text-[11px] text-on-surface-subtle">
          Click any row to drill into that person's daily log for the month.
        </div>
      </div>
    </div>
  );
}

// ── Activity view ──────────────────────────────────────────────────────────
// Lists every edit to project_assignments for the visible month. Each row
// shows who changed it, when, the project + person, and a per-week diff
// so a reviewer can scan "what moved" without doing math. The `search`
// prop is the page-level free-text filter (project / employee / actor).
interface AuditRow {
  id: number;
  assignment_id: string;
  project_id: string | null;
  project_name: string | null;
  employee_id: string | null;
  employee_name: string | null;
  month: number;
  year: number;
  w1_before: number; w2_before: number; w3_before: number; w4_before: number; w5_before: number; monthly_before: number;
  w1_after:  number; w2_after:  number; w3_after:  number; w4_after:  number; w5_after:  number; monthly_after:  number;
  notes_before: string | null;
  notes_after:  string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  changed_at: string;
}

function ActivityView({ month, year, search }: { month: number; year: number; search: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.getAssignmentAudit({ month, year })
      .then((r: any) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [month, year]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.project_name ?? '').toLowerCase().includes(q) ||
      (r.employee_name ?? '').toLowerCase().includes(q) ||
      (r.actor_name ?? '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  if (loading) {
    return (
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 px-5 py-8 text-center text-on-surface-subtle text-sm">
        Loading activity…
      </div>
    );
  }
  if (filtered.length === 0) {
    return (
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 px-5 py-12 text-center">
        <History size={28} className="mx-auto text-on-surface-subtle mb-2" />
        <p className="text-sm text-on-surface-muted">No allocation edits recorded for {MONTHS[month - 1]} {year}.</p>
        <p className="text-xs text-on-surface-subtle mt-0.5">Only changes to existing assignments are logged. Logging started after the latest deploy.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
      <div className="px-5 py-3 border-b border-outline bg-surface-2/30 flex items-center justify-between text-xs text-on-surface-muted">
        <span><span className="font-semibold text-on-surface num-mono">{filtered.length}</span> edit{filtered.length === 1 ? '' : 's'} for {MONTHS[month-1]} {year}</span>
        <span>Most recent first</span>
      </div>
      <div className="divide-y divide-outline">
        {filtered.map(r => {
          const dMonthly = num(r.monthly_after) - num(r.monthly_before);
          const dMonthlyCls = dMonthly === 0 ? 'text-on-surface-subtle'
            : dMonthly > 0 ? 'text-success' : 'text-danger';
          const weeks = [
            { k: 'W1', b: r.w1_before, a: r.w1_after },
            { k: 'W2', b: r.w2_before, a: r.w2_after },
            { k: 'W3', b: r.w3_before, a: r.w3_after },
            { k: 'W4', b: r.w4_before, a: r.w4_after },
            { k: 'W5', b: r.w5_before, a: r.w5_after },
          ].filter(w => num(w.b) !== num(w.a));
          const ts = new Date(r.changed_at);
          return (
            <div key={r.id} className="px-5 py-3.5 hover:bg-surface-2/40 transition-colors">
              <div className="flex items-start justify-between gap-4 mb-1.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface truncate">
                    {r.project_name ?? '—'}
                    <span className="text-on-surface-subtle font-normal"> · </span>
                    <span className="text-on-surface-muted font-medium">{r.employee_name ?? '—'}</span>
                  </p>
                  <p className="text-[11px] text-on-surface-subtle mt-0.5">
                    edited by <span className="font-semibold text-on-surface">{r.actor_name ?? 'Unknown'}</span>
                    {r.actor_role && <span className="text-on-surface-subtle"> ({r.actor_role})</span>}
                    {' · '}{ts.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' · '}<span className="num-mono">{formatAgo(r.changed_at)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs flex-shrink-0">
                  <span className="text-on-surface-subtle num-mono">{num(r.monthly_before)}h</span>
                  <ArrowRight size={11} className="text-on-surface-subtle" />
                  <span className="num-mono font-bold text-on-surface">{num(r.monthly_after)}h</span>
                  <span className={`num-mono text-[11px] font-semibold ${dMonthlyCls}`}>
                    {dMonthly > 0 ? '+' : ''}{dMonthly}h
                  </span>
                </div>
              </div>
              {weeks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {weeks.map(w => {
                    const d = num(w.a) - num(w.b);
                    const cls = d > 0 ? 'text-success bg-success-container' : 'text-danger bg-danger-container';
                    return (
                      <span key={w.k} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${cls}`}>
                        <span className="font-bold">{w.k}</span>
                        <span className="num-mono opacity-75">{num(w.b)}</span>
                        <ArrowRight size={9} />
                        <span className="num-mono">{num(w.a)}</span>
                        <span className="num-mono opacity-75">({d > 0 ? '+' : ''}{d})</span>
                      </span>
                    );
                  })}
                </div>
              )}
              {(r.notes_before ?? '') !== (r.notes_after ?? '') && (
                <p className="text-[11px] text-on-surface-subtle mt-1.5 italic">
                  Notes: <span className="line-through opacity-60">{r.notes_before || '∅'}</span>
                  <ArrowRight size={9} className="inline mx-1" />
                  <span className="text-on-surface-muted not-italic">{r.notes_after || '∅'}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

