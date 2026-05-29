import { useEffect, useState } from 'react';
import { financeApi, type FinSettings } from '../../services/financeApi';

export default function SettingsTab({ onChanged }: { onChanged: () => void }) {
  const [s, setS] = useState<FinSettings | null>(null);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { financeApi.getSettings().then(setS).catch((e) => setErr(e.message)); }, []);
  if (!s) return <div className="h-48 rounded-xl-2 bg-surface-2 animate-pulse" />;

  const save = async () => {
    setSaving(true); setSaved(false);
    try { const next = await financeApi.saveSettings(s); setS(next); setSaved(true); onChanged(); }
    catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl space-y-5">
      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      <div className="rounded-xl-2 border border-outline bg-surface p-6 space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-on-surface-muted mb-1">Working hours per month (capacity)</label>
            <input type="number" value={s.working_hours_per_month} onChange={(e) => setS({ ...s, working_hours_per_month: Number(e.target.value) })}
              className="w-full rounded-xl-2 border border-outline bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-brand" />
            <p className="mt-1 text-xs text-on-surface-subtle">Effective hourly cost = salary ÷ this. e.g. 22 days × 8h = 176.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-on-surface-muted mb-1">Currency symbol</label>
            <input value={s.currency} maxLength={4} onChange={(e) => setS({ ...s, currency: e.target.value })}
              className="w-full rounded-xl-2 border border-outline bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-brand" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-muted mb-1">How should overhead be spread across projects?</label>
          <select value={s.overhead_method} onChange={(e) => setS({ ...s, overhead_method: e.target.value as any })}
            className="w-full rounded-xl-2 border border-outline bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-brand">
            <option value="direct_hours">By direct hours — projects using more staff hours absorb more</option>
            <option value="revenue">By revenue share — bigger projects absorb more</option>
            <option value="headcount">Equally per project</option>
            <option value="none">Don’t allocate — show only direct (gross) profit</option>
          </select>
          <p className="mt-1 text-xs text-on-surface-subtle">Overhead pool = indirect salaries + overhead costs. This only changes how it’s divided, never total company profit.</p>
        </div>

        <label className="flex items-start gap-3 rounded-xl-2 border border-outline bg-surface-2 p-3 cursor-pointer">
          <input type="checkbox" checked={s.include_bench_in_overhead} onChange={(e) => setS({ ...s, include_bench_in_overhead: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]" />
          <span className="text-sm text-on-surface">
            Include idle / bench cost in the overhead pool
            <span className="mt-0.5 block text-xs text-on-surface-subtle">On = cost of unallocated staff hours is spread onto projects (fully-loaded). Off = shown separately as company-level idle capacity (recommended).</span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className="rounded-xl-2 bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          {saved && <span className="text-sm text-success">Saved ✓</span>}
        </div>
      </div>

      <div className="rounded-xl-2 border border-outline bg-surface p-6 text-sm text-on-surface-muted">
        <div className="mb-2 font-semibold text-on-surface">How profit is calculated</div>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Each person’s <b>effective hourly cost</b> = monthly salary ÷ capacity hours.</li>
          <li><b>Direct</b> staff hours allocated to a project (from Project Hours) become that project’s direct labour cost.</li>
          <li><b>Gross profit</b> = revenue − direct labour cost.</li>
          <li>The <b>overhead pool</b> (indirect salaries + overhead costs) is spread across projects using the method above.</li>
          <li><b>Net profit</b> = gross − allocated overhead = the true, fully-loaded project profit.</li>
          <li>Unallocated direct hours show up as <b>idle / bench cost</b> at company level.</li>
        </ol>
      </div>
    </div>
  );
}
