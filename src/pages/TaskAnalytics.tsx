import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import {
  BarChart3, KanbanSquare, Filter, AlertTriangle, CheckCircle2, Clock, PlayCircle, Loader2,
} from 'lucide-react';
import { api } from '../services/api';
import type { Task, TaskBoard } from '../services/api';

// Task analytics — cross-organisation view aggregated client-side from
// /api/tasks (which is already visibility-filtered, so a viewer only ever
// sees analytics for the boards they can access). Filter chips narrow the
// dataset; every chart re-computes from the filtered slice.

type StatusType = 'open' | 'active' | 'done';
const STATUS_TYPE_LABEL: Record<StatusType, string> = { open: 'Open', active: 'In progress', done: 'Done' };
const STATUS_COLORS: Record<StatusType, string> = { open: '#94a3b8', active: '#2563eb', done: '#15803d' };
const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#dc2626', high: '#ea580c', normal: '#2563eb', low: '#94a3b8', none: '#cbd5e1',
};
// Palette for chart series where the count isn't fixed (board / assignee).
const SERIES = ['#EE2770', '#2563eb', '#15803d', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#334155'];

interface Employee { id: string; name: string; department?: string | null; status?: string }

// Every task carries its board's statuses inline (list_statuses), so we
// can map t.status → the column's type without a separate lookup.
function statusTypeOf(t: Task): StatusType {
  const col = (t.list_statuses ?? []).find(s => s.id === t.status);
  return (col?.type as StatusType) ?? 'open';
}

function withinRange(d: string | null | undefined, from: string, to: string): boolean {
  if (!d) return !from && !to;
  const iso = d.slice(0, 10);
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

export default function TaskAnalytics() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [boards, setBoards] = useState<TaskBoard[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // Filters
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());   // '' = internal
  const [boardFilter, setBoardFilter] = useState<Set<string>>(new Set());
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(new Set()); // 'unassigned' sentinel
  const [statusFilter, setStatusFilter] = useState<Set<StatusType>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(new Set());
  const [rangeField, setRangeField] = useState<'created_at' | 'due_date'>('created_at');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.listTasks({}).catch(() => [] as Task[]),
      api.listTaskBoards({ include_archived: true }).catch(() => [] as TaskBoard[]),
      api.getEmployees().catch(() => [] as any[]),
    ])
      .then(([t, b, e]) => {
        setTasks(t);
        setBoards(b);
        setEmployees((e as any[]).filter(x => x.status === 'active'));
      })
      .catch((e: any) => setErr(e?.message ?? 'Failed to load analytics'))
      .finally(() => setLoading(false));
  }, []);

  const empName = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.id, e.name);
    return m;
  }, [employees]);
  const boardById = useMemo(() => {
    const m = new Map<string, TaskBoard>();
    for (const b of boards) m.set(b.id, b);
    return m;
  }, [boards]);
  const projects = useMemo(() => {
    const set = new Map<string, string>();
    for (const b of boards) {
      if (b.project_id) set.set(b.project_id, b.project_name ?? b.project_id);
    }
    return Array.from(set.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [boards]);

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      const b = boardById.get(t.list_id);
      if (projectFilter.size) {
        const pid = b?.project_id ?? '';
        if (!projectFilter.has(pid || '__internal__')) return false;
      }
      if (boardFilter.size && !boardFilter.has(t.list_id)) return false;
      if (assigneeFilter.size) {
        const key = t.assignee_id ?? 'unassigned';
        if (!assigneeFilter.has(key)) return false;
      }
      if (statusFilter.size && !statusFilter.has(statusTypeOf(t))) return false;
      if (priorityFilter.size && !priorityFilter.has(t.priority)) return false;
      if (fromDate || toDate) {
        const src = rangeField === 'due_date' ? t.due_date : t.created_at;
        if (!withinRange(src, fromDate, toDate)) return false;
      }
      return true;
    });
  }, [tasks, boardById, projectFilter, boardFilter, assigneeFilter, statusFilter, priorityFilter, rangeField, fromDate, toDate]);

  // ── Aggregations ─────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const kpis = useMemo(() => {
    let open = 0, active = 0, done = 0, overdue = 0;
    for (const t of filtered) {
      const st = statusTypeOf(t);
      if (st === 'open') open++;
      else if (st === 'active') active++;
      else if (st === 'done') done++;
      if (st !== 'done' && t.due_date && t.due_date < today) overdue++;
    }
    return { total: filtered.length, open, active, done, overdue };
  }, [filtered, today]);

  const statusData = useMemo(() => {
    const buckets: Record<StatusType, number> = { open: 0, active: 0, done: 0 };
    for (const t of filtered) buckets[statusTypeOf(t)]++;
    return (Object.keys(buckets) as StatusType[])
      .filter(k => buckets[k] > 0)
      .map(k => ({ name: STATUS_TYPE_LABEL[k], value: buckets[k], color: STATUS_COLORS[k] }));
  }, [filtered]);

  const priorityData = useMemo(() => {
    const buckets: Record<string, number> = { urgent: 0, high: 0, normal: 0, low: 0, none: 0 };
    for (const t of filtered) buckets[t.priority] = (buckets[t.priority] ?? 0) + 1;
    return Object.entries(buckets)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: k[0].toUpperCase() + k.slice(1), value: v, color: PRIORITY_COLORS[k] ?? '#94a3b8' }));
  }, [filtered]);

  const byAssignee = useMemo(() => {
    const map = new Map<string, { name: string; open: number; active: number; done: number; overdue: number }>();
    for (const t of filtered) {
      const key = t.assignee_id ?? 'unassigned';
      const name = key === 'unassigned' ? 'Unassigned' : (empName.get(key) ?? t.assignee_name ?? 'Unknown');
      const row = map.get(key) ?? { name, open: 0, active: 0, done: 0, overdue: 0 };
      const st = statusTypeOf(t);
      row[st] += 1;
      if (st !== 'done' && t.due_date && t.due_date < today) row.overdue++;
      map.set(key, row);
    }
    return Array.from(map.values())
      .sort((a, b) => (b.open + b.active + b.done) - (a.open + a.active + a.done))
      .slice(0, 12);
  }, [filtered, empName, today]);

  const byBoard = useMemo(() => {
    const map = new Map<string, { name: string; open: number; active: number; done: number; total: number }>();
    for (const t of filtered) {
      const b = boardById.get(t.list_id);
      const name = b?.name ?? 'Unknown board';
      const row = map.get(t.list_id) ?? { name, open: 0, active: 0, done: 0, total: 0 };
      row[statusTypeOf(t)] += 1;
      row.total += 1;
      map.set(t.list_id, row);
    }
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [filtered, boardById]);

  const overdueByAssignee = useMemo(() => {
    return byAssignee
      .filter(a => a.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue)
      .slice(0, 10)
      .map(a => ({ name: a.name, overdue: a.overdue }));
  }, [byAssignee]);

  const trend = useMemo(() => {
    // Weekly created vs done, bucketed by ISO week of created_at / completed_at.
    // Show last 12 weeks based on today.
    const weekKey = (d: Date) => {
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    };
    const buckets = new Map<string, { week: string; created: number; done: number }>();
    for (const t of filtered) {
      const c = new Date(t.created_at);
      const ck = weekKey(c);
      if (!buckets.has(ck)) buckets.set(ck, { week: ck, created: 0, done: 0 });
      buckets.get(ck)!.created += 1;
      if (t.completed_at) {
        const d = new Date(t.completed_at);
        const dk = weekKey(d);
        if (!buckets.has(dk)) buckets.set(dk, { week: dk, created: 0, done: 0 });
        buckets.get(dk)!.done += 1;
      }
    }
    // Last 12 non-empty weeks in chronological order.
    return Array.from(buckets.values())
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-12);
  }, [filtered]);

  // ── UI helpers ────────────────────────────────────────────────
  const toggle = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setter(next);
  };
  const clearAll = () => {
    setProjectFilter(new Set()); setBoardFilter(new Set()); setAssigneeFilter(new Set());
    setStatusFilter(new Set()); setPriorityFilter(new Set()); setFromDate(''); setToDate('');
  };

  if (loading) {
    return <div className="p-8 text-center text-sm text-on-surface-muted"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading analytics…</div>;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface flex items-center gap-2">
            <BarChart3 size={20} className="text-accent" /> Task analytics
          </h1>
          <p className="text-sm text-on-surface-muted mt-0.5">
            {kpis.total} tasks across {byBoard.length} board{byBoard.length === 1 ? '' : 's'} — narrow with filters below.
          </p>
        </div>
        <Link to="/tasks" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-outline bg-surface hover:bg-surface-2 text-on-surface">
          <KanbanSquare size={13} /> Back to boards
        </Link>
      </div>

      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      {/* Filters */}
      <div className="rounded-xl-2 border border-outline bg-surface p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Filter size={13} className="text-on-surface-muted" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">Filters</span>
          {(projectFilter.size || boardFilter.size || assigneeFilter.size || statusFilter.size || priorityFilter.size || fromDate || toDate) ? (
            <button onClick={clearAll} className="ml-auto text-[11px] text-accent font-semibold hover:underline">Clear all</button>
          ) : null}
        </div>

        {/* Status pills */}
        <div className="flex flex-wrap gap-1.5">
          {(['open', 'active', 'done'] as StatusType[]).map(s => (
            <button key={s} onClick={() => toggle(statusFilter, s, setStatusFilter)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                statusFilter.has(s) ? 'text-white border-transparent' : 'bg-surface border-outline text-on-surface-muted hover:text-on-surface'
              }`}
              style={statusFilter.has(s) ? { background: STATUS_COLORS[s] } : undefined}>
              {STATUS_TYPE_LABEL[s]}
            </button>
          ))}
        </div>

        {/* Priority pills */}
        <div className="flex flex-wrap gap-1.5">
          {['urgent', 'high', 'normal', 'low', 'none'].map(p => (
            <button key={p} onClick={() => toggle(priorityFilter, p, setPriorityFilter)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                priorityFilter.has(p) ? 'text-white border-transparent' : 'bg-surface border-outline text-on-surface-muted hover:text-on-surface'
              }`}
              style={priorityFilter.has(p) ? { background: PRIORITY_COLORS[p] } : undefined}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        {/* Project + Board + Assignee dropdowns */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <MultiPicker
            label="Project"
            options={[['__internal__', 'Internal (no project)'], ...projects.map(([id, n]) => [id, n] as [string, string])]}
            selected={projectFilter}
            onToggle={v => toggle(projectFilter, v, setProjectFilter)}
          />
          <MultiPicker
            label="Board"
            options={boards.map(b => [b.id, b.name] as [string, string])}
            selected={boardFilter}
            onToggle={v => toggle(boardFilter, v, setBoardFilter)}
          />
          <MultiPicker
            label="Assignee"
            options={[['unassigned', 'Unassigned'], ...employees.map(e => [e.id, e.name] as [string, string])]}
            selected={assigneeFilter}
            onToggle={v => toggle(assigneeFilter, v, setAssigneeFilter)}
          />
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-muted mb-1">Date range ({rangeField === 'due_date' ? 'due' : 'created'})</label>
            <div className="flex items-center gap-1">
              <select value={rangeField} onChange={e => setRangeField(e.target.value as any)}
                className="text-xs px-2 py-1.5 rounded-lg border border-outline bg-surface-2">
                <option value="created_at">Created</option>
                <option value="due_date">Due</option>
              </select>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border border-outline bg-surface-2 min-w-0 flex-1" />
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border border-outline bg-surface-2 min-w-0 flex-1" />
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KpiTile icon={KanbanSquare} label="Total" value={kpis.total} tone="text-on-surface" />
        <KpiTile icon={Clock}        label="Open"       value={kpis.open}    tone="text-on-surface-muted" />
        <KpiTile icon={PlayCircle}   label="In progress" value={kpis.active} tone="text-info" />
        <KpiTile icon={CheckCircle2} label="Done"       value={kpis.done}    tone="text-success" />
        <KpiTile icon={AlertTriangle} label="Overdue"   value={kpis.overdue} tone="text-danger" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Status distribution">
          {statusData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                  label={(d: any) => `${d.name} ${d.value}`}>
                  {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Priority mix">
          {priorityData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={priorityData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                  label={(d: any) => `${d.name} ${d.value}`}>
                  {priorityData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Tasks by assignee (top 12)">
          {byAssignee.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={Math.max(260, byAssignee.length * 24)}>
              <BarChart data={byAssignee} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="open" stackId="a" fill={STATUS_COLORS.open} name="Open" />
                <Bar dataKey="active" stackId="a" fill={STATUS_COLORS.active} name="In progress" />
                <Bar dataKey="done" stackId="a" fill={STATUS_COLORS.done} name="Done" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Tasks by board (top 12)">
          {byBoard.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={Math.max(260, byBoard.length * 24)}>
              <BarChart data={byBoard} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="open" stackId="b" fill={STATUS_COLORS.open} name="Open" />
                <Bar dataKey="active" stackId="b" fill={STATUS_COLORS.active} name="In progress" />
                <Bar dataKey="done" stackId="b" fill={STATUS_COLORS.done} name="Done" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Overdue by assignee">
          {overdueByAssignee.length === 0 ? <p className="p-6 text-center text-sm text-on-surface-muted">Nothing overdue right now. </p> : (
            <ResponsiveContainer width="100%" height={Math.max(220, overdueByAssignee.length * 24)}>
              <BarChart data={overdueByAssignee} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="overdue" fill="#dc2626" name="Overdue" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Created vs done — last 12 weeks">
          {trend.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="created" stroke={SERIES[0]} strokeWidth={2} name="Created" />
                <Line type="monotone" dataKey="done"    stroke={STATUS_COLORS.done} strokeWidth={2} name="Done" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────
function KpiTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">
        <Icon size={11} /> {label}
      </div>
      <p className={`text-2xl font-display font-bold num-mono mt-1 ${tone}`}>{value}</p>
    </div>
  );
}
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-4">
      <h3 className="text-sm font-semibold text-on-surface mb-3">{title}</h3>
      {children}
    </div>
  );
}
function EmptyChart() {
  return <p className="p-8 text-center text-sm text-on-surface-subtle">No data for the current filters.</p>;
}
function MultiPicker({ label, options, selected, onToggle }: {
  label: string;
  options: Array<[string, string]>;
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const shown = q.trim() ? options.filter(([, n]) => n.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div className="relative">
      <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-muted mb-1">
        {label} {selected.size > 0 && <span className="normal-case font-normal text-accent">· {selected.size}</span>}
      </label>
      <button onClick={() => setOpen(o => !o)}
        className="w-full text-left px-3 py-1.5 rounded-lg border border-outline bg-surface-2 text-xs text-on-surface hover:bg-surface-3">
        {selected.size ? `${selected.size} selected` : `All ${label.toLowerCase()}s`}
      </button>
      {open && (
        <div className="absolute z-10 top-full mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-outline bg-surface shadow-elev-3 p-1">
          <input value={q} onChange={e => setQ(e.target.value)} autoFocus
            placeholder={`Search ${label.toLowerCase()}…`}
            className="w-full px-2 py-1.5 rounded border border-outline bg-surface-2 text-xs mb-1" />
          {shown.length === 0 && <p className="p-2 text-[11px] italic text-on-surface-subtle">No matches.</p>}
          {shown.map(([id, n]) => (
            <label key={id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-2 cursor-pointer text-xs">
              <input type="checkbox" checked={selected.has(id)} onChange={() => onToggle(id)} />
              <span className="flex-1 truncate">{n}</span>
            </label>
          ))}
          <button onClick={() => setOpen(false)}
            className="w-full mt-1 py-1 text-[11px] font-semibold text-on-surface-muted hover:bg-surface-2 rounded">Close</button>
        </div>
      )}
    </div>
  );
}
