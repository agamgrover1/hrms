import { useState, useEffect, useMemo } from 'react';
import { Plus, Pencil, Trash2, X, Search, Briefcase, ExternalLink, Flag, AlertTriangle, IndianRupee, CalendarDays } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { financeApi, type FinProjectExpense } from '../services/financeApi';

interface Project {
  id: string;
  name: string;
  client_name: string | null;
  project_type: string | null;
  dashboard_url: string | null;
  project_reporting_id: string | null;
  project_reporting_name: string | null;
  project_lead_id: string | null;
  project_lead_name: string | null;
  status: string;
  flag: string | null;
  flag_reason: string | null;
  notes: string | null;
  total_hours_cap?: number | null;
  consumed_hours_total?: number | null;
  billing_source?: 'direct' | 'upwork' | null;
}

const PROJECT_TYPES = [
  { value: 'full', label: 'Full SEO' },
  { value: 'onpage', label: 'On-page SEO' },
  { value: 'offpage', label: 'Off-page SEO' },
  { value: 'technical', label: 'Technical SEO' },
  { value: 'local', label: 'Local SEO' },
  { value: 'web_dev', label: 'Web Development' },
  { value: 'other', label: 'Other' },
];

const FLAGS = [
  { value: '', label: 'No flag' },
  { value: 'yellow', label: 'Yellow — needs attention' },
  { value: 'red', label: 'Red — at risk' },
];

const STATUS_PILL: Record<string, { label: string; bg: string; color: string }> = {
  active:   { label: 'Active',   bg: 'rgb(var(--success-container))', color: 'rgb(var(--success))' },
  on_hold:  { label: 'On Hold',  bg: 'rgb(var(--warning-container))', color: 'rgb(var(--warning))' },
  archived: { label: 'Archived', bg: 'rgb(var(--surface-3))',         color: 'rgb(var(--on-surface-muted))' },
};

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">{label}</span>
      {children}
    </label>
  );
}

function typeLabel(v: string | null) {
  return PROJECT_TYPES.find(t => t.value === v)?.label ?? v ?? '—';
}

export default function Projects() {
  const { user } = useAuth();
  const role = user?.role ?? 'employee';
  const canEdit = role === 'admin' || role === 'hr_manager' || role === 'project_coordinator';

  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [reportingFilter, setReportingFilter] = useState('');
  const [leadFilter, setLeadFilter] = useState('');
  const [flagFilter, setFlagFilter] = useState('');
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [expensesFor, setExpensesFor] = useState<Project | null>(null);
  const [dailyFor, setDailyFor] = useState<Project | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.getProjects().then(setProjects).catch(() => {}),
      api.getEmployees().then(setEmployees).catch(() => {}),
    ]).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return projects.filter(p => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (typeFilter && p.project_type !== typeFilter) return false;
      if (reportingFilter && p.project_reporting_id !== reportingFilter) return false;
      if (leadFilter && p.project_lead_id !== leadFilter) return false;
      if (flagFilter === 'none' && p.flag) return false;
      if (flagFilter && flagFilter !== 'none' && p.flag !== flagFilter) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.client_name ?? '').toLowerCase().includes(term) ||
        (p.project_reporting_name ?? '').toLowerCase().includes(term) ||
        (p.project_lead_name ?? '').toLowerCase().includes(term)
      );
    });
  }, [projects, search, typeFilter, statusFilter, reportingFilter, leadFilter, flagFilter]);

  // Surface people who actually own at least one project — keeps the
  // dropdowns from showing every employee in the system.
  const reportingPeople = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) if (p.project_reporting_id) m.set(p.project_reporting_id, p.project_reporting_name || '—');
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [projects]);
  const leadPeople = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) if (p.project_lead_id) m.set(p.project_lead_id, p.project_lead_name || '—');
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [projects]);

  const activeFilterCount = [typeFilter, reportingFilter, leadFilter, flagFilter].filter(Boolean).length;
  const clearAllFilters = () => {
    setTypeFilter(''); setReportingFilter(''); setLeadFilter(''); setFlagFilter('');
  };

  const counts = {
    active: projects.filter(p => p.status === 'active').length,
    on_hold: projects.filter(p => p.status === 'on_hold').length,
    archived: projects.filter(p => p.status === 'archived').length,
    flagged: projects.filter(p => p.flag).length,
  };

  const handleDelete = async (p: Project) => {
    if (!confirm(`Archive project "${p.name}"? It will be hidden but history of hour logs is preserved.`)) return;
    await api.deleteProject(p.id).catch(() => {});
    load();
  };

  const summaryTiles: Array<{ label: string; value: number; color: string; blob: string; stagger: string }> = [
    { label: 'Active',   value: counts.active,   color: 'text-success',           blob: 'bg-brand/15',     stagger: 'stagger-1' },
    { label: 'On Hold',  value: counts.on_hold,  color: 'text-warning',           blob: 'bg-warning/20',   stagger: 'stagger-2' },
    { label: 'Archived', value: counts.archived, color: 'text-on-surface-muted',  blob: 'bg-surface-3',    stagger: 'stagger-3' },
    { label: 'Flagged',  value: counts.flagged,  color: 'text-danger',            blob: 'bg-danger/15',    stagger: 'stagger-4' },
  ];

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {summaryTiles.map(({ label, value, color, blob, stagger }) => (
          <div key={label}
            className={`group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up ${stagger}`}>
            <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full ${blob} blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500`} />
            <div className="relative">
              <p className={`num-mono text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-on-surface-subtle mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search project, client, reporting, lead…"
              className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface border border-outline rounded-lg text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-outline rounded-lg px-3 py-2.5 bg-surface text-on-surface-muted focus:outline-none focus:ring-2 focus:ring-accent/30">
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="archived">Archived</option>
            <option value="">All Statuses</option>
          </select>
          <button onClick={() => setShowMoreFilters(s => !s)}
            className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
              showMoreFilters || activeFilterCount > 0
                ? 'border-accent bg-accent-container/40 text-accent'
                : 'border-outline bg-surface text-on-surface-muted hover:bg-surface-2'
            }`}>
            Filters
            {activeFilterCount > 0 && (
              <span className="num-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent text-on-accent">{activeFilterCount}</span>
            )}
          </button>
          {canEdit && (
            <button
              onClick={() => { setEditing(null); setShowForm(true); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-accent text-on-accent hover:opacity-90 shadow-elev-1 hover:shadow-elev-2 transition-all"
            >
              <Plus size={15} /> New Project
            </button>
          )}
        </div>

        {showMoreFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-surface-2 border border-outline rounded-xl-2 p-3">
            <FilterField label="Type">
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                className="w-full text-sm border border-outline rounded-lg px-2.5 py-2 bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
                <option value="">Any type</option>
                {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </FilterField>
            <FilterField label="Reporting person">
              <select value={reportingFilter} onChange={e => setReportingFilter(e.target.value)}
                className="w-full text-sm border border-outline rounded-lg px-2.5 py-2 bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
                <option value="">Any reviewer</option>
                {reportingPeople.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </FilterField>
            <FilterField label="Project lead">
              <select value={leadFilter} onChange={e => setLeadFilter(e.target.value)}
                className="w-full text-sm border border-outline rounded-lg px-2.5 py-2 bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
                <option value="">Any lead</option>
                {leadPeople.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </FilterField>
            <FilterField label="Flag">
              <select value={flagFilter} onChange={e => setFlagFilter(e.target.value)}
                className="w-full text-sm border border-outline rounded-lg px-2.5 py-2 bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
                <option value="">Any</option>
                <option value="red">🔴 Red — at risk</option>
                <option value="yellow">🟡 Yellow — watch</option>
                <option value="none">No flag</option>
              </select>
            </FilterField>
            {activeFilterCount > 0 && (
              <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-end pt-1">
                <button onClick={clearAllFilters}
                  className="text-xs font-semibold text-accent hover:underline">Clear all filters</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 border-b border-outline">
            <tr className="text-left text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Reporting</th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right" title="Consumed vs total-hours cap (one-time projects)">Hours</th>
              {canEdit && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {loading ? (
              <tr><td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-on-surface-subtle">Loading projects…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={canEdit ? 7 : 6} className="px-4 py-12 text-center">
                <Briefcase size={28} className="mx-auto text-on-surface-subtle mb-2" />
                <p className="text-sm text-on-surface-muted">No projects match your filters.</p>
              </td></tr>
            ) : filtered.map(p => {
              const archived = p.status === 'archived';
              const flagClass = p.flag === 'red'
                ? 'bg-danger-container/30 hover:bg-danger-container/40'
                : p.flag === 'yellow'
                ? 'bg-warning-container/30 hover:bg-warning-container/40'
                : 'hover:bg-surface-2';
              const pill = STATUS_PILL[p.status] ?? STATUS_PILL.active;
              return (
                <tr key={p.id} className={`${flagClass} transition-colors ${archived ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      {p.flag && (
                        <Flag size={14}
                          className={`mt-0.5 ${p.flag === 'red' ? 'text-danger' : 'text-warning'}`} />
                      )}
                      <div>
                        <p className={`font-semibold text-on-surface ${archived ? 'line-through' : ''} inline-flex items-center gap-1.5`}>
                          {p.name}
                          {(p as any).billing_source === 'upwork' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-container text-accent">
                              <Briefcase size={9} strokeWidth={2.5} /> Upwork
                            </span>
                          )}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                          {p.client_name && <span className="text-xs text-on-surface-muted">{p.client_name}</span>}
                          {p.dashboard_url && (
                            <a href={p.dashboard_url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-on-brand-container hover:underline">
                              Dashboard <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                        {p.flag_reason && (
                          <p className="text-xs text-danger mt-1 flex items-center gap-1">
                            <AlertTriangle size={11} /> {p.flag_reason}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-on-surface-muted">{typeLabel(p.project_type)}</td>
                  <td className="px-4 py-3 text-on-surface-muted">{p.project_reporting_name ?? '—'}</td>
                  <td className="px-4 py-3 text-on-surface-muted">{p.project_lead_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: pill.bg, color: pill.color }}>
                      {pill.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.total_hours_cap != null && Number(p.total_hours_cap) > 0 ? (() => {
                      const used = Math.round(Number(p.consumed_hours_total ?? 0));
                      const cap = Number(p.total_hours_cap);
                      const pctUsed = Math.min(1, used / cap);
                      const overBy = used - cap;
                      const tone =
                        overBy > 0 ? 'text-danger'
                        : pctUsed >= 0.9 ? 'text-warning'
                        : 'text-on-surface';
                      const barTone =
                        overBy > 0 ? 'bg-danger'
                        : pctUsed >= 0.9 ? 'bg-warning'
                        : 'bg-success';
                      return (
                        <div className="inline-flex flex-col items-end gap-1">
                          <span className={`num-mono text-xs font-semibold ${tone}`}>
                            {used}<span className="text-on-surface-subtle">/{cap}h</span>
                            {overBy > 0 && <span className="ml-1 text-[10px]">(+{overBy})</span>}
                          </span>
                          <div className="w-20 h-1 rounded-full bg-surface-3 overflow-hidden">
                            <div className={`h-full ${barTone}`} style={{ width: `${Math.min(100, pctUsed * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })() : (
                      <span className="num-mono text-xs text-on-surface-subtle">
                        {Math.round(Number(p.consumed_hours_total ?? 0))}h<span className="text-on-surface-subtle/60"> · uncapped</span>
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => setDailyFor(p)}
                          className="p-1.5 rounded hover:bg-brand-container/60 transition-colors" title="Daily activity (who worked how many hours each day)">
                          <CalendarDays size={14} className="text-on-brand-container" />
                        </button>
                        <button onClick={() => setExpensesFor(p)}
                          className="p-1.5 rounded hover:bg-warning-container/60 transition-colors" title="Project expenses (outsourcing, content, ads)">
                          <IndianRupee size={14} className="text-warning" />
                        </button>
                        <button onClick={() => { setEditing(p); setShowForm(true); }}
                          className="p-1.5 rounded hover:bg-surface-3 transition-colors" title="Edit">
                          <Pencil size={14} className="text-on-surface-muted" />
                        </button>
                        {!archived && (
                          <button onClick={() => handleDelete(p)}
                            className="p-1.5 rounded hover:bg-danger-container/50 transition-colors" title="Archive">
                            <Trash2 size={14} className="text-danger" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <ProjectForm
          existing={editing}
          employees={employees}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
          createdBy={user?.name}
        />
      )}

      {expensesFor && (
        <ProjectExpensesModal
          project={expensesFor}
          onClose={() => setExpensesFor(null)}
        />
      )}

      {dailyFor && (
        <ProjectDailyActivityModal
          project={dailyFor}
          onClose={() => setDailyFor(null)}
        />
      )}
    </div>
  );
}

// ── Daily activity modal — project-centric view: employees × days ──────────
// Reporting managers / coordinators / admins use this to see how many hours
// were spent on a specific project each day, by whom, with the day's notes.
export function ProjectDailyActivityModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [days, setDays] = useState<Array<{
    id: string; employee_id: string; employee_name: string | null; log_date: string;
    hours: number; notes: string | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredCell, setHoveredCell] = useState<{ emp: string; date: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    api.getHourLogDays({ project_id: project.id, month, year })
      .then((d: any[]) => setDays(d as any))
      .catch(() => setDays([]))
      .finally(() => setLoading(false));
  }, [project.id, month, year]);

  // Build the list of days in the month (1..N)
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayNums = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Group entries: (employee_id → date → row[])
  const byEmpDate = new Map<string, Map<string, typeof days>>();
  const empNames = new Map<string, string>();
  for (const d of days) {
    const iso = String(d.log_date).slice(0, 10);
    if (!byEmpDate.has(d.employee_id)) byEmpDate.set(d.employee_id, new Map());
    const empMap = byEmpDate.get(d.employee_id)!;
    if (!empMap.has(iso)) empMap.set(iso, []);
    empMap.get(iso)!.push(d);
    if (d.employee_name) empNames.set(d.employee_id, d.employee_name);
  }
  const employees = Array.from(byEmpDate.keys()).sort((a, b) =>
    (empNames.get(a) ?? '').localeCompare(empNames.get(b) ?? '')
  );

  // Totals
  const totalHours = days.reduce((s, d) => s + Number(d.hours), 0);
  const activeDays = new Set(days.map(d => String(d.log_date).slice(0, 10))).size;

  // Daily totals (across all employees) for the column footer
  const totalByDay = new Map<string, number>();
  for (const d of days) {
    const iso = String(d.log_date).slice(0, 10);
    totalByDay.set(iso, (totalByDay.get(iso) ?? 0) + Number(d.hours));
  }

  const heatTone = (h: number) => {
    if (h === 0) return 'text-on-surface-subtle';
    if (h < 2)   return 'bg-brand/15 text-on-surface';
    if (h < 5)   return 'bg-brand/30 text-on-surface';
    if (h < 8)   return 'bg-brand/55 text-on-brand-container font-bold';
    return 'bg-accent/70 text-on-accent font-bold';
  };
  const isoFor = (day: number) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const weekdayLabel = (day: number) => ['S','M','T','W','T','F','S'][new Date(year, month-1, day).getDay()];

  // The note panel shows whatever the user is hovering on (or last clicked)
  const hoveredEntries = hoveredCell ? (byEmpDate.get(hoveredCell.emp)?.get(hoveredCell.date) ?? []) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-5 border-b border-outline">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface truncate">Daily activity</h3>
            <p className="text-xs text-on-surface-muted mt-0.5 truncate">{project.name}{project.client_name ? ` · ${project.client_name}` : ''}</p>
            <p className="text-[11px] text-on-surface-subtle mt-1">Each cell is one employee's hours on this project for that day. Hover for the work notes.</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg flex-shrink-0"><X size={16} className="text-on-surface-muted" /></button>
        </div>

        <div className="px-6 py-3 border-b border-outline bg-surface-2/40 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <select value={month} onChange={e => setMonth(Number(e.target.value))}
              className="text-sm bg-surface border border-outline rounded-lg px-2.5 py-1.5">
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i+1} value={i+1}>{new Date(2000, i, 1).toLocaleString('en-IN', { month: 'short' })}</option>
              ))}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="text-sm bg-surface border border-outline rounded-lg px-2.5 py-1.5">
              {[year-1, year, year+1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-6 text-xs">
            <div><span className="text-on-surface-subtle">Hours: </span><span className="num-mono font-bold text-on-surface">{Math.round(totalHours)}h</span></div>
            <div><span className="text-on-surface-subtle">Contributors: </span><span className="num-mono font-bold text-on-surface">{employees.length}</span></div>
            <div><span className="text-on-surface-subtle">Active days: </span><span className="num-mono font-bold text-on-surface">{activeDays}</span></div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="px-6 py-12 text-center text-sm text-on-surface-subtle">Loading…</div>
          ) : employees.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <CalendarDays size={28} className="mx-auto text-on-surface-subtle mb-2" />
              <p className="text-sm text-on-surface-muted">No daily entries logged on this project for {new Date(year, month-1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}.</p>
            </div>
          ) : (
            <table className="text-xs border-collapse w-full">
              <thead className="sticky top-0 bg-surface-2 z-10">
                <tr className="border-b border-outline">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-bold text-on-surface-muted sticky left-0 bg-surface-2 min-w-[160px]">Employee</th>
                  {dayNums.map(d => (
                    <th key={d} className="px-1 py-2 text-center font-mono min-w-[28px]">
                      <div className="text-[9px] uppercase font-bold text-on-surface-subtle">{weekdayLabel(d)}</div>
                      <div className="text-[10px] font-semibold text-on-surface">{d}</div>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right text-[10px] uppercase tracking-wider font-bold text-on-surface-muted bg-surface-3 min-w-[60px]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {employees.map(empId => {
                  const dateMap = byEmpDate.get(empId) ?? new Map();
                  const empTotal = Array.from(dateMap.values()).flat().reduce((s, d) => s + Number(d.hours), 0);
                  return (
                    <tr key={empId} className="hover:bg-surface-2/40">
                      <td className="px-3 py-1.5 text-sm font-semibold text-on-surface sticky left-0 bg-surface hover:bg-surface-2/40 whitespace-nowrap">{empNames.get(empId) ?? '—'}</td>
                      {dayNums.map(d => {
                        const iso = isoFor(d);
                        const entries = dateMap.get(iso) ?? [];
                        const sum = entries.reduce((s: number, e: any) => s + Number(e.hours), 0);
                        const focused = hoveredCell?.emp === empId && hoveredCell?.date === iso;
                        return (
                          <td key={d}
                            onMouseEnter={() => setHoveredCell({ emp: empId, date: iso })}
                            className={`px-1 py-1 text-center text-[11px] cursor-default transition-colors ${heatTone(sum)} ${focused ? 'ring-2 ring-accent ring-inset' : ''}`}
                          >
                            <span className="num-mono">{sum > 0 ? sum : ''}</span>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right num-mono font-bold text-on-surface bg-surface-2/40">{Math.round(empTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-surface-2 border-t border-outline">
                <tr>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-bold text-on-surface-muted sticky left-0 bg-surface-2">Day total</th>
                  {dayNums.map(d => {
                    const sum = totalByDay.get(isoFor(d)) ?? 0;
                    return (
                      <td key={d} className="px-1 py-2 text-center num-mono text-[11px] font-bold text-on-surface">{sum > 0 ? Math.round(sum) : ''}</td>
                    );
                  })}
                  <td className="px-2 py-2 text-right num-mono font-bold text-accent">{Math.round(totalHours)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Hover note panel */}
        <div className="px-6 py-3 border-t border-outline bg-surface-2/40 min-h-[64px]">
          {hoveredCell && hoveredEntries.length > 0 ? (
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">
                {empNames.get(hoveredCell.emp)} · {new Date(hoveredCell.date + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
              </p>
              <ul className="mt-1 space-y-0.5">
                {hoveredEntries.map((e: any) => (
                  <li key={e.id} className="text-xs text-on-surface">
                    <span className="num-mono font-semibold">{Number(e.hours)}h</span>
                    <span className="text-on-surface-muted"> — {e.notes || <em className="text-on-surface-subtle">no note</em>}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-on-surface-subtle italic">Hover a cell to see the day's note.</p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-outline bg-surface flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Project expenses modal — outsourced services, content, ad spend ─────────
const EXPENSE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'outsource', label: 'Outsourced work' },
  { value: 'content',   label: 'Content / copy' },
  { value: 'ads',       label: 'Ad spend' },
  { value: 'tools',     label: 'Tools / software' },
  { value: 'travel',    label: 'Travel' },
  { value: 'other',     label: 'Other' },
];

const fmtINR = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const monthLabel = (m: number, y: number) =>
  new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

function ProjectExpensesModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [list, setList] = useState<FinProjectExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ vendor: '', description: '', amount: '', category: 'outsource' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    financeApi.getProjectExpenses({ project_id: project.id, month, year })
      .then(setList).catch(() => setList([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [project.id, month, year]);

  const total = useMemo(() => list.reduce((s, e) => s + Number(e.amount || 0), 0), [list]);

  const add = async () => {
    const amount = Number(draft.amount);
    if (!draft.description.trim()) { setError('Description is required'); return; }
    if (Number.isNaN(amount) || amount <= 0) { setError('Amount must be a positive number'); return; }
    setError(''); setSaving(true);
    try {
      await financeApi.addProjectExpense({
        project_id: project.id, month, year,
        vendor: draft.vendor.trim() || undefined,
        description: draft.description.trim(),
        amount, category: draft.category,
      });
      setDraft({ vendor: '', description: '', amount: '', category: draft.category });
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to add expense');
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: number) => {
    if (!confirm('Delete this expense?')) return;
    try { await financeApi.deleteProjectExpense(id); load(); }
    catch (err: any) { alert(err.message ?? 'Failed'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-5 border-b border-outline">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface truncate">Project expenses</h3>
            <p className="text-xs text-on-surface-muted mt-0.5 truncate">{project.name}{project.client_name ? ` · ${project.client_name}` : ''}</p>
            <p className="text-[11px] text-on-surface-subtle mt-1">
              Outsourced services, content, ad spend, tools — deducted from this project's revenue in the profitability dashboard.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg flex-shrink-0"><X size={16} className="text-on-surface-muted" /></button>
        </div>

        {/* Month/year + total */}
        <div className="px-6 py-3 border-b border-outline bg-surface-2/40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <select value={month} onChange={e => setMonth(Number(e.target.value))}
              className="text-sm bg-surface border border-outline rounded-lg px-2.5 py-1.5">
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i+1} value={i+1}>{monthLabel(i+1, year).split(' ')[0]}</option>
              ))}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="text-sm bg-surface border border-outline rounded-lg px-2.5 py-1.5">
              {[year-1, year, year+1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">Total · {monthLabel(month, year)}</p>
            <p className="num-mono text-lg font-bold text-warning">{fmtINR(total)}</p>
          </div>
        </div>

        {/* Add form */}
        <div className="px-6 py-3 border-b border-outline grid grid-cols-12 gap-2 items-end">
          <div className="col-span-12 sm:col-span-3">
            <label className="text-[10px] uppercase tracking-wide font-bold text-on-surface-muted block mb-1">Category</label>
            <select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}
              className="w-full text-sm bg-surface border border-outline rounded-lg px-2.5 py-1.5">
              {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="col-span-12 sm:col-span-3">
            <label className="text-[10px] uppercase tracking-wide font-bold text-on-surface-muted block mb-1">Vendor</label>
            <input value={draft.vendor} onChange={e => setDraft({ ...draft, vendor: e.target.value })}
              placeholder="optional"
              className="w-full text-sm bg-surface border border-outline rounded-lg px-2.5 py-1.5 placeholder:text-on-surface-subtle" />
          </div>
          <div className="col-span-12 sm:col-span-4">
            <label className="text-[10px] uppercase tracking-wide font-bold text-on-surface-muted block mb-1">Description *</label>
            <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
              placeholder="e.g. Content writing — May batch"
              className="w-full text-sm bg-surface border border-outline rounded-lg px-2.5 py-1.5 placeholder:text-on-surface-subtle" />
          </div>
          <div className="col-span-8 sm:col-span-2">
            <label className="text-[10px] uppercase tracking-wide font-bold text-on-surface-muted block mb-1">Amount *</label>
            <input value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })}
              type="number" step="0.01" min="0" placeholder="0"
              className="w-full text-sm bg-surface border border-outline rounded-lg px-2.5 py-1.5 text-right num-mono" />
          </div>
          <div className="col-span-4 sm:col-span-12 sm:flex sm:justify-end">
            <button onClick={add} disabled={saving}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity">
              <Plus size={14} /> {saving ? '…' : 'Add'}
            </button>
          </div>
          {error && <p className="col-span-12 text-xs text-danger bg-danger-container px-2 py-1 rounded">{error}</p>}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-6 py-12 text-center text-sm text-on-surface-subtle">Loading…</div>
          ) : list.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Briefcase size={24} className="mx-auto text-on-surface-subtle mb-2" />
              <p className="text-sm text-on-surface-muted">No expenses logged for {monthLabel(month, year)} yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b border-outline">
                <tr className="text-left text-[10px] font-bold text-on-surface-muted uppercase tracking-wider">
                  <th className="px-5 py-2.5">Category</th>
                  <th className="px-3 py-2.5">Vendor / Description</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5">Added by</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {list.map(e => {
                  const cat = EXPENSE_CATEGORIES.find(c => c.value === e.category)?.label ?? e.category;
                  return (
                    <tr key={e.id} className="hover:bg-surface-2/40 transition-colors">
                      <td className="px-5 py-2.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-warning-container text-warning">
                          {cat}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-sm text-on-surface">{e.description}</p>
                        {e.vendor && <p className="text-[11px] text-on-surface-muted">{e.vendor}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-right num-mono font-bold text-warning">{fmtINR(e.amount)}</td>
                      <td className="px-3 py-2.5 text-[11px] text-on-surface-muted">
                        {e.created_by ?? '—'}
                        {e.created_by_role ? <span className="ml-1 px-1 py-0 rounded bg-surface-3 text-on-surface-subtle text-[9px] uppercase">{e.created_by_role.replace('_',' ')}</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button onClick={() => remove(e.id)} className="p-1.5 rounded hover:bg-danger-container/50">
                          <Trash2 size={13} className="text-danger" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-outline bg-surface-2/60 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm font-medium text-on-surface-muted hover:bg-surface-3 rounded-lg transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

function ProjectForm({
  existing, employees, onClose, onSaved, createdBy,
}: {
  existing: Project | null;
  employees: any[];
  onClose: () => void;
  onSaved: () => void;
  createdBy?: string;
}) {
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    client_name: existing?.client_name ?? '',
    project_type: existing?.project_type ?? 'full',
    dashboard_url: existing?.dashboard_url ?? '',
    project_reporting_id: existing?.project_reporting_id ?? '',
    project_lead_id: existing?.project_lead_id ?? '',
    status: existing?.status ?? 'active',
    flag: existing?.flag ?? '',
    flag_reason: existing?.flag_reason ?? '',
    notes: existing?.notes ?? '',
    total_hours_cap: (existing as any)?.total_hours_cap != null ? String((existing as any).total_hours_cap) : '',
    billing_source: (existing as any)?.billing_source ?? 'direct',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setF = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Project name is required.'); return; }
    setSaving(true);
    setError('');
    const reportingEmp = employees.find(e => e.id === form.project_reporting_id);
    const leadEmp = employees.find(e => e.id === form.project_lead_id);
    const trimmedCap = form.total_hours_cap.trim();
    if (trimmedCap && (Number.isNaN(Number(trimmedCap)) || Number(trimmedCap) < 0)) {
      setError('Total hours cap must be a non-negative number.');
      setSaving(false);
      return;
    }
    const payload: any = {
      name: form.name.trim(),
      client_name: form.client_name.trim() || null,
      project_type: form.project_type || null,
      dashboard_url: form.dashboard_url.trim() || null,
      project_reporting_id: form.project_reporting_id || null,
      project_reporting_name: reportingEmp?.name ?? null,
      project_lead_id: form.project_lead_id || null,
      project_lead_name: leadEmp?.name ?? null,
      status: form.status,
      flag: form.flag || null,
      flag_reason: form.flag ? form.flag_reason.trim() || null : null,
      notes: form.notes.trim() || null,
      total_hours_cap: trimmedCap === '' ? null : Number(trimmedCap),
      billing_source: form.billing_source || 'direct',
      created_by: createdBy ?? null,
    };
    try {
      if (existing) await api.updateProject(existing.id, payload);
      else await api.createProject(payload);
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30";
  const selectCls = "w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30";
  const labelCls = "text-xs font-medium text-on-surface-muted mb-1.5 block";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <h3 className="font-display text-lg font-bold text-on-surface tracking-tight">{existing ? 'Edit Project' : 'New Project'}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className={labelCls}>Project Name *</label>
            <input value={form.name} onChange={e => setF('name', e.target.value)}
              placeholder='e.g. "Anatoliy Chistov - Sarab"'
              className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Client Name</label>
              <input value={form.client_name} onChange={e => setF('client_name', e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Project Type</label>
              <select value={form.project_type} onChange={e => setF('project_type', e.target.value)}
                className={selectCls}>
                {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Dashboard URL</label>
            <input value={form.dashboard_url} onChange={e => setF('dashboard_url', e.target.value)}
              placeholder="https://…"
              className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Project Reporting</label>
              <select value={form.project_reporting_id} onChange={e => setF('project_reporting_id', e.target.value)}
                className={selectCls}>
                <option value="">— None —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <p className="text-[11px] text-on-surface-subtle mt-1">Approves hour logs on this project.</p>
            </div>
            <div>
              <label className={labelCls}>Project Lead</label>
              <select value={form.project_lead_id} onChange={e => setF('project_lead_id', e.target.value)}
                className={selectCls}>
                <option value="">— None —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => setF('status', e.target.value)}
                className={selectCls}>
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Flag</label>
              <select value={form.flag} onChange={e => setF('flag', e.target.value)}
                className={selectCls}>
                {FLAGS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
          {form.flag && (
            <div>
              <label className={labelCls}>Flag Reason</label>
              <input value={form.flag_reason} onChange={e => setF('flag_reason', e.target.value)}
                placeholder="Why is this flagged?"
                className={inputCls} />
            </div>
          )}
          <div>
            <label className={labelCls}>Total hours cap <span className="font-normal text-on-surface-subtle">(optional — for one-time / fixed-budget projects)</span></label>
            <input value={form.total_hours_cap} onChange={e => setF('total_hours_cap', e.target.value)}
              type="number" step="0.5" min="0"
              placeholder="Leave blank for recurring projects"
              className={`${inputCls} num-mono`} />
            {existing && (existing as any)?.consumed_hours_total != null && (
              <p className="text-[11px] text-on-surface-subtle mt-1">
                <span className="num-mono font-semibold text-on-surface">{Math.round(Number((existing as any).consumed_hours_total))}h</span> approved so far across all months.
              </p>
            )}
          </div>

          {/* Billing source — Upwork projects route through the wallet so the
              invoice flow flags them. Coordinator gets USD-default + label. */}
          <div>
            <label className={labelCls}>Billing source</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setF('billing_source', 'direct')}
                className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                  form.billing_source !== 'upwork'
                    ? 'border-accent bg-accent-container/40 text-accent'
                    : 'border-outline bg-surface text-on-surface-muted hover:bg-surface-2'
                }`}>
                Direct invoice
                <span className="block text-[10px] font-normal opacity-80 mt-0.5">Client pays directly — invoice + bank transfer</span>
              </button>
              <button type="button" onClick={() => setF('billing_source', 'upwork')}
                className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                  form.billing_source === 'upwork'
                    ? 'border-accent bg-accent-container/40 text-accent'
                    : 'border-outline bg-surface text-on-surface-muted hover:bg-surface-2'
                }`}>
                Upwork
                <span className="block text-[10px] font-normal opacity-80 mt-0.5">Earnings accrue in Upwork wallet → admin withdraws monthly</span>
              </button>
            </div>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={3}
              className={`${inputCls} resize-none`} />
          </div>
          {error && <p className="text-sm text-danger bg-danger-container/50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-accent text-on-accent hover:opacity-90 shadow-elev-1 hover:shadow-elev-2 transition-all disabled:opacity-50">
            {saving ? 'Saving…' : (existing ? 'Save Changes' : 'Create Project')}
          </button>
        </div>
      </div>
    </div>
  );
}
