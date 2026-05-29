import { useEffect, useState } from 'react';
import { financeApi } from '../../services/financeApi';
import { money } from './format';

type Row = {
  id: string; name: string; designation: string | null; department: string | null; salary: number;
  cost_type: 'direct' | 'indirect' | 'supervisor' | null; capacity_hours: number | null; active: boolean | null;
};

export default function PeopleTab({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [defCap, setDefCap] = useState(176);
  const [currency, setCurrency] = useState('₹');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([financeApi.getEmployees(), financeApi.getSettings()])
      .then(([emps, s]) => { setRows(emps as Row[]); setDefCap(s.working_hours_per_month); setCurrency(s.currency); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const persist = async (id: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const r = { ...rows.find((x) => x.id === id)!, ...patch };
    setSavingId(id);
    try {
      await financeApi.saveEmployee(id, {
        cost_type: r.cost_type ?? null,
        capacity_hours: r.capacity_hours,
        active: r.active ?? true,
      });
      onChanged();
    } catch (e: any) { setErr(e.message); } finally { setSavingId(null); }
  };

  if (loading) return <div className="h-64 rounded-xl-2 bg-surface-2 animate-pulse" />;

  const classified = rows.filter((r) => r.cost_type).length;

  return (
    <div className="space-y-4">
      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}
      <p className="text-sm text-on-surface-muted">
        Tag each person as <b className="text-success">Direct</b> (billable — hours land on projects), <b className="text-accent">Indirect</b> (overhead — founders, HR, admin),
        or <b className="text-brand">Supervisor</b> (lead/manager — cost spreads only across the projects they run). Unclassified people are excluded.
        <b className="text-on-surface"> {classified}</b> of {rows.length} classified. Salaries come from the HRMS.
      </p>

      <div className="rounded-xl-2 border border-outline bg-surface overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-on-surface-subtle border-b border-outline bg-surface-2">
              <th className="text-left font-semibold px-4 py-2.5">Person</th>
              <th className="text-left font-semibold px-3 py-2.5">Dept</th>
              <th className="text-right font-semibold px-3 py-2.5">Salary /mo</th>
              <th className="text-left font-semibold px-3 py-2.5">Classification</th>
              <th className="text-right font-semibold px-3 py-2.5">Capacity (h)</th>
              <th className="text-right font-semibold px-3 py-2.5">Eff. rate/h</th>
              <th className="text-center font-semibold px-3 py-2.5">In finance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {rows.map((r) => {
              const cap = r.capacity_hours && r.capacity_hours > 0 ? r.capacity_hours : defCap;
              const rate = cap > 0 ? r.salary / cap : 0;
              return (
                <tr key={r.id} className={`hover:bg-surface-2/50 ${!r.cost_type ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-on-surface">{r.name}</div>
                    <div className="text-xs text-on-surface-subtle">{r.designation || '—'}</div>
                  </td>
                  <td className="px-3 py-2 text-on-surface-muted">{r.department || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface">{money(r.salary, currency)}</td>
                  <td className="px-3 py-2">
                    <select value={r.cost_type ?? 'none'} onChange={(e) => persist(r.id, { cost_type: e.target.value === 'none' ? null : (e.target.value as any) })}
                      className="rounded-lg border border-outline bg-surface px-2 py-1.5 text-sm text-on-surface outline-none focus:border-brand">
                      <option value="none">Unclassified</option>
                      <option value="direct">Direct (billable)</option>
                      <option value="indirect">Indirect (overhead)</option>
                      <option value="supervisor">Supervisor (lead/manager)</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" placeholder={String(defCap)} value={r.capacity_hours ?? ''} disabled={r.cost_type !== 'direct'}
                      onChange={(e) => setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, capacity_hours: e.target.value === '' ? null : Number(e.target.value) } : x))}
                      onBlur={() => r.cost_type === 'direct' && persist(r.id, {})}
                      className="w-24 rounded-lg border border-outline bg-surface px-2 py-1.5 text-right text-sm text-on-surface outline-none focus:border-brand disabled:opacity-40" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface-muted">{r.cost_type === 'direct' ? money(rate, currency) : '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" disabled={!r.cost_type} checked={r.active ?? false}
                      onChange={(e) => persist(r.id, { active: e.target.checked })}
                      className="h-4 w-4 accent-[rgb(var(--primary))] disabled:opacity-30" />
                    {savingId === r.id && <span className="ml-2 text-xs text-on-surface-subtle">…</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
