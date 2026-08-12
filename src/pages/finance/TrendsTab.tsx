import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { X, ExternalLink } from 'lucide-react';
import { financeApi, type FinTrendPoint, type FinInvoice } from '../../services/financeApi';
import { MONTHS, money, moneyShort, pct } from './format';

export default function TrendsTab({ month, year, rev }: { month: number; year: number; rev: number }) {
  const [series, setSeries] = useState<FinTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [currency, setCurrency] = useState('₹');
  // Pending-invoices drilldown — opens when a Pending cell is clicked.
  // Holds the month/year being drilled into; null = no modal.
  const [pendingDrill, setPendingDrill] = useState<{ month: number; year: number } | null>(null);

  useEffect(() => {
    setLoading(true); setErr('');
    Promise.all([financeApi.getTrends(month, year), financeApi.getSettings()])
      .then(([s, st]) => { setSeries(s); setCurrency(st.currency); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [month, year, rev]);

  if (loading) return <div className="h-80 rounded-xl-2 bg-surface-2 animate-pulse" />;
  if (err) return <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-4 text-sm text-danger">{err}</div>;

  const chartData = series.map((s) => ({
    label: `${MONTHS[s.month - 1]} ${String(s.year).slice(2)}`,
    Revenue: Math.round(s.revenue),
    'Net profit': Math.round(s.netProfit),
    margin: s.netMargin,
  }));
  const nonEmpty = series.filter((s) => s.revenue > 0 || s.totalCost > 0);

  return (
    <div className="space-y-5">
      <div className="rounded-xl-2 border border-outline bg-surface p-5">
        <h3 className="text-sm font-semibold text-on-surface mb-4">Revenue & net profit · trailing 12 months</h3>
        {nonEmpty.length === 0 ? (
          <div className="py-10 text-center text-sm text-on-surface-muted">No data in the last 12 months. Add revenue & classify staff to populate trends.</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--outline))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'rgb(var(--on-surface-muted))' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => moneyShort(v, currency)} tick={{ fontSize: 11, fill: 'rgb(var(--on-surface-muted))' }} axisLine={false} tickLine={false} width={70} />
              <Tooltip
                formatter={(v: any, name: any) => [money(Number(v), currency), name]}
                contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--outline))', borderRadius: 12, fontSize: 12, color: 'rgb(var(--on-surface))' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Revenue" fill="rgb(var(--primary))" radius={[4, 4, 0, 0]} barSize={18} />
              <Line dataKey="Net profit" stroke="rgb(var(--success))" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="rounded-xl-2 border border-outline bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-on-surface-subtle border-b border-outline bg-surface-2">
              <th className="text-left font-semibold px-4 py-2.5">Month</th>
              <th className="text-right font-semibold px-3 py-2.5">Revenue</th>
              <th className="text-right font-semibold px-3 py-2.5">Total cost</th>
              <th className="text-right font-semibold px-3 py-2.5">Net profit</th>
              <th className="text-right font-semibold px-3 py-2.5">Margin</th>
              <th className="text-right font-semibold px-3 py-2.5">Utilization</th>
              <th className="text-right font-semibold px-3 py-2.5">Bench cost</th>
              <th className="text-right font-semibold px-3 py-2.5" title="Invoiced this month but not yet cleared. Click to drill in.">Pending payment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {series.map((s) => {
              const pending = Number((s as any).totalPending ?? 0);
              const hasPending = pending > 0;
              return (
                <tr key={`${s.year}-${s.month}`} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2.5 font-medium text-on-surface">{MONTHS[s.month - 1]} {s.year}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-on-surface">{money(s.revenue, currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-on-surface-muted">{money(s.totalCost, currency)}</td>
                  <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${s.netProfit >= 0 ? 'text-success' : 'text-danger'}`}>{money(s.netProfit, currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-on-surface">{pct(s.netMargin)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-on-surface">{pct(s.utilization)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-warning">{money(s.benchCost, currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {hasPending ? (
                      <button
                        onClick={() => setPendingDrill({ month: s.month, year: s.year })}
                        title={`${s.pendingInvoiceCount ?? 0} pending invoice(s) — click for the list`}
                        className="text-warning font-semibold hover:underline underline-offset-2 decoration-warning/60 cursor-pointer"
                      >
                        {money(pending, currency)}
                        {s.pendingInvoiceCount != null && s.pendingInvoiceCount > 0 && (
                          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-warning-container/60 text-warning">
                            {s.pendingInvoiceCount}
                          </span>
                        )}
                      </button>
                    ) : pending < 0 ? (
                      <span title="Received exceeds invoiced this month — overpayment / advance / refund pending" className="text-info font-semibold">{money(pending, currency)}</span>
                    ) : (
                      <span className="text-on-surface-subtle">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pendingDrill && (
        <PendingInvoicesModal
          month={pendingDrill.month}
          year={pendingDrill.year}
          currency={currency}
          onClose={() => setPendingDrill(null)}
        />
      )}
    </div>
  );
}

function PendingInvoicesModal({ month, year, currency, onClose }: {
  month: number; year: number; currency: string; onClose: () => void;
}) {
  const [rows, setRows] = useState<FinInvoice[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    // Both 'pending' and 'cleared_pending' count as "not yet money in the
    // bank". cleared_pending is what a coordinator submits for admin
    // review — it's not cleared until admin approves, so it's still
    // "pending payment" from a cash-flow standpoint.
    financeApi.getInvoices({ month, year })
      .then(all => setRows(all.filter(inv => inv.status === 'pending' || inv.status === 'cleared_pending')))
      .catch(e => setErr(e.message ?? 'Failed to load invoices'));
  }, [month, year]);

  const outstanding = (inv: FinInvoice): number => {
    // amount_received is optional; treat null as 0. Outstanding = invoiced
    // minus whatever's been received (usually 0 for pending; can be non-
    // zero on cleared_pending awaiting admin approval).
    return Number(inv.amount_invoiced_inr ?? inv.amount_invoiced ?? 0) - Number(inv.amount_received ?? 0);
  };
  const total = rows ? rows.reduce((s, r) => s + outstanding(r), 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl border border-outline shadow-elev-4 w-full max-w-3xl flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-outline flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-on-surface">
              Pending payment · {MONTHS[month - 1]} {year}
            </h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              Invoices raised this month that haven't cleared yet.
              {rows && <> Outstanding <span className="num-mono font-semibold text-on-surface">{money(total, currency)}</span> across {rows.length} invoice{rows.length === 1 ? '' : 's'}.</>}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-2"><X size={16} className="text-on-surface-muted" /></button>
        </div>

        <div className="flex-1 overflow-auto">
          {err ? (
            <div className="p-6 text-sm text-danger">{err}</div>
          ) : rows === null ? (
            <div className="p-6 text-sm text-on-surface-muted">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-on-surface-muted">Nothing pending for {MONTHS[month - 1]} {year} — every invoice for this month has cleared.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-on-surface-subtle bg-surface-2/60 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left">Invoice #</th>
                  <th className="px-4 py-2 text-left">Project</th>
                  <th className="px-4 py-2 text-left">Raised</th>
                  <th className="px-4 py-2 text-right">Amount (INR)</th>
                  <th className="px-4 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {rows.map(inv => (
                  <tr key={inv.id} className="hover:bg-surface-2/40">
                    <td className="px-4 py-2 num-mono text-[13px] text-on-surface">{inv.invoice_number ?? <span className="text-on-surface-subtle">—</span>}</td>
                    <td className="px-4 py-2">
                      <p className="text-on-surface font-semibold">{inv.project_name ?? inv.project_id}</p>
                      {inv.project_client_name && <p className="text-[11px] text-on-surface-muted">{inv.project_client_name}</p>}
                    </td>
                    <td className="px-4 py-2 text-on-surface-muted">
                      {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right num-mono font-semibold text-warning">{money(outstanding(inv), currency)}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`inline-flex items-center text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        inv.status === 'cleared_pending' ? 'bg-info-container/60 text-info' : 'bg-warning-container/60 text-warning'
                      }`}>
                        {inv.status === 'cleared_pending' ? 'Awaiting admin' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-outline bg-surface-2/40 flex items-center justify-between">
          <a href={`/finance?tab=invoices`}
            onClick={onClose}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline">
            Manage invoices <ExternalLink size={11} />
          </a>
          <button onClick={onClose} className="px-4 py-2 text-sm text-on-surface-muted hover:bg-surface-2 rounded-lg">Close</button>
        </div>
      </div>
    </div>
  );
}
