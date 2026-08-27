import { useEffect, useMemo, useRef, useState } from 'react';
import { Filter, X, ChevronDown, Save, Trash2, Bookmark, Users as UsersIcon, Flag, Tag, Calendar, Diamond, Repeat, User } from 'lucide-react';
import { api, type TaskFilters, type TaskSavedView } from '../../services/api';
import { toast } from '../Toaster';

// The Tasks page's filter surface (Phase 5a).
// - Filter popover: multi-select for assignee / status / priority / tags,
//   due-date presets, milestone + recurrence toggles.
// - Applied filters render as removable chips in-line.
// - Saved-views dropdown loads any prior view; save-current dialog names
//   + shares the current combo.

interface Props {
  filters: TaskFilters;
  onChange: (f: TaskFilters) => void;
  savedViews: TaskSavedView[];
  activeViewId: string | null;
  onLoadView: (v: TaskSavedView) => void;
  onSaved: (v: TaskSavedView) => void;
  onDeleted: (id: string) => void;
  employees: Array<{ id: string; name: string; employee_id?: string }>;
  statuses: Array<{ id: string; label: string }>;
  boardId: string | null;
}

const PRIORITY_OPTIONS = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
  { id: 'none', label: 'None' },
];
const DUE_PRESETS: Array<{ id: NonNullable<TaskFilters['due']>; label: string }> = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This week' },
  { id: 'next_week', label: 'Next week' },
  { id: 'no_date', label: 'No due date' },
  { id: 'custom', label: 'Custom range' },
];

function filterCount(f: TaskFilters): number {
  let n = 0;
  if (f.assignee_ids?.length) n += 1;
  if (f.statuses?.length) n += 1;
  if (f.priorities?.length) n += 1;
  if (f.tags?.length) n += 1;
  if (f.due) n += 1;
  if (f.is_milestone !== undefined) n += 1;
  if (f.has_recurrence !== undefined) n += 1;
  if (f.assigned_by_me) n += 1;
  return n;
}

export default function TaskFilterBar(props: Props) {
  const { filters, onChange, savedViews, activeViewId, onLoadView, onSaved, onDeleted, employees, statuses, boardId } = props;
  const [popover, setPopover] = useState<'filters' | 'views' | null>(null);
  const [showSave, setShowSave] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!barRef.current) return;
      if (!barRef.current.contains(e.target as Node)) setPopover(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const nActive = filterCount(filters);
  const activeView = savedViews.find(v => v.id === activeViewId);

  return (
    <div ref={barRef} className="relative flex items-center gap-2 flex-wrap">
      {/* Filter button */}
      <button onClick={() => setPopover(v => v === 'filters' ? null : 'filters')}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${nActive > 0 ? 'border-accent/40 text-accent bg-accent/5' : 'border-outline text-on-surface-muted hover:bg-surface-2'}`}>
        <Filter size={13} /> Filters
        {nActive > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent text-on-accent text-[10px] font-bold">{nActive}</span>}
        <ChevronDown size={11} />
      </button>

      {/* Saved views dropdown */}
      <button onClick={() => setPopover(v => v === 'views' ? null : 'views')}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${activeView ? 'border-brand/40 text-brand bg-brand/5' : 'border-outline text-on-surface-muted hover:bg-surface-2'}`}>
        <Bookmark size={13} />
        {activeView ? activeView.name : 'Saved views'}
        <ChevronDown size={11} />
      </button>

      {/* Save current combo */}
      {nActive > 0 && (
        <button onClick={() => setShowSave(true)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:opacity-80">
          <Save size={11} /> Save as view
        </button>
      )}

      {/* Applied filter chips */}
      {filters.assignee_ids?.length && (
        <FilterChip label={`Assignee · ${filters.assignee_ids.length}`} onClear={() => onChange({ ...filters, assignee_ids: undefined })} />
      )}
      {filters.statuses?.length && (
        <FilterChip label={`Status · ${filters.statuses.map(s => statuses.find(x => x.id === s)?.label ?? s).join(', ')}`} onClear={() => onChange({ ...filters, statuses: undefined })} />
      )}
      {filters.priorities?.length && (
        <FilterChip label={`Priority · ${filters.priorities.join(', ')}`} onClear={() => onChange({ ...filters, priorities: undefined })} />
      )}
      {filters.tags?.length && (
        <FilterChip label={`Tag · ${filters.tags.join(', ')}`} onClear={() => onChange({ ...filters, tags: undefined })} />
      )}
      {filters.due && (
        <FilterChip
          label={`Due · ${DUE_PRESETS.find(p => p.id === filters.due)?.label ?? filters.due}${filters.due === 'custom' ? ` (${filters.due_from ?? '…'}–${filters.due_to ?? '…'})` : ''}`}
          onClear={() => onChange({ ...filters, due: undefined, due_from: undefined, due_to: undefined })}
        />
      )}
      {filters.is_milestone !== undefined && (
        <FilterChip label={filters.is_milestone ? 'Milestones only' : 'No milestones'} onClear={() => onChange({ ...filters, is_milestone: undefined })} />
      )}
      {filters.has_recurrence !== undefined && (
        <FilterChip label={filters.has_recurrence ? 'Recurring only' : 'One-off only'} onClear={() => onChange({ ...filters, has_recurrence: undefined })} />
      )}
      {filters.assigned_by_me && (
        <FilterChip label="Assigned by me" onClear={() => onChange({ ...filters, assigned_by_me: undefined })} />
      )}
      {nActive > 0 && (
        <button onClick={() => onChange({})} className="text-[11px] text-on-surface-subtle hover:text-danger">Clear all</button>
      )}

      {/* Popover: filters */}
      {popover === 'filters' && (
        <FilterPopover filters={filters} onChange={onChange} employees={employees} statuses={statuses} onClose={() => setPopover(null)} />
      )}
      {popover === 'views' && (
        <ViewsPopover views={savedViews} onLoad={v => { onLoadView(v); setPopover(null); }} onDelete={async id => {
          if (!window.confirm('Delete this saved view?')) return;
          try { await api.deleteTaskView(id); onDeleted(id); }
          catch (e: any) { toast.error('Could not delete', e?.message ?? 'Please try again.'); }
        }} />
      )}

      {showSave && (
        <SaveViewModal
          filters={filters}
          boardId={boardId}
          onClose={() => setShowSave(false)}
          onSaved={v => { onSaved(v); setShowSave(false); toast.success('View saved', v.name); }}
        />
      )}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-brand/10 text-brand text-[11px] font-semibold border border-brand/20">
      {label}
      <button onClick={onClear} className="p-0.5 rounded hover:bg-brand/20"><X size={10} /></button>
    </span>
  );
}

function FilterPopover({ filters, onChange, employees, statuses, onClose }: {
  filters: TaskFilters;
  onChange: (f: TaskFilters) => void;
  employees: Props['employees'];
  statuses: Props['statuses'];
  onClose: () => void;
}) {
  const toggleIn = <T extends string>(list: T[] | undefined, id: T): T[] => {
    const set = new Set(list ?? []);
    if (set.has(id)) set.delete(id); else set.add(id);
    return Array.from(set);
  };
  return (
    <div className="absolute top-full left-0 mt-2 w-[520px] max-w-[calc(100vw-32px)] z-30 rounded-xl-2 border border-outline bg-surface shadow-elev-4 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-on-surface">Filters</p>
        <button onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={14} /></button>
      </div>

      <FilterSection icon={UsersIcon} label="Assignee">
        <div className="flex flex-wrap gap-1.5">
          <MultiPill active={filters.assignee_ids?.includes('__unassigned__') ?? false}
            onClick={() => onChange({ ...filters, assignee_ids: toggleIn(filters.assignee_ids, '__unassigned__') })}>
            Unassigned
          </MultiPill>
          {employees.slice(0, 20).map(e => (
            <MultiPill key={e.id} active={filters.assignee_ids?.includes(e.id) ?? false}
              onClick={() => onChange({ ...filters, assignee_ids: toggleIn(filters.assignee_ids, e.id) })}>
              {e.name}
            </MultiPill>
          ))}
        </div>
      </FilterSection>

      <FilterSection icon={undefined} label="Status">
        <div className="flex flex-wrap gap-1.5">
          {statuses.map(s => (
            <MultiPill key={s.id} active={filters.statuses?.includes(s.id) ?? false}
              onClick={() => onChange({ ...filters, statuses: toggleIn(filters.statuses, s.id) })}>
              {s.label}
            </MultiPill>
          ))}
        </div>
      </FilterSection>

      <FilterSection icon={Flag} label="Priority">
        <div className="flex flex-wrap gap-1.5">
          {PRIORITY_OPTIONS.map(p => (
            <MultiPill key={p.id} active={filters.priorities?.includes(p.id) ?? false}
              onClick={() => onChange({ ...filters, priorities: toggleIn(filters.priorities, p.id) })}>
              {p.label}
            </MultiPill>
          ))}
        </div>
      </FilterSection>

      <FilterSection icon={Calendar} label="Due">
        <div className="flex flex-wrap gap-1.5">
          {DUE_PRESETS.map(p => (
            <MultiPill key={p.id} active={filters.due === p.id}
              onClick={() => onChange({ ...filters, due: filters.due === p.id ? undefined : p.id })}>
              {p.label}
            </MultiPill>
          ))}
        </div>
        {filters.due === 'custom' && (
          <div className="flex items-center gap-2 mt-2">
            <input type="date" value={filters.due_from ?? ''} onChange={e => onChange({ ...filters, due_from: e.target.value || undefined })}
              className="px-2 py-1 rounded border border-outline bg-surface text-xs" />
            <span className="text-[11px] text-on-surface-muted">to</span>
            <input type="date" value={filters.due_to ?? ''} onChange={e => onChange({ ...filters, due_to: e.target.value || undefined })}
              className="px-2 py-1 rounded border border-outline bg-surface text-xs" />
          </div>
        )}
      </FilterSection>

      <FilterSection icon={Tag} label="Tags">
        <input type="text" placeholder="Comma-separated (e.g. seo, content)"
          defaultValue={filters.tags?.join(', ') ?? ''}
          onBlur={e => {
            const parts = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
            onChange({ ...filters, tags: parts.length ? parts : undefined });
          }}
          className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
      </FilterSection>

      <FilterSection icon={undefined} label="Type">
        <div className="flex flex-wrap gap-1.5">
          <MultiPill active={filters.is_milestone === true}
            onClick={() => onChange({ ...filters, is_milestone: filters.is_milestone === true ? undefined : true })}>
            <Diamond size={10} className="fill-current" /> Milestones only
          </MultiPill>
          <MultiPill active={filters.has_recurrence === true}
            onClick={() => onChange({ ...filters, has_recurrence: filters.has_recurrence === true ? undefined : true })}>
            <Repeat size={10} /> Recurring only
          </MultiPill>
          <MultiPill active={filters.assigned_by_me === true}
            onClick={() => onChange({ ...filters, assigned_by_me: filters.assigned_by_me === true ? undefined : true })}>
            <User size={10} /> Assigned by me
          </MultiPill>
        </div>
      </FilterSection>

      <div className="flex justify-between pt-3 border-t border-outline">
        <button onClick={() => onChange({})} className="text-xs text-on-surface-subtle hover:text-danger font-semibold">Clear all</button>
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">Done</button>
      </div>
    </div>
  );
}

function FilterSection({ icon: Icon, label, children }: { icon?: any; label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-on-surface-muted font-semibold mb-1.5">
        {Icon && <Icon size={11} />} {label}
      </p>
      {children}
    </div>
  );
}
function MultiPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border ${active ? 'bg-accent text-on-accent border-accent' : 'bg-surface text-on-surface-muted border-outline hover:bg-surface-2'}`}>
      {children}
    </button>
  );
}

function ViewsPopover({ views, onLoad, onDelete }: {
  views: TaskSavedView[]; onLoad: (v: TaskSavedView) => void; onDelete: (id: string) => void;
}) {
  const personal = views.filter(v => v.scope === 'personal');
  const shared   = views.filter(v => v.scope === 'shared');
  if (!views.length) {
    return (
      <div className="absolute top-full left-24 mt-2 w-72 z-30 rounded-xl-2 border border-outline bg-surface shadow-elev-4 p-4 text-xs text-on-surface-muted">
        No saved views yet. Apply filters + click <b className="text-on-surface">Save as view</b> to create one.
      </div>
    );
  }
  return (
    <div className="absolute top-full left-24 mt-2 w-80 z-30 rounded-xl-2 border border-outline bg-surface shadow-elev-4 p-2">
      {personal.length > 0 && (
        <>
          <p className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-on-surface-muted font-semibold">Personal</p>
          {personal.map(v => <ViewRow key={v.id} view={v} onLoad={onLoad} onDelete={onDelete} />)}
        </>
      )}
      {shared.length > 0 && (
        <>
          <p className="px-2 py-1.5 mt-1 text-[10px] uppercase tracking-wider text-on-surface-muted font-semibold">Shared</p>
          {shared.map(v => <ViewRow key={v.id} view={v} onLoad={onLoad} onDelete={onDelete} />)}
        </>
      )}
    </div>
  );
}
function ViewRow({ view, onLoad, onDelete }: { view: TaskSavedView; onLoad: (v: TaskSavedView) => void; onDelete: (id: string) => void }) {
  const n = filterCount(view.filters ?? {});
  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-2">
      <button onClick={() => onLoad(view)} className="flex-1 text-left flex items-center gap-2 min-w-0">
        <Bookmark size={12} className="text-brand flex-shrink-0" />
        <span className="text-sm text-on-surface truncate">{view.name}</span>
        <span className="text-[10px] font-mono text-on-surface-subtle">{n} filter{n === 1 ? '' : 's'}</span>
      </button>
      <button onClick={() => onDelete(view.id)}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-on-surface-subtle hover:text-danger hover:bg-danger/10">
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function SaveViewModal({ filters, boardId, onClose, onSaved }: {
  filters: TaskFilters; boardId: string | null; onClose: () => void; onSaved: (v: TaskSavedView) => void;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'personal' | 'shared'>('personal');
  const [pinBoard, setPinBoard] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const v = await api.createTaskView({
        name: name.trim(),
        scope,
        board_id: pinBoard ? (boardId ?? undefined) : null,
        filters,
      });
      onSaved(v);
    } catch (e: any) { toast.error('Could not save view', e?.body?.error ?? e?.message ?? 'Please try again.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-xl-3 bg-surface border border-outline shadow-elev-4 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-on-surface">Save view</h2>
          <button type="button" onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={16} /></button>
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Name</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. My urgent this week"
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Scope</label>
          <div className="flex gap-1.5">
            {(['personal', 'shared'] as const).map(s => (
              <button key={s} type="button" onClick={() => setScope(s)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${scope === s ? 'bg-accent text-on-accent border-accent' : 'bg-surface text-on-surface-muted border-outline hover:bg-surface-2'}`}>
                {s === 'personal' ? 'Just me' : 'Whole team'}
              </button>
            ))}
          </div>
        </div>
        {boardId && (
          <label className="flex items-center gap-2 text-xs text-on-surface-muted">
            <input type="checkbox" checked={pinBoard} onChange={e => setPinBoard(e.target.checked)} />
            Pin to this board (loading the view switches to it)
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-outline">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-outline text-xs font-semibold hover:bg-surface-2">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            <Save size={12} /> Save
          </button>
        </div>
      </form>
    </div>
  );
}
