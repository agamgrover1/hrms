import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, ArrowRight, Sparkles, Award, Activity, Settings2, Info, Users as UsersIcon, ChevronDown, Briefcase } from 'lucide-react';
import { financeApi, type FinOptimization, type FinManagerPnl } from '../../services/financeApi';
import { money, moneyShort, pct, hrs } from './format';

const VERDICT_CFG: Record<string, { label: string; cls: string; sub: string }> = {
  great:     { label: 'Great',     cls: 'bg-success-container text-success',   sub: 'high leverage — keep them happy' },
  ok:        { label: 'OK',        cls: 'bg-brand-container text-brand',       sub: 'paying for themselves' },
  underused: { label: 'Underused', cls: 'bg-warning-container text-warning',   sub: 'on cheap projects vs. their rate' },
  bench:     { label: 'Bench risk',cls: 'bg-danger-container text-danger',     sub: 'cost > revenue — find them better work' },
};

export default function OptimizationTab({ month, year, rev }: { month: number; year: number; rev: number }) {
  const [threshold, setThreshold] = useState(5000);
  const [data, setData] = useState<FinOptimization | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true); setErr('');
    financeApi.getOptimization(month, year, threshold)
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [month, year, threshold, rev]);

  if (loading) return <Skeleton />;
  if (err) return <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-4 text-sm text-danger">{err}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Header / control strip */}
      <div className="rounded-xl-2 border border-outline bg-surface p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-2 text-sm text-on-surface-muted">
          <Sparkles size={15} className="text-brand" />
          <span>Three lenses on the same data: where you're bleeding margin, the full margin grid, and per-employee leverage.</span>
        </div>
        <div className="inline-flex items-center gap-2 text-xs">
          <Settings2 size={13} className="text-on-surface-subtle" />
          <label className="text-on-surface-muted">Noise floor</label>
          <input type="number" min="0" step="1000" value={threshold}
            onChange={e => setThreshold(Number(e.target.value) || 0)}
            className="w-24 px-2 py-1 rounded-lg border border-outline bg-surface-2 text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          <span className="text-on-surface-subtle">₹/mo (swap suggestions must clear this)</span>
        </div>
      </div>

      <BleedReport data={data} />
      <MarginMatrix data={data} />
      <LeverageScore data={data} />
      <ManagerPnl month={month} year={year} rev={rev} />
    </div>
  );
}

// ── 1. Bleed Report ──────────────────────────────────────────────────────
function BleedReport({ data }: { data: FinOptimization }) {
  const c = data.currency;
  const top = data.bleed.rows.filter(r => r.best_swap && r.best_swap.net_gain >= data.threshold).slice(0, 12);
  const losses = data.bleed.rows.filter(r => r.monthly_margin < 0);
  const lossTotal = losses.reduce((s, r) => s + r.monthly_margin, 0);

  return (
    <section className="rounded-xl-3 border border-outline bg-surface overflow-hidden shadow-elev-1">
      <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-danger-container/40 to-surface flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold tracking-tight text-on-surface inline-flex items-center gap-2">
            <TrendingDown size={18} className="text-danger" /> Bleed report
          </h3>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Assignments costing you margin, with the best feasible swap. Each swap candidate has spare capacity ≥ this assignment's hours.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Max gain from suggested swaps</p>
          <p className="num-mono text-3xl font-bold text-success mt-0.5">+{moneyShort(data.bleed.total_potential_gain, c)}</p>
          <p className="text-[11px] text-on-surface-subtle mt-0.5">{data.bleed.actionable_count} actionable swap{data.bleed.actionable_count === 1 ? '' : 's'} this month</p>
        </div>
      </div>

      {losses.length > 0 && (
        <div className="px-5 py-2.5 border-b border-outline bg-danger-container/20 text-xs text-danger inline-flex items-center gap-2 w-full">
          <AlertTriangle size={12} />
          <span>{losses.length} assignment{losses.length === 1 ? '' : 's'} currently running at a loss — combined {money(lossTotal, c)}/mo.</span>
        </div>
      )}

      {top.length === 0 ? (
        <div className="p-12 text-center">
          <Award size={28} className="mx-auto text-success mb-2" />
          <p className="text-sm text-on-surface-muted">No actionable swaps clearing the {money(data.threshold, c)} floor.</p>
          <p className="text-xs text-on-surface-subtle mt-1">Either everything's well-allocated, or your noise floor is too high.</p>
        </div>
      ) : (
        <div className="divide-y divide-outline">
          {top.map((r) => {
            const swap = r.best_swap!;
            return (
              <div key={r.assignment_id} className="px-5 py-4 hover:bg-surface-2/40">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-on-surface">
                      <span className="text-danger">{r.employee_name}</span> ({money(r.employee_rate, c)}/h)
                      {' '}on{' '}
                      <span className="text-on-surface">{r.project_name}</span>
                      <span className="text-on-surface-subtle"> ({money(r.project_revenue_per_hour, c)}/h)</span>
                    </p>
                    <p className="text-xs text-on-surface-muted mt-1 num-mono">
                      <span className={r.margin_per_hour < 0 ? 'text-danger' : 'text-on-surface-muted'}>
                        {money(r.margin_per_hour, c)}/h margin
                      </span>
                      {' × '}{hrs(r.hours)}{' = '}
                      <span className={`font-semibold ${r.monthly_margin < 0 ? 'text-danger' : 'text-on-surface'}`}>{money(r.monthly_margin, c)}/mo</span>
                    </p>

                    {/* Swap proposal */}
                    <div className="mt-3 rounded-xl-2 bg-surface-2/40 border border-outline px-3 py-2.5 flex items-center gap-3 flex-wrap">
                      <ArrowRight size={14} className="text-success shrink-0" />
                      <p className="text-xs text-on-surface flex-1 min-w-0">
                        Move to{' '}
                        <span className="font-semibold text-success">{swap.candidate_employee_name}</span>
                        <span className="text-on-surface-subtle"> ({money(swap.candidate_rate, c)}/h, {hrs(swap.candidate_free_hours)} free)</span>
                        {' — '}new margin{' '}
                        <span className="num-mono font-semibold">{money(swap.candidate_monthly_margin, c)}/mo</span>
                      </p>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] uppercase tracking-wide font-bold text-on-surface-subtle">Net gain</p>
                        <p className="num-mono text-base font-bold text-success">+{money(swap.net_gain, c)}/mo</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="px-5 py-2.5 border-t border-outline bg-surface-2/30 text-[11px] text-on-surface-subtle inline-flex items-center gap-2">
        <Info size={11} />
        Greedy single-swap suggestions. Each swap is independently feasible (capacity-checked) but not jointly optimal — apply highest-gain swaps first and recompute.
      </div>
    </section>
  );
}

// ── 2. Margin Matrix ─────────────────────────────────────────────────────
function MarginMatrix({ data }: { data: FinOptimization }) {
  const c = data.currency;
  const { employees, projects, cells } = data.matrix;
  const cellMap = useMemo(() => {
    const m = new Map<string, typeof cells[0]>();
    for (const cell of cells) m.set(`${cell.employee_id}__${cell.project_id}`, cell);
    return m;
  }, [cells]);

  // Color scale based on margin_per_hour
  const maxAbs = useMemo(() => {
    let mx = 1;
    for (const cell of cells) mx = Math.max(mx, Math.abs(cell.margin_per_hour));
    return mx;
  }, [cells]);

  const cellColor = (mph: number, assigned: boolean) => {
    const intensity = Math.min(1, Math.abs(mph) / maxAbs);
    // Assigned cells get higher saturation; potential cells get a hint
    const alpha = assigned ? Math.max(0.25, intensity) : Math.max(0.05, intensity * 0.25);
    if (mph >= 0) return `rgba(34, 197, 94, ${alpha})`;
    return `rgba(239, 68, 68, ${alpha})`;
  };

  return (
    <section className="rounded-xl-3 border border-outline bg-surface overflow-hidden shadow-elev-1">
      <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-brand-container/40 to-surface">
        <h3 className="font-display text-lg font-bold tracking-tight text-on-surface inline-flex items-center gap-2">
          <Activity size={18} className="text-brand" /> Margin heat map
        </h3>
        <p className="text-xs text-on-surface-muted mt-0.5">
          Rows sorted by cost (highest first), columns by revenue/h (highest first). Solid cells = currently assigned; faint cells = potential (no current hours). Top-left = ideal seniors-on-premium quadrant.
        </p>
      </div>

      {employees.length === 0 || projects.length === 0 ? (
        <div className="p-12 text-center text-sm text-on-surface-muted">
          Need at least one direct-staff employee and one active project with revenue to render the matrix.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="sticky left-0 bg-surface z-10 px-3 py-2 border-b border-outline text-left text-[10px] uppercase tracking-wide font-bold text-on-surface-subtle">
                  Employee · cost/h
                </th>
                {projects.map(p => (
                  <th key={p.id} className="px-2 py-2 border-b border-outline text-center min-w-[80px] max-w-[80px] align-bottom">
                    <div className="font-semibold text-on-surface truncate text-[11px]" title={p.name}>{p.name}</div>
                    <div className="text-on-surface-subtle num-mono text-[10px] mt-0.5">{money(p.revenue_per_hour, c)}/h</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map(e => (
                <tr key={e.id}>
                  <td className="sticky left-0 bg-surface z-10 px-3 py-2 border-b border-outline whitespace-nowrap min-w-[180px]">
                    <div className="text-on-surface font-semibold truncate">{e.name}</div>
                    <div className="text-on-surface-subtle text-[10px] num-mono">{money(e.rate, c)}/h · {e.designation ?? '—'}</div>
                  </td>
                  {projects.map(p => {
                    const cell = cellMap.get(`${e.id}__${p.id}`)!;
                    return (
                      <td key={p.id}
                        className={`px-1 py-1 border-b border-outline text-center align-middle ${cell.assigned ? 'border-l border-r border-on-surface/10' : ''}`}
                        style={{ background: cellColor(cell.margin_per_hour, cell.assigned) }}
                        title={`${e.name} × ${p.name}\nmargin: ${money(cell.margin_per_hour, c)}/h\n${cell.assigned ? `${hrs(cell.hours)} this month → ${money(cell.monthly_margin, c)}` : 'not assigned'}`}>
                        {cell.assigned ? (
                          <div className="text-[10px] font-bold text-on-surface">
                            <div className="num-mono">{hrs(cell.hours)}</div>
                            <div className={`num-mono ${cell.margin_per_hour < 0 ? 'text-danger' : 'text-success'}`}>
                              {moneyShort(cell.monthly_margin, c)}
                            </div>
                          </div>
                        ) : (
                          <div className={`num-mono text-[9px] ${cell.margin_per_hour < 0 ? 'text-danger/60' : 'text-success/60'}`}>
                            {money(cell.margin_per_hour, c)}/h
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-5 py-2.5 border-t border-outline bg-surface-2/30 text-[11px] text-on-surface-subtle flex flex-wrap gap-4">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'rgba(34,197,94,0.6)' }} />+ margin</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'rgba(239,68,68,0.6)' }} />− margin</span>
        <span>solid = currently assigned · faint = potential allocation</span>
      </div>
    </section>
  );
}

// ── 3. Leverage Score ────────────────────────────────────────────────────
function LeverageScore({ data }: { data: FinOptimization }) {
  const c = data.currency;
  const rows = data.leverage;
  const totalSalary = rows.reduce((s, r) => s + r.salary, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue_produced, 0);
  const orgLeverage = totalSalary > 0 ? totalRevenue / totalSalary : 0;

  return (
    <section className="rounded-xl-3 border border-outline bg-surface overflow-hidden shadow-elev-1">
      <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-success-container/40 to-surface flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold tracking-tight text-on-surface inline-flex items-center gap-2">
            <TrendingUp size={18} className="text-success" /> Leverage score
          </h3>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Revenue produced ÷ salary, per direct-staff employee. ≥4× = great, 2.5–4× = OK, 1.5–2.5× = underused, &lt;1.5× = bench risk.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Org-wide leverage</p>
          <p className="num-mono text-2xl font-bold text-on-surface mt-0.5">{orgLeverage.toFixed(1)}×</p>
          <p className="text-[11px] text-on-surface-subtle mt-0.5">{moneyShort(totalRevenue, c)} produced on {moneyShort(totalSalary, c)} salary</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-12 text-center text-sm text-on-surface-muted">No direct-staff employees classified yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide font-bold text-on-surface-subtle bg-surface-2 border-b border-outline">
                <th className="px-4 py-2.5 text-left">Employee</th>
                <th className="px-3 py-2.5 text-right">Salary</th>
                <th className="px-3 py-2.5 text-right">Hours · Util</th>
                <th className="px-3 py-2.5 text-right">Revenue produced</th>
                <th className="px-3 py-2.5 text-right">Margin</th>
                <th className="px-3 py-2.5 text-right">Leverage</th>
                <th className="px-3 py-2.5 text-left">Verdict</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline">
              {rows.map(r => {
                const v = VERDICT_CFG[r.verdict] ?? VERDICT_CFG.ok;
                return (
                  <tr key={r.employee_id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-on-surface">{r.name}</div>
                      <div className="text-xs text-on-surface-subtle">{r.designation || r.department || '—'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right num-mono text-on-surface-muted">{money(r.salary, c)}</td>
                    <td className="px-3 py-2.5 text-right num-mono text-xs text-on-surface-muted">
                      <div>{hrs(r.hours_allocated)} / {hrs(r.capacity)}</div>
                      <div className={`${r.utilization >= 0.8 ? 'text-success' : r.utilization >= 0.5 ? 'text-warning' : 'text-danger'}`}>{pct(r.utilization)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right num-mono text-on-surface">{money(r.revenue_produced, c)}</td>
                    <td className={`px-3 py-2.5 text-right num-mono font-semibold ${r.margin_produced >= 0 ? 'text-success' : 'text-danger'}`}>
                      {money(r.margin_produced, c)}
                    </td>
                    <td className="px-3 py-2.5 text-right num-mono font-bold text-on-surface">{r.leverage.toFixed(1)}×</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${v.cls}`}>{v.label}</span>
                      <div className="text-[10px] text-on-surface-subtle mt-0.5">{v.sub}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── 4. Manager P&L ───────────────────────────────────────────────────────
// Reporting managers don't bill hours directly, so we score them by the
// margin their team produces (plus their own billables, if they bill).
function ManagerPnl({ month, year, rev }: { month: number; year: number; rev: number }) {
  const [scope, setScope] = useState<'direct' | 'subtree'>('direct');
  const [data, setData] = useState<FinManagerPnl | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr('');
    financeApi.getManagerPnl(month, year, scope)
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [month, year, scope, rev]);

  const c = data?.currency ?? '₹';

  return (
    <section className="rounded-xl-3 border border-outline bg-surface overflow-hidden shadow-elev-1">
      <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-accent-container/40 to-surface flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold tracking-tight text-on-surface inline-flex items-center gap-2">
            <UsersIcon size={18} className="text-accent" /> Manager P&amp;L
          </h3>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Reporting managers measured by team output. Net contribution = team revenue + manager's own billables − team salaries − manager salary.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-lg p-0.5">
            {([
              { key: 'direct', label: 'Direct reports' },
              { key: 'subtree', label: 'Full sub-tree' },
            ] as Array<{ key: 'direct' | 'subtree'; label: string }>).map(opt => (
              <button key={opt.key} onClick={() => setScope(opt.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  scope === opt.key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'
                }`}>{opt.label}</button>
            ))}
          </div>
          {data && (
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Org manager leverage</p>
              <p className="num-mono text-xl font-bold text-on-surface mt-0.5">{data.total.org_leverage.toFixed(1)}×</p>
              <p className="text-[11px] text-on-surface-subtle mt-0.5">{moneyShort(data.total.team_revenue_total, c)} on {moneyShort(data.total.manager_salary_total + data.total.team_salary_total, c)} all-in</p>
            </div>
          )}
        </div>
      </div>

      {err && <div className="mx-5 mt-3 rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      {loading ? (
        <div className="p-12 text-center text-sm text-on-surface-subtle">Loading…</div>
      ) : !data || data.managers.length === 0 ? (
        <div className="p-12 text-center">
          <UsersIcon size={28} className="mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">No reporting managers active this month.</p>
          <p className="text-xs text-on-surface-subtle mt-1">A manager appears here once they have at least one direct report AND a Finance Classification entry.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide font-bold text-on-surface-subtle bg-surface-2 border-b border-outline">
                <th className="px-4 py-2.5 text-left">Manager</th>
                <th className="px-3 py-2.5 text-center">Reports</th>
                <th className="px-3 py-2.5 text-right">Team revenue</th>
                <th className="px-3 py-2.5 text-right">Team salary</th>
                <th className="px-3 py-2.5 text-right">Mgr salary</th>
                <th className="px-3 py-2.5 text-right">Net contr.</th>
                <th className="px-3 py-2.5 text-right">Leverage</th>
                <th className="px-3 py-2.5 text-right">Team util</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline">
              {data.managers.map(m => {
                const v = VERDICT_CFG[m.verdict] ?? VERDICT_CFG.ok;
                const isOpen = expanded === m.manager_id;
                return (
                  <ManagerRow key={m.manager_id}
                    manager={m}
                    isOpen={isOpen}
                    onToggle={() => setExpanded(isOpen ? null : m.manager_id)}
                    currency={c}
                    verdictCfg={v}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-5 py-2.5 border-t border-outline bg-surface-2/30 text-[11px] text-on-surface-subtle flex flex-wrap gap-4 items-center">
        <span className="inline-flex items-center gap-1.5"><Briefcase size={11} className="text-warning" /> Billing manager (also has own assignments)</span>
        <span>Click any row to drill into per-report leverage</span>
        {scope === 'subtree' && <span className="text-warning">Sub-tree mode favours senior managers — they're not "better", just have bigger trees.</span>}
      </div>
    </section>
  );
}

function ManagerRow({ manager: m, isOpen, onToggle, currency: c, verdictCfg: v }: {
  manager: FinManagerPnl['managers'][number]; isOpen: boolean; onToggle: () => void; currency: string; verdictCfg: { label: string; cls: string; sub: string };
}) {
  return (
    <>
      <tr className="hover:bg-surface-2/50 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-2.5">
          <div className="font-semibold text-on-surface inline-flex items-center gap-1.5">
            {m.manager_name}
            {m.is_billing_manager && (
              <span title="This manager is also a billing IC" className="inline-flex items-center"><Briefcase size={11} className="text-warning" /></span>
            )}
          </div>
          <div className="text-xs text-on-surface-subtle">{m.manager_designation || m.manager_department || '—'}</div>
        </td>
        <td className="px-3 py-2.5 text-center num-mono font-semibold text-on-surface">{m.reports_count}</td>
        <td className="px-3 py-2.5 text-right num-mono">
          <div className="text-on-surface">{money(m.team_revenue_produced, c)}</div>
          {m.is_billing_manager && m.manager_revenue_produced > 0 && (
            <div className="text-[10px] text-warning">+ {money(m.manager_revenue_produced, c)} own</div>
          )}
        </td>
        <td className="px-3 py-2.5 text-right num-mono text-on-surface-muted">{money(m.team_salary, c)}</td>
        <td className="px-3 py-2.5 text-right num-mono text-on-surface-muted">{money(m.manager_salary, c)}</td>
        <td className={`px-3 py-2.5 text-right num-mono font-bold ${m.net_contribution >= 0 ? 'text-success' : 'text-danger'}`}>
          {m.net_contribution >= 0 ? '+' : ''}{money(m.net_contribution, c)}
        </td>
        <td className="px-3 py-2.5 text-right num-mono font-bold text-on-surface">{m.leverage.toFixed(1)}×</td>
        <td className="px-3 py-2.5 text-right num-mono text-xs">
          <span className={m.team_utilization >= 0.8 ? 'text-success' : m.team_utilization >= 0.5 ? 'text-warning' : 'text-danger'}>
            {pct(m.team_utilization)}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold ${v.cls}`}>{v.label}</span>
            <ChevronDown size={13} className={`text-on-surface-subtle transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-surface-2/30">
          <td colSpan={9} className="px-4 py-3">
            <div className="space-y-3">
              {/* Financial walk-through */}
              <div className="rounded-xl-2 border border-outline bg-surface p-3 text-xs space-y-1">
                <div className="font-bold text-on-surface mb-1">How {m.manager_name}'s P&L breaks down</div>
                <Line label="Team revenue produced" value={money(m.team_revenue_produced, c)} />
                {m.is_billing_manager && m.manager_revenue_produced > 0 && (
                  <Line label={`+ ${m.manager_name}'s own billables`} value={money(m.manager_revenue_produced, c)} tone="text-warning" />
                )}
                <Line label="− Team salaries" value={money(m.team_salary, c)} tone="text-on-surface-muted" minus />
                <Line label={`− ${m.manager_name}'s salary`} value={money(m.manager_salary, c)} tone="text-on-surface-muted" minus />
                <div className="border-t-2 border-outline-strong pt-1 mt-1">
                  <Line label="Net contribution" value={money(m.net_contribution, c)} bold tone={m.net_contribution >= 0 ? 'text-success' : 'text-danger'} />
                  <Line label="Leverage" value={`${m.leverage.toFixed(1)}× — ${v.label}`} tone={m.net_contribution >= 0 ? 'text-success' : 'text-danger'} />
                </div>
              </div>

              {/* Per-report breakdown */}
              <div>
                <p className="text-[10px] uppercase tracking-wide font-bold text-on-surface-subtle mb-1.5">Per-report breakdown ({m.reports.length})</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-on-surface-subtle border-b border-outline">
                      <th className="px-2 py-1.5 text-left">Report</th>
                      <th className="px-2 py-1.5 text-right">Salary</th>
                      <th className="px-2 py-1.5 text-right">Util</th>
                      <th className="px-2 py-1.5 text-right">Revenue</th>
                      <th className="px-2 py-1.5 text-right">Leverage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline">
                    {m.reports.map(r => (
                      <tr key={r.id}>
                        <td className="px-2 py-1.5">
                          <div className="text-on-surface font-medium">{r.name}</div>
                          <div className="text-on-surface-subtle text-[10px]">{r.designation ?? '—'}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right num-mono text-on-surface-muted">{money(r.salary, c)}</td>
                        <td className="px-2 py-1.5 text-right num-mono">
                          <span className={r.utilization >= 0.8 ? 'text-success' : r.utilization >= 0.5 ? 'text-warning' : 'text-danger'}>
                            {pct(r.utilization)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right num-mono text-on-surface">{money(r.revenue_produced, c)}</td>
                        <td className="px-2 py-1.5 text-right num-mono font-bold text-on-surface">{r.leverage.toFixed(1)}×</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Line({ label, value, bold, minus, tone }: { label: string; value: string; bold?: boolean; minus?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${bold ? 'font-bold text-on-surface' : 'text-on-surface-muted'}`}>{label}</span>
      <span className={`num-mono ${bold ? 'font-bold' : ''} ${tone || 'text-on-surface'}`}>{minus ? '−' : ''}{value.replace('₹-', '₹')}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-32 rounded-xl-3 bg-surface-2" />
      <div className="h-64 rounded-xl-3 bg-surface-2" />
      <div className="h-64 rounded-xl-3 bg-surface-2" />
    </div>
  );
}
