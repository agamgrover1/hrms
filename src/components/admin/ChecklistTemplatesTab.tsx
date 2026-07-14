import { useEffect, useState } from 'react';
import { Plus, Trash2, Check, X, Pencil, ArrowUp, ArrowDown, UserPlus, LogOut } from 'lucide-react';
import { api } from '../../services/api';

// Admin editor for the standard onboarding + offboarding checklist items.
// Fresh checklists (via the "Start onboarding / offboarding" buttons on
// an employee profile) seed from this list; existing in-progress
// checklists keep their snapshot untouched, so an edit here is safe to
// make even mid-cycle.

type Kind = 'onboarding' | 'offboarding';
type TemplateItem = { id: string; kind: string; key: string; label: string; sort_order: number };

export default function ChecklistTemplatesTab() {
  const [kind, setKind] = useState<Kind>('onboarding');
  const [rows, setRows] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const load = () => {
    setLoading(true);
    api.getChecklistTemplates(kind)
      .then(r => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind]);

  const add = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true); setError('');
    try {
      const item = await api.addChecklistTemplate(kind, label);
      setRows(prev => [...prev, item]);
      setNewLabel('');
    } catch (e: any) { setError(e?.message || 'Add failed'); }
    finally { setBusy(false); }
  };

  const startEdit = (r: TemplateItem) => { setEditingId(r.id); setEditDraft(r.label); };
  const cancelEdit = () => { setEditingId(null); setEditDraft(''); };
  const saveEdit = async () => {
    if (!editingId) return;
    const label = editDraft.trim();
    if (!label) return;
    setBusy(true); setError('');
    try {
      const updated = await api.renameChecklistTemplate(editingId, label);
      setRows(prev => prev.map(r => r.id === editingId ? updated : r));
      cancelEdit();
    } catch (e: any) { setError(e?.message || 'Rename failed'); }
    finally { setBusy(false); }
  };

  const remove = async (r: TemplateItem) => {
    if (!confirm(`Remove "${r.label}" from the ${kind} template?\n\nExisting checklists are unaffected — this only stops it from seeding into future ones.`)) return;
    setBusy(true); setError('');
    try {
      await api.deleteChecklistTemplate(r.id);
      setRows(prev => prev.filter(x => x.id !== r.id));
    } catch (e: any) { setError(e?.message || 'Delete failed'); }
    finally { setBusy(false); }
  };

  const move = async (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= rows.length) return;
    // Optimistic swap; roll back on error.
    const next = rows.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setRows(next);
    try {
      await api.reorderChecklistTemplates(kind, next.map(r => r.id));
    } catch (e: any) {
      setError(e?.message || 'Reorder failed');
      load(); // rewind to server truth
    }
  };

  const inputCls = 'text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface placeholder:text-on-surface-subtle w-full transition-colors';

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Kind toggle */}
        <div className="inline-flex items-center gap-1 bg-surface-2 rounded-lg border border-outline p-0.5">
          <button onClick={() => setKind('onboarding')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 ${kind === 'onboarding' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
            <UserPlus className="w-3.5 h-3.5" /> Onboarding
          </button>
          <button onClick={() => setKind('offboarding')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 ${kind === 'offboarding' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
            <LogOut className="w-3.5 h-3.5" /> Offboarding
          </button>
        </div>
        <span className="text-xs text-on-surface-subtle">
          Edits apply to <b className="text-on-surface">new</b> checklists only. In-progress checklists keep their existing shape.
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{error}</div>
      )}

      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-outline bg-surface-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-on-surface-muted uppercase tracking-wider">Items ({rows.length})</span>
        </div>
        {loading ? (
          <div className="h-40 bg-surface-2 animate-pulse" />
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-on-surface-subtle">
            No standard items yet. Add one below — it will seed into every new {kind} checklist.
          </div>
        ) : (
          <ul className="divide-y divide-outline">
            {rows.map((r, i) => (
              <li key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => move(i, -1)} disabled={i === 0 || busy}
                    title="Move up"
                    className="text-on-surface-subtle hover:text-on-surface disabled:opacity-20 disabled:cursor-not-allowed">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === rows.length - 1 || busy}
                    title="Move down"
                    className="text-on-surface-subtle hover:text-on-surface disabled:opacity-20 disabled:cursor-not-allowed">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                {editingId === r.id ? (
                  <>
                    <input value={editDraft} onChange={e => setEditDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                      autoFocus className={inputCls} />
                    <button onClick={saveEdit} disabled={busy || !editDraft.trim()}
                      title="Save" className="shrink-0 p-1.5 rounded-md text-success hover:bg-success/10 disabled:opacity-40">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={cancelEdit}
                      title="Cancel" className="shrink-0 p-1.5 rounded-md text-on-surface-muted hover:bg-surface-2">
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-on-surface min-w-0">{r.label}</span>
                    <span className="text-[10px] text-on-surface-subtle num-mono shrink-0" title={`Key: ${r.key}`}>{r.key}</span>
                    <button onClick={() => startEdit(r)}
                      title="Rename" className="shrink-0 p-1.5 rounded-md text-on-surface-muted hover:text-accent hover:bg-surface-2">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(r)}
                      title="Remove from template" className="shrink-0 p-1.5 rounded-md text-on-surface-muted hover:text-danger hover:bg-danger-container/40">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* Add row */}
        <div className="px-4 py-3 border-t border-outline bg-surface-2/40 flex items-center gap-2">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            placeholder={`New ${kind} item…`}
            className={inputCls} />
          <button onClick={add} disabled={busy || !newLabel.trim()}
            className="shrink-0 px-3 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
