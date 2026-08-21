import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users as UsersIcon, RefreshCw, Info, ChevronRight } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toaster';

// Workload — one row per in-scope employee showing capacity vs demand
// for the current week (or month). Reads task_time_entries AND
// hour_log_days side-by-side, read-only. Both existing systems stay
// exactly as they are; this is a viewing layer only.

type Range = 'week' | 'month';
type Scope = 'team' | 'all';
type Workload = Awaited<ReturnType<typeof api.getWorkload>>;

const MANAGER_ROLES = ['admin', 'hr_manager', 'project_coordinator'];

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}
function loadTone(pct: number | null): 'unknown' | 'low' | 'mid' | 'high' | 'over' {
  if (pct == null) return 'unknown';
  if (pct >= 100) return 'over';
  if (pct >= 85) return 'high';
  if (pct >= 60) return 'mid';
  return 'low';
}
const TONE_BAR: Record<string, string> = {
  low:  'bg-success',
  mid:  'bg-brand',
  high: 'bg-warning',
  over: 'bg-danger',
  unknown: 'bg-outline',
};
const TONE_TEXT: Record<string, string> = {
  low:  'text-success',
  mid:  'text-brand',
  high: 'text-warning',
  over: 'text-danger',
  unknown: 'text-on-surface-subtle',
};

export default function Workload() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canSeeAll = MANAGER_ROLES.includes(user?.role ?? '');
  const [range, setRange] = useState<Range>('week');
  const [scope, setScope] = useState<Scope>(canSeeAll ? 'all' : 'team');
  const [data, setData] = useState<Workload | null>(null);
  const [loading, setLoading] = useState(true);
  const [dept, setDept] = useState<string>('');

  const load = () => {
    setLoading(true);
    api.getWorkload({ range, scope })
      .then(setData)
      .catch((e: any) => toast.error('Could not load workload', e?.message ?? 'Please try again.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [range, scope]);

  const depts = useMemo(() => {
    const s = new Set<string>();
    (data?.rows ?? []).forEach(r => r.employee.department && s.add(r.employee.department));
    return Array.from(s).sort();
  }, [data]);
  const filtered = useMemo(() => {
    if (!data) return [];
    return dept ? data.rows.filter(r => r.employee.department === dept) : data.rows;
  }, [data, dept]);

  const summary = useMemo(() => {
    const over  = filtered.filter(r => (r.load_pct ?? 0) >= 100).length;
    const high  = filtered.filter(r => (r.load_pct ?? 0) >= 85 && (r.load_pct ?? 0) < 100).length;
    const under = filtered.filter(r => (r.load_pct ?? 0) < 60 && r.load_pct != null).length;
    const overdue = filtered.reduce((a, r) => a + r.overdue, 0);
    return { over, high, under, overdue, total: filtered.length };
  }, [filtered]);

  // Rebalance nudge — surface the single most-loaded person whose queue
  // has an obvious moveable task (i.e. any active task with no dep).
  const topOverloaded = filtered.find(r => (r.load_pct ?? 0) >= 100);

  const windowLabel = data
    ? range === 'week'
      ? `${new Date(data.start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(data.end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
      : new Date(data.start).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2">
            <UsersIcon className="text-accent" size={22} />
            <h1 className="font-display text-2xl font-bold text-on-surface">Workload</h1>
          </div>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Capacity vs demand across {scope === 'all' ? 'the org' : 'your team'} — reads project allocations + task time + timesheet, all read-only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-lg border border-outline bg-surface p-1">
            {(['week', 'month'] as Range[]).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${range === r ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>
                {r === 'week' ? 'This week' : 'This month'}
              </button>
            ))}
          </div>
          {canSeeAll && (
            <div className="inline-flex items-center gap-1 rounded-lg border border-outline bg-surface p-1">
              {(['team', 'all'] as Scope[]).map(s => (
                <button key={s} onClick={() => setScope(s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${scope === s ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>
                  {s === 'team' ? 'My team' : 'Whole org'}
                </button>
              ))}
            </div>
          )}
          <button onClick={load} className="p-2 rounded-lg border border-outline hover:bg-surface-2" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="People" value={summary.total} hint={windowLabel} />
        <SummaryCard label="Over capacity" value={summary.over} tone="danger" />
        <SummaryCard label="Near limit" value={summary.high} tone="warning" hint="85–99%" />
        <SummaryCard label="Under-utilised" value={summary.under} tone="success" hint="<60%" />
        <SummaryCard label="Overdue tasks" value={summary.overdue} tone={summary.overdue > 0 ? 'danger' : undefined} />
      </div>

      {/* Rebalance card */}
      {topOverloaded && (
        <div className="rounded-xl-2 border border-outline bg-brand-container/40 px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand text-on-accent grid place-items-center font-bold text-sm">i</div>
          <div className="flex-1 text-sm text-on-surface">
            <b>{topOverloaded.employee.name} is {topOverloaded.load_pct}% loaded this {range}.</b>{' '}
            {topOverloaded.overdue > 0 && <>Has <b className="text-danger">{topOverloaded.overdue} overdue</b>. </>}
            Consider reassigning the lowest-priority items or extending due dates.
          </div>
          <button onClick={() => navigate(`/employees/${topOverloaded.employee.id}?tab=tasks`)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:opacity-80">
            View queue <ChevronRight size={13} />
          </button>
        </div>
      )}

      {/* Filter row */}
      {depts.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-subtle font-semibold">Department</span>
          <button onClick={() => setDept('')}
            className={`px-2 py-1 rounded-full text-xs font-semibold border ${!dept ? 'bg-accent text-on-accent border-transparent' : 'text-on-surface-muted border-outline hover:bg-surface-2'}`}>
            All
          </button>
          {depts.map(d => (
            <button key={d} onClick={() => setDept(d === dept ? '' : d)}
              className={`px-2 py-1 rounded-full text-xs font-semibold border ${dept === d ? 'bg-accent text-on-accent border-transparent' : 'text-on-surface-muted border-outline hover:bg-surface-2'}`}>
              {d}
            </button>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-on-surface-subtle">
        <LegendChip color="bg-success" label="< 60%" />
        <LegendChip color="bg-brand"   label="60–85%" />
        <LegendChip color="bg-warning" label="85–100%" />
        <LegendChip color="bg-danger"  label="over 100%" />
        <span className="inline-flex items-center gap-1 ml-2">
          <Info size={11} /> demand = logged this {range} + estimate on open tasks due this {range}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        <div className="grid grid-cols-[minmax(220px,1.4fr)_2fr_80px_80px_80px_80px] items-center gap-3 px-4 py-2.5 bg-surface-2 border-b border-outline text-[10px] uppercase tracking-wider font-semibold text-on-surface-muted">
          <span>Employee</span>
          <span>Load</span>
          <span className="text-right">Capacity</span>
          <span className="text-right">Task hrs</span>
          <span className="text-right">Timesheet</span>
          <span className="text-right">Overdue</span>
        </div>
        {loading && filtered.length === 0 && (
          <div className="p-10 text-center text-sm text-on-surface-muted">Loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-10 text-center text-sm text-on-surface-subtle">
            {scope === 'team'
              ? 'No direct reports found. Switch to "Whole org" if you\'re admin/HR.'
              : 'No active employees in this department.'}
          </div>
        )}
        {filtered.map(r => {
          const tone = loadTone(r.load_pct);
          const barWidth = r.load_pct != null ? Math.min(100, r.load_pct) : 0;
          return (
            <details key={r.employee.id} className="group border-b border-outline last:border-b-0">
              <summary className="grid grid-cols-[minmax(220px,1.4fr)_2fr_80px_80px_80px_80px] items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-2 list-none">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-brand-container text-on-brand-container text-[10px] font-bold grid place-items-center flex-shrink-0">
                    {initials(r.employee.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-on-surface font-semibold truncate">{r.employee.name}</p>
                    <p className="text-[10px] text-on-surface-subtle truncate">{r.employee.designation ?? ''}{r.employee.designation && r.employee.department ? ' · ' : ''}{r.employee.department ?? ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
                    <div className={`${TONE_BAR[tone]} h-full rounded-full transition-all`} style={{ width: `${barWidth}%` }} />
                  </div>
                  <span className={`font-mono tabular-nums text-xs font-bold ${TONE_TEXT[tone]}`}>
                    {r.load_pct == null ? '—' : `${r.load_pct}%`}
                  </span>
                </div>
                <span className="font-mono tabular-nums text-xs text-on-surface-muted text-right">{r.capacity_hours}h</span>
                <span className="font-mono tabular-nums text-xs text-on-surface-muted text-right">{r.task_logged_hours}h</span>
                <span className="font-mono tabular-nums text-xs text-on-surface-muted text-right">{r.manual_logged_hours}h</span>
                <span className={`font-mono tabular-nums text-xs text-right font-semibold ${r.overdue > 0 ? 'text-danger' : 'text-on-surface-subtle'}`}>
                  {r.overdue}
                </span>
              </summary>
              <div className="px-4 pb-4 bg-surface-2/50 border-t border-outline">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle font-semibold mb-1.5">Top of queue</p>
                    {r.top_tasks.length === 0 ? (
                      <p className="text-xs text-on-surface-subtle italic">No active tasks assigned.</p>
                    ) : (
                      <div className="space-y-1">
                        {r.top_tasks.map(t => (
                          <button key={t.id} onClick={() => navigate(`/tasks?task=${t.id}`)}
                            className="w-full text-left text-xs flex items-center gap-2 py-1 px-2 rounded hover:bg-surface">
                            <span className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
                            <span className="flex-1 min-w-0 truncate text-on-surface">{t.title}</span>
                            <span className="text-[10px] text-on-surface-subtle truncate max-w-[100px]">{t.project_name ?? '—'}</span>
                            {t.due_date && (
                              <span className={`font-mono text-[10px] ${new Date(t.due_date) < new Date() ? 'text-danger font-semibold' : 'text-on-surface-subtle'}`}>
                                {new Date(t.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 content-start">
                    <MiniStat label="Task time" value={`${r.task_logged_hours}h`} hint="from task_time_entries" />
                    <MiniStat label="Timesheet" value={`${r.manual_logged_hours}h`} hint="from hour_log_days" />
                    <MiniStat label="Estimate ahead" value={`${r.estimate_hours}h`} hint={`open tasks due this ${range}`} />
                    <MiniStat label="Demand total" value={`${r.demand_hours}h`} hint="logged + estimate" />
                  </div>
                </div>
                <div className="flex justify-end mt-3">
                  <button onClick={() => navigate(`/employees/${r.employee.id}?tab=tasks`)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:opacity-80">
                    Open full profile <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            </details>
          );
        })}
      </div>

      {data && (
        <p className="text-[10px] text-on-surface-subtle text-right">
          Window: {windowLabel} · Task time is an additional source — the existing timesheet approval flow is unchanged.
        </p>
      )}
    </div>
  );
}

function SummaryCard({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: 'danger' | 'warning' | 'success' }) {
  const toneCls = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-on-surface';
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle font-semibold">{label}</p>
      <p className={`font-display text-2xl font-bold mt-1 ${toneCls}`}>{value}</p>
      {hint && <p className="text-[10px] text-on-surface-subtle mt-0.5">{hint}</p>}
    </div>
  );
}
function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`w-2.5 h-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  );
}
function MiniStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-outline bg-surface p-2">
      <p className="text-[9px] uppercase tracking-wider text-on-surface-subtle font-semibold">{label}</p>
      <p className="font-mono tabular-nums text-sm text-on-surface font-semibold mt-0.5">{value}</p>
      <p className="text-[9px] text-on-surface-subtle italic mt-0.5">{hint}</p>
    </div>
  );
}
