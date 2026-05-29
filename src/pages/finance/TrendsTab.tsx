import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { financeApi, type FinTrendPoint } from '../../services/financeApi';
import { MONTHS, money, moneyShort, pct } from './format';

export default function TrendsTab({ month, year, rev }: { month: number; year: number; rev: number }) {
  const [series, setSeries] = useState<FinTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [currency, setCurrency] = useState('₹');

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
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {series.map((s) => (
              <tr key={`${s.year}-${s.month}`} className="hover:bg-surface-2/50">
                <td className="px-4 py-2.5 font-medium text-on-surface">{MONTHS[s.month - 1]} {s.year}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-on-surface">{money(s.revenue, currency)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-on-surface-muted">{money(s.totalCost, currency)}</td>
                <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${s.netProfit >= 0 ? 'text-success' : 'text-danger'}`}>{money(s.netProfit, currency)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-on-surface">{pct(s.netMargin)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-on-surface">{pct(s.utilization)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-warning">{money(s.benchCost, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
