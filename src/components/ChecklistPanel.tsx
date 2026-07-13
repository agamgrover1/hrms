import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, Circle, PlayCircle, Plus, Trash2,
  Ban, Sparkles, ChevronDown, User, Clock,
} from 'lucide-react';
import { api } from '../services/api';
import { toast } from './Toaster';

// Shared onboarding + offboarding checklist. Both flows are identical
// in shape (header + items + optional per-item note + custom items);
// this component drives both by `kind`, so we don't ship two copies.
//
// Callers pass the employeeId + kind + a "gate" (for offboarding, we
// require `employee.exit_date` to be set before allowing Start). All
// state is loaded from the API — the panel is essentially a small
// controller around api.getChecklist / startChecklist / etc.

type Kind = 'onboarding' | 'offboarding';

interface ChecklistItem {
  id: string;
  key: string;
  label: string;
  sort_order: number;
  done: boolean;
  done_by_name: string | null;
  done_at: string | null;
  notes: string | null;
  is_custom: boolean;
}
interface Checklist {
  id: string;
  employee_id: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  started_at: string;
  started_by_name: string | null;
  completed_at: string | null;
  completed_by_name: string | null;
  cancel_reason: string | null;
  items?: ChecklistItem[];
}

interface Props {
  employeeId: string;
  kind: Kind;
  // Offboarding gate: pass employee.exit_date. When null, we render a
  // short placeholder and disable Start.
  exitDate?: string | null;
  // Called after any mutation so the parent can refresh sibling
  // widgets (e.g. Home KPI tile).
  onChanged?: () => void;
}

const KIND_COPY: Record<Kind, { title: string; startLabel: string; emptyGate: string }> = {
  onboarding: {
    title: 'Onboarding',
    startLabel: 'Start onboarding',
    emptyGate: '',
  },
  offboarding: {
    title: 'Offboarding',
    startLabel: 'Start offboarding',
    emptyGate: 'No exit date on file yet. Set an exit date on this employee to start offboarding.',
  },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ChecklistPanel({ employeeId, kind, exitDate, onChanged }: Props) {
  const [current, setCurrent] = useState<Checklist | null>(null);
  const [history, setHistory] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getChecklist(employeeId, kind)
      .then(d => { setCurrent(d.current); setHistory(d.history || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [employeeId, kind]);

  useEffect(() => { load(); }, [load]);

  const gateBlocked = kind === 'offboarding' && !exitDate;

  const start = async () => {
    if (gateBlocked) return;
    setBusy(true);
    try {
      await api.startChecklist(employeeId, kind);
      toast.success(`${KIND_COPY[kind].title} started`, 'Items are ready to tick.');
      load(); onChanged?.();
    } catch (e: any) {
      toast.error('Could not start', e?.message);
    } finally { setBusy(false); }
  };

  const toggleItem = async (item: ChecklistItem) => {
    // Optimistic — flip locally, roll back on error.
    const prevItems = current?.items ?? [];
    setCurrent(c => c ? { ...c, items: prevItems.map(i => i.id === item.id ? { ...i, done: !i.done } : i) } : c);
    try {
      const r = await api.updateChecklistItem(item.id, kind, { done: !item.done });
      // If auto-complete fired, refresh — the header pill needs to flip.
      if (r.checklist_completed) { load(); onChanged?.(); return; }
      // Merge server truth back in for done_by / done_at.
      setCurrent(c => c ? { ...c, items: c.items!.map(i => i.id === item.id ? { ...i, ...r.item } : i) } : c);
      onChanged?.();
    } catch (e: any) {
      // Rollback.
      setCurrent(c => c ? { ...c, items: prevItems } : c);
      toast.error('Could not update', e?.message);
    }
  };

  const saveNote = async (itemId: string, notes: string) => {
    try {
      await api.updateChecklistItem(itemId, kind, { notes: notes || null });
      setCurrent(c => c ? { ...c, items: c.items!.map(i => i.id === itemId ? { ...i, notes: notes || null } : i) } : c);
      setExpandedNote(null);
    } catch (e: any) { toast.error('Save failed', e?.message); }
  };

  const addCustom = async () => {
    const label = newItemLabel.trim();
    if (!label || !current) return;
    setBusy(true);
    try {
      const item = await api.addChecklistItem(current.id, kind, label);
      setCurrent(c => c ? { ...c, items: [...(c.items ?? []), item] } : c);
      setNewItemLabel('');
    } catch (e: any) {
      toast.error('Could not add', e?.message);
    } finally { setBusy(false); }
  };

  const deleteItem = async (item: ChecklistItem) => {
    if (!item.is_custom) return;
    if (!window.confirm(`Remove "${item.label}"?`)) return;
    try {
      await api.deleteChecklistItem(item.id, kind);
      setCurrent(c => c ? { ...c, items: (c.items ?? []).filter(i => i.id !== item.id) } : c);
    } catch (e: any) { toast.error('Delete failed', e?.message); }
  };

  const markComplete = async () => {
    if (!current) return;
    if (!window.confirm('Close this checklist out even though some items may be unchecked?')) return;
    setBusy(true);
    try {
      await api.completeChecklist(current.id, kind);
      toast.success('Marked complete');
      load(); onChanged?.();
    } catch (e: any) { toast.error('Could not complete', e?.message); }
    finally { setBusy(false); }
  };

  const cancelChecklist = async () => {
    if (!current) return;
    const reason = window.prompt('Reason for cancelling this checklist?');
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await api.cancelChecklist(current.id, kind, reason.trim());
      toast.success('Checklist cancelled');
      load(); onChanged?.();
    } catch (e: any) { toast.error('Could not cancel', e?.message); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="h-32 rounded-xl-2 bg-surface-2 animate-pulse" />;

  // ── No current checklist: show Start button (or gate placeholder) ──
  if (!current) {
    return (
      <div className="space-y-4">
        {gateBlocked ? (
          <div className="rounded-xl-2 border border-outline bg-surface-2/40 p-6 text-center text-sm text-on-surface-muted">
            {KIND_COPY[kind].emptyGate}
          </div>
        ) : (
          <div className="rounded-xl-2 border border-outline bg-surface p-6 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <h3 className="font-semibold text-on-surface">No {kind} checklist yet</h3>
              </div>
              <p className="text-sm text-on-surface-muted mt-1">
                Start the checklist to track the standard {kind === 'onboarding' ? 'joiner' : 'exit'} tasks. HR / admin can tick items and add ad-hoc ones as they go.
              </p>
            </div>
            <button
              onClick={start} disabled={busy}
              className="shrink-0 px-4 py-2 bg-accent text-on-accent rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-60 flex items-center gap-2">
              <PlayCircle className="w-4 h-4" /> {KIND_COPY[kind].startLabel}
            </button>
          </div>
        )}
        {history.length > 0 && <HistoryBlock history={history} onOpen={() => setHistoryOpen(o => !o)} open={historyOpen} kind={kind} />}
      </div>
    );
  }

  // ── Live checklist ──
  const items = current.items ?? [];
  const done = items.filter(i => i.done).length;
  const total = items.length;
  const isCompleted = current.status === 'completed';
  const isCancelled = current.status === 'cancelled';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl-2 border border-outline bg-surface p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-on-surface">{KIND_COPY[kind].title}</h3>
              <StatusPill status={current.status} />
              <span className="text-xs text-on-surface-muted num-mono">{done}/{total} done</span>
            </div>
            <div className="text-xs text-on-surface-subtle mt-1">
              Started {fmtDate(current.started_at)}
              {current.started_by_name && <> by {current.started_by_name}</>}
              {isCompleted && current.completed_at && <> · closed {fmtDate(current.completed_at)}{current.completed_by_name ? ` by ${current.completed_by_name}` : ''}</>}
              {isCancelled && current.cancel_reason && <> · cancelled: {current.cancel_reason}</>}
            </div>
          </div>
          {current.status === 'in_progress' && (
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={markComplete} disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold border border-success/40 bg-success/10 text-success rounded-md hover:bg-success/20 disabled:opacity-50 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Mark complete
              </button>
              <button onClick={cancelChecklist} disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold border border-outline text-on-surface-muted rounded-md hover:bg-surface-2 disabled:opacity-50 flex items-center gap-1.5">
                <Ban className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          )}
        </div>
        {/* Progress bar */}
        {total > 0 && (
          <div className="mt-3 h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <div className="h-full bg-success transition-all" style={{ width: `${(done / total) * 100}%` }} />
          </div>
        )}
      </div>

      {/* Items */}
      <div className="rounded-xl-2 border border-outline bg-surface divide-y divide-outline">
        {items.map(item => (
          <div key={item.id} className="p-3 hover:bg-surface-2/40">
            <div className="flex items-start gap-3">
              <button
                onClick={() => current.status === 'in_progress' && toggleItem(item)}
                disabled={current.status !== 'in_progress'}
                className={`mt-0.5 shrink-0 rounded-full transition-colors ${current.status !== 'in_progress' ? 'cursor-default' : ''}`}
                title={current.status === 'in_progress' ? (item.done ? 'Mark not done' : 'Mark done') : ''}>
                {item.done ? (
                  <CheckCircle2 className="w-5 h-5 text-success" />
                ) : (
                  <Circle className="w-5 h-5 text-on-surface-subtle hover:text-accent" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm ${item.done ? 'line-through text-on-surface-muted' : 'text-on-surface'}`}>{item.label}</span>
                  {item.is_custom && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 uppercase tracking-wider">Custom</span>
                  )}
                </div>
                {item.done_by_name && item.done_at && (
                  <div className="text-[11px] text-on-surface-subtle mt-0.5 flex items-center gap-1">
                    <User className="w-3 h-3" /> {item.done_by_name}
                    <Clock className="w-3 h-3 ml-1" /> {fmtDate(item.done_at)}
                  </div>
                )}
                {expandedNote === item.id ? (
                  <NoteEditor
                    initial={item.notes ?? ''}
                    onSave={(v) => saveNote(item.id, v)}
                    onCancel={() => setExpandedNote(null)}
                  />
                ) : item.notes ? (
                  <button onClick={() => current.status === 'in_progress' && setExpandedNote(item.id)}
                    className="mt-1.5 text-xs text-on-surface-muted italic text-left w-full hover:text-on-surface transition-colors">
                    "{item.notes}"
                  </button>
                ) : current.status === 'in_progress' ? (
                  <button onClick={() => setExpandedNote(item.id)}
                    className="mt-1.5 text-[11px] text-on-surface-subtle hover:text-accent transition-colors">
                    + add note
                  </button>
                ) : null}
              </div>
              {item.is_custom && current.status === 'in_progress' && (
                <button onClick={() => deleteItem(item)} title="Remove this custom item"
                  className="shrink-0 text-on-surface-subtle hover:text-danger p-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
        {current.status === 'in_progress' && (
          <div className="p-3 flex items-center gap-2">
            <input
              value={newItemLabel}
              onChange={e => setNewItemLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustom()}
              placeholder="Add a custom item…"
              className="flex-1 text-sm px-3 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
            <button onClick={addCustom} disabled={busy || !newItemLabel.trim()}
              className="px-3 py-2 text-xs font-semibold bg-accent text-on-accent rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        )}
      </div>

      {history.length > 0 && <HistoryBlock history={history} onOpen={() => setHistoryOpen(o => !o)} open={historyOpen} kind={kind} />}
    </div>
  );
}

function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="mt-2 space-y-1.5">
      <textarea
        value={v} onChange={e => setV(e.target.value)}
        autoFocus rows={2}
        className="w-full text-xs px-2 py-1.5 rounded-md border border-outline bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent resize-none"
        placeholder="Add context (invoice link, ticket ID, notes)…"
      />
      <div className="flex items-center gap-2">
        <button onClick={() => onSave(v.trim())}
          className="px-2 py-1 text-[11px] font-semibold bg-accent text-on-accent rounded-md hover:opacity-90">Save</button>
        <button onClick={onCancel}
          className="px-2 py-1 text-[11px] text-on-surface-muted hover:text-on-surface">Cancel</button>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: 'in_progress' | 'completed' | 'cancelled' }) {
  const cfg = status === 'completed'
    ? { cls: 'bg-success/15 text-success border-success/30', label: 'Completed' }
    : status === 'cancelled'
      ? { cls: 'bg-surface-3 text-on-surface-muted border-outline', label: 'Cancelled' }
      : { cls: 'bg-warning/15 text-warning border-warning/30', label: 'In progress' };
  return (
    <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function HistoryBlock({ history, onOpen, open, kind }: { history: any[]; onOpen: () => void; open: boolean; kind: Kind }) {
  // Track which historical checklist is currently expanded so HR can dig
  // into who ticked what without leaving the profile. Only one row open
  // at a time — keeps the panel manageable at 5 rows.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="rounded-xl-2 border border-outline bg-surface">
      <button onClick={onOpen}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium text-on-surface hover:bg-surface-2/50">
        <span>Previous {kind} checklists ({history.length})</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-outline divide-y divide-outline">
          {history.map(h => {
            const isExpanded = expandedId === h.id;
            const items: ChecklistItem[] = h.items ?? [];
            const doneCount = items.filter(i => i.done).length;
            return (
              <div key={h.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : h.id)}
                  className="w-full px-4 py-2.5 text-xs flex items-center justify-between gap-3 hover:bg-surface-2/40">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <StatusPill status={h.status} />
                    <span className="text-on-surface-muted">Started {fmtDate(h.started_at)}</span>
                    {h.started_by_name && <span className="text-on-surface-subtle">by {h.started_by_name}</span>}
                    {h.completed_at && <span className="text-on-surface-subtle">· closed {fmtDate(h.completed_at)}</span>}
                    {h.completed_by_name && <span className="text-on-surface-subtle">by {h.completed_by_name}</span>}
                    {items.length > 0 && (
                      <span className="text-on-surface-subtle num-mono">· {doneCount}/{items.length} items</span>
                    )}
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-on-surface-subtle transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
                {isExpanded && (
                  <div className="px-4 py-3 bg-surface-2/30 border-t border-outline">
                    {h.cancel_reason && (
                      <div className="mb-3 px-3 py-2 rounded-md bg-warning-container/40 border border-warning/30 text-xs">
                        <span className="font-semibold text-on-surface">Cancel reason: </span>
                        <span className="italic text-on-surface-muted">"{h.cancel_reason}"</span>
                      </div>
                    )}
                    {items.length === 0 ? (
                      <p className="text-xs text-on-surface-subtle italic">No items recorded.</p>
                    ) : (
                      <ul className="divide-y divide-outline rounded-md border border-outline bg-surface">
                        {items.map(item => (
                          <li key={item.id} className="px-3 py-2 flex items-start gap-3">
                            {item.done ? (
                              <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                            ) : (
                              <Circle className="w-4 h-4 text-on-surface-subtle shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs ${item.done ? 'text-on-surface' : 'text-on-surface-muted'}`}>{item.label}</span>
                                {item.is_custom && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 uppercase tracking-wider">Custom</span>
                                )}
                              </div>
                              {item.done && item.done_by_name && item.done_at && (
                                <div className="text-[10px] text-on-surface-subtle mt-0.5">
                                  Ticked by {item.done_by_name} · {fmtDate(item.done_at)}
                                </div>
                              )}
                              {item.notes && (
                                <div className="text-[11px] text-on-surface-muted mt-1 italic break-words">"{item.notes}"</div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
