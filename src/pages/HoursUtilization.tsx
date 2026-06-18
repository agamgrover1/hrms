import { useEffect, useMemo, useState } from 'react';
import { Users as UsersIcon, AlertTriangle, Calendar, ChevronRight } from 'lucide-react';
import { api } from '../services/api';
import EmployeeHoursDetailModal from '../components/EmployeeHoursDetailModal';

type UtilGroupKey = 'none' | 'manager' | 'department';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FULL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function pct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return `${(v * 100).toFixed(0)}%`;
}
function hrs(n: number): string {
  return `${Math.round(n)}h`;
}

export default function HoursUtilization() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [groupBy, setGroupBy] = useState<UtilGroupKey>('none');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getHoursUtilization>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Drill-in modal — clicking an employee row opens their full hours
  // detail (project assignments, weekly breakdown, logged + internal).
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    setLoading(true); setErr('');
    api.getHoursUtilization(month, year)
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [month, year]);

  const groups = useMemo(() => {
    if (!data) return [];
    if (groupBy === 'none') return [{ name: null as string | null, rows: data.employees, totalAlloc: 0, totalCap: 0, totalBench: 0 }];
    const keyOf = (e: any) => groupBy === 'manager'
      ? (e.reporting_manager_name || 'No manager')
      : (e.department || '—');
    const buckets = new Map<string, any[]>();
    for (const e of data.employees) {
      const k = keyOf(e);
      const arr = buckets.get(k); if (arr) arr.push(e); else buckets.set(k, [e]);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, rows]) => ({
        name, rows,
        totalAlloc: rows.reduce((s, r) => s + Number(r.allocatedHours || 0), 0),
        totalCap: rows.reduce((s, r) => s + Number(r.capacity || 0), 0),
        totalBench: rows.reduce((s, r) => s + Number(r.benchHours || 0), 0),
      }));
  }, [data, groupBy]);

  const orgTotal = data?.total;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">Direct staff utilization</h1>
          <p className="text-sm text-on-surface-muted mt-0.5">
            {data?.scope === 'team'
              ? <>Your team's planned hours vs. monthly capacity. <span className="text-on-surface-subtle">No salary or cost data shown.</span></>
              : <>Everyone on direct-cost work this month. <span className="text-on-surface-subtle">Hours only — no salary breakdown.</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-2 bg-surface rounded-lg border border-outline px-3 py-2">
            <Calendar size={14} className="text-on-surface-subtle" />
            <select value={month} onChange={e => setMonth(Number(e.target.value))}
              className="text-sm bg-transparent focus:outline-none">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{FULL_MONTHS[i]}</option>)}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="text-sm bg-transparent focus:outline-none num-mono">
              {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-lg p-0.5">
            <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-on-surface-subtle pl-1.5">Group</span>
            {([
              { key: 'none', label: 'None' },
              { key: 'manager', label: 'Team' },
              { key: 'department', label: 'Department' },
            ] as Array<{ key: UtilGroupKey; label: string }>).map(opt => (
              <button key={opt.key} onClick={() => setGroupBy(opt.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  groupBy === opt.key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'
                }`}>{opt.label}</button>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      {/* Headline tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Headcount" value={String(orgTotal?.headcount ?? 0)} sub="direct staff this month" />
        <Tile label="Allocated" value={hrs(orgTotal?.allocated ?? 0)} sub={`of ${hrs(orgTotal?.capacity ?? 0)} capacity`} tone="text-on-surface" />
        <Tile label="Bench" value={hrs(orgTotal?.bench ?? 0)} sub="hours not yet planned"
          tone={(orgTotal?.bench ?? 0) > 0 ? 'text-warning' : 'text-on-surface-subtle'} />
        <Tile label="Utilization" value={pct(orgTotal?.utilization)} sub="allocated ÷ capacity"
          tone={(orgTotal?.utilization ?? 0) >= 0.8 ? 'text-success' : (orgTotal?.utilization ?? 0) >= 0.6 ? 'text-warning' : 'text-danger'} />
      </div>

      {/* Drill-in modal — clicking a row opens project + weekly breakdown
          for that employee in the selected month. */}
      {detail && (
        <EmployeeHoursDetailModal
          employeeId={detail.id}
          employeeName={detail.name}
          month={month}
          year={year}
          onClose={() => setDetail(null)}
        />
      )}

      {/* Per-employee list */}
      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-outline flex items-center justify-between">
          <p className="text-sm font-semibold text-on-surface">Per-employee utilization</p>
          <p className="text-[11px] text-on-surface-subtle">Click any row for the project + weekly breakdown.</p>
        </div>
        {loading ? (
          <div className="p-12 text-center text-sm text-on-surface-subtle">Loading…</div>
        ) : !data || data.employees.length === 0 ? (
          <div className="p-12 text-center">
            <UsersIcon size={28} className="mx-auto text-on-surface-subtle mb-2" />
            <p className="text-sm text-on-surface-muted">
              {data?.scope === 'team' ? "No one on your team is direct-billable this month." : 'No direct staff classified yet.'}
            </p>
            {data?.scope !== 'team' && <p className="text-xs text-on-surface-subtle mt-1">Classify staff under Finance → Classification to populate this view.</p>}
          </div>
        ) : (
          <div className="divide-y divide-outline">
            {groups.map(g => (
              <div key={g.name ?? '__all__'}>
                {g.name !== null && (
                  <div className="flex items-center justify-between gap-3 px-5 py-2 bg-gradient-to-r from-brand-container/40 to-transparent">
                    <div className="inline-flex items-center gap-2">
                      <UsersIcon size={13} className="text-brand" />
                      <span className="font-display text-sm font-bold text-on-surface">{g.name}</span>
                      <span className="num-mono text-[10px] font-semibold text-on-surface-muted bg-surface px-1.5 py-0.5 rounded-full">{g.rows.length}</span>
                    </div>
                    <div className="text-[11px] text-on-surface-muted num-mono">
                      {hrs(g.totalAlloc)}/{hrs(g.totalCap)} · {pct(g.totalCap > 0 ? g.totalAlloc / g.totalCap : null)}
                    </div>
                  </div>
                )}
                {g.rows.map((e: any) => {
                  const u = e.utilization ?? 0;
                  const barColor = u > 1 ? 'bg-danger' : u >= 0.8 ? 'bg-success' : u >= 0.6 ? 'bg-warning' : 'bg-danger/60';
                  const isOver = u > 1;
                  return (
                    <button key={e.id}
                      onClick={() => setDetail({ id: e.id, name: e.name })}
                      title={`Open ${e.name}'s hours detail — projects, weekly breakdown, and logs`}
                      className="w-full flex items-center gap-4 px-5 py-2.5 text-left hover:bg-surface-2 transition-colors group">
                      <div className="w-44 shrink-0">
                        <div className="text-sm font-medium text-on-surface truncate group-hover:text-accent transition-colors">{e.name}</div>
                        <div className="text-xs text-on-surface-subtle truncate">{e.designation || e.department || '—'}</div>
                      </div>
                      <div className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(u, 1) * 100}%` }} />
                      </div>
                      <div className="w-16 text-right text-sm tabular-nums num-mono text-on-surface inline-flex items-center justify-end gap-1">
                        {isOver && <AlertTriangle size={11} className="text-danger" />}
                        {pct(u)}
                      </div>
                      <div className="w-40 text-right text-xs text-on-surface-subtle num-mono">
                        {hrs(e.allocatedHours)}/{hrs(e.capacity)} · bench {hrs(e.benchHours)}
                      </div>
                      <ChevronRight size={14} className="text-on-surface-subtle group-hover:text-accent transition-colors flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-4">
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">{label}</div>
      <div className={`mt-1 text-2xl font-bold num-mono ${tone || 'text-on-surface'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-on-surface-subtle">{sub}</div>}
    </div>
  );
}
