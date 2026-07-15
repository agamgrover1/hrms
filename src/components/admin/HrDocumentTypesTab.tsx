import { useEffect, useState } from 'react';
import { Plus, Check, X, Pencil, ArrowUp, ArrowDown, Eye, EyeOff, FileText } from 'lucide-react';
import { api } from '../../services/api';

// Admin editor for HR document types (Appointment letter, NOC, etc.).
// Renames + code changes take effect immediately for future issues;
// past doc_numbers stay literal so the audit trail is preserved. Types
// can be hidden (active=false) so they stop appearing in the Issue
// dropdown without deleting the row.

type TypeRow = { id: string; key: string; code: string; label: string; sort_order: number; active: boolean };

export default function HrDocumentTypesTab() {
  const [rows, setRows] = useState<TypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newCode, setNewCode] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ label: string; code: string }>({ label: '', code: '' });

  const load = () => {
    setLoading(true);
    api.getHrDocumentTypes({ include_inactive: true })
      .then(r => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const add = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true); setError('');
    try {
      const created = await api.addHrDocumentType({ label, code: newCode.trim() || undefined });
      setRows(prev => [...prev, created]);
      setNewLabel(''); setNewCode('');
    } catch (e: any) { setError(e?.message || 'Add failed'); }
    finally { setBusy(false); }
  };

  const startEdit = (r: TypeRow) => { setEditingId(r.id); setEditDraft({ label: r.label, code: r.code }); };
  const cancelEdit = () => { setEditingId(null); setEditDraft({ label: '', code: '' }); };
  const saveEdit = async () => {
    if (!editingId) return;
    const label = editDraft.label.trim();
    const code = editDraft.code.trim();
    if (!label || !code) return;
    setBusy(true); setError('');
    try {
      const updated = await api.updateHrDocumentType(editingId, { label, code });
      setRows(prev => prev.map(r => r.id === editingId ? updated : r));
      cancelEdit();
    } catch (e: any) { setError(e?.message || 'Rename failed'); }
    finally { setBusy(false); }
  };

  const toggleActive = async (r: TypeRow) => {
    setBusy(true); setError('');
    try {
      const updated = await api.updateHrDocumentType(r.id, { active: !r.active });
      setRows(prev => prev.map(x => x.id === r.id ? updated : x));
    } catch (e: any) { setError(e?.message || 'Toggle failed'); }
    finally { setBusy(false); }
  };

  const move = async (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= rows.length) return;
    const next = rows.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setRows(next);
    try {
      await api.reorderHrDocumentTypes(next.map(r => r.id));
    } catch (e: any) {
      setError(e?.message || 'Reorder failed');
      load();
    }
  };

  const inputCls = 'text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface placeholder:text-on-surface-subtle w-full transition-colors';

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-xl-2 border border-outline bg-brand-container/20 p-3 text-xs text-on-surface-muted flex items-start gap-2">
        <FileText className="w-4 h-4 shrink-0 text-brand mt-0.5" />
        <div>
          <p><b className="text-on-surface">Rename freely.</b> Past doc numbers are stored as literal strings (e.g. <span className="num-mono">DL-APP-2026-0001</span>) — a rename only affects <em>future</em> issues, so history stays accurate.</p>
          <p className="mt-1"><b className="text-on-surface">Hide instead of delete.</b> Turning a type off stops it from appearing in the Issue dropdown but keeps existing docs of that type visible everywhere.</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{error}</div>
      )}

      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-outline bg-surface-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
            Document types ({rows.filter(r => r.active).length} active · {rows.length} total)
          </span>
        </div>
        {loading ? (
          <div className="h-40 bg-surface-2 animate-pulse" />
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-on-surface-subtle">
            No document types yet.
          </div>
        ) : (
          <ul className="divide-y divide-outline">
            {rows.map((r, i) => {
              const isEditing = editingId === r.id;
              return (
                <li key={r.id} className={`px-4 py-2.5 flex items-center gap-3 ${!r.active ? 'opacity-50' : ''}`}>
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button onClick={() => move(i, -1)} disabled={i === 0 || busy} title="Move up"
                      className="text-on-surface-subtle hover:text-on-surface disabled:opacity-20 disabled:cursor-not-allowed">
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === rows.length - 1 || busy} title="Move down"
                      className="text-on-surface-subtle hover:text-on-surface disabled:opacity-20 disabled:cursor-not-allowed">
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {isEditing ? (
                    <>
                      <input value={editDraft.code} maxLength={6}
                        onChange={e => setEditDraft(d => ({ ...d, code: e.target.value.toUpperCase() }))}
                        placeholder="APP"
                        className={inputCls + ' w-20 num-mono uppercase text-center'} />
                      <input value={editDraft.label}
                        onChange={e => setEditDraft(d => ({ ...d, label: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                        autoFocus className={inputCls} />
                      <button onClick={saveEdit} disabled={busy || !editDraft.label.trim() || !editDraft.code.trim()}
                        title="Save" className="shrink-0 p-1.5 rounded-md text-success hover:bg-success/10 disabled:opacity-40">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={cancelEdit} title="Cancel"
                        className="shrink-0 p-1.5 rounded-md text-on-surface-muted hover:bg-surface-2">
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="num-mono text-xs font-bold text-accent bg-accent/10 border border-accent/20 rounded px-2 py-0.5 shrink-0 w-14 text-center">
                        {r.code}
                      </span>
                      <span className={`flex-1 text-sm min-w-0 ${r.active ? 'text-on-surface' : 'text-on-surface-muted line-through'}`}>{r.label}</span>
                      <span className="text-[10px] text-on-surface-subtle num-mono shrink-0" title={`Machine key: ${r.key}`}>{r.key}</span>
                      <button onClick={() => toggleActive(r)}
                        title={r.active ? 'Hide from Issue dropdown' : 'Show in Issue dropdown'}
                        className={`shrink-0 p-1.5 rounded-md ${r.active ? 'text-on-surface-muted hover:text-warning hover:bg-warning-container/40' : 'text-success hover:text-success hover:bg-success/10'}`}>
                        {r.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => startEdit(r)} title="Rename"
                        className="shrink-0 p-1.5 rounded-md text-on-surface-muted hover:text-accent hover:bg-surface-2">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {/* Add row */}
        <div className="px-4 py-3 border-t border-outline bg-surface-2/40 flex items-center gap-2">
          <input value={newCode} maxLength={6}
            onChange={e => setNewCode(e.target.value.toUpperCase())}
            placeholder="APP"
            title="3-letter code (auto-derived from label if left blank)"
            className={inputCls + ' w-20 num-mono uppercase text-center'} />
          <input value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            placeholder="New document type label…"
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
