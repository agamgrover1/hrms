import { useEffect, useMemo, useState } from 'react';
import { Plus, X, Trash2, CheckCircle, Circle, Clock, AlertCircle, ChevronDown, ChevronRight, Pencil, Tag as TagIcon } from 'lucide-react';
import { api } from '../services/api';
import type { TodoTask } from '../services/api';
import { toast } from './Toaster';

// Parse a comma / space separated string into a clean tag list.
// Mirrors the backend normalization: lowercase, trim, no dupes, drop
// empties, cap at 8. Splits on comma AND space so the user can type
// naturally without having to remember which separator to use.
function parseTags(input: string): string[] {
  if (!input) return [];
  const parts = input
    .split(/[,\s]+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0 && t.length <= 32);
  return Array.from(new Set(parts)).slice(0, 8);
}

// To-Do tab for MyPortal. Two sections:
//   - "My tasks" — anything assigned to me (self or assigned by a manager/HR/admin)
//   - "Assigned by me" — tasks I created for someone else, so I can follow up
// Anyone can add tasks for themselves. Reporting managers / HR / admin can
// also add tasks for others; the backend enforces who can assign to whom.

const PRIORITY_TONE: Record<string, { bg: string; color: string; label: string }> = {
  high:   { bg: '#fee2e2', color: '#b91c1c', label: 'High' },
  normal: { bg: '#e0e7ff', color: '#3730a3', label: 'Normal' },
  low:    { bg: '#f3f4f6', color: '#64748b', label: 'Low' },
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

function dueDateLabel(due: string | null) {
  if (!due) return null;
  const d = new Date(due + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
  const text = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (diff < 0) return { text, tone: 'text-danger', extra: `${Math.abs(diff)}d overdue` };
  if (diff === 0) return { text, tone: 'text-warning', extra: 'today' };
  if (diff === 1) return { text, tone: 'text-warning', extra: 'tomorrow' };
  if (diff <= 7) return { text, tone: 'text-on-surface-muted', extra: `in ${diff}d` };
  return { text, tone: 'text-on-surface-subtle', extra: null };
}

export default function TodoTab({ canAssignToOthers, employees }: {
  canAssignToOthers: boolean;
  employees: Array<{ id: string; name: string; designation?: string | null; status?: string | null }>;
}) {
  const [mine, setMine] = useState<TodoTask[]>([]);
  const [assignedByMe, setAssignedByMe] = useState<TodoTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  // Add-task form state
  const [showForm, setShowForm] = useState(false);
  const [formAssignSelf, setFormAssignSelf] = useState(true);
  const [formAssigneeId, setFormAssigneeId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formPriority, setFormPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [formTags, setFormTags] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // Active tag filter — null = show all. Clicking a chip on a row (or a
  // pill in the header) sets this; clicking again clears it. Applies to
  // both "My tasks" and "Assigned by me" so the filter feels global.
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.getTodos()
      .then(r => { setMine(r.mine ?? []); setAssignedByMe(r.assigned_by_me ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const resetForm = () => {
    setFormAssignSelf(true);
    setFormAssigneeId('');
    setFormTitle('');
    setFormDescription('');
    setFormDueDate('');
    setFormPriority('normal');
    setFormTags('');
    setFormError('');
  };

  const submit = async () => {
    setFormError('');
    if (!formTitle.trim()) { setFormError('Title is required'); return; }
    if (!formAssignSelf && !formAssigneeId) { setFormError('Pick who this task is for'); return; }
    setFormBusy(true);
    try {
      await api.createTodo({
        title: formTitle.trim(),
        description: formDescription.trim() || undefined,
        due_date: formDueDate || undefined,
        priority: formPriority,
        assignee_id: formAssignSelf ? undefined : formAssigneeId,
        tags: parseTags(formTags),
      });
      toast.success(formAssignSelf ? 'To-do added' : 'Task assigned', formTitle.trim());
      resetForm();
      setShowForm(false);
      load();
    } catch (e: any) {
      setFormError(e?.message ?? 'Failed to create task');
      toast.error('Failed to create task', e?.message);
    }
    finally { setFormBusy(false); }
  };

  const toggleStatus = async (t: TodoTask) => {
    const next = t.status === 'done' ? 'pending' : t.status === 'pending' ? 'in_progress' : 'done';
    try {
      await api.updateTodo(t.id, { status: next });
      if (next === 'done') toast.success('Task marked done', t.title);
      load();
    } catch (e: any) { toast.error('Could not update task', e?.message); }
  };

  const remove = async (t: TodoTask) => {
    if (!confirm('Delete this task?')) return;
    try {
      await api.deleteTodo(t.id);
      toast.success('Task deleted', t.title);
      load();
    } catch (e: any) { toast.error('Could not delete task', e?.message); }
  };

  // Edit state — only one task in edit mode at a time. The row renders
  // an inline form when its id matches; everything else stays read-only.
  const [editingId, setEditingId] = useState<string | null>(null);
  const saveEdit = async (id: string, patch: { title: string; description: string; due_date: string; priority: 'low' | 'normal' | 'high'; tags: string[] }) => {
    try {
      await api.updateTodo(id, {
        title: patch.title.trim(),
        description: patch.description.trim() || undefined,
        due_date: patch.due_date || null,
        priority: patch.priority,
        tags: patch.tags,
      });
      toast.success('Task updated', patch.title.trim());
      setEditingId(null);
      load();
    } catch (e: any) { toast.error('Could not update task', e?.message); }
  };

  // Quick tag-only edit — invoked from the row's tag chip UI so the
  // assignee can categorize whatever landed on their list without
  // opening the full edit form.
  const saveTagsOnly = async (id: string, tags: string[]) => {
    try {
      await api.updateTodo(id, { tags });
      load();
    } catch (e: any) { toast.error('Could not update tags', e?.message); }
  };

  // Every tag currently used across both lists — drives the filter pill
  // row and the datalist auto-complete on the add form. Sorted by usage
  // frequency so the most-used categories show first.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of [...mine, ...assignedByMe]) {
      for (const tag of (t.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  }, [mine, assignedByMe]);

  const passesFilters = (t: TodoTask): boolean => {
    if (!showCompleted && (t.status === 'done' || t.status === 'cancelled')) return false;
    if (tagFilter && !((t.tags ?? []).includes(tagFilter))) return false;
    return true;
  };
  const filteredMine     = useMemo(() => mine.filter(passesFilters),        [mine, showCompleted, tagFilter]);
  const filteredAssigned = useMemo(() => assignedByMe.filter(passesFilters), [assignedByMe, showCompleted, tagFilter]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-on-surface">To-Do</h2>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Lightweight task list. Add things for yourself, or {canAssignToOthers ? 'assign a task to someone you manage' : 'ask your manager / HR to add things they want you to track'}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCompleted(v => !v)}
            className="text-xs font-semibold text-on-surface-muted hover:text-on-surface inline-flex items-center gap-1">
            {showCompleted ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showCompleted ? 'Hide completed' : 'Show completed'}
          </button>
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-on-accent text-sm font-semibold px-3 py-2 hover:opacity-90">
            <Plus size={14} /> Add task
          </button>
        </div>
      </div>

      {/* Tag filter row — only appears once at least one task on the list
          has a tag. Click a pill to filter to that tag; click "All" to
          clear. The count next to each tag is how many open tasks carry
          it, so the user knows which categories are actually alive. */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <TagIcon size={12} className="text-on-surface-subtle mr-0.5" />
          <button onClick={() => setTagFilter(null)}
            className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold transition-colors ${
              tagFilter === null
                ? 'bg-accent text-on-accent border-accent'
                : 'bg-surface text-on-surface-muted border-outline hover:border-accent/50'}`}>
            All
          </button>
          {allTags.map(t => (
            <button key={t.tag} onClick={() => setTagFilter(cur => cur === t.tag ? null : t.tag)}
              className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold transition-colors inline-flex items-center gap-1 ${
                tagFilter === t.tag
                  ? 'bg-accent text-on-accent border-accent'
                  : 'bg-surface text-on-surface-muted border-outline hover:border-accent/50'}`}>
              {t.tag}
              <span className="text-[9px] opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="rounded-xl-2 border border-accent/30 bg-accent-container/15 p-4 space-y-3">
          {canAssignToOthers && (
            <div className="flex gap-2">
              <button onClick={() => setFormAssignSelf(true)}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold ${formAssignSelf ? 'bg-surface border border-accent text-accent' : 'bg-surface-2 text-on-surface-muted border border-outline'}`}>
                For me
              </button>
              <button onClick={() => setFormAssignSelf(false)}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold ${!formAssignSelf ? 'bg-surface border border-accent text-accent' : 'bg-surface-2 text-on-surface-muted border border-outline'}`}>
                Assign to someone
              </button>
            </div>
          )}

          {!formAssignSelf && (
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Assignee *</label>
              <select value={formAssigneeId} onChange={e => setFormAssigneeId(e.target.value)}
                className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20">
                <option value="">— Pick someone —</option>
                {employees.filter(e => (e.status ?? 'active') === 'active').map(e => (
                  <option key={e.id} value={e.id}>{e.name}{e.designation ? ` · ${e.designation}` : ''}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Title *</label>
            <input value={formTitle} onChange={e => setFormTitle(e.target.value)} autoFocus
              placeholder="What needs to happen?"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Description</label>
            <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)}
              rows={2} placeholder="Optional context…"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Due</label>
              <input type="date" value={formDueDate} onChange={e => setFormDueDate(e.target.value)}
                className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Priority</label>
              <select value={formPriority} onChange={e => setFormPriority(e.target.value as any)}
                className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">
              Tags / categories <span className="text-on-surface-subtle normal-case">(optional, up to 8)</span>
            </label>
            <input value={formTags} onChange={e => setFormTags(e.target.value)}
              list="todo-tag-suggestions"
              placeholder="client-work, follow-up, urgent…"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20" />
            {/* Suggests tags the user already has on their list, so they
                stick with a stable vocabulary instead of drifting into
                "client-work" vs "clientwork" vs "Client Work". */}
            <datalist id="todo-tag-suggestions">
              {allTags.map(t => <option key={t.tag} value={t.tag} />)}
            </datalist>
            <p className="text-[10px] text-on-surface-subtle mt-1">Separate with commas or spaces. Case doesn't matter — everything gets lowercased.</p>
          </div>
          {formError && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{formError}</p>}
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setShowForm(false); }}
              className="flex-1 py-2 text-sm font-medium border border-outline rounded-lg text-on-surface-muted hover:bg-surface-2">Cancel</button>
            <button onClick={submit} disabled={formBusy}
              className="flex-1 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50">
              {formBusy ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl-2 border border-outline bg-surface p-10 text-center text-sm text-on-surface-subtle">Loading…</div>
      ) : (
        <>
          {/* My tasks */}
          <TaskSection
            title="My tasks"
            subtitle={tagFilter ? `Filtered by #${tagFilter}` : "Things I need to do — whether I added them or someone else did"}
            tasks={filteredMine}
            emptyText={tagFilter ? `No open tasks tagged "${tagFilter}".` : showCompleted ? 'No tasks yet.' : 'No open tasks. Add one above.'}
            renderTask={t => (
              <TaskRow key={t.id} task={t} showAssignee={false} showCreator
                isEditing={editingId === t.id}
                activeTagFilter={tagFilter}
                onTagClick={(tag) => setTagFilter(cur => cur === tag ? null : tag)}
                onQuickTagsSave={(tags) => saveTagsOnly(t.id, tags)}
                onEdit={() => setEditingId(t.id)}
                onCancelEdit={() => setEditingId(null)}
                onSave={(patch) => saveEdit(t.id, patch)}
                onToggle={() => toggleStatus(t)}
                onDelete={() => remove(t)} />
            )}
          />

          {/* Assigned by me */}
          {(assignedByMe.length > 0 || showCompleted) && (
            <TaskSection
              title="Assigned by me"
              subtitle={tagFilter ? `Filtered by #${tagFilter}` : "Tasks I added to other people's lists"}
              tasks={filteredAssigned}
              emptyText={tagFilter ? `No open tasks tagged "${tagFilter}".` : "No tasks you've assigned to others."}
              renderTask={t => (
                <TaskRow key={t.id} task={t} showAssignee showCreator={false}
                  isEditing={editingId === t.id}
                  activeTagFilter={tagFilter}
                  onTagClick={(tag) => setTagFilter(cur => cur === tag ? null : tag)}
                  onQuickTagsSave={(tags) => saveTagsOnly(t.id, tags)}
                  onEdit={() => setEditingId(t.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(patch) => saveEdit(t.id, patch)}
                  onToggle={() => toggleStatus(t)}
                  onDelete={() => remove(t)} />
              )}
            />
          )}
        </>
      )}
    </div>
  );
}

function TaskSection({ title, subtitle, tasks, emptyText, renderTask }: {
  title: string; subtitle: string; tasks: TodoTask[]; emptyText: string;
  renderTask: (t: TodoTask) => React.ReactNode;
}) {
  return (
    <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-1 overflow-hidden">
      <div className="px-5 py-3 border-b border-outline flex items-center justify-between">
        <div>
          <p className="font-display text-base font-bold text-on-surface">{title}</p>
          <p className="text-[11px] text-on-surface-subtle">{subtitle}</p>
        </div>
        <span className="num-mono text-xs font-bold px-2 py-0.5 rounded-full bg-surface-2 text-on-surface-muted">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-on-surface-subtle">{emptyText}</div>
      ) : (
        <div className="divide-y divide-outline">{tasks.map(renderTask)}</div>
      )}
    </div>
  );
}

function TaskRow({ task, showAssignee, showCreator, isEditing, activeTagFilter, onTagClick, onQuickTagsSave, onEdit, onCancelEdit, onSave, onToggle, onDelete }: {
  task: TodoTask; showAssignee: boolean; showCreator: boolean;
  isEditing: boolean;
  activeTagFilter: string | null;
  onTagClick: (tag: string) => void;
  onQuickTagsSave: (tags: string[]) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: { title: string; description: string; due_date: string; priority: 'low' | 'normal' | 'high'; tags: string[] }) => void;
  onToggle: () => void; onDelete: () => void;
}) {
  const isDone = task.status === 'done';
  const isCancelled = task.status === 'cancelled';
  const prio = PRIORITY_TONE[task.priority] ?? PRIORITY_TONE.normal;
  const due = dueDateLabel(task.due_date);
  const tags = task.tags ?? [];

  // Inline add-tag popover on rows that don't have any tag yet — one
  // click to categorize a task without opening the full edit form.
  const [quickAdd, setQuickAdd] = useState(false);
  const [quickAddDraft, setQuickAddDraft] = useState('');

  if (isEditing) return (
    <TaskEditRow task={task} onCancel={onCancelEdit} onSave={onSave} />
  );

  return (
    <div className="px-5 py-3 flex items-start gap-3 hover:bg-surface-2/30">
      <button onClick={onToggle} className="mt-0.5 flex-shrink-0 text-on-surface-muted hover:text-accent" title={isDone ? 'Mark as to-do' : 'Cycle status'}>
        {isDone ? <CheckCircle size={18} className="text-success" /> :
          task.status === 'in_progress' ? <Clock size={18} className="text-warning" /> :
          <Circle size={18} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className={`text-sm font-semibold ${isDone || isCancelled ? 'text-on-surface-subtle line-through' : 'text-on-surface'}`}>{task.title}</p>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: prio.bg, color: prio.color }}>{prio.label}</span>
          <span className="text-[10px] text-on-surface-subtle">· {STATUS_LABEL[task.status]}</span>
        </div>
        {task.description && (
          <p className="text-xs text-on-surface-muted leading-snug mt-0.5 whitespace-pre-line">{task.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {due && (
            <span className={`text-[11px] num-mono ${due.tone}`}>
              {due.text}{due.extra ? ` · ${due.extra}` : ''}
            </span>
          )}
          {showAssignee && task.assignee_name && (
            <span className="text-[11px] text-on-surface-subtle">
              → <span className="text-on-surface-muted font-medium">{task.assignee_name}</span>
            </span>
          )}
          {showCreator && task.created_by_name && task.created_by_role !== 'self' && (
            <span className="text-[11px] text-on-surface-subtle">
              added by <span className="text-on-surface-muted font-medium">{task.created_by_name}</span>
            </span>
          )}
        </div>
        {/* Tag chips + quick-add. Chips are click-to-filter; a small × on
            each removes it in place. Empty-tag rows get a subtle "add
            tag" affordance so categorization stays one click away. */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {tags.map(tag => {
            const isActive = activeTagFilter === tag;
            return (
              <span key={tag}
                className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 border transition-colors ${
                  isActive
                    ? 'bg-accent text-on-accent border-accent'
                    : 'bg-accent/8 text-accent border-accent/25 hover:bg-accent/15'}`}>
                <button onClick={() => onTagClick(tag)} className="focus:outline-none" title={isActive ? 'Clear filter' : `Filter to #${tag}`}>
                  #{tag}
                </button>
                <button
                  onClick={() => onQuickTagsSave(tags.filter(x => x !== tag))}
                  className="opacity-60 hover:opacity-100 text-[12px] leading-none"
                  title="Remove tag">
                  ×
                </button>
              </span>
            );
          })}
          {quickAdd ? (
            <span className="inline-flex items-center gap-1">
              <input
                value={quickAddDraft}
                onChange={e => setQuickAddDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const next = parseTags([...tags, quickAddDraft].join(','));
                    onQuickTagsSave(next);
                    setQuickAdd(false); setQuickAddDraft('');
                  }
                  if (e.key === 'Escape') { setQuickAdd(false); setQuickAddDraft(''); }
                }}
                onBlur={() => {
                  const draft = quickAddDraft.trim();
                  if (draft) {
                    const next = parseTags([...tags, draft].join(','));
                    onQuickTagsSave(next);
                  }
                  setQuickAdd(false); setQuickAddDraft('');
                }}
                autoFocus
                placeholder="tag…"
                className="text-[11px] px-2 py-0.5 rounded-full border border-accent/40 bg-surface w-24 focus:outline-none focus:ring-1 focus:ring-accent/30" />
            </span>
          ) : (
            <button onClick={() => setQuickAdd(true)}
              className="text-[10px] text-on-surface-subtle hover:text-accent inline-flex items-center gap-0.5">
              <Plus size={10} /> {tags.length === 0 ? 'add tag' : 'more'}
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-0.5">
        <button onClick={onEdit} className="text-on-surface-subtle hover:text-accent p-1" title="Edit">
          <Pencil size={13} />
        </button>
        <button onClick={onDelete} className="text-on-surface-subtle hover:text-danger p-1" title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// Inline edit form — swaps in for a row when editing. Pre-fills with the
// task's current values; save calls api.updateTodo via the parent.
// Status / assignee aren't editable here (status flips via the circle
// click on the row; reassigning a task wasn't in the original ask).
function TaskEditRow({ task, onCancel, onSave }: {
  task: TodoTask;
  onCancel: () => void;
  onSave: (patch: { title: string; description: string; due_date: string; priority: 'low' | 'normal' | 'high'; tags: string[] }) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [dueDate, setDueDate] = useState((task.due_date ?? '').slice(0, 10));
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>(task.priority);
  const [tags, setTags] = useState((task.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    setBusy(true);
    try { await onSave({ title, description, due_date: dueDate, priority, tags: parseTags(tags) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="px-5 py-3 bg-accent-container/15 border-l-2 border-accent space-y-3">
      <div>
        <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Title *</label>
        <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); if (e.key === 'Escape') onCancel(); }}
          className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20" />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          rows={2} placeholder="Optional context…"
          className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent/20" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Due</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value as any)}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Tags</label>
        <input value={tags} onChange={e => setTags(e.target.value)}
          placeholder="client-work, follow-up…"
          className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20" />
      </div>
      {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex-1 py-2 text-sm font-medium border border-outline rounded-lg text-on-surface-muted hover:bg-surface-2">Cancel</button>
        <button onClick={submit} disabled={busy}
          className="flex-1 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      <p className="text-[10px] text-on-surface-subtle">⌘/Ctrl + Enter to save · Esc to cancel.</p>
    </div>
  );
}
