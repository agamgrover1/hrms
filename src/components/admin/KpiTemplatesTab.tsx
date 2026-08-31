import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Check, X, Pencil, Eye, EyeOff, Target, Zap, Users } from 'lucide-react';
import { api, type KpiTemplate } from '../../services/api';
import { toast } from '../Toaster';

// Admin editor for KPI templates — the catalog HR builds once, then
// assigns to team members from EmployeeProfile. Every column here
// flows through to the employee's KPI tab: name, target, cadence,
// weight, unit, and the source (manual entry vs auto-pulled).

type SourceMeta = { key: string; label: string };

const CADENCES: Array<{ key: 'weekly' | 'monthly'; label: string }> = [
  { key: 'weekly',  label: 'Weekly'  },
  { key: 'monthly', label: 'Monthly' },
];

export default function KpiTemplatesTab() {
  const [rows, setRows] = useState<KpiTemplate[]>([]);
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.getKpiTemplates({ include_inactive: true })
      .then(r => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => { api.getKpiSources().then(setSources).catch(() => setSources([])); }, []);

  const sourceLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of sources) m[s.key] = s.label;
    return m;
  }, [sources]);

  const toggleActive = async (t: KpiTemplate) => {
    setBusy(true); setError('');
    try {
      const updated = await api.updateKpiTemplate(t.id, { active: !t.active });
      setRows(prev => prev.map(x => x.id === t.id ? updated : x));
    } catch (e: any) { setError(e?.message || 'Toggle failed'); }
    finally { setBusy(false); }
  };

  const bulkAssign = async (t: KpiTemplate) => {
    const scope = t.role_key ? `all "${t.role_key}" employees` : 'ALL active employees';
    if (!confirm(`Assign "${t.name}" to ${scope}? Employees who already have this KPI are skipped.`)) return;
    setBusy(true); setError('');
    try {
      const r = await api.bulkAutoAssignKpi(t.id);
      toast.success('Bulk-assigned', `${r.assigned} new · ${r.skipped} already had it · ${r.matched} matched.`);
    } catch (e: any) { setError(e?.message || 'Bulk-assign failed'); }
    finally { setBusy(false); }
  };

  const inputCls = 'text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface placeholder:text-on-surface-subtle transition-colors';

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="rounded-xl-2 border border-outline bg-brand-container/20 p-3 text-xs text-on-surface-muted flex items-start gap-2">
        <Target className="w-4 h-4 shrink-0 text-brand mt-0.5" />
        <div>
          <p><b className="text-on-surface">One template, many employees.</b> Set a KPI here (target, cadence, weight). Assign it to specific employees from their profile. Auto-source KPIs pull actuals from HRMS data (attendance, hours); manual KPIs are entered by the lead each period.</p>
          <p className="mt-1"><b className="text-on-surface">Role scope</b> is a freeform label (e.g. <span className="num-mono">SEO Executive</span>) — matching employees can be auto-assigned in bulk from their profile.</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{error}</div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
          Templates ({rows.filter(r => r.active).length} active · {rows.length} total)
        </span>
        <button onClick={() => { setShowAdd(true); setEditingId(null); }} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">
          <Plus className="w-3.5 h-3.5" /> New template
        </button>
      </div>

      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        {loading ? (
          <div className="h-40 bg-surface-2 animate-pulse" />
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-on-surface-subtle">
            No KPI templates yet. Add one to start.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b border-outline text-left text-[10px] font-semibold text-on-surface-muted uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Cadence</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Role scope</th>
                  <th className="px-3 py-2 text-center">Weight</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {rows.map(t => (
                  <tr key={t.id} className={`hover:bg-surface-2/50 ${!t.active ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2.5">
                      <div className="text-sm font-semibold text-on-surface">{t.name}</div>
                      {t.description && (
                        <div className="text-[11px] text-on-surface-muted mt-0.5 max-w-md">{t.description}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 num-mono text-sm">
                      {t.higher_is_better ? '≥ ' : '≤ '}{Number(t.default_target)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-on-surface-muted">{t.unit}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 uppercase tracking-wider font-bold">
                        {t.cadence}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {t.source === 'manual' ? (
                        <span className="text-on-surface-subtle">Manual</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-success">
                          <Zap className="w-3 h-3" />
                          {sourceLabel[t.source] ?? t.source}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-on-surface-muted">{t.role_key || <span className="italic">All roles</span>}</td>
                    <td className="px-3 py-2.5 text-center num-mono text-xs">{Number(t.weight)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        {t.active && (
                          <button onClick={() => bulkAssign(t)} disabled={busy}
                            title={t.role_key ? `Assign to every "${t.role_key}" employee` : 'Assign to every active employee'}
                            className="p-1.5 rounded-md text-on-surface-muted hover:text-brand hover:bg-brand/10">
                            <Users className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => toggleActive(t)}
                          title={t.active ? 'Hide (stops new assignments)' : 'Show'}
                          className={`p-1.5 rounded-md ${t.active ? 'text-on-surface-muted hover:text-warning hover:bg-warning-container/40' : 'text-success hover:bg-success/10'}`}>
                          {t.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => { setEditingId(t.id); setShowAdd(false); }}
                          title="Edit"
                          className="p-1.5 rounded-md text-on-surface-muted hover:text-accent hover:bg-surface-2">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(showAdd || editingId) && (
        <KpiTemplateEditor
          existing={editingId ? rows.find(r => r.id === editingId) : undefined}
          sources={sources}
          onClose={() => { setShowAdd(false); setEditingId(null); }}
          onSaved={saved => {
            setRows(prev => {
              const others = prev.filter(r => r.id !== saved.id);
              return [...others, saved].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
            });
            setShowAdd(false); setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

function KpiTemplateEditor({ existing, sources, onClose, onSaved }: {
  existing?: KpiTemplate;
  sources: SourceMeta[];
  onClose: () => void;
  onSaved: (t: KpiTemplate) => void;
}) {
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    unit: existing?.unit ?? 'count',
    default_target: existing?.default_target != null ? String(existing.default_target) : '',
    weight: existing?.weight != null ? String(existing.weight) : '1',
    cadence: (existing?.cadence ?? 'monthly') as 'weekly' | 'monthly',
    source: existing?.source ?? 'manual',
    role_key: existing?.role_key ?? '',
    higher_is_better: existing?.higher_is_better !== false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.default_target || Number.isNaN(Number(form.default_target))) { setError('Target must be a number.'); return; }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        unit: form.unit.trim() || 'count',
        default_target: Number(form.default_target),
        weight: Number(form.weight) || 1,
        cadence: form.cadence,
        source: form.source,
        role_key: form.role_key.trim() || null,
        higher_is_better: form.higher_is_better,
      };
      const saved = existing
        ? await api.updateKpiTemplate(existing.id, payload as any)
        : await api.createKpiTemplate(payload as any);
      onSaved(saved);
    } catch (e: any) { setError(e?.message ?? 'Save failed'); }
    finally { setBusy(false); }
  };

  const inputCls = 'w-full text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <h3 className="font-display text-lg font-semibold text-on-surface">
            {existing ? 'Edit KPI template' : 'New KPI template'}
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X className="w-4 h-4 text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{error}</div>
          )}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Blogs shipped, Attendance %" className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2} placeholder="What does this measure? How should the lead interpret it?"
              className={inputCls + ' resize-none'} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Target *</label>
              <input type="number" step="0.1" value={form.default_target}
                onChange={e => setForm(f => ({ ...f, default_target: e.target.value }))}
                placeholder="40" className={inputCls + ' num-mono'} />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Unit</label>
              <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="count / % / hours / ₹" className={inputCls} />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Weight</label>
              <input type="number" step="0.1" min="0" value={form.weight}
                onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
                className={inputCls + ' num-mono'} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Cadence</label>
              <select value={form.cadence} onChange={e => setForm(f => ({ ...f, cadence: e.target.value as any }))} className={inputCls}>
                {CADENCES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Direction</label>
              <select value={form.higher_is_better ? 'up' : 'down'}
                onChange={e => setForm(f => ({ ...f, higher_is_better: e.target.value === 'up' }))} className={inputCls}>
                <option value="up">Higher is better (default)</option>
                <option value="down">Lower is better (e.g. "days late")</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Data source</label>
            <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className={inputCls}>
              {sources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <p className="text-[10px] text-on-surface-subtle mt-1">
              Manual = lead types actual at end of period. Auto = HRMS computes it from existing data.
            </p>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Role scope (optional)</label>
            <input value={form.role_key} onChange={e => setForm(f => ({ ...f, role_key: e.target.value }))}
              placeholder="e.g. SEO Executive, Web Designer — leave blank for all roles"
              className={inputCls} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5">
            <Check className="w-4 h-4" /> {busy ? 'Saving…' : (existing ? 'Save changes' : 'Create template')}
          </button>
        </div>
      </div>
    </div>
  );
}
