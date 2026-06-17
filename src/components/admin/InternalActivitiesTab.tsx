import { useEffect, useState } from 'react';
import { Plus, Trash2, Check, X, Pencil } from 'lucide-react';
import { api } from '../../services/api';

// Admin-managed list of non-project activities. Employees pick from this
// list when logging hours that aren't tied to a billable project.
// Deletion is soft (active=false) so historical logs still resolve names.
// Roles an admin can assign per-activity. Empty selection = visible to
// everyone (the GET endpoint treats NULL / empty as "all hands"). The
// labels are the user-facing strings; the keys are what the backend
// stores and the GET filter compares against.
type RoleKey = 'admin' | 'hr_manager' | 'project_coordinator' | 'manager' | 'employee';
const ROLE_CHIPS: { key: RoleKey; label: string }[] = [
  { key: 'admin',                label: 'Admin' },
  { key: 'hr_manager',           label: 'HR' },
  { key: 'project_coordinator',  label: 'Coord' },
  { key: 'manager',              label: 'Manager' },
  { key: 'employee',             label: 'Employee' },
];

export default function InternalActivitiesTab() {
  const [rows, setRows] = useState<Array<{ id: string; name: string; description: string | null; active: boolean; sort_order: number; roles: string[] | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ name: string; description: string; sort_order: string; roles: RoleKey[] }>({ name: '', description: '', sort_order: '100', roles: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; description: string; sort_order: number; roles: RoleKey[] }>({ name: '', description: '', sort_order: 100, roles: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.getInternalActivities()
      .then(r => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const add = async () => {
    if (!draft.name.trim()) return;
    setBusy(true); setError('');
    try {
      await api.addInternalActivity({
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        sort_order: Number(draft.sort_order) || 100,
        // Empty array on the wire would be normalized to null on the
        // server (= visible to everyone). Pass it explicitly so admin's
        // toggle state matches what the backend stores.
        roles: draft.roles.length ? draft.roles : null,
      });
      setDraft({ name: '', description: '', sort_order: '100', roles: [] });
      setAdding(false);
      load();
    } catch (e: any) { setError(e.message ?? 'Failed to add'); }
    finally { setBusy(false); }
  };

  const startEdit = (r: typeof rows[number]) => {
    setEditingId(r.id);
    setEditDraft({
      name: r.name,
      description: r.description ?? '',
      sort_order: r.sort_order,
      roles: (r.roles ?? []) as RoleKey[],
    });
  };
  const saveEdit = async (id: string) => {
    setBusy(true); setError('');
    try {
      await api.updateInternalActivity(id, {
        name: editDraft.name.trim(),
        description: editDraft.description.trim() || undefined,
        sort_order: editDraft.sort_order,
        roles: editDraft.roles.length ? editDraft.roles : null,
      });
      setEditingId(null);
      load();
    } catch (e: any) { setError(e.message ?? 'Failed to update'); }
    finally { setBusy(false); }
  };
  const toggleActive = async (r: typeof rows[number]) => {
    try { await api.updateInternalActivity(r.id, { active: !r.active }); load(); }
    catch (e: any) { setError(e.message); }
  };
  const remove = async (id: string) => {
    if (!confirm('Deactivate this activity? Existing logs are kept; it won\'t appear in the picker anymore.')) return;
    try { await api.deleteInternalActivity(id); load(); }
    catch (e: any) { setError(e.message); }
  };

  if (loading) return <div className="h-32 rounded-xl-2 bg-surface-2 animate-pulse" />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl-2 border border-outline bg-surface-2/60 p-4 text-xs text-on-surface-muted">
        <p className="text-on-surface font-semibold text-sm mb-1">Internal activities · non-project work</p>
        <p>People without active projects (HR, recruiters, bench employees, admin doing ops) log hours against these activities. Self-reported — no approval. The list is admin-curated.</p>
      </div>

      {error && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{error}</div>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-on-surface-muted">{rows.length} activit{rows.length === 1 ? 'y' : 'ies'}</p>
        <button onClick={() => setAdding(v => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl-2 bg-brand px-3 py-2 text-xs font-medium text-on-brand hover:opacity-90">
          {adding ? <X size={14} /> : <Plus size={14} />} {adding ? 'Cancel' : 'New activity'}
        </button>
      </div>

      {adding && (
        <div className="rounded-xl-2 border border-brand/30 bg-brand-container/20 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-4">
              <label className="block text-xs text-on-surface-muted mb-1">Name *</label>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Internal Initiative"
                className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-sm focus:border-brand outline-none" />
            </div>
            <div className="sm:col-span-6">
              <label className="block text-xs text-on-surface-muted mb-1">Description</label>
              <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Short hint for employees"
                className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-sm focus:border-brand outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-on-surface-muted mb-1">Sort</label>
              <input type="number" value={draft.sort_order} onChange={e => setDraft({ ...draft, sort_order: e.target.value })}
                className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-sm focus:border-brand outline-none num-mono" />
            </div>
            <div className="sm:col-span-12">
              <label className="block text-xs text-on-surface-muted mb-1">Visible to</label>
              <RoleChips
                value={draft.roles}
                onChange={r => setDraft({ ...draft, roles: r })}
              />
              <p className="text-[11px] text-on-surface-subtle mt-1">
                Pick the roles that should see this activity in their picker. Leave empty to make it visible to everyone.
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={add} disabled={busy || !draft.name.trim()}
              className="rounded-xl-2 bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:opacity-90 disabled:opacity-50">
              {busy ? 'Adding…' : 'Add activity'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl-2 border border-outline bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-on-surface-subtle border-b border-outline bg-surface-2">
              <th className="text-left px-4 py-2.5 font-semibold">Name</th>
              <th className="text-left px-4 py-2.5 font-semibold">Description</th>
              <th className="text-left px-4 py-2.5 font-semibold">Visible to</th>
              <th className="text-right px-3 py-2.5 font-semibold">Sort</th>
              <th className="text-center px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {rows.map(r => {
              const isEditing = editingId === r.id;
              return (
                <tr key={r.id} className={`${r.active ? '' : 'opacity-60'} hover:bg-surface-2/50`}>
                  <td className="px-4 py-2">
                    {isEditing
                      ? <input value={editDraft.name} onChange={e => setEditDraft({ ...editDraft, name: e.target.value })}
                          className="w-full rounded-lg border border-outline bg-surface px-2 py-1.5 text-sm focus:border-brand outline-none" />
                      : <span className="font-medium text-on-surface">{r.name}</span>}
                  </td>
                  <td className="px-4 py-2 text-on-surface-muted">
                    {isEditing
                      ? <input value={editDraft.description} onChange={e => setEditDraft({ ...editDraft, description: e.target.value })}
                          className="w-full rounded-lg border border-outline bg-surface px-2 py-1.5 text-sm focus:border-brand outline-none" />
                      : (r.description ?? '—')}
                  </td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <RoleChips
                        value={editDraft.roles}
                        onChange={roles => setEditDraft({ ...editDraft, roles })}
                      />
                    ) : (
                      <RoleChips value={(r.roles ?? []) as RoleKey[]} readOnly />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right num-mono text-xs">
                    {isEditing
                      ? <input type="number" value={editDraft.sort_order} onChange={e => setEditDraft({ ...editDraft, sort_order: Number(e.target.value) })}
                          className="w-20 rounded-lg border border-outline bg-surface px-2 py-1.5 text-right text-sm focus:border-brand outline-none num-mono" />
                      : r.sort_order}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => toggleActive(r)}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${r.active ? 'bg-success-container text-success' : 'bg-surface-2 text-on-surface-subtle'}`}>
                      {r.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isEditing ? (
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => saveEdit(r.id)} className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-on-accent hover:opacity-90">
                          <Check size={12} />
                        </button>
                        <button onClick={() => setEditingId(null)} className="rounded-lg border border-outline px-2.5 py-1.5 text-xs font-semibold text-on-surface-muted hover:bg-surface-2">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => startEdit(r)} className="text-on-surface-subtle hover:text-on-surface p-1"><Pencil size={12} /></button>
                        <button onClick={() => remove(r.id)} className="text-on-surface-subtle hover:text-danger p-1"><Trash2 size={12} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-on-surface-muted">No activities yet — click "New activity" above to add one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Toggle strip showing the 5 role chips. Empty selection (read or write)
// renders an "All roles" pill so it's obvious the activity is unscoped
// rather than accidentally hidden from everyone.
function RoleChips({ value, onChange, readOnly = false }: {
  value: RoleKey[];
  onChange?: (next: RoleKey[]) => void;
  readOnly?: boolean;
}) {
  if (readOnly && value.length === 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-success-container text-success">
        All roles
      </span>
    );
  }
  const toggle = (k: RoleKey) => {
    if (!onChange) return;
    onChange(value.includes(k) ? value.filter(r => r !== k) : [...value, k]);
  };
  return (
    <div className="flex flex-wrap gap-1">
      {ROLE_CHIPS.map(({ key, label }) => {
        const on = value.includes(key);
        if (readOnly) {
          if (!on) return null;
          return (
            <span key={key} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-accent-container text-accent">
              {label}
            </span>
          );
        }
        return (
          <button key={key} type="button" onClick={() => toggle(key)}
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
              on
                ? 'bg-accent text-on-accent'
                : 'bg-surface-2 text-on-surface-subtle border border-outline hover:bg-surface-3'
            }`}>
            {label}
          </button>
        );
      })}
      {!readOnly && value.length > 0 && (
        <button type="button" onClick={() => onChange?.([])}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider text-on-surface-subtle hover:text-on-surface">
          Clear
        </button>
      )}
    </div>
  );
}
