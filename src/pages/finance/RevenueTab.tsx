import { useEffect, useState } from 'react';
import { Copy, Plus, X } from 'lucide-react';
import { financeApi } from '../../services/financeApi';
import { useAuth } from '../../context/AuthContext';
import { MONTHS, money } from './format';

const BLANK_NEW = { name: '', client_name: '', billing_type: 'fixed', fixed_amount: '', hourly_rate: '', billable_hours: '' };

type Row = {
  id: string; name: string; client_name: string | null;
  billing_type: 'fixed' | 'hourly'; fixed_amount: number; hourly_rate: number; billable_hours: number;
};

export default function RevenueTab({ month, year, onChanged }: { month: number; year: number; onChanged: () => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [creating, setCreating] = useState(false);
  const [np, setNp] = useState({ ...BLANK_NEW });

  const load = () => {
    setLoading(true); setErr('');
    financeApi.getRevenue(month, year)
      .then((data) => setRows(data.map((r) => ({
        id: r.id, name: r.name, client_name: r.client_name,
        billing_type: (r.billing_type as any) || 'fixed',
        fixed_amount: Number(r.fixed_amount || 0), hourly_rate: Number(r.hourly_rate || 0), billable_hours: Number(r.billable_hours || 0),
      }))))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [month, year]);

  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = async (r: Row) => {
    setSaving(r.id);
    try {
      await financeApi.saveRevenue({ project_id: r.id, month, year, billing_type: r.billing_type, fixed_amount: r.fixed_amount, hourly_rate: r.hourly_rate, billable_hours: r.billable_hours });
      onChanged();
    } catch (e: any) { setErr(e.message); } finally { setSaving(null); }
  };

  const createProject = async () => {
    if (!np.name.trim()) { setErr('Project name is required'); return; }
    setCreating(true); setErr('');
    try {
      await financeApi.createProject({
        name: np.name.trim(), client_name: np.client_name.trim(), month, year,
        billing_type: np.billing_type, fixed_amount: Number(np.fixed_amount) || 0,
        hourly_rate: Number(np.hourly_rate) || 0, billable_hours: Number(np.billable_hours) || 0,
        created_by: user?.name,
      });
      setNp({ ...BLANK_NEW }); setShowAdd(false);
      load(); onChanged();
    } catch (e: any) { setErr(e.message); } finally { setCreating(false); }
  };

  const copyPrev = async () => {
    const idx = year * 12 + (month - 1) - 1;
    const pm = (idx % 12) + 1, py = Math.floor(idx / 12);
    if (!confirm(`Copy project billing from ${MONTHS[pm - 1]} ${py} into ${MONTHS[month - 1]} ${year}? Existing rows are kept.`)) return;
    try { await financeApi.copyMonth(pm, py, month, year); load(); onChanged(); } catch (e: any) { setErr(e.message); }
  };

  if (loading) return <div className="h-64 rounded-xl-2 bg-surface-2 animate-pulse" />;

  return (
    <div className="space-y-4">
      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-on-surface-muted">What each client pays for <b className="text-on-surface">{MONTHS[month - 1]} {year}</b>. Visible to admins only.</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-1.5 rounded-xl-2 bg-brand px-3 py-2 text-xs font-medium text-on-brand hover:opacity-90">
            {showAdd ? <X size={14} /> : <Plus size={14} />} {showAdd ? 'Cancel' : 'New project'}
          </button>
          <button onClick={copyPrev} className="flex items-center gap-1.5 rounded-xl-2 border border-outline bg-surface px-3 py-2 text-xs font-medium text-on-surface hover:bg-surface-2">
            <Copy size={14} /> Copy last month
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="rounded-xl-2 border border-brand/30 bg-brand-container/20 p-4">
          <h4 className="text-sm font-semibold text-on-surface mb-3">New project <span className="font-normal text-on-surface-muted">· also appears in Project Mgmt → Projects</span></h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs text-on-surface-muted mb-1">Project name *</label>
              <input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} placeholder="e.g. VA Support Retainer"
                className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-sm text-on-surface outline-none focus:border-brand" />
            </div>
            <div>
              <label className="block text-xs text-on-surface-muted mb-1">Client</label>
              <input value={np.client_name} onChange={(e) => setNp({ ...np, client_name: e.target.value })} placeholder="Client name"
                className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-sm text-on-surface outline-none focus:border-brand" />
            </div>
            <div>
              <label className="block text-xs text-on-surface-muted mb-1">Billing</label>
              <select value={np.billing_type} onChange={(e) => setNp({ ...np, billing_type: e.target.value })}
                className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-sm text-on-surface outline-none focus:border-brand">
                <option value="fixed">Fixed monthly</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>
            {np.billing_type === 'fixed' ? (
              <div>
                <label className="block text-xs text-on-surface-muted mb-1">Fixed amount /mo</label>
                <input type="number" value={np.fixed_amount} onChange={(e) => setNp({ ...np, fixed_amount: e.target.value })} placeholder="0"
                  className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-right text-sm text-on-surface outline-none focus:border-brand" />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-on-surface-muted mb-1">Hourly rate</label>
                  <input type="number" value={np.hourly_rate} onChange={(e) => setNp({ ...np, hourly_rate: e.target.value })} placeholder="0"
                    className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-right text-sm text-on-surface outline-none focus:border-brand" />
                </div>
                <div>
                  <label className="block text-xs text-on-surface-muted mb-1">Billable hours /mo</label>
                  <input type="number" value={np.billable_hours} onChange={(e) => setNp({ ...np, billable_hours: e.target.value })} placeholder="0"
                    className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-right text-sm text-on-surface outline-none focus:border-brand" />
                </div>
              </>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={createProject} disabled={creating} className="rounded-xl-2 bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:opacity-90 disabled:opacity-50">
              {creating ? 'Creating…' : 'Create project'}
            </button>
            <span className="text-xs text-on-surface-subtle">Assign people & hours afterwards under Project Mgmt → Hours grid.</span>
          </div>
        </div>
      )}

      <div className="rounded-xl-2 border border-outline bg-surface overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-on-surface-subtle border-b border-outline bg-surface-2">
              <th className="text-left font-semibold px-4 py-2.5">Project</th>
              <th className="text-left font-semibold px-3 py-2.5">Billing</th>
              <th className="text-right font-semibold px-3 py-2.5">Fixed /mo</th>
              <th className="text-right font-semibold px-3 py-2.5">Rate/h</th>
              <th className="text-right font-semibold px-3 py-2.5">Billable h</th>
              <th className="text-right font-semibold px-3 py-2.5">Revenue</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {rows.map((r) => {
              const revenue = r.billing_type === 'hourly' ? r.hourly_rate * r.billable_hours : r.fixed_amount;
              return (
                <tr key={r.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-on-surface">{r.name}</div>
                    <div className="text-xs text-on-surface-subtle">{r.client_name || '—'}</div>
                  </td>
                  <td className="px-3 py-2">
                    <select value={r.billing_type} onChange={(e) => set(r.id, { billing_type: e.target.value as any })}
                      className="rounded-lg border border-outline bg-surface px-2 py-1.5 text-sm text-on-surface outline-none focus:border-brand">
                      <option value="fixed">Fixed</option>
                      <option value="hourly">Hourly</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={r.fixed_amount} disabled={r.billing_type !== 'fixed'}
                      onChange={(e) => set(r.id, { fixed_amount: Number(e.target.value) })}
                      className="w-28 rounded-lg border border-outline bg-surface px-2 py-1.5 text-right text-sm text-on-surface outline-none focus:border-brand disabled:opacity-40" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={r.hourly_rate} disabled={r.billing_type !== 'hourly'}
                      onChange={(e) => set(r.id, { hourly_rate: Number(e.target.value) })}
                      className="w-24 rounded-lg border border-outline bg-surface px-2 py-1.5 text-right text-sm text-on-surface outline-none focus:border-brand disabled:opacity-40" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={r.billable_hours} disabled={r.billing_type !== 'hourly'}
                      onChange={(e) => set(r.id, { billable_hours: Number(e.target.value) })}
                      className="w-24 rounded-lg border border-outline bg-surface px-2 py-1.5 text-right text-sm text-on-surface outline-none focus:border-brand disabled:opacity-40" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-on-surface">{money(revenue)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => save(r)} disabled={saving === r.id}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-on-brand hover:opacity-90 disabled:opacity-50">
                      {saving === r.id ? '…' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-on-surface-muted">No active projects. Create projects under Project Mgmt → Projects.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
