import { useEffect, useState } from 'react';
import { financeApi, type FinModel } from '../../services/financeApi';
import { MONTHS, money, moneyShort, pct, hrs, marginTone } from './format';

export default function DashboardTab({ month, year, rev }: { month: number; year: number; rev: number }) {
  const [model, setModel] = useState<FinModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true); setErr('');
    financeApi.getDashboard(month, year)
      .then(setModel)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [month, year, rev]);

  if (loading) return <Skeleton />;
  if (err) return <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-4 text-sm text-danger">{err}</div>;
  if (!model) return null;

  const c = model.settings.currency;
  const t = model.totals;
  const hasData = t.headcount > 0 || t.activeProjects > 0;

  if (!hasData) {
    return (
      <div className="rounded-xl-2 border border-outline bg-surface p-8 text-center text-sm text-on-surface-muted">
        No finance data for {MONTHS[month - 1]} {year} yet. Classify staff under <b>Classification</b> and set project billing under <b>Revenue</b>.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Revenue" value={money(t.revenue, c)} sub={`${t.activeProjects} active projects`} />
        <Kpi label="Net profit (true)" value={money(t.netProfit, c)} tone={t.netProfit >= 0 ? 'text-success' : 'text-danger'} sub="after every cost" />
        <Kpi label="Net margin" value={pct(t.netMargin)} tone={marginTone(t.netMargin)} sub={`gross ${pct(t.grossMargin)}`} />
        <Kpi label="Utilization" value={pct(t.utilization)} tone={(t.utilization ?? 0) >= 0.8 ? 'text-success' : (t.utilization ?? 0) >= 0.6 ? 'text-warning' : 'text-danger'} sub={`${hrs(t.allocatedDirectHours)} / ${hrs(t.directCapacityHours)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Cost waterfall */}
        <div className="lg:col-span-2 rounded-xl-2 border border-outline bg-surface p-5">
          <h3 className="text-sm font-semibold text-on-surface mb-4">Where the money goes · {MONTHS[month - 1]} {year}</h3>
          <Waterfall t={t} currency={c} />
        </div>
        {/* Cost by department */}
        <div className="rounded-xl-2 border border-outline bg-surface p-5">
          <h3 className="text-sm font-semibold text-on-surface mb-3">Salary by department</h3>
          <div className="space-y-2">
            {model.byDept.map((d) => (
              <div key={d.department} className="flex items-center justify-between text-sm">
                <span className="text-on-surface-muted truncate">{d.department}</span>
                <span className="text-on-surface-subtle ml-2">×{d.headcount}</span>
                <span className="ml-auto font-medium tabular-nums text-on-surface">{moneyShort(d.salary, c)}</span>
              </div>
            ))}
            <div className="mt-2 border-t border-outline pt-2 text-xs text-on-surface-muted">
              Overhead pool: <b className="text-on-surface">{money(t.overheadPool, c)}</b>/mo
            </div>
          </div>
        </div>
      </div>

      {/* Project P&L */}
      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-outline text-sm font-semibold text-on-surface">Project profitability</div>
        {model.projectRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-on-surface-muted">No active projects with revenue this month.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-on-surface-subtle border-b border-outline bg-surface-2">
                  <th className="text-left font-semibold px-4 py-2.5">Project</th>
                  <th className="text-right font-semibold px-3 py-2.5">Revenue</th>
                  <th className="text-right font-semibold px-3 py-2.5">Direct cost</th>
                  <th className="text-right font-semibold px-3 py-2.5">Gross</th>
                  <th className="text-right font-semibold px-3 py-2.5">Overhead</th>
                  <th className="text-right font-semibold px-3 py-2.5">Net profit</th>
                  <th className="text-right font-semibold px-3 py-2.5">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {model.projectRows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-on-surface">{p.name}</div>
                      <div className="text-xs text-on-surface-subtle">{p.client_name || '—'} · {p.billing_type === 'hourly' ? `${money(p.hourly_rate, c)}/h` : 'fixed'} · {hrs(p.directHours)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-on-surface">{money(p.revenue, c)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-on-surface-muted">{money(p.directCost, c)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-on-surface">{money(p.grossProfit, c)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-on-surface-subtle">{money(p.overhead, c)}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${p.netProfit >= 0 ? 'text-success' : 'text-danger'}`}>{money(p.netProfit, c)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${marginTone(p.netMargin)}`}>{pct(p.netMargin)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-outline-strong bg-surface-2 font-semibold text-on-surface">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(t.revenue, c)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(t.directCost, c)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(t.grossProfit, c)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(t.overheadPool - (model.settings.include_bench_in_overhead ? t.benchCost : 0), c)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(t.revenue - t.directCost - t.overheadPool, c)}</td>
                  <td className="px-3 py-2.5"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {!model.settings.include_bench_in_overhead && t.benchCost > 0 && (
          <div className="border-t border-outline bg-warning-container/30 px-5 py-2.5 text-xs text-warning">
            ⚠️ Idle / bench cost of <b>{money(t.benchCost, c)}</b> ({hrs(t.directCapacityHours - t.allocatedDirectHours)} unallocated) sits outside projects — that’s why company net ({money(t.netProfit, c)}) is below the sum of project nets.
          </div>
        )}
      </div>

      {/* Utilization */}
      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-outline text-sm font-semibold text-on-surface">Direct staff utilization</div>
        <div className="divide-y divide-outline">
          {model.employeeRows.filter((e) => e.cost_type === 'direct').length === 0 ? (
            <div className="p-6 text-center text-sm text-on-surface-muted">No direct (billable) staff classified.</div>
          ) : (
            model.employeeRows.filter((e) => e.cost_type === 'direct').sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0)).map((e) => {
              const u = e.utilization ?? 0;
              const barColor = u > 1 ? 'bg-danger' : u >= 0.8 ? 'bg-success' : 'bg-warning';
              return (
                <div key={e.id} className="flex items-center gap-4 px-5 py-2.5">
                  <div className="w-44 shrink-0">
                    <div className="text-sm font-medium text-on-surface truncate">{e.name}</div>
                    <div className="text-xs text-on-surface-subtle truncate">{e.designation || e.department || '—'}</div>
                  </div>
                  <div className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(u, 1) * 100}%` }} />
                  </div>
                  <div className="w-14 text-right text-sm tabular-nums text-on-surface">{pct(u)}</div>
                  <div className="w-40 text-right text-xs text-on-surface-subtle">{hrs(e.allocatedHours)}/{hrs(e.capacity)} · bench {money(e.benchCost, c)}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'text-on-surface' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-on-surface-subtle">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-on-surface-subtle">{sub}</div>}
    </div>
  );
}

function Waterfall({ t, currency }: { t: any; currency: string }) {
  const segments = [
    { label: 'Direct labour', value: t.directCost, color: 'bg-brand' },
    { label: 'Idle / bench', value: t.benchCost, color: 'bg-warning' },
    { label: 'Indirect salaries', value: t.indirectSalaries, color: 'bg-accent' },
    { label: 'Other overhead', value: t.otherCosts, color: 'bg-on-surface-subtle' },
    { label: 'Net profit', value: Math.max(t.netProfit, 0), color: 'bg-success' },
  ];
  const denom = t.revenue > 0 ? t.revenue : segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <div className="flex h-8 w-full overflow-hidden rounded-xl-2">
        {segments.map((s) => s.value > 0 && (
          <div key={s.label} className={`${s.color} h-full`} style={{ width: `${(s.value / denom) * 100}%` }} title={`${s.label}: ${money(s.value, currency)}`} />
        ))}
        {t.netProfit < 0 && <div className="h-full flex-1 bg-danger/40" title="Loss" />}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.color}`} />
            <span className="text-on-surface-muted">{s.label}</span>
            <span className="ml-auto font-medium tabular-nums text-on-surface">{money(s.value, currency)}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-outline pt-3 text-xs text-on-surface-muted">
        <span>Revenue <b className="text-on-surface">{money(t.revenue, currency)}</b></span>
        <span>Total cost <b className="text-on-surface">{money(t.totalCost, currency)}</b></span>
        <span>Salary bill <b className="text-on-surface">{money(t.totalSalary, currency)}</b></span>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl-2 bg-surface-2" />)}</div>
      <div className="h-48 rounded-xl-2 bg-surface-2" />
      <div className="h-64 rounded-xl-2 bg-surface-2" />
    </div>
  );
}
