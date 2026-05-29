import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { financeApi } from '../../services/financeApi';
import { MONTHS, money } from './format';

type Cost = { id: number; name: string; amount: number; category: string };
const CATEGORIES = ['facilities', 'software', 'professional', 'marketing', 'general'];

export default function OverheadTab({ month, year, onChanged }: { month: number; year: number; onChanged: () => void }) {
  const [costs, setCosts] = useState<Cost[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', amount: '', category: 'general' });

  const load = () => {
    setLoading(true);
    financeApi.getOverhead(month, year)
      .then((d) => setCosts(d.map((c) => ({ ...c, amount: Number(c.amount) }))))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [month, year]);

  const add = async () => {
    if (!form.name.trim()) return;
    try {
      await financeApi.addOverhead({ month, year, name: form.name.trim(), amount: Number(form.amount) || 0, category: form.category });
      setForm({ name: '', amount: '', category: 'general' });
      load(); onChanged();
    } catch (e: any) { setErr(e.message); }
  };
  const update = async (c: Cost) => { try { await financeApi.updateOverhead(c.id, { name: c.name, amount: c.amount, category: c.category }); onChanged(); } catch (e: any) { setErr(e.message); } };
  const remove = async (id: number) => { try { await financeApi.deleteOverhead(id); load(); onChanged(); } catch (e: any) { setErr(e.message); } };

  const total = costs.reduce((s, c) => s + c.amount, 0);

  if (loading) return <div className="h-64 rounded-xl-2 bg-surface-2 animate-pulse" />;

  return (
    <div className="space-y-4">
      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}
      <p className="text-sm text-on-surface-muted">Fixed monthly costs not tied to one project (rent, software, compliance) for <b className="text-on-surface">{MONTHS[month - 1]} {year}</b> — they feed the overhead pool spread across projects. Total: <b className="text-on-surface">{money(total)}</b></p>

      <div className="rounded-xl-2 border border-outline bg-surface overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-on-surface-subtle border-b border-outline bg-surface-2">
              <th className="text-left font-semibold px-4 py-2.5">Cost item</th>
              <th className="text-left font-semibold px-3 py-2.5">Category</th>
              <th className="text-right font-semibold px-3 py-2.5">Amount /mo</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {costs.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2/50">
                <td className="px-4 py-2">
                  <input value={c.name} onChange={(e) => setCosts((cs) => cs.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x))} onBlur={() => update(c)}
                    className="w-full rounded-lg border border-outline bg-surface px-2 py-1.5 text-sm text-on-surface outline-none focus:border-brand" />
                </td>
                <td className="px-3 py-2">
                  <select value={c.category} onChange={(e) => { const v = e.target.value; setCosts((cs) => cs.map((x) => x.id === c.id ? { ...x, category: v } : x)); update({ ...c, category: v }); }}
                    className="rounded-lg border border-outline bg-surface px-2 py-1.5 text-sm text-on-surface outline-none focus:border-brand">
                    {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input type="number" value={c.amount} onChange={(e) => setCosts((cs) => cs.map((x) => x.id === c.id ? { ...x, amount: Number(e.target.value) } : x))} onBlur={() => update(c)}
                    className="w-32 rounded-lg border border-outline bg-surface px-2 py-1.5 text-right text-sm text-on-surface outline-none focus:border-brand" />
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => remove(c.id)} className="rounded-lg border border-danger/30 p-1.5 text-danger hover:bg-danger-container/40"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            <tr className="bg-brand-container/30">
              <td className="px-4 py-2">
                <input value={form.name} placeholder="New cost item…" onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-outline bg-surface px-2 py-1.5 text-sm text-on-surface outline-none focus:border-brand" />
              </td>
              <td className="px-3 py-2">
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="rounded-lg border border-outline bg-surface px-2 py-1.5 text-sm text-on-surface outline-none focus:border-brand">
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </td>
              <td className="px-3 py-2">
                <input type="number" value={form.amount} placeholder="0" onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-32 rounded-lg border border-outline bg-surface px-2 py-1.5 text-right text-sm text-on-surface outline-none focus:border-brand" />
              </td>
              <td className="px-3 py-2 text-right">
                <button onClick={add} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-on-brand hover:opacity-90">+ Add</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
