import { Fragment, useEffect, useMemo, useState } from 'react';
import { X, Briefcase, Users as UsersIcon } from 'lucide-react';
import { financeApi, type FinModel, type FinEmployeeRow } from '../../services/financeApi';
import { MONTHS, money, moneyShort, pct, hrs, marginTone } from './format';

type UtilGroupKey = 'none' | 'department' | 'designation';

export default function DashboardTab({ month, year, rev }: { month: number; year: number; rev: number }) {
  const [model, setModel] = useState<FinModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [drilldown, setDrilldown] = useState<FinEmployeeRow | null>(null);
  const [utilGroup, setUtilGroup] = useState<UtilGroupKey>('none');

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
  const ovhSum = model.projectRows.reduce((s, p) => s + p.overhead, 0);
  const supSum = model.projectRows.reduce((s, p) => s + p.supervision, 0);
  const netSum = model.projectRows.reduce((s, p) => s + p.netProfit, 0);

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
        <Kpi label="Net profit (true)" value={money(t.netProfit, c)} tone={t.netProfit >= 0 ? 'text-success' : 'text-danger'} sub="after every cost" />
        <Kpi label="Net margin" value={pct(t.netMargin)} tone={marginTone(t.netMargin)} sub={`gross ${pct(t.grossMargin)}`} />
        <Kpi label="Utilization" value={pct(t.utilization)} tone={(t.utilization ?? 0) >= 0.8 ? 'text-success' : (t.utilization ?? 0) >= 0.6 ? 'text-warning' : 'text-danger'} sub={`${hrs(t.allocatedDirectHours)} / ${hrs(t.directCapacityHours)}`} />
        <Kpi label="Active projects" value={String(t.activeProjects)} sub={`${t.headcount} headcount`} />
      </div>

      {/* Invoiced vs Received strip — accrual vs cash side-by-side */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Invoiced" value={money(t.totalInvoiced || t.revenue, c)} sub="accrual · what we billed" />
        <Kpi label="Received" value={money(t.totalReceived || 0, c)} tone="text-success" sub="cash · in the bank" />
        <Kpi label="Pending" value={money(t.totalPending || 0, c)}
          tone={(t.pendingInvoiceCount ?? 0) > 0 ? 'text-warning' : 'text-on-surface-subtle'}
          sub={`${t.pendingInvoiceCount ?? 0} invoice${t.pendingInvoiceCount === 1 ? '' : 's'} awaiting clearance`} />
        <Kpi label="Cleared" value={String(t.clearedInvoiceCount ?? 0)} sub={`of ${(t.pendingInvoiceCount ?? 0) + (t.clearedInvoiceCount ?? 0)} this month`} />
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
                  <th className="text-right font-semibold px-3 py-2.5" title="Drives the P&L (accrual basis)">Revenue</th>
                  <th className="text-right font-semibold px-3 py-2.5" title="Cleared invoices only — money actually received">Received</th>
                  <th className="text-right font-semibold px-3 py-2.5">Direct cost</th>
                  <th className="text-right font-semibold px-3 py-2.5" title="Outsourced services, content, ad spend etc. logged against this project">Outsourced</th>
                  <th className="text-right font-semibold px-3 py-2.5">Gross</th>
                  <th className="text-right font-semibold px-3 py-2.5">Overhead</th>
                  <th className="text-right font-semibold px-3 py-2.5">Supervision</th>
                  <th className="text-right font-semibold px-3 py-2.5">Net profit</th>
                  <th className="text-right font-semibold px-3 py-2.5">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {model.projectRows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-on-surface inline-flex items-center gap-2">
                        {p.name}
                        {p.pendingCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-warning-container text-warning" title={`${p.pendingCount} pending invoice${p.pendingCount === 1 ? '' : 's'}`}>
                            ⏳ {p.pendingCount}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-on-surface-subtle">{p.client_name || '—'} · {p.billing_type === 'hourly' ? `${money(p.hourly_rate, c)}/h` : 'fixed'} · {hrs(p.directHours)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-on-surface">{money(p.revenue, c)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${p.received > 0 ? (p.received < p.invoiced ? 'text-warning' : 'text-success') : 'text-on-surface-subtle'}`} title={p.invoiceCount > 0 ? `${p.clearedCount} cleared, ${p.pendingCount} pending of ${p.invoiceCount}` : 'No invoices raised yet'}>
                      {p.invoiceCount > 0 ? money(p.received, c) : <span className="text-on-surface-subtle">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-on-surface-muted">{money(p.directCost, c)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${p.projectExpenses > 0 ? 'text-warning' : 'text-on-surface-subtle'}`}>{money(p.projectExpenses || 0, c)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-on-surface">{money(p.grossProfit, c)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-on-surface-subtle">{money(p.overhead, c)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-on-surface-subtle" title={p.supervisorNames?.length ? `Leads: ${p.supervisorNames.join(', ')}` : 'No supervisor assigned'}>{money(p.supervision, c)}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${p.netProfit >= 0 ? 'text-success' : 'text-danger'}`}>{money(p.netProfit, c)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${marginTone(p.netMargin)}`}>{pct(p.netMargin)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-outline-strong bg-surface-2 font-semibold text-on-surface">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(t.revenue, c)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${(t.totalReceived ?? 0) < (t.totalInvoiced ?? t.revenue) ? 'text-warning' : 'text-success'}`}>{money(t.totalReceived ?? 0, c)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(t.directCost, c)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(t.projectExpenses || 0, c)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(t.grossProfit, c)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(ovhSum, c)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(supSum, c)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(netSum, c)}</td>
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

      {/* Per-employee drill-in modal */}
      {drilldown && (
        <EmployeeProjectsModal
          emp={drilldown}
          model={model}
          month={month}
          year={year}
          onClose={() => setDrilldown(null)}
        />
      )}

      {/* Utilization */}
      <UtilizationSection
        model={model}
        groupBy={utilGroup}
        setGroupBy={setUtilGroup}
        onPick={setDrilldown}
      />
    </div>
  );
}

function UtilizationSection({ model, groupBy, setGroupBy, onPick }: {
  model: FinModel;
  groupBy: UtilGroupKey;
  setGroupBy: (k: UtilGroupKey) => void;
  onPick: (e: FinEmployeeRow) => void;
}) {
  const c = model.settings.currency;
  const direct = useMemo(
    () => model.employeeRows.filter(e => e.cost_type === 'direct').sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0)),
    [model.employeeRows]
  );

  const groups = useMemo(() => {
    if (groupBy === 'none') {
      return [{ name: null as string | null, rows: direct, totalAlloc: 0, totalCap: 0, totalBench: 0 }];
    }
    const keyOf = (e: FinEmployeeRow) => (groupBy === 'department' ? e.department : e.designation) || '—';
    const buckets = new Map<string, FinEmployeeRow[]>();
    for (const e of direct) {
      const k = keyOf(e);
      const arr = buckets.get(k);
      if (arr) arr.push(e); else buckets.set(k, [e]);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, rows]) => ({
        name,
        rows,
        totalAlloc: rows.reduce((s, r) => s + r.allocatedHours, 0),
        totalCap: rows.reduce((s, r) => s + r.capacity, 0),
        totalBench: rows.reduce((s, r) => s + r.benchCost, 0),
      }));
  }, [direct, groupBy]);

  return (
    <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <div className="px-5 py-3 border-b border-outline flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold text-on-surface">
          Direct staff utilization
          <span className="text-xs font-normal text-on-surface-subtle ml-2">· click any row for project breakdown</span>
        </div>
        <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-lg px-1 py-0.5">
          <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-on-surface-subtle pl-1.5">Group</span>
          {([
            { key: 'none', label: 'None' },
            { key: 'department', label: 'Team' },
            { key: 'designation', label: 'Role' },
          ] as Array<{ key: UtilGroupKey; label: string }>).map(opt => (
            <button key={opt.key} onClick={() => setGroupBy(opt.key)}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                groupBy === opt.key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-3'
              }`}>{opt.label}</button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-outline">
        {direct.length === 0 ? (
          <div className="p-6 text-center text-sm text-on-surface-muted">No direct (billable) staff classified.</div>
        ) : groups.map(g => (
          <Fragment key={g.name ?? '__all__'}>
            {g.name !== null && (
              <div className="flex items-center justify-between gap-3 px-5 py-2 bg-gradient-to-r from-brand-container/40 to-transparent">
                <div className="inline-flex items-center gap-2">
                  <UsersIcon size={13} className="text-brand" />
                  <span className="font-display text-sm font-bold text-on-surface">{g.name}</span>
                  <span className="num-mono text-[10px] font-semibold text-on-surface-muted bg-surface px-1.5 py-0.5 rounded-full">{g.rows.length}</span>
                </div>
                <div className="text-[11px] text-on-surface-muted num-mono">
                  {hrs(g.totalAlloc)}/{hrs(g.totalCap)} · {pct(g.totalCap > 0 ? g.totalAlloc / g.totalCap : null)} · bench {money(g.totalBench, c)}
                </div>
              </div>
            )}
            {g.rows.map(e => {
              const u = e.utilization ?? 0;
              const barColor = u > 1 ? 'bg-danger' : u >= 0.8 ? 'bg-success' : 'bg-warning';
              return (
                <button key={e.id} onClick={() => onPick(e)}
                  className="flex w-full items-center gap-4 px-5 py-2.5 text-left hover:bg-surface-2/60 transition-colors group">
                  <div className="w-44 shrink-0">
                    <div className="text-sm font-medium text-on-surface truncate group-hover:text-accent transition-colors">{e.name}</div>
                    <div className="text-xs text-on-surface-subtle truncate">{e.designation || e.department || '—'}</div>
                  </div>
                  <div className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(u, 1) * 100}%` }} />
                  </div>
                  <div className="w-14 text-right text-sm tabular-nums text-on-surface">{pct(u)}</div>
                  <div className="w-40 text-right text-xs text-on-surface-subtle">{hrs(e.allocatedHours)}/{hrs(e.capacity)} · bench {money(e.benchCost, c)}</div>
                </button>
              );
            })}
          </Fragment>
        ))}
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
    { label: 'Management (leads)', value: t.supervisionCost, color: 'bg-indigo-500' },
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

function EmployeeProjectsModal({ emp, model, month, year, onClose }: {
  emp: FinEmployeeRow; model: FinModel; month: number; year: number; onClose: () => void;
}) {
  const c = model.settings.currency;
  // Reverse-pivot projectRows[].team[] to find every project this employee was costed against.
  const rows = useMemo(() => {
    const out: Array<{ projectId: string; projectName: string; clientName: string | null; hours: number; rate: number; cost: number; revenue: number; projectRevenuePerHour: number }> = [];
    for (const p of model.projectRows) {
      const member = p.team.find(t => t.id === emp.id);
      if (!member || member.hours <= 0) continue;
      out.push({
        projectId: p.id,
        projectName: p.name,
        clientName: p.client_name,
        hours: member.hours,
        rate: member.rate,
        cost: member.cost,
        revenue: (p.revenuePerHour || 0) * member.hours,
        projectRevenuePerHour: p.revenuePerHour || 0,
      });
    }
    return out.sort((a, b) => b.hours - a.hours);
  }, [model.projectRows, emp.id]);

  const totalLogged = rows.reduce((s, r) => s + r.hours, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const u = emp.utilization ?? 0;
  const barColor = u > 1 ? 'bg-danger' : u >= 0.8 ? 'bg-success' : 'bg-warning';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-outline bg-gradient-to-r from-brand-container/40 to-surface flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">{emp.name}</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              {emp.designation || '—'} · {emp.department || '—'} · {MONTHS[month - 1]} {year}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors">
            <X size={18} className="text-on-surface-muted" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-outline bg-surface-2/40 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Allocated</div>
            <div className="num-mono text-lg font-bold text-on-surface mt-0.5">{hrs(emp.allocatedHours)}</div>
            <div className="text-[10px] text-on-surface-subtle">of {hrs(emp.capacity)} capacity</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Utilization</div>
            <div className={`num-mono text-lg font-bold mt-0.5 ${u > 1 ? 'text-danger' : u >= 0.8 ? 'text-success' : 'text-warning'}`}>{pct(u)}</div>
            <div className="h-1.5 mt-1 rounded-full bg-surface-3 overflow-hidden">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(u, 1) * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Bench</div>
            <div className="num-mono text-lg font-bold text-warning mt-0.5">{money(emp.benchCost, c)}</div>
            <div className="text-[10px] text-on-surface-subtle">{hrs(emp.benchHours)} idle</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Cost rate</div>
            <div className="num-mono text-lg font-bold text-on-surface mt-0.5">{money(emp.rate, c)}<span className="text-xs font-normal text-on-surface-subtle">/h</span></div>
            <div className="text-[10px] text-on-surface-subtle">{money(emp.salary, c)}/mo</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Briefcase size={28} className="mx-auto text-on-surface-subtle mb-2" />
              <p className="text-sm text-on-surface-muted">No project hours costed against {emp.name.split(' ')[0]} this month.</p>
              <p className="text-xs text-on-surface-subtle mt-1">All {hrs(emp.capacity)} of capacity is sitting on the bench.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b border-outline sticky top-0">
                <tr className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">
                  <th className="text-left px-5 py-3">Project</th>
                  <th className="text-right px-3 py-3">Hours</th>
                  <th className="text-right px-3 py-3">% of load</th>
                  <th className="text-right px-3 py-3">Direct cost</th>
                  <th className="text-right px-5 py-3">Revenue contribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {rows.map(r => {
                  const share = totalLogged > 0 ? r.hours / totalLogged : 0;
                  return (
                    <tr key={r.projectId} className="hover:bg-surface-2/50">
                      <td className="px-5 py-3">
                        <div className="font-medium text-on-surface">{r.projectName}</div>
                        <div className="text-xs text-on-surface-subtle mt-0.5">{r.clientName || '—'}</div>
                      </td>
                      <td className="px-3 py-3 text-right num-mono font-semibold text-on-surface">{hrs(r.hours)}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          <div className="w-16 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                            <div className="h-full rounded-full bg-brand" style={{ width: `${share * 100}%` }} />
                          </div>
                          <span className="num-mono text-xs text-on-surface-muted w-9 text-right">{pct(share)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right num-mono text-on-surface-muted">{money(r.cost, c)}</td>
                      <td className="px-5 py-3 text-right num-mono text-on-surface">{r.projectRevenuePerHour > 0 ? money(r.revenue, c) : <span className="text-on-surface-subtle text-xs">— (fixed-fee)</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-outline-strong bg-surface-2 font-semibold text-on-surface">
                  <td className="px-5 py-3">Total · {rows.length} project{rows.length === 1 ? '' : 's'}</td>
                  <td className="px-3 py-3 text-right num-mono">{hrs(totalLogged)}</td>
                  <td className="px-3 py-3 text-right num-mono text-on-surface-muted">100%</td>
                  <td className="px-3 py-3 text-right num-mono">{money(totalCost, c)}</td>
                  <td className="px-5 py-3 text-right num-mono">{money(totalRevenue, c)}</td>
                </tr>
                {emp.benchHours > 0 && (
                  <tr className="bg-warning-container/30 text-warning text-xs">
                    <td className="px-5 py-2">⚠ Idle / bench</td>
                    <td className="px-3 py-2 text-right num-mono font-semibold">{hrs(emp.benchHours)}</td>
                    <td className="px-3 py-2 text-right num-mono">{pct(emp.benchHours / Math.max(emp.capacity, 1))}</td>
                    <td className="px-3 py-2 text-right num-mono">{money(emp.benchCost, c)}</td>
                    <td className="px-5 py-2 text-right text-on-surface-subtle">—</td>
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
