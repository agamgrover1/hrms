import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, RefreshCw, Download, ChevronRight, AlertTriangle, Clock, CheckCircle2, TrendingUp,
  Briefcase, Users as UsersIcon,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import { api, type ReportsOverview } from '../services/api';
import { toast } from '../components/Toaster';

// Phase 5c — /reports page. Two tabs, one bootstrap endpoint.
//   Overview  → KPI band + charts + activity feed
//   Reports   → tabular breakdowns with CSV export

const CHART_AXIS = '#94a3b8';
const CHART_GRID = 'rgba(148, 163, 184, 0.18)';
const STATUS_PALETTE = ['#5B4CE1', '#EE2770', '#22c55e', '#f59e0b', '#0ea5e9', '#a855f7', '#ef4444', '#14b8a6', '#6366f1', '#eab308'];
const PRIORITY_TONES: Record<string, string> = {
  urgent: '#E23B5F', high: '#D08800', normal: '#5B4CE1', low: '#0F86D6', none: '#6B6577',
};

type Tab = 'overview' | 'reports';
type WindowChoice = 7 | 30 | 90;

export default function Reports() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState<WindowChoice>(30);
  const [data, setData] = useState<ReportsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true); setErr('');
    api.getReportsOverview(days)
      .then(setData)
      .catch((e: any) => setErr(e?.message ?? 'Failed to load reports'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [days]);

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2">
            <BarChart3 className="text-accent" size={22} />
            <h1 className="font-display text-2xl font-bold text-on-surface">Reports</h1>
          </div>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Rollups across projects, tasks and hours. Every metric derives from live data — nothing cached.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-lg border border-outline bg-surface p-1">
            {([7, 30, 90] as WindowChoice[]).map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${days === d ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>
                Last {d}d
              </button>
            ))}
          </div>
          <button onClick={load} className="p-2 rounded-lg border border-outline hover:bg-surface-2" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="inline-flex items-center gap-1 rounded-lg border border-outline bg-surface p-1">
        {(['overview', 'reports'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold ${tab === t ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>
            {t === 'overview' ? 'Overview' : 'Reports'}
          </button>
        ))}
      </div>

      {err && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{err}</div>
      )}
      {loading && !data && (
        <div className="p-10 text-center text-sm text-on-surface-muted">Loading…</div>
      )}

      {data && tab === 'overview' && <OverviewTab data={data} navigate={navigate} />}
      {data && tab === 'reports' && <ReportsTab data={data} />}
    </div>
  );
}

function OverviewTab({ data, navigate }: { data: ReportsOverview; navigate: ReturnType<typeof useNavigate> }) {
  const statusData = useMemo(() => data.tasks_by_status.map((s, i) => ({ ...s, fill: STATUS_PALETTE[i % STATUS_PALETTE.length] })), [data.tasks_by_status]);
  return (
    <>
      {/* KPI band */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Briefcase} label="Active projects" value={data.totals.active_projects} tone="brand" />
        <Kpi icon={Clock}     label="Open tasks"     value={data.totals.open} tone="brand" />
        <Kpi icon={CheckCircle2} label={`Shipped · ${data.days}d`} value={data.totals.completed_in_window} tone="success" />
        <Kpi icon={AlertTriangle} label="Overdue"       value={data.totals.overdue} tone={data.totals.overdue > 0 ? 'danger' : 'brand'} />
        <Kpi icon={TrendingUp} label={`Hours · ${data.days}d`} value={`${data.totals.hours_logged_in_window}h`} tone="accent" />
        <Kpi icon={UsersIcon}  label="People working" value={data.totals.active_assignees} tone="brand" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Tasks by status">
          {statusData.length === 0 ? <EmptyMsg text="No tasks yet." /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={statusData} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 12 }} barSize={16}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                <XAxis type="number" stroke={CHART_AXIS} fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="status" stroke={CHART_AXIS} fontSize={11} width={110} />
                <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ background: 'rgb(var(--surface-3))', border: '1px solid rgba(148,163,184,0.3)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {statusData.map((s, i) => <Cell key={i} fill={s.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Open tasks by priority">
          {data.tasks_by_priority.length === 0 ? <EmptyMsg text="Nothing open." /> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={data.tasks_by_priority} dataKey="count" nameKey="priority" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {data.tasks_by_priority.map((p, i) => (
                    <Cell key={i} fill={PRIORITY_TONES[p.priority] ?? STATUS_PALETTE[i % STATUS_PALETTE.length]} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Overdue by assignee">
          {data.overdue_by_assignee.length === 0 ? <EmptyMsg text="No overdue tasks. Nice." /> : (
            <div className="divide-y divide-outline">
              {data.overdue_by_assignee.map(row => (
                <button key={row.employee_id ?? row.name}
                  onClick={() => row.employee_id && navigate(`/employees/${row.employee_id}?tab=tasks`)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-surface-2 disabled:cursor-default"
                  disabled={!row.employee_id}>
                  <span className="text-on-surface truncate">{row.name}</span>
                  <span className="font-mono tabular-nums text-danger font-semibold">{row.count}</span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title="Project progress" subtitle="top projects by activity">
          {data.projects_completion.length === 0 ? <EmptyMsg text="No projects with tasks yet." /> : (
            <div className="divide-y divide-outline">
              {data.projects_completion.slice(0, 8).map(p => {
                const tone = p.overdue > 0 ? 'bg-danger' : p.pct >= 80 ? 'bg-success' : p.pct >= 40 ? 'bg-brand' : 'bg-warning';
                return (
                  <div key={p.project_id} className="px-3 py-2">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-sm text-on-surface font-semibold truncate">{p.name}</span>
                      <span className="text-[11px] font-mono text-on-surface-muted">{p.done}/{p.total} · {p.pct}%</span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div className={`h-full ${tone}`} style={{ width: `${p.pct}%` }} />
                    </div>
                    {p.overdue > 0 && (
                      <p className="text-[10px] text-danger font-mono mt-0.5">{p.overdue} overdue</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card title="Recent activity" subtitle={`last ${data.days}d`}>
        {data.activity.length === 0 ? <EmptyMsg text="Quiet." /> : (
          <div className="divide-y divide-outline max-h-80 overflow-y-auto">
            {data.activity.map((a, i) => (
              <div key={i} className="px-3 py-2 flex items-start gap-2 text-xs">
                <span className={`w-1 h-1 rounded-full flex-shrink-0 mt-1.5 ${a.source === 'task' ? 'bg-brand' : 'bg-accent'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-on-surface">
                    <b>{a.actor_name ?? 'System'}</b>{' '}
                    <span className="text-on-surface-muted">{a.action.replace(/_/g, ' ')}</span>
                    {a.subject_title && <span className="text-on-surface"> · {a.subject_title}</span>}
                    {a.project_name && <span className="text-on-surface-subtle"> · {a.project_name}</span>}
                  </p>
                  <p className="text-[10px] font-mono text-on-surface-subtle">
                    {new Date(a.when).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function ReportsTab({ data }: { data: ReportsOverview }) {
  return (
    <div className="space-y-4">
      <ReportCard
        title="Hours by employee"
        subtitle={`task time + timesheet · last ${data.days}d`}
        rows={data.time_by_employee}
        headers={['Employee', 'Task hours', 'Timesheet', 'Total']}
        renderRow={(r: any) => [r.name ?? 'Unknown', `${r.task_hours}h`, `${r.timesheet_hours}h`, `${r.total_hours}h`]}
        csvName={`hours-by-employee-${data.days}d`}
        csvBuild={() => csvOf(['Employee', 'Task hours', 'Timesheet hours', 'Total hours'], data.time_by_employee.map((r: any) => [r.name ?? '', r.task_hours, r.timesheet_hours, r.total_hours]))}
      />

      <ReportCard
        title="Tasks by project"
        subtitle="active projects only"
        rows={data.projects_completion}
        headers={['Project', 'Open', 'Done', 'Overdue', 'Completion']}
        renderRow={(r: any) => [
          <span key="n"><span className="font-semibold">{r.name}</span>{r.client_name ? <span className="text-on-surface-subtle"> · {r.client_name}</span> : ''}</span>,
          String(r.open), String(r.done),
          <span key="o" className={r.overdue > 0 ? 'text-danger font-semibold' : ''}>{r.overdue}</span>,
          `${r.pct}%`,
        ]}
        csvName="tasks-by-project"
        csvBuild={() => csvOf(['Project', 'Client', 'Open', 'Done', 'Overdue', 'Total', 'Completion %'],
          data.projects_completion.map((r: any) => [r.name, r.client_name ?? '', r.open, r.done, r.overdue, r.total, r.pct]))}
      />

      <ReportCard
        title="Overdue tasks"
        subtitle={`${data.overdue_tasks.length} rows${data.overdue_tasks.length >= 100 ? ' (capped at 100)' : ''}`}
        rows={data.overdue_tasks}
        headers={['Task', 'Assignee', 'Project', 'Due', 'Days late', 'Priority']}
        renderRow={(r: any) => [
          r.title,
          r.assignee_name ?? '—',
          r.project_name ?? '—',
          new Date(r.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          <span key="d" className="text-danger font-semibold">{r.days_overdue}</span>,
          r.priority,
        ]}
        csvName="overdue-tasks"
        csvBuild={() => csvOf(['Task', 'Assignee', 'Project', 'Due', 'Days overdue', 'Priority'],
          data.overdue_tasks.map((r: any) => [r.title, r.assignee_name ?? '', r.project_name ?? '', r.due_date, r.days_overdue, r.priority]))}
      />
    </div>
  );
}

function ReportCard({ title, subtitle, rows, headers, renderRow, csvName, csvBuild }: {
  title: string; subtitle?: string;
  rows: any[]; headers: string[];
  renderRow: (r: any) => React.ReactNode[];
  csvName: string;
  csvBuild: () => string;
}) {
  const download = () => {
    const csv = csvBuild();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${csvName}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded', `${csvName}.csv`);
  };
  return (
    <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline">
        <div>
          <h3 className="font-display text-sm font-bold text-on-surface">{title}</h3>
          {subtitle && <p className="text-[11px] text-on-surface-muted mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-on-surface-subtle">{rows.length} rows</span>
          <button onClick={download} disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold hover:bg-surface-2 disabled:opacity-40">
            <Download size={12} /> CSV
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-on-surface-subtle italic text-center">No data.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-on-surface-muted font-semibold bg-surface-2/40">
                {headers.map(h => <th key={h} className="text-left px-4 py-2 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline">
              {rows.slice(0, 25).map((r, i) => (
                <tr key={i} className="hover:bg-surface-2">
                  {renderRow(r).map((cell, j) => (
                    <td key={j} className="px-4 py-2 text-on-surface truncate max-w-[300px]">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 25 && (
            <p className="text-[10px] text-on-surface-subtle bg-surface-2/40 px-4 py-2 border-t border-outline">
              Showing 25 of {rows.length}. Export CSV for the full list.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// CSV builder with proper escaping — quotes wrap any cell that contains
// a comma, quote or newline; embedded quotes get doubled.
function csvOf(headers: string[], rows: any[][]): string {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    if (/["\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-outline flex items-baseline justify-between">
        <h3 className="font-display text-sm font-bold text-on-surface">{title}</h3>
        {subtitle && <p className="text-[10px] text-on-surface-subtle">{subtitle}</p>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: React.ReactNode; tone: 'brand' | 'accent' | 'success' | 'danger' }) {
  const toneCls = {
    brand:   'text-brand bg-brand/10',
    accent:  'text-accent bg-accent/10',
    success: 'text-success bg-success/10',
    danger:  'text-danger bg-danger/10',
  }[tone];
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-3 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${toneCls}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle font-semibold">{label}</p>
        <p className="font-display text-xl font-bold text-on-surface mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function EmptyMsg({ text }: { text: string }) {
  return <p className="text-xs text-on-surface-subtle italic text-center py-6">{text}</p>;
}
