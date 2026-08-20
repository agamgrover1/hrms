import { useCallback, useEffect, useState } from 'react';
import {
  X, Loader2, Trash2, Send, Plus, MessageSquare, History, GitBranch, Check,
} from 'lucide-react';
import { api } from '../../services/api';
import type { Task, TaskActivity, TaskComment, TaskPriority, TaskStatus } from '../../services/api';
import { toast } from '../Toaster';
import { TASK_PRIORITIES, PRIORITY_META, initials } from '../../lib/taskMeta';

// Full task detail — the panel behind every card. Field edits save on blur /
// change immediately (no Save button), matching how the rest of the portal's
// inline editors behave, and each save re-fetches so the activity timeline
// below stays truthful.

interface Props {
  taskId: string;
  employees: any[];
  onClose: () => void;
  /** Called after any write so the board behind the modal can refresh. */
  onChanged: () => void;
}

export default function TaskDetailModal({ taskId, employees, onClose, onChanged }: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');

  const load = useCallback(() => {
    setLoading(true);
    api.getTask(taskId)
      .then(({ task: t, subtasks: st, comments: cs, activity: acts }) => {
        setTask(t); setSubtasks(st); setComments(cs); setActivity(acts);
        setTitle(t.title); setDescription(t.description ?? '');
      })
      .catch((e: any) => setErr(e?.message ?? 'Failed to load task'))
      .finally(() => setLoading(false));
  }, [taskId]);
  useEffect(load, [load]);

  // Esc closes — the modal is a full-screen overlay, so leaving it keyboard-
  // inert would trap anyone not using a mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = async (data: Record<string, any>) => {
    if (!task) return;
    setSaving(true);
    try {
      await api.patchTask(task.id, data);
      load();
      onChanged();
    } catch (e: any) {
      toast.error('Could not save', e?.message ?? 'Please try again.');
      load();
    } finally { setSaving(false); }
  };

  const addComment = async () => {
    const body = comment.trim();
    if (!body || !task) return;
    setComment('');
    try {
      await api.addTaskComment(task.id, body);
      load();
    } catch (e: any) {
      setComment(body);
      toast.error('Comment not posted', e?.message ?? 'Please try again.');
    }
  };

  const addSubtask = async () => {
    const t = newSubtask.trim();
    if (!t || !task) return;
    setNewSubtask('');
    try {
      await api.createTask({ parent_id: task.id, title: t });
      load(); onChanged();
    } catch (e: any) {
      toast.error('Could not add subtask', e?.message ?? 'Please try again.');
    }
  };

  const statuses: TaskStatus[] = task?.list_statuses ?? [];
  const doneStatus = statuses.find(s => s.type === 'done');
  const openStatus = statuses.find(s => s.type !== 'done');

  const toggleSubtask = async (st: Task) => {
    // A subtask lives on the same board, so it uses the same columns — flip
    // it between the board's done column and its first open one.
    const target = st.completed_at ? openStatus : doneStatus;
    if (!target) return;
    try {
      await api.patchTask(st.id, { status: target.id });
      load(); onChanged();
    } catch (e: any) {
      toast.error('Could not update subtask', e?.message ?? 'Please try again.');
    }
  };

  const remove = async () => {
    if (!task) return;
    const extra = subtasks.length ? ` and its ${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'}` : '';
    if (!window.confirm(`Delete "${task.title}"${extra}? This cannot be undone.`)) return;
    try {
      await api.deleteTask(task.id);
      toast.success('Task deleted');
      onChanged(); onClose();
    } catch (e: any) {
      toast.error('Could not delete', e?.message ?? 'Please try again.');
    }
  };

  const field = 'w-full px-2.5 py-1.5 rounded-lg border border-outline bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/30';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] rounded-xl-3 bg-surface border border-outline shadow-elev-4 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-5 py-3 border-b border-outline flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {task && (
              <p className="text-[11px] text-on-surface-subtle truncate">
                {task.project_name ? `${task.project_name} · ` : ''}{task.list_name}
              </p>
            )}
            <p className="text-[10px] text-on-surface-subtle font-mono">{taskId}</p>
          </div>
          {saving && <Loader2 size={14} className="animate-spin text-on-surface-subtle" />}
          {task && (
            <button onClick={remove} title="Delete task"
              className="p-1.5 rounded-lg text-danger/70 hover:text-danger hover:bg-danger/10"><Trash2 size={16} /></button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-on-surface-subtle hover:text-on-surface hover:bg-surface-2"><X size={18} /></button>
        </div>

        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-on-surface-muted">
            <Loader2 size={16} className="animate-spin" /> Loading task…
          </div>
        )}
        {err && <div className="p-5 text-sm text-danger">{err}</div>}

        {task && !loading && (
          <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
            {/* ── Left: title, description, subtasks, discussion ── */}
            <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-5">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={() => { if (title.trim() && title !== task.title) patch({ title }); else setTitle(task.title); }}
                className="w-full font-display text-xl font-bold text-on-surface bg-transparent border-b border-transparent hover:border-outline focus:border-accent focus:outline-none pb-1"
              />

              <div>
                <label className="block text-xs font-semibold text-on-surface-muted mb-1.5">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  onBlur={() => { if (description !== (task.description ?? '')) patch({ description: description || null }); }}
                  rows={4} placeholder="Add more detail…"
                  className={`${field} resize-y`}
                />
              </div>

              {/* Subtasks */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <GitBranch size={13} className="text-on-surface-muted" />
                  <span className="text-xs font-semibold text-on-surface-muted">
                    Subtasks {subtasks.length > 0 && `· ${subtasks.filter(s => s.completed_at).length}/${subtasks.length}`}
                  </span>
                </div>
                <div className="space-y-1">
                  {subtasks.map(st => (
                    <div key={st.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-2">
                      <button onClick={() => toggleSubtask(st)}
                        className={`w-4 h-4 rounded border flex-shrink-0 grid place-items-center ${st.completed_at ? 'bg-success border-success text-white' : 'border-outline-strong'}`}>
                        {st.completed_at && <Check size={10} strokeWidth={3} />}
                      </button>
                      <span className={`flex-1 text-sm ${st.completed_at ? 'line-through text-on-surface-subtle' : 'text-on-surface'}`}>
                        {st.title}
                      </span>
                      {st.assignee_name && (
                        <span className="text-[10px] text-on-surface-subtle">{st.assignee_name}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Plus size={13} className="text-on-surface-subtle flex-shrink-0" />
                  <input
                    value={newSubtask}
                    onChange={e => setNewSubtask(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
                    placeholder="Add a subtask and press Enter"
                    className="flex-1 px-2 py-1.5 rounded-lg border border-transparent hover:border-outline focus:border-accent bg-transparent text-sm focus:outline-none"
                  />
                </div>
              </div>

              {/* Comments / activity */}
              <div>
                <div className="flex items-center gap-3 border-b border-outline mb-3">
                  {([['comments', MessageSquare, `Comments${comments.length ? ` (${comments.length})` : ''}`],
                     ['activity', History, 'Activity']] as const).map(([id, Icon, label]) => (
                    <button key={id} onClick={() => setTab(id)}
                      className={`inline-flex items-center gap-1.5 pb-2 text-xs font-semibold border-b-2 -mb-px ${tab === id ? 'border-accent text-on-surface' : 'border-transparent text-on-surface-subtle hover:text-on-surface'}`}>
                      <Icon size={12} /> {label}
                    </button>
                  ))}
                </div>

                {tab === 'comments' ? (
                  <div className="space-y-3">
                    {comments.length === 0 && <p className="text-xs text-on-surface-subtle">No comments yet.</p>}
                    {comments.map(c => (
                      <div key={c.id} className="flex gap-2.5">
                        <span className="w-6 h-6 rounded-full bg-brand-container text-on-brand-container text-[9px] font-bold grid place-items-center flex-shrink-0">
                          {initials(c.author_name)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs">
                            <span className="font-semibold text-on-surface">{c.author_name ?? 'Someone'}</span>
                            <span className="text-on-surface-subtle ml-1.5">
                              {new Date(c.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </p>
                          <p className="text-sm text-on-surface whitespace-pre-wrap break-words">{c.body}</p>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-end gap-2 pt-1">
                      <textarea
                        value={comment} onChange={e => setComment(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addComment(); } }}
                        rows={2} placeholder="Write a comment… (⌘/Ctrl + Enter to post)"
                        className={`${field} resize-none`}
                      />
                      <button onClick={addComment} disabled={!comment.trim()}
                        className="p-2 rounded-lg bg-accent text-on-accent disabled:opacity-40 hover:opacity-90"><Send size={14} /></button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activity.length === 0 && <p className="text-xs text-on-surface-subtle">Nothing logged yet.</p>}
                    {activity.map(a => (
                      <p key={a.id} className="text-xs text-on-surface-muted">
                        <span className="font-semibold text-on-surface">{a.actor_name ?? 'Someone'}</span>{' '}
                        {a.kind === 'created' ? 'created this'
                          : a.kind === 'comment' ? 'commented'
                          : a.kind === 'status' ? <>moved it <b className="text-on-surface">{a.before_val}</b> → <b className="text-on-surface">{a.after_val}</b></>
                          : a.kind === 'assignee' ? <>reassigned it <b className="text-on-surface">{a.before_val}</b> → <b className="text-on-surface">{a.after_val}</b></>
                          : <>changed {a.field?.replace(/_/g, ' ')} to <b className="text-on-surface">{a.after_val || '—'}</b></>}
                        <span className="text-on-surface-subtle ml-1.5">
                          {new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Right: the properties rail ── */}
            <aside className="w-full md:w-64 flex-shrink-0 border-t md:border-t-0 md:border-l border-outline bg-surface-2 p-4 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-[11px] font-semibold text-on-surface-muted mb-1">Status</label>
                <select value={task.status} onChange={e => patch({ status: e.target.value })} className={field}>
                  {statuses.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-on-surface-muted mb-1">Assignee</label>
                <select value={task.assignee_id ?? ''} onChange={e => patch({ assignee_id: e.target.value || null })} className={field}>
                  <option value="">Unassigned</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-on-surface-muted mb-1">Priority</label>
                <select value={task.priority} onChange={e => patch({ priority: e.target.value as TaskPriority })} className={field}>
                  {TASK_PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                {task.priority !== 'none' && (
                  <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-on-surface-muted">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: PRIORITY_META[task.priority].color }} />
                    {PRIORITY_META[task.priority].label}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-on-surface-muted mb-1">Start date</label>
                <input type="date" value={task.start_date?.slice(0, 10) ?? ''}
                  onChange={e => patch({ start_date: e.target.value || null })} className={field} />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-on-surface-muted mb-1">Due date</label>
                <input type="date" value={task.due_date?.slice(0, 10) ?? ''}
                  onChange={e => patch({ due_date: e.target.value || null })} className={field} />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-on-surface-muted mb-1">Estimate (hours)</label>
                <input type="number" min="0" step="0.5" defaultValue={task.estimate_hours ?? ''}
                  onBlur={e => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    if (String(v ?? '') !== String(task.estimate_hours ?? '')) patch({ estimate_hours: v });
                  }}
                  className={field} />
              </div>

              <div className="pt-2 border-t border-outline text-[11px] text-on-surface-subtle space-y-0.5">
                <p>Created by {task.created_by_name ?? 'Unknown'}</p>
                <p>{new Date(task.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                {task.completed_at && (
                  <p className="text-success font-semibold">
                    Completed {new Date(task.completed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </p>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
