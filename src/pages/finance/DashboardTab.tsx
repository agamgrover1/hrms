import { Fragment, useEffect, useMemo, useState } from 'react';
import { X, Briefcase, Users as UsersIcon, FileText, IndianRupee, Receipt, Clock, CheckCircle2, Ban, ChevronRight, Settings as SettingsIcon } from 'lucide-react';
import { financeApi, type FinModel, type FinEmployeeRow, type FinProjectRow, type FinInvoice, type FinProjectExpense } from '../../services/financeApi';
import { MONTHS, money, moneyShort, pct, hrs, marginTone } from './format';

type UtilGroupKey = 'none' | 'manager';

export default function DashboardTab({ month, year, rev }: { month: number; year: number; rev: number }) {
  const [model, setModel] = useState<FinModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [drilldown, setDrilldown] = useState<FinEmployeeRow | null>(null);
  const [projectDrilldown, setProjectDrilldown] = useState<FinProjectRow | null>(null);
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
        <div className="px-5 py-3 border-b border-outline text-sm font-semibold text-on-surface">Project profitability <span className="text-xs font-normal text-on-surface-subtle ml-2">· click any row for the full breakdown</span></div>
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
                  <tr key={p.id} className="hover:bg-surface-2/50 cursor-pointer group" onClick={() => setProjectDrilldown(p)}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-on-surface inline-flex items-center gap-2 group-hover:text-accent transition-colors">
                        {p.name}
                        <ChevronRight size={12} className="text-on-surface-subtle group-hover:text-accent transition-colors" />
                        {(p as any).status === 'archived' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-surface-3 text-on-surface-muted border border-outline"
                            title="Project was archived but had cost or revenue this month. Still counted in the books for that activity.">
                            Archived
                          </span>
                        )}
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

      {/* Per-project drill-in modal */}
      {projectDrilldown && (
        <ProjectDrilldownModal
          project={projectDrilldown}
          model={model}
          month={month}
          year={year}
          onClose={() => setProjectDrilldown(null)}
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
    // Team = reporting manager. People with no manager get bucketed under "No manager".
    const keyOf = (e: FinEmployeeRow) => e.reporting_manager_name || 'No manager';
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
            { key: 'manager', label: 'Team' },
          ] as Array<{ key: UtilGroupKey; label: string }>).map(opt => (
            <button key={opt.key} onClick={() => setGroupBy(opt.key)}
              title={opt.key === 'manager' ? 'Group by reporting manager' : undefined}
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

// ── Per-project profitability drilldown ────────────────────────────────────
function ProjectDrilldownModal({ project: p, model, month, year, onClose }: {
  project: FinProjectRow; model: FinModel; month: number; year: number; onClose: () => void;
}) {
  const c = model.settings.currency;
  const [invoices, setInvoices] = useState<FinInvoice[] | null>(null);
  const [expenses, setExpenses] = useState<FinProjectExpense[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      financeApi.getInvoices({ project_id: p.id, month, year }).catch(() => [] as FinInvoice[]),
      financeApi.getProjectExpenses({ project_id: p.id, month, year }).catch(() => [] as FinProjectExpense[]),
    ]).then(([inv, exp]) => {
      if (!alive) return;
      setInvoices(inv);
      setExpenses(exp);
    }).catch((e: any) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [p.id, month, year]);

  const totalCost = p.directCost + p.projectExpenses + p.overhead + p.supervision;
  const overheadMethodLabel: Record<string, string> = {
    direct_hours: 'direct hours',
    revenue: 'revenue',
    headcount: 'headcount',
    none: 'no allocation',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-outline bg-gradient-to-r from-brand-container/40 to-surface flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">{p.name}</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              {p.client_name || '—'} · {p.billing_type === 'hourly' ? `${money(p.hourly_rate, c)}/h × ${hrs(p.billable_hours)}` : 'Fixed billing'} · {MONTHS[month - 1]} {year}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors">
            <X size={18} className="text-on-surface-muted" />
          </button>
        </div>

        {/* P&L summary strip */}
        <div className="px-6 py-4 border-b border-outline bg-surface-2/40 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <PnlTile label="Revenue" value={money(p.revenue, c)} tone="text-on-surface" />
          <PnlTile label="Total cost" value={money(totalCost, c)} tone="text-on-surface-muted" sub={`${pct(p.revenue > 0 ? totalCost / p.revenue : 0)} of revenue`} />
          <PnlTile label="Net profit" value={money(p.netProfit, c)} tone={p.netProfit >= 0 ? 'text-success' : 'text-danger'} />
          <PnlTile label="Net margin" value={pct(p.netMargin)} tone={marginTone(p.netMargin)} />
        </div>

        {err && <div className="mx-6 mt-3 rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Invoices */}
          <Section icon={FileText} title="Invoices" subtitle={`${p.invoiceCount} invoice${p.invoiceCount === 1 ? '' : 's'} · Invoiced ${money(p.invoiced, c)} · Received ${money(p.received, c)}`}>
            {invoices === null ? <Loading /> : invoices.length === 0 ? (
              <Empty label="No invoices raised for this project this month." sub={p.revenue > 0 ? 'Revenue is coming from the legacy Billing setup row instead.' : undefined} />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-on-surface-subtle border-b border-outline">
                    <th className="text-left font-semibold px-3 py-2">Invoice #</th>
                    <th className="text-left font-semibold px-3 py-2">Date</th>
                    <th className="text-right font-semibold px-3 py-2">Invoiced</th>
                    <th className="text-right font-semibold px-3 py-2">Received</th>
                    <th className="text-left font-semibold px-3 py-2">Status</th>
                    <th className="text-left font-semibold px-3 py-2">Raised by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline">
                  {invoices.filter(i => i.status !== 'cancelled').map(i => (
                    <tr key={i.id} className="hover:bg-surface-2/40">
                      <td className="px-3 py-2 num-mono text-xs text-on-surface-muted">{i.invoice_number || '—'}</td>
                      <td className="px-3 py-2 text-xs text-on-surface-muted">{i.invoice_date ? new Date(i.invoice_date.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}</td>
                      <td className="px-3 py-2 text-right num-mono text-on-surface">{money(Number(i.amount_invoiced), c)}</td>
                      <td className={`px-3 py-2 text-right num-mono ${i.status === 'cleared' ? 'text-success' : 'text-on-surface-subtle'}`}>
                        {i.status === 'cleared' ? money(Number(i.amount_received || 0), c) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {i.status === 'cleared' ? <Pill icon={CheckCircle2} label="Cleared" tone="bg-success-container text-success" />
                          : i.status === 'cancelled' ? <Pill icon={Ban} label="Cancelled" tone="bg-surface-3 text-on-surface-subtle" />
                          : <Pill icon={Clock} label="Pending" tone="bg-warning-container text-warning" />}
                      </td>
                      <td className="px-3 py-2 text-xs text-on-surface-muted">{i.created_by_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Billing setup — shows the fin_project_revenue row backing
              this project's revenue, including the legacy direct-
              project rows that aren't visible on the Billing Setup tab
              (which filters to Upwork only). Answers "where is this
              ₹X revenue coming from when Invoices is empty?". */}
          <Section icon={SettingsIcon} title="Billing setup"
            subtitle={(p as any).has_billing_setup
              ? `${((p as any).billing_type === 'hourly') ? `${money((p as any).hourly_rate, (p as any).billing_currency || c)}/h × ${hrs((p as any).billable_hours)}` : `${money((p as any).fixed_amount, (p as any).billing_currency || c)} fixed`}${(p as any).billing_currency && (p as any).billing_currency !== 'INR' ? ` · ${(p as any).billing_currency}` : ''}`
              : 'No setup row for this period'}>
            {(p as any).has_billing_setup ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-on-surface-subtle border-b border-outline">
                      <th className="text-left font-semibold px-3 py-2">Field</th>
                      <th className="text-right font-semibold px-3 py-2">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline">
                    <tr><td className="px-3 py-2 text-on-surface-muted">Billing type</td><td className="px-3 py-2 text-right font-semibold text-on-surface capitalize">{(p as any).billing_type}</td></tr>
                    <tr><td className="px-3 py-2 text-on-surface-muted">Currency</td><td className="px-3 py-2 text-right font-semibold text-on-surface">{(p as any).billing_currency || 'INR'}</td></tr>
                    {(p as any).billing_type === 'fixed' ? (
                      <tr><td className="px-3 py-2 text-on-surface-muted">Fixed amount</td><td className="px-3 py-2 text-right font-semibold text-on-surface num-mono">{money((p as any).fixed_amount, (p as any).billing_currency || c)}</td></tr>
                    ) : (
                      <>
                        <tr><td className="px-3 py-2 text-on-surface-muted">Hourly rate</td><td className="px-3 py-2 text-right font-semibold text-on-surface num-mono">{money((p as any).hourly_rate, (p as any).billing_currency || c)}/h</td></tr>
                        <tr><td className="px-3 py-2 text-on-surface-muted">Billable hours</td><td className="px-3 py-2 text-right font-semibold text-on-surface num-mono">{hrs((p as any).billable_hours)}</td></tr>
                        <tr><td className="px-3 py-2 text-on-surface-muted">Subtotal</td><td className="px-3 py-2 text-right font-semibold text-on-surface num-mono">{money(Number((p as any).hourly_rate) * Number((p as any).billable_hours), (p as any).billing_currency || c)}</td></tr>
                      </>
                    )}
                    {(p as any).billing_currency && (p as any).billing_currency !== 'INR' && (
                      <>
                        <tr><td className="px-3 py-2 text-on-surface-muted">FX rate</td><td className="px-3 py-2 text-right font-semibold text-on-surface num-mono">1 {(p as any).billing_currency} = ₹{Number((p as any).billing_fx_rate || 1).toFixed(4)}</td></tr>
                        <tr><td className="px-3 py-2 text-on-surface-muted">Revenue (INR)</td><td className="px-3 py-2 text-right font-bold text-on-surface num-mono">{money((p as any).billing_revenue_inr || p.revenue, c)}</td></tr>
                      </>
                    )}
                  </tbody>
                </table>
                {p.invoiceCount === 0 && (
                  <p className="px-3 pt-3 text-[11px] text-on-surface-muted italic">
                    No invoices for this period — revenue above is coming from this Billing-setup row directly. For direct/retainer clients, raising an invoice on the Invoices tab will take precedence over this row in the roll-up.
                  </p>
                )}
              </div>
            ) : (p as any).has_legacy_billing_row ? (
              <div className="rounded-xl-2 border border-warning/40 bg-warning-container/30 p-3 text-xs text-on-surface-muted">
                <p className="font-semibold text-warning mb-1">Legacy billing row — not counted</p>
                <p>
                  This project has a fin_project_revenue entry for {MONTHS[month - 1]} {year}, but it's a direct/retainer
                  project so the row is ignored. Revenue only comes from invoices for these clients. The legacy entry
                  exists silently in the database; clean it up from the Billing setup tab using the "Clean direct rows"
                  banner that appears for admin.
                </p>
              </div>
            ) : (
              <Empty label="No Billing-setup row exists for this period."
                sub={p.revenue > 0 ? 'But revenue is non-zero — likely from an invoice. See the Invoices section above.' : undefined} />
            )}
          </Section>

          {/* Direct cost (team) */}
          <Section icon={UsersIcon} title="Direct cost (people)" subtitle={`${p.team.length} person${p.team.length === 1 ? '' : 's'} · ${hrs(p.directHours)} · ${money(p.directCost, c)}`}>
            {p.team.length === 0 ? (
              <Empty label="No direct staff allocated to this project this month." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-on-surface-subtle border-b border-outline">
                    <th className="text-left font-semibold px-3 py-2">Employee</th>
                    <th className="text-right font-semibold px-3 py-2">Hours</th>
                    <th className="text-right font-semibold px-3 py-2">Rate /h</th>
                    <th className="text-right font-semibold px-3 py-2">Cost</th>
                    <th className="text-right font-semibold px-3 py-2">% of direct cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline">
                  {p.team.map(t => {
                    const share = p.directCost > 0 ? t.cost / p.directCost : 0;
                    return (
                      <tr key={t.id} className="hover:bg-surface-2/40">
                        <td className="px-3 py-2">
                          <div className="text-on-surface">{t.name}</div>
                          <div className="text-xs text-on-surface-subtle">{t.designation || '—'}</div>
                        </td>
                        <td className="px-3 py-2 text-right num-mono text-on-surface">{hrs(t.hours)}</td>
                        <td className="px-3 py-2 text-right num-mono text-on-surface-muted">{money(t.rate, c)}</td>
                        <td className="px-3 py-2 text-right num-mono font-semibold text-on-surface">{money(t.cost, c)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-2 justify-end">
                            <div className="w-16 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                              <div className="h-full rounded-full bg-brand" style={{ width: `${share * 100}%` }} />
                            </div>
                            <span className="num-mono text-xs text-on-surface-muted w-10 text-right">{pct(share)}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-outline-strong bg-surface-2 font-semibold">
                    <td className="px-3 py-2">Total · {hrs(p.directHours)} at avg {money(p.effectiveCostPerHour, c)}/h</td>
                    <td className="px-3 py-2 text-right num-mono">{hrs(p.directHours)}</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right num-mono">{money(p.directCost, c)}</td>
                    <td className="px-3 py-2 text-right num-mono">100%</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </Section>

          {/* Outsourced expenses */}
          <Section icon={Receipt} title="Outsourced expenses" subtitle={`${money(p.projectExpenses, c)} this month`}>
            {expenses === null ? <Loading /> :
              expenses.length === 0 ? <Empty label="No outsourced expenses logged for this project." sub="Coordinators add these from the per-project ₹ button on the Projects page." /> : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-on-surface-subtle border-b border-outline">
                      <th className="text-left font-semibold px-3 py-2">Vendor / description</th>
                      <th className="text-left font-semibold px-3 py-2">Category</th>
                      <th className="text-right font-semibold px-3 py-2">Amount</th>
                      <th className="text-left font-semibold px-3 py-2">Added by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline">
                    {expenses.map(e => (
                      <tr key={e.id} className="hover:bg-surface-2/40">
                        <td className="px-3 py-2">
                          <div className="text-on-surface">{e.vendor || '—'}</div>
                          <div className="text-xs text-on-surface-subtle">{e.description}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-on-surface-muted capitalize">{e.category}</td>
                        <td className="px-3 py-2 text-right num-mono text-warning font-semibold">{money(Number(e.amount), c)}</td>
                        <td className="px-3 py-2 text-xs text-on-surface-muted">{e.created_by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </Section>

          {/* Supervision */}
          <Section icon={Briefcase} title="Supervision (project leads & reporting managers)" subtitle={`${money(p.supervision, c)} allocated from supervisor salaries`}>
            {p.supervisorBreakdown.length === 0 ? (
              <Empty label="No supervisor allocated to this project." sub="Supervision is computed only for staff classified as 'supervisor' and assigned as a lead or reporting manager." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-on-surface-subtle border-b border-outline">
                    <th className="text-left font-semibold px-3 py-2">Supervisor</th>
                    <th className="text-right font-semibold px-3 py-2">Their salary /mo</th>
                    <th className="text-right font-semibold px-3 py-2">Share to this project</th>
                    <th className="text-right font-semibold px-3 py-2">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline">
                  {p.supervisorBreakdown.map(s => (
                    <tr key={s.id} className="hover:bg-surface-2/40">
                      <td className="px-3 py-2 text-on-surface">{s.name}</td>
                      <td className="px-3 py-2 text-right num-mono text-on-surface-muted">{money(s.salary, c)}</td>
                      <td className="px-3 py-2 text-right num-mono text-on-surface-muted">{pct(s.share)}</td>
                      <td className="px-3 py-2 text-right num-mono font-semibold text-on-surface">{money(s.amount, c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {p.supervisorBreakdown.length > 0 && (
              <p className="mt-2 text-[11px] text-on-surface-subtle">
                Each supervisor's salary is spread across the projects they run, proportional to direct hours on each. So a supervisor on three projects with this one having half the hours gets 50% of their salary booked here.
              </p>
            )}
          </Section>

          {/* Overhead */}
          <Section icon={IndianRupee} title="Overhead allocation" subtitle={`${money(p.overhead, c)} — ${pct(p.overheadShare)} of the ₹${Math.round(p.overheadPool).toLocaleString('en-IN')} pool`}>
            <div className="rounded-xl-2 border border-outline bg-surface-2/40 p-4 space-y-2 text-sm">
              <Line label="Overhead pool this month" value={money(p.overheadPool, c)} bold />
              <Line label="Allocation method" value={overheadMethodLabel[p.overheadMethod] || p.overheadMethod} />
              <Line label="This project's share" value={pct(p.overheadShare)} />
              <Line label="Allocated to this project" value={money(p.overhead, c)} bold tone="text-on-surface" />
            </div>
            <p className="mt-2 text-[11px] text-on-surface-subtle">
              The pool combines indirect salaries (admin, HR), other org-wide costs, and unallocated supervision. It's split across active projects using the method set under Settings → Overhead method.
            </p>
          </Section>

          {/* Bottom-line walkthrough */}
          <Section icon={null} title="How net profit is computed" subtitle="">
            <div className="rounded-xl-2 border border-outline bg-surface-2/40 p-4 space-y-1.5 text-sm">
              <Line label="Revenue" value={money(p.revenue, c)} tone="text-on-surface" />
              <Line label="− Direct cost" value={money(p.directCost, c)} tone="text-on-surface-muted" minus />
              <Line label="− Outsourced expenses" value={money(p.projectExpenses, c)} tone="text-warning" minus />
              <div className="border-t border-outline pt-1.5">
                <Line label="Gross profit" value={money(p.grossProfit, c)} bold />
              </div>
              <Line label="− Overhead" value={money(p.overhead, c)} tone="text-on-surface-muted" minus />
              <Line label="− Supervision" value={money(p.supervision, c)} tone="text-on-surface-muted" minus />
              <div className="border-t-2 border-outline-strong pt-1.5">
                <Line label="Net profit" value={money(p.netProfit, c)} bold tone={p.netProfit >= 0 ? 'text-success' : 'text-danger'} />
                <Line label="Net margin" value={pct(p.netMargin)} tone={marginTone(p.netMargin)} />
              </div>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}

function PnlTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">{label}</div>
      <div className={`num-mono text-lg font-bold mt-0.5 ${tone || 'text-on-surface'}`}>{value}</div>
      {sub && <div className="text-[10px] text-on-surface-subtle mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, children }: { icon: any; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-outline bg-surface-2/40 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {Icon && <Icon size={15} className="text-brand mt-0.5" />}
          <div>
            <h4 className="text-sm font-bold text-on-surface">{title}</h4>
            {subtitle && <p className="text-[11px] text-on-surface-muted mt-0.5">{subtitle}</p>}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Empty({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-sm text-on-surface-muted">{label}</p>
      {sub && <p className="text-xs text-on-surface-subtle mt-1">{sub}</p>}
    </div>
  );
}

function Loading() {
  return <div className="px-4 py-6 text-center text-sm text-on-surface-subtle">Loading…</div>;
}

function Pill({ icon: Icon, label, tone }: { icon: any; label: string; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${tone}`}>
      <Icon size={11} strokeWidth={2.5} /> {label}
    </span>
  );
}

function Line({ label, value, bold, minus, tone }: { label: string; value: string; bold?: boolean; minus?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={`${bold ? 'font-bold text-on-surface' : 'text-on-surface-muted'}`}>{label}</span>
      <span className={`num-mono tabular-nums ${bold ? 'font-bold' : ''} ${tone || 'text-on-surface'}`}>{minus ? '−' : ''}{value}</span>
    </div>
  );
}
