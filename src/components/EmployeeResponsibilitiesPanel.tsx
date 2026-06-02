import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, X, MapPin, History, ChevronDown, BookOpen, AlertCircle } from 'lucide-react';
import { api } from '../services/api';

interface PersonalItem {
  id: number;
  employee_id: string;
  section_name: string;
  section_order: number;
  item_order: number;
  title: string;
  details: string | null;
  frequency: string | null;
  where_to_do: string | null;
  created_at: string;
  updated_at: string;
}

interface AuditEntry {
  id: number;
  employee_id: string;
  item_id: number | null;
  action: 'create' | 'update' | 'delete';
  title: string | null;
  before_data: any;
  after_data: any;
  reason: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  created_at: string;
}

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

interface Draft {
  id?: number;
  section_name: string;
  section_order: number;
  item_order: number;
  title: string;
  details: string;
  frequency: string;
  where_to_do: string;
  reason: string;
}

const BLANK_DRAFT: Draft = {
  section_name: '', section_order: 0, item_order: 0,
  title: '', details: '', frequency: '', where_to_do: '', reason: '',
};

export default function EmployeeResponsibilitiesPanel({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const [items, setItems] = useState<PersonalItem[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [canViewAudit, setCanViewAudit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<PersonalItem | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = () => {
    setLoading(true); setErr('');
    api.getEmployeeResponsibilities(employeeId)
      .then(r => {
        setItems(r.items as PersonalItem[]);
        setCanWrite(r.can_write);
        setCanViewAudit(r.can_view_audit);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [employeeId]);

  // Lazy-load audit when opened
  useEffect(() => {
    if (!showAudit || audit !== null) return;
    setAuditLoading(true);
    api.getEmployeeResponsibilitiesAudit(employeeId)
      .then(d => setAudit(d as AuditEntry[]))
      .catch(e => setErr(e.message))
      .finally(() => setAuditLoading(false));
  }, [showAudit, audit, employeeId]);

  const sections = useMemo(() => {
    const map = new Map<string, { order: number; rows: PersonalItem[] }>();
    for (const it of items) {
      const ex = map.get(it.section_name);
      if (ex) ex.rows.push(it);
      else map.set(it.section_name, { order: it.section_order, rows: [it] });
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([name, v]) => ({ name, order: v.order, rows: v.rows.sort((a, b) => a.item_order - b.item_order) }));
  }, [items]);

  const openCreate = (section?: { name: string; order: number; nextItemOrder: number }) => {
    setDraft({
      ...BLANK_DRAFT,
      section_name: section?.name ?? '',
      section_order: section?.order ?? Math.max(0, ...sections.map(s => s.order)) + 1,
      item_order: section?.nextItemOrder ?? 1,
    });
  };
  const openEdit = (it: PersonalItem) => {
    setDraft({
      id: it.id,
      section_name: it.section_name,
      section_order: it.section_order,
      item_order: it.item_order,
      title: it.title,
      details: it.details ?? '',
      frequency: it.frequency ?? '',
      where_to_do: it.where_to_do ?? '',
      reason: '',
    });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.section_name.trim() || !draft.title.trim()) { setErr('Section and title are required'); return; }
    setSaving(true); setErr('');
    try {
      const payload = {
        section_name: draft.section_name.trim(),
        section_order: Number(draft.section_order) || 0,
        item_order: Number(draft.item_order) || 0,
        title: draft.title.trim(),
        details: draft.details.trim() || undefined,
        frequency: draft.frequency || undefined,
        where_to_do: draft.where_to_do.trim() || undefined,
        reason: draft.reason.trim() || undefined,
      };
      if (draft.id) await api.updateEmployeeResponsibility(draft.id, payload);
      else await api.addEmployeeResponsibility({ ...payload, employee_id: employeeId });
      setDraft(null);
      setAudit(null); // invalidate so audit refetches when opened
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteEmployeeResponsibility(deleting.id, deleteReason.trim() || undefined);
      setDeleting(null);
      setDeleteReason('');
      setAudit(null);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="space-y-5">
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-2 overflow-hidden">
        <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-brand-container/40 to-surface flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-brand-container/60 flex items-center justify-center shrink-0">
              <BookOpen size={18} className="text-brand" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-lg font-bold tracking-tight text-on-surface truncate">Responsibilities for {employeeName}</h3>
              <p className="text-xs text-on-surface-muted mt-0.5">
                Personal items layered on top of {employeeName.split(' ')[0]}'s role playbook. Edits are logged.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canViewAudit && (
              <button onClick={() => setShowAudit(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-outline bg-surface text-on-surface-muted hover:bg-surface-2">
                <History size={13} /> Edit history
              </button>
            )}
            {canWrite && (
              <button onClick={() => openCreate()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:opacity-90">
                <Plus size={13} /> Add item
              </button>
            )}
          </div>
        </div>

        {!canWrite && !canViewAudit && (
          <div className="px-5 py-2.5 bg-warning-container/30 text-warning text-xs inline-flex items-center gap-2 w-full">
            <AlertCircle size={12} className="shrink-0" />
            You can view this list but only admin / HR / their reporting manager can edit.
          </div>
        )}
      </div>

      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      {loading ? (
        <div className="py-16 text-center text-sm text-on-surface-subtle">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-surface rounded-xl-2 border border-outline py-16 text-center">
          <BookOpen size={28} className="mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">No personal items yet.</p>
          <p className="text-xs text-on-surface-subtle mt-1">{employeeName.split(' ')[0]} only sees the standard role playbook today.</p>
          {canWrite && (
            <button onClick={() => openCreate()} className="mt-3 text-xs font-semibold text-accent hover:underline">
              Add the first one →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map(section => (
            <div key={section.name} className="bg-surface rounded-xl-2 border border-outline overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-2/40 border-b border-outline flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="num-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-container/60 text-brand">{section.rows.length}</span>
                  <h4 className="font-display text-sm font-bold tracking-tight text-on-surface truncate">{section.name}</h4>
                </div>
                {canWrite && (
                  <button onClick={() => openCreate({ name: section.name, order: section.order, nextItemOrder: Math.max(0, ...section.rows.map(r => r.item_order)) + 1 })}
                    className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-1">
                    <Plus size={11} /> Add
                  </button>
                )}
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
                    {canWrite && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => openEdit(it)} className="p-1.5 rounded hover:bg-surface-2 text-on-surface-muted hover:text-on-surface" title="Edit">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => setDeleting(it)} className="p-1.5 rounded hover:bg-danger-container text-on-surface-muted hover:text-danger" title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      {draft && (
        <DraftModal draft={draft} setDraft={setDraft} sections={sections.map(s => s.name)} saving={saving} onSave={save} onClose={() => setDraft(null)} />
      )}

      {/* Delete confirm with reason */}
      {deleting && (
        <Dialog onClose={() => setDeleting(null)} title={`Delete "${deleting.title}"?`}>
          <div className="space-y-3">
            <p className="text-sm text-on-surface-muted">This removes the item from {employeeName.split(' ')[0]}'s personal R&R. The change is recorded in the edit history.</p>
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">Reason (optional)</span>
              <textarea value={deleteReason} onChange={e => setDeleteReason(e.target.value)} rows={2}
                placeholder="e.g. moved to another team"
                className="w-full text-sm bg-surface-2 border border-outline rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setDeleting(null); setDeleteReason(''); }} className="px-3 py-2 rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
              <button onClick={remove} className="px-4 py-2 rounded-lg text-sm font-semibold bg-danger text-on-accent hover:opacity-90">Delete</button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Audit log */}
      {showAudit && (
        <Dialog onClose={() => setShowAudit(false)} title="Edit history" wide>
          {auditLoading ? <div className="py-10 text-center text-sm text-on-surface-subtle">Loading…</div>
            : !audit || audit.length === 0 ? <div className="py-10 text-center text-sm text-on-surface-muted">No edits recorded yet.</div>
            : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {audit.map(a => <AuditRow key={a.id} entry={a} />)}
              </div>
            )}
        </Dialog>
      )}
    </div>
  );
}

function AuditRow({ entry: a }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const tone = a.action === 'create' ? 'bg-success-container text-success'
    : a.action === 'delete' ? 'bg-danger-container text-danger'
    : 'bg-warning-container text-warning';
  return (
    <div className="rounded-lg border border-outline overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full px-3 py-2.5 flex items-start justify-between gap-3 hover:bg-surface-2/40 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${tone}`}>{a.action}</span>
            <span className="text-sm font-semibold text-on-surface truncate">{a.title || `Item #${a.item_id}`}</span>
          </div>
          <p className="text-[11px] text-on-surface-muted mt-1">
            {new Date(a.created_at).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' })}
            {a.actor_name && <> · by <span className="text-on-surface">{a.actor_name}</span></>}
            {a.actor_role && <span className="text-on-surface-subtle"> ({a.actor_role})</span>}
          </p>
          {a.reason && <p className="text-[11px] text-on-surface-muted mt-1 italic">"{a.reason}"</p>}
        </div>
        <ChevronDown size={14} className={`text-on-surface-subtle shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-outline px-3 py-2 bg-surface-2/30 text-xs space-y-2">
          {a.action === 'update' ? (
            <DiffView before={a.before_data} after={a.after_data} />
          ) : a.action === 'create' ? (
            <JsonBlock label="Created" data={a.after_data} />
          ) : (
            <JsonBlock label="Deleted" data={a.before_data} />
          )}
        </div>
      )}
    </div>
  );
}

function DiffView({ before, after }: { before: any; after: any }) {
  if (!before || !after) return null;
  const FIELDS: Array<{ key: string; label: string }> = [
    { key: 'title', label: 'Title' },
    { key: 'section_name', label: 'Section' },
    { key: 'details', label: 'Details' },
    { key: 'frequency', label: 'Frequency' },
    { key: 'where_to_do', label: 'Where' },
    { key: 'section_order', label: 'Section order' },
    { key: 'item_order', label: 'Item order' },
  ];
  const changed = FIELDS.filter(f => (before[f.key] ?? '') !== (after[f.key] ?? ''));
  if (!changed.length) return <p className="text-on-surface-subtle">No field-level changes recorded.</p>;
  return (
    <div className="space-y-1.5">
      {changed.map(f => (
        <div key={f.key} className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide font-bold text-on-surface-subtle">{f.label}</span>
          <div className="grid grid-cols-2 gap-2">
            <span className="text-on-surface-muted line-through opacity-70 break-words">{String(before[f.key] ?? '—')}</span>
            <span className="text-on-surface font-medium break-words">{String(after[f.key] ?? '—')}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function JsonBlock({ label, data }: { label: string; data: any }) {
  if (!data) return null;
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide font-bold text-on-surface-subtle">{label}</span>
      <pre className="mt-1 p-2 rounded bg-surface-2 text-on-surface-muted text-[11px] overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

function DraftModal({ draft, setDraft, sections, saving, onSave, onClose }: {
  draft: Draft; setDraft: (d: Draft) => void; sections: string[]; saving: boolean; onSave: () => void; onClose: () => void;
}) {
  const inputCls = 'w-full text-sm bg-surface-2 border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface placeholder:text-on-surface-subtle transition-colors';
  return (
    <Dialog onClose={onClose} title={draft.id ? 'Edit item' : 'New personal item'}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Section name" required>
            <input value={draft.section_name} onChange={e => setDraft({ ...draft, section_name: e.target.value })}
              placeholder="e.g. Client deliverables"
              list="emp-resp-sections"
              className={inputCls} />
            <datalist id="emp-resp-sections">{sections.map(s => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Section order">
            <input type="number" value={draft.section_order} onChange={e => setDraft({ ...draft, section_order: Number(e.target.value) || 0 })}
              className={inputCls + ' num-mono'} />
          </Field>
        </div>
        <Field label="Title" required>
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}
            className={inputCls} />
        </Field>
        <Field label="Where to do it (nav breadcrumb)">
          <input value={draft.where_to_do} onChange={e => setDraft({ ...draft, where_to_do: e.target.value })}
            placeholder="e.g. Project Mgmt → Hours grid"
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
          <textarea value={draft.details} onChange={e => setDraft({ ...draft, details: e.target.value })} rows={3}
            className={inputCls} />
        </Field>
        <Field label="Reason for this change (optional)">
          <input value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })}
            placeholder="Saved with the audit entry, e.g. 'New client onboarded'"
            className={inputCls} />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-outline mt-4">
        <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
        <button onClick={onSave} disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent disabled:opacity-50">
          {saving ? 'Saving…' : (draft.id ? 'Save changes' : 'Add item')}
        </button>
      </div>
    </Dialog>
  );
}

function Dialog({ children, onClose, title, wide }: { children: React.ReactNode; onClose: () => void; title: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
          <h3 className="text-base font-bold text-on-surface">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

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
