import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, X, MapPin } from 'lucide-react';
import { api } from '../../services/api';

interface RoleItem {
  id: number;
  role: string;
  section_name: string;
  section_order: number;
  item_order: number;
  title: string;
  details: string | null;
  frequency: string | null;
  where_to_do: string | null;
}

const ROLES: Array<{ key: string; label: string }> = [
  { key: 'project_coordinator', label: 'Project Coordinator' },
  { key: 'admin',               label: 'Admin' },
  { key: 'hr_manager',          label: 'HR Manager' },
  { key: 'employee',            label: 'Employee' },
];

const FREQS = [
  { key: 'one_time',  label: 'One-time' },
  { key: 'daily',     label: 'Daily' },
  { key: 'weekly',    label: 'Weekly' },
  { key: 'monthly',   label: 'Monthly' },
  { key: 'as_needed', label: 'Ad-hoc' },
];

const FREQ_CLS: Record<string, string> = {
  daily:     'bg-accent-container text-accent',
  weekly:    'bg-brand-container text-brand',
  monthly:   'bg-warning-container text-warning',
  one_time:  'bg-success-container text-success',
  as_needed: 'bg-surface-3 text-on-surface-muted',
};

interface DraftItem {
  id?: number;
  role: string;
  section_name: string;
  section_order: number;
  item_order: number;
  title: string;
  details: string;
  frequency: string;
  where_to_do: string;
}

const BLANK: DraftItem = {
  role: 'project_coordinator',
  section_name: '',
  section_order: 0,
  item_order: 0,
  title: '',
  details: '',
  frequency: '',
  where_to_do: '',
};

export default function RoleResponsibilitiesTab() {
  const [role, setRole] = useState('project_coordinator');
  const [items, setItems] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<DraftItem | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true); setErr('');
    api.getRoleResponsibilities(role)
      .then(d => setItems(d as RoleItem[]))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [role]);

  // Group by section, preserving order
  const sections = useMemo(() => {
    const map = new Map<string, { order: number; rows: RoleItem[] }>();
    for (const it of items) {
      const ex = map.get(it.section_name);
      if (ex) ex.rows.push(it);
      else map.set(it.section_name, { order: it.section_order, rows: [it] });
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([name, v]) => ({ name, order: v.order, rows: v.rows.sort((a, b) => a.item_order - b.item_order) }));
  }, [items]);

  const openCreate = (section?: { name: string; order: number; nextOrder?: number }) => {
    setDraft({
      ...BLANK,
      role,
      section_name: section?.name ?? '',
      section_order: section?.order ?? Math.max(0, ...sections.map(s => s.order)) + 1,
      item_order: section?.nextOrder ?? 1,
    });
  };

  const openEdit = (it: RoleItem) => {
    setDraft({
      id: it.id,
      role: it.role,
      section_name: it.section_name,
      section_order: it.section_order,
      item_order: it.item_order,
      title: it.title,
      details: it.details ?? '',
      frequency: it.frequency ?? '',
      where_to_do: it.where_to_do ?? '',
    });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.section_name.trim() || !draft.title.trim()) { setErr('Section and title are required'); return; }
    setSaving(true); setErr('');
    try {
      const payload = {
        role: draft.role,
        section_name: draft.section_name.trim(),
        section_order: Number(draft.section_order) || 0,
        item_order: Number(draft.item_order) || 0,
        title: draft.title.trim(),
        details: draft.details.trim() || undefined,
        frequency: draft.frequency || undefined,
        where_to_do: draft.where_to_do.trim() || undefined,
      };
      if (draft.id) await api.updateRoleResponsibility(draft.id, payload);
      else await api.addRoleResponsibility(payload);
      setDraft(null);
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (it: RoleItem) => {
    if (!confirm(`Delete "${it.title}"? This cannot be undone.`)) return;
    try { await api.deleteRoleResponsibility(it.id); load(); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-subtle">Role</span>
          <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-lg p-0.5">
            {ROLES.map(r => (
              <button key={r.key} onClick={() => setRole(r.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  role === r.key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'
                }`}>{r.label}</button>
            ))}
          </div>
        </div>
        <button onClick={() => openCreate()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:opacity-90">
          <Plus size={13} /> Add item
        </button>
      </div>

      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      {loading ? (
        <div className="py-16 text-center text-sm text-on-surface-subtle">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-surface rounded-xl-2 border border-outline py-16 text-center">
          <p className="text-sm text-on-surface-muted">No items for this role yet.</p>
          <button onClick={() => openCreate()} className="mt-2 text-xs font-semibold text-accent hover:underline">
            Add the first one →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map(section => (
            <div key={section.name} className="bg-surface rounded-xl-2 border border-outline overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-2/40 border-b border-outline flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="num-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-container/60 text-brand">{section.rows.length}</span>
                  <h4 className="font-display text-sm font-bold tracking-tight text-on-surface truncate">{section.name}</h4>
                  <span className="text-[10px] text-on-surface-subtle">· order {section.order}</span>
                </div>
                <button onClick={() => openCreate({ name: section.name, order: section.order, nextOrder: Math.max(0, ...section.rows.map(r => r.item_order)) + 1 })}
                  className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-1">
                  <Plus size={11} /> Add item
                </button>
              </div>
              <div className="divide-y divide-outline">
                {section.rows.map(it => (
                  <div key={it.id} className="px-4 py-3 hover:bg-surface-2/30 flex items-start gap-3">
                    <span className="num-mono shrink-0 text-[11px] font-bold w-6 h-6 rounded-full bg-surface-3 text-on-surface-muted inline-flex items-center justify-center mt-0.5">
                      {it.item_order}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-on-surface">{it.title}</p>
                        {it.frequency && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold ${FREQ_CLS[it.frequency] ?? 'bg-surface-3 text-on-surface-muted'}`}>
                            {FREQS.find(f => f.key === it.frequency)?.label ?? it.frequency}
                          </span>
                        )}
                      </div>
                      {it.where_to_do && (
                        <p className="text-[11px] text-on-surface-muted mt-1 inline-flex items-center gap-1">
                          <MapPin size={10} className="text-brand shrink-0" />
                          <span className="num-mono">{it.where_to_do}</span>
                        </p>
                      )}
                      {it.details && <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">{it.details}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => openEdit(it)} className="p-1.5 rounded hover:bg-surface-2 text-on-surface-muted hover:text-on-surface" title="Edit">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => remove(it)} className="p-1.5 rounded hover:bg-danger-container text-on-surface-muted hover:text-danger" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setDraft(null)}>
          <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
              <h3 className="text-base font-bold text-on-surface">{draft.id ? 'Edit item' : 'New item'}</h3>
              <button onClick={() => setDraft(null)} className="p-1.5 rounded-lg hover:bg-surface-2"><X size={16} className="text-on-surface-muted" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Section name" required>
                  <input value={draft.section_name} onChange={e => setDraft({ ...draft, section_name: e.target.value })}
                    placeholder="e.g. Daily routine"
                    list="section-suggestions"
                    className={inputCls} />
                  <datalist id="section-suggestions">
                    {sections.map(s => <option key={s.name} value={s.name} />)}
                  </datalist>
                </Field>
                <Field label="Section order">
                  <input type="number" value={draft.section_order} onChange={e => setDraft({ ...draft, section_order: Number(e.target.value) || 0 })}
                    className={inputCls + ' num-mono'} />
                </Field>
              </div>
              <Field label="Title" required>
                <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}
                  placeholder="e.g. Check who hasn't logged hours today"
                  className={inputCls} />
              </Field>
              <Field label="Where to do it (nav breadcrumb)">
                <input value={draft.where_to_do} onChange={e => setDraft({ ...draft, where_to_do: e.target.value })}
                  placeholder="e.g. Project Mgmt → Compliance"
                  className={inputCls + ' num-mono'} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Frequency">
                  <select value={draft.frequency} onChange={e => setDraft({ ...draft, frequency: e.target.value })}
                    className={inputCls}>
                    <option value="">—</option>
                    {FREQS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </Field>
                <Field label="Item order">
                  <input type="number" value={draft.item_order} onChange={e => setDraft({ ...draft, item_order: Number(e.target.value) || 0 })}
                    className={inputCls + ' num-mono'} />
                </Field>
              </div>
              <Field label="Details / instructions">
                <textarea value={draft.details} onChange={e => setDraft({ ...draft, details: e.target.value })} rows={4}
                  placeholder="Explain what to do, why it matters, and any gotchas. Shown below the title in the playbook."
                  className={inputCls} />
              </Field>
            </div>
            <div className="px-5 py-3 border-t border-outline flex items-center justify-end gap-2 bg-surface-2/30">
              <button onClick={() => setDraft(null)} className="px-3 py-2 rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent disabled:opacity-50">
                {saving ? 'Saving…' : (draft.id ? 'Save changes' : 'Add item')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full text-sm bg-surface-2 border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface placeholder:text-on-surface-subtle transition-colors';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
