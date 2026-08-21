import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Loader2, Trash2, Send, Plus, MessageSquare, History, GitBranch, Check, Eye, EyeOff,
  Link2, Flag, Diamond, Play, Square, Clock, Repeat,
} from 'lucide-react';
import { api } from '../../services/api';
import type { Task, TaskActivity, TaskComment, TaskPriority, TaskStatus } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../Toaster';
import { TASK_PRIORITIES, PRIORITY_META, initials } from '../../lib/taskMeta';

type DepKind = 'blocks' | 'waiting_on' | 'related_to';
type DepEdge = { kind: DepKind; other_id: string; other_title: string; other_status: string; other_completed_at: string | null };
const DEP_LABEL: Record<DepKind, { out: string; in: string }> = {
  blocks:      { out: 'Blocked by',   in: 'Blocks' },
  waiting_on:  { out: 'Waiting on',   in: 'Waited on by' },
  related_to:  { out: 'Related to',   in: 'Related to' },
};

// Render a comment body with inline @[Name](emp_id) mentions expanded
// into brand-coloured chips. Everything else preserves whitespace so
// multi-line comments still read as written.
const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;
function renderCommentBody(body: string): (string | JSX.Element)[] {
  const nodes: (string | JSX.Element)[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(body)) !== null) {
    if (m.index > last) nodes.push(body.slice(last, m.index));
    nodes.push(
      <span key={`${m.index}-${m[2]}`} className="inline-flex items-baseline px-1.5 py-0.5 mx-0.5 rounded bg-accent/10 text-accent font-semibold text-[12.5px]">
        @{m[1]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) nodes.push(body.slice(last));
  return nodes;
}

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
  const { user } = useAuth();
  const myEmpId = user?.employee_id_ref ?? null;

  const [task, setTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [watchers, setWatchers] = useState<Array<{ employee_id: string; employee_name: string | null; avatar: string | null }>>([]);
  const [depsOut, setDepsOut] = useState<DepEdge[]>([]);
  const [depsIn, setDepsIn] = useState<DepEdge[]>([]);
  const [depPickerOpen, setDepPickerOpen] = useState<DepKind | null>(null);
  const [depQuery, setDepQuery] = useState('');
  const [depCandidates, setDepCandidates] = useState<any[]>([]);

  // Time tracking state — entries list + live-timer clock + manual form
  const [timeEntries, setTimeEntries] = useState<Awaited<ReturnType<typeof api.getTaskTime>>>([]);
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualHours, setManualHours] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [timerBusy, setTimerBusy] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');

  // Mention picker state — triggered when the caret sits just after an
  // unclosed `@…` in the composer. `mentionAnchor` is the character index
  // of the `@`; `mentionQuery` is what the user has typed since.
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionCursor, setMentionCursor] = useState(0);

  const mentionMatches = useMemo(() => {
    if (mentionAnchor == null) return [];
    const q = mentionQuery.toLowerCase();
    return employees
      .filter((e: any) => e.name && (!q || e.name.toLowerCase().includes(q) || (e.employee_id ?? '').toLowerCase().includes(q)))
      .slice(0, 6);
  }, [employees, mentionAnchor, mentionQuery]);

  const load = useCallback(() => {
    setLoading(true);
    api.getTask(taskId)
      .then(({ task: t, subtasks: st, comments: cs, activity: acts }) => {
        setTask(t); setSubtasks(st); setComments(cs); setActivity(acts);
        setTitle(t.title); setDescription(t.description ?? '');
      })
      .catch((e: any) => setErr(e?.message ?? 'Failed to load task'))
      .finally(() => setLoading(false));
    api.getTaskWatchers(taskId).then(setWatchers).catch(() => setWatchers([]));
    api.getTaskDependencies(taskId)
      .then(d => { setDepsOut(d.out); setDepsIn(d.in); })
      .catch(() => { setDepsOut([]); setDepsIn([]); });
    api.getTaskTime(taskId).then(setTimeEntries).catch(() => setTimeEntries([]));
  }, [taskId]);
  useEffect(load, [load]);

  // Live tick for the running-timer clock — only runs while there IS
  // an open timer belonging to the current user on this task, so an
  // idle drawer never re-renders.
  const openTimer = timeEntries.find(e => e.source === 'timer' && !e.stopped_at && e.employee_id === myEmpId);
  useEffect(() => {
    if (!openTimer) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [openTimer?.id]);

  const startTimer = async () => {
    if (timerBusy) return;
    setTimerBusy(true);
    try {
      await api.startTaskTimer(taskId);
      const fresh = await api.getTaskTime(taskId);
      setTimeEntries(fresh);
    } catch (e: any) { toast.error('Could not start timer', e?.message ?? 'Please try again.'); }
    finally { setTimerBusy(false); }
  };
  const stopTimer = async () => {
    if (timerBusy) return;
    setTimerBusy(true);
    try {
      await api.stopTaskTimer(taskId);
      const fresh = await api.getTaskTime(taskId);
      setTimeEntries(fresh);
      load();
    } catch (e: any) { toast.error('Could not stop timer', e?.message ?? 'Please try again.'); }
    finally { setTimerBusy(false); }
  };
  const addManualTime = async () => {
    const hrs = Number(manualHours);
    if (!Number.isFinite(hrs) || hrs <= 0) { toast.error('Hours required', 'Enter a positive number.'); return; }
    try {
      await api.addTaskTime(taskId, { log_date: manualDate, hours: hrs, notes: manualNote.trim() || undefined });
      setManualHours(''); setManualNote('');
      const fresh = await api.getTaskTime(taskId);
      setTimeEntries(fresh);
      load();
    } catch (e: any) { toast.error('Could not save', e?.message ?? 'Please try again.'); }
  };
  const removeTime = async (entryId: string) => {
    if (!window.confirm('Delete this time entry?')) return;
    try {
      await api.deleteTaskTime(entryId);
      setTimeEntries(prev => prev.filter(e => e.id !== entryId));
      load();
    } catch (e: any) { toast.error('Could not delete', e?.message ?? 'Please try again.'); }
  };

  const totalLoggedH = Number(task?.logged_hours ?? 0);
  const runningHours = openTimer ? (nowTick - new Date(openTimer.started_at!).getTime()) / 3_600_000 : 0;
  const totalWithRunningH = totalLoggedH + runningHours;
  const fmtDuration = (h: number) => {
    const totalSec = Math.max(0, Math.round(h * 3600));
    const H = Math.floor(totalSec / 3600);
    const M = Math.floor((totalSec % 3600) / 60);
    const S = totalSec % 60;
    return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}:${String(S).padStart(2, '0')}`;
  };

  // Dep-picker search: fetch matching tasks whenever the picker is
  // open and the query changes. Cheap search endpoint already exists
  // via listTasks(q). Excludes self + tasks already linked so the
  // picker never shows a duplicate row.
  useEffect(() => {
    if (!depPickerOpen) { setDepCandidates([]); return; }
    const q = depQuery.trim();
    let cancelled = false;
    const alreadyLinked = new Set([...depsOut, ...depsIn].map(d => d.other_id));
    alreadyLinked.add(taskId);
    api.listTasks({ q: q || undefined, include_subtasks: true }).then((rows: any[]) => {
      if (cancelled) return;
      setDepCandidates(rows.filter(r => !alreadyLinked.has(r.id)).slice(0, 8));
    }).catch(() => setDepCandidates([]));
    return () => { cancelled = true; };
  }, [depPickerOpen, depQuery, depsOut, depsIn, taskId]);

  const addDep = async (otherId: string, kind: DepKind) => {
    try {
      await api.addTaskDependency(taskId, otherId, kind);
      const d = await api.getTaskDependencies(taskId);
      setDepsOut(d.out); setDepsIn(d.in);
      setDepPickerOpen(null); setDepQuery('');
    } catch (e: any) {
      toast.error('Could not link', e?.message ?? 'Please try again.');
    }
  };
  const removeDep = async (otherId: string, kind: DepKind, direction: 'out' | 'in') => {
    try {
      // Direction determines which side of the edge the DELETE targets:
      // an outgoing "blocked_by" edge = task_id is US → out call uses (us, other).
      // an incoming edge = task_id is OTHER → we need to call remove(other, us, kind).
      if (direction === 'out') await api.removeTaskDependency(taskId, otherId, kind);
      else                     await api.removeTaskDependency(otherId, taskId, kind);
      const d = await api.getTaskDependencies(taskId);
      setDepsOut(d.out); setDepsIn(d.in);
    } catch (e: any) {
      toast.error('Could not unlink', e?.message ?? 'Please try again.');
    }
  };

  // Task is blocked if any outgoing 'blocks' edge points to an
  // uncompleted task. Read straight off the deps arrays.
  const blockedByOpen = depsOut.filter(d => d.kind === 'blocks' && !d.other_completed_at);

  const isWatching = myEmpId ? watchers.some(w => w.employee_id === myEmpId) : false;
  const toggleWatch = async () => {
    if (!myEmpId || watchBusy) return;
    setWatchBusy(true);
    try {
      if (isWatching) {
        await api.removeTaskWatcher(taskId, myEmpId);
        setWatchers(prev => prev.filter(w => w.employee_id !== myEmpId));
      } else {
        await api.addTaskWatcher(taskId);
        api.getTaskWatchers(taskId).then(setWatchers).catch(() => {});
      }
    } catch (e: any) {
      toast.error('Could not update watch', e?.message ?? 'Please try again.');
    } finally { setWatchBusy(false); }
  };

  // Detect a mention trigger: look backwards from the caret for the
  // nearest `@` that isn't preceded by an alphanumeric (so "email@x"
  // doesn't fire). If the run since that `@` has no whitespace, we're
  // in a live mention.
  const onCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setComment(val);
    const caret = e.target.selectionStart ?? val.length;
    let i = caret - 1;
    while (i >= 0) {
      const ch = val[i];
      if (ch === '@') {
        const prev = i === 0 ? '' : val[i - 1];
        if (/[A-Za-z0-9_]/.test(prev)) { setMentionAnchor(null); return; }
        setMentionAnchor(i);
        setMentionQuery(val.slice(i + 1, caret));
        setMentionCursor(0);
        return;
      }
      if (/\s/.test(ch)) break;
      i--;
    }
    setMentionAnchor(null);
  };

  const pickMention = (emp: any) => {
    if (mentionAnchor == null || !composerRef.current) return;
    const caret = composerRef.current.selectionStart ?? comment.length;
    const before = comment.slice(0, mentionAnchor);
    const after = comment.slice(caret);
    const insert = `@[${emp.name}](${emp.id}) `;
    const next = before + insert + after;
    setComment(next);
    setMentionAnchor(null);
    setMentionQuery('');
    // Restore caret just after the inserted mention.
    requestAnimationFrame(() => {
      const pos = (before + insert).length;
      composerRef.current?.setSelectionRange(pos, pos);
      composerRef.current?.focus();
    });
  };

  const onCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionAnchor != null && mentionMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionCursor(c => Math.min(c + 1, mentionMatches.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionCursor(c => Math.max(c - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionMatches[mentionCursor]); return; }
      if (e.key === 'Escape') { setMentionAnchor(null); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addComment();
    }
  };

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

              {/* Dependencies */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Link2 size={13} className="text-on-surface-muted" />
                  <span className="text-xs font-semibold text-on-surface-muted">Dependencies</span>
                  {blockedByOpen.length > 0 && (
                    <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-danger/10 text-danger">
                      Blocked · {blockedByOpen.length}
                    </span>
                  )}
                </div>

                {(['blocks', 'waiting_on', 'related_to'] as DepKind[]).map(kind => {
                  const outs = depsOut.filter(d => d.kind === kind);
                  const ins  = depsIn .filter(d => d.kind === kind);
                  if (!outs.length && !ins.length && depPickerOpen !== kind) return null;
                  return (
                    <div key={kind} className="mb-2">
                      {outs.length > 0 && (
                        <>
                          <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle font-semibold mt-1 mb-1">{DEP_LABEL[kind].out}</p>
                          <div className="space-y-1">
                            {outs.map(d => <DepRow key={`${kind}-out-${d.other_id}`} edge={d} onRemove={() => removeDep(d.other_id, kind, 'out')} />)}
                          </div>
                        </>
                      )}
                      {ins.length > 0 && (
                        <>
                          <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle font-semibold mt-2 mb-1">{DEP_LABEL[kind].in}</p>
                          <div className="space-y-1">
                            {ins.map(d => <DepRow key={`${kind}-in-${d.other_id}`} edge={d} onRemove={() => removeDep(d.other_id, kind, 'in')} />)}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {depPickerOpen && (
                  <div className="relative mt-2">
                    <input autoFocus value={depQuery} onChange={e => setDepQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { setDepPickerOpen(null); setDepQuery(''); } }}
                      placeholder={`Search tasks to link as "${DEP_LABEL[depPickerOpen].out.toLowerCase()}"…`}
                      className={`${field} pr-8`} />
                    <button onClick={() => { setDepPickerOpen(null); setDepQuery(''); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-subtle hover:text-on-surface"><X size={13} /></button>
                    {depCandidates.length > 0 && (
                      <div className="absolute z-10 top-full mt-1 left-0 right-0 max-h-60 overflow-y-auto rounded-lg border border-outline bg-surface shadow-elev-3 py-1">
                        {depCandidates.map((c: any) => (
                          <button key={c.id} onMouseDown={(e) => { e.preventDefault(); addDep(c.id, depPickerOpen); }}
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2">
                            <div className="text-on-surface font-medium truncate">{c.title}</div>
                            <div className="text-[10px] text-on-surface-subtle">{c.project_name ? `${c.project_name} · ` : ''}{c.list_name}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {(['blocks', 'waiting_on', 'related_to'] as DepKind[]).map(k => (
                    <button key={k} onClick={() => { setDepPickerOpen(k); setDepQuery(''); }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-dashed border-outline text-[10px] font-semibold text-on-surface-muted hover:text-on-surface hover:bg-surface-2">
                      <Plus size={10} /> {DEP_LABEL[k].out.toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time tracking */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Clock size={13} className="text-on-surface-muted" />
                  <span className="text-xs font-semibold text-on-surface-muted">Time</span>
                  <span className="ml-auto text-[11px] font-mono text-on-surface-muted">
                    {totalWithRunningH.toFixed(2)}h logged
                    {task.estimate_hours ? <> · est {task.estimate_hours}h</> : null}
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  {openTimer ? (
                    <button onClick={stopTimer} disabled={timerBusy}
                      className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-semibold bg-danger-container/40 border border-danger/40 text-danger hover:bg-danger-container/60 disabled:opacity-60">
                      <Square size={12} className="fill-current" />
                      <span className="hidden sm:inline">Stop</span>
                      <span className="font-mono tabular-nums text-[12px] px-1.5 py-0.5 rounded bg-danger/10 border border-danger/30">
                        {fmtDuration(runningHours)}
                      </span>
                    </button>
                  ) : (
                    <button onClick={startTimer} disabled={timerBusy || !myEmpId}
                      title={!myEmpId ? 'You have no linked employee record.' : 'Start a timer on this task'}
                      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold bg-success-container/40 border border-success/40 text-success hover:bg-success-container/60 disabled:opacity-60">
                      <Play size={12} className="fill-current" /> Start timer
                    </button>
                  )}
                  <div className="flex items-center gap-1.5 ml-auto">
                    <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                      className="px-2 py-1.5 rounded-lg border border-outline bg-surface text-xs" />
                    <input type="number" min="0" step="0.25" placeholder="Hrs" value={manualHours}
                      onChange={e => setManualHours(e.target.value)}
                      className="w-16 px-2 py-1.5 rounded-lg border border-outline bg-surface text-xs font-mono" />
                    <input value={manualNote} onChange={e => setManualNote(e.target.value)}
                      placeholder="Note (optional)"
                      className="w-36 px-2 py-1.5 rounded-lg border border-outline bg-surface text-xs" />
                    <button onClick={addManualTime}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">
                      <Plus size={11} /> Log
                    </button>
                  </div>
                </div>

                {timeEntries.length === 0 ? (
                  <p className="text-[11px] text-on-surface-subtle italic">No time logged yet.</p>
                ) : (
                  <div className="border border-outline rounded-lg overflow-hidden">
                    {timeEntries.slice(0, 8).map(e => {
                      const isOpen = e.source === 'timer' && !e.stopped_at;
                      const canDelete = e.employee_id === myEmpId || e.created_by_id === user?.id
                        || ['admin', 'hr_manager', 'project_coordinator'].includes(user?.role ?? '');
                      return (
                        <div key={e.id} className="group grid grid-cols-[70px_1fr_60px_50px_16px] items-center gap-2 px-2.5 py-1.5 text-xs border-b border-outline last:border-b-0 hover:bg-surface-2">
                          <span className="font-mono text-[11px] text-on-surface-muted">
                            {new Date(e.log_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </span>
                          <span className="truncate text-on-surface">
                            <span className="font-medium">{e.employee_name?.split(' ')[0] ?? '—'}</span>
                            {e.notes && <span className="text-on-surface-subtle"> · {e.notes}</span>}
                          </span>
                          <span className="font-mono text-[11px] text-on-surface tabular-nums text-right">
                            {isOpen
                              ? <span className="text-danger font-semibold">running…</span>
                              : `${Number(e.hours).toFixed(2)}h`}
                          </span>
                          <span className={`text-[9px] font-semibold uppercase tracking-wider text-center px-1 py-0.5 rounded ${e.source === 'timer' ? 'bg-brand-container text-on-brand-container' : 'bg-surface-2 text-on-surface-muted'}`}>
                            {e.source === 'timer' ? 'timer' : 'manual'}
                          </span>
                          {canDelete && !isOpen ? (
                            <button onClick={() => removeTime(e.id)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-on-surface-subtle hover:text-danger hover:bg-danger/10 transition">
                              <X size={11} />
                            </button>
                          ) : <span />}
                        </div>
                      );
                    })}
                    {timeEntries.length > 8 && (
                      <div className="px-2.5 py-1 text-[10px] text-on-surface-subtle bg-surface-2 border-t border-outline">
                        + {timeEntries.length - 8} older entries
                      </div>
                    )}
                  </div>
                )}
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
                          <p className="text-sm text-on-surface whitespace-pre-wrap break-words">{renderCommentBody(c.body)}</p>
                        </div>
                      </div>
                    ))}
                    <div className="relative">
                      <div className="flex items-end gap-2 pt-1">
                        <textarea
                          ref={composerRef}
                          value={comment}
                          onChange={onCommentChange}
                          onKeyDown={onCommentKeyDown}
                          rows={2} placeholder="Write a comment… type @ to mention · ⌘/Ctrl + Enter to post"
                          className={`${field} resize-none`}
                        />
                        <button onClick={addComment} disabled={!comment.trim()}
                          className="p-2 rounded-lg bg-accent text-on-accent disabled:opacity-40 hover:opacity-90"><Send size={14} /></button>
                      </div>
                      {mentionAnchor != null && mentionMatches.length > 0 && (
                        <div className="absolute z-10 left-0 bottom-full mb-1 w-64 max-h-56 overflow-y-auto rounded-lg border border-outline bg-surface shadow-elev-3 py-1">
                          {mentionMatches.map((emp: any, i: number) => (
                            <button key={emp.id}
                              onMouseDown={(e) => { e.preventDefault(); pickMention(emp); }}
                              onMouseEnter={() => setMentionCursor(i)}
                              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm ${i === mentionCursor ? 'bg-accent/10 text-accent' : 'text-on-surface hover:bg-surface-2'}`}>
                              <span className="w-5 h-5 rounded-full bg-brand-container text-on-brand-container text-[9px] font-bold grid place-items-center flex-shrink-0">
                                {initials(emp.name)}
                              </span>
                              <span className="flex-1 min-w-0 truncate">{emp.name}</span>
                              <span className="text-[10px] text-on-surface-subtle font-mono">{emp.employee_id}</span>
                            </button>
                          ))}
                        </div>
                      )}
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

              <button onClick={() => patch({ is_milestone: !task.is_milestone })}
                className={`inline-flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-semibold border ${task.is_milestone ? 'bg-accent/10 text-accent border-accent/30' : 'bg-surface text-on-surface-muted border-outline hover:bg-surface-2'}`}
                title="Milestones mark a headline delivery on the calendar + timeline.">
                <Diamond size={11} className={task.is_milestone ? 'fill-current' : ''} />
                {task.is_milestone ? 'This is a milestone' : 'Mark as milestone'}
              </button>

              <RecurrencePicker
                value={(task.recurrence as any) ?? null}
                dueDate={task.due_date}
                parentId={task.parent_id}
                onChange={rule => patch({ recurrence: rule })}
              />
              {!task.parent_id && task.recurrence && (
                <p className="text-[10px] text-on-surface-subtle -mt-1 leading-snug">
                  When you mark this Done, the next occurrence will be auto-created
                  {task.due_date ? '' : ' — add a due date so the next date can be computed'}.
                </p>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold text-on-surface-muted">Watchers {watchers.length > 0 && <span className="font-mono text-on-surface-subtle">· {watchers.length}</span>}</label>
                  {myEmpId && (
                    <button onClick={toggleWatch} disabled={watchBusy}
                      title={isWatching ? "You'll stop getting notifications for this task" : "Get notified about comments and mentions"}
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded border ${isWatching ? 'border-accent/40 text-accent bg-accent/5 hover:bg-accent/10' : 'border-outline text-on-surface-muted hover:bg-surface hover:text-on-surface'} disabled:opacity-50`}>
                      {isWatching ? <><EyeOff size={11} /> Unwatch</> : <><Eye size={11} /> Watch</>}
                    </button>
                  )}
                </div>
                {watchers.length === 0 ? (
                  <p className="text-[11px] text-on-surface-subtle italic">No watchers yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {watchers.map(w => (
                      <span key={w.employee_id}
                        title={w.employee_name ?? 'Unknown'}
                        className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full bg-surface border border-outline text-[11px]">
                        <span className="w-4 h-4 rounded-full bg-brand-container text-on-brand-container text-[8px] font-bold grid place-items-center">
                          {initials(w.employee_name ?? '')}
                        </span>
                        <span className="truncate max-w-[100px]">{w.employee_name?.split(' ')[0] ?? '—'}</span>
                      </span>
                    ))}
                  </div>
                )}
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

function DepRow({ edge, onRemove }: { edge: DepEdge; onRemove: () => void }) {
  const done = !!edge.other_completed_at;
  return (
    <div className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg border ${done ? 'border-outline bg-surface-2 text-on-surface-subtle' : 'border-outline bg-surface text-on-surface'}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${done ? 'bg-success' : 'bg-danger/70'}`} />
      <span className={`flex-1 min-w-0 truncate text-sm ${done ? 'line-through' : ''}`}>{edge.other_title}</span>
      {done ? (
        <span className="text-[10px] font-semibold text-success uppercase tracking-wider">Done</span>
      ) : (
        <span className="text-[10px] font-mono text-on-surface-subtle">{edge.other_status}</span>
      )}
      <button onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-on-surface-subtle hover:text-danger hover:bg-danger/10 transition"
        title="Unlink"><X size={11} /></button>
    </div>
  );
}

// Recurrence picker in the drawer's right rail. Sub-tasks (parent_id
// set) can't recur — the whole model spawns off the top-level task.
type RecurrenceRule = { kind: 'daily' | 'weekly' | 'monthly'; interval: number; dow?: number; dom?: number } | null;
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function summariseRecurrence(r: NonNullable<RecurrenceRule>): string {
  const every = r.interval > 1 ? `every ${r.interval} ` : 'every ';
  if (r.kind === 'daily')   return `${every}day${r.interval > 1 ? 's' : ''}`;
  if (r.kind === 'weekly')  return `${every}week${r.interval > 1 ? 's' : ''}${Number.isInteger(r.dow) ? ` on ${WEEKDAYS[r.dow!]}` : ''}`;
  return `${every}month${r.interval > 1 ? 's' : ''}${Number.isInteger(r.dom) ? ` on the ${r.dom}${suffix(r.dom!)}` : ''}`;
}
function suffix(n: number): string {
  const s = ['th','st','nd','rd']; const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
function RecurrencePicker({ value, dueDate, parentId, onChange }: {
  value: RecurrenceRule; dueDate: string | null; parentId: string | null; onChange: (v: RecurrenceRule) => void;
}) {
  const [open, setOpen] = useState(false);
  if (parentId) {
    return (
      <div className="text-[11px] text-on-surface-subtle italic border border-dashed border-outline rounded-lg px-2 py-1.5">
        Sub-tasks can't recur — put the rule on the parent task.
      </div>
    );
  }
  if (!value && !open) {
    return (
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-semibold border bg-surface text-on-surface-muted border-outline hover:bg-surface-2">
        <Repeat size={11} /> Make recurring
      </button>
    );
  }
  const current: NonNullable<RecurrenceRule> = value ?? { kind: 'weekly', interval: 1, dow: dueDate ? new Date(dueDate).getDay() : new Date().getDay() };
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Repeat size={11} className="text-accent" />
        <span className="text-[11px] font-semibold text-accent">{value ? summariseRecurrence(value) : 'Configure recurrence'}</span>
        {value && (
          <button onClick={() => { onChange(null); setOpen(false); }} title="Remove recurrence"
            className="ml-auto p-1 rounded text-on-surface-subtle hover:text-danger hover:bg-danger/10"><X size={11} /></button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {(['daily','weekly','monthly'] as const).map(k => (
          <button key={k} onClick={() => onChange({ ...current, kind: k, interval: current.interval || 1 })}
            className={`text-[11px] font-semibold py-1 rounded ${current.kind === k ? 'bg-accent text-on-accent' : 'bg-surface text-on-surface-muted border border-outline hover:bg-surface-2'}`}>
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-on-surface-muted">every</span>
        <input type="number" min="1" max="365" value={current.interval}
          onChange={e => onChange({ ...current, interval: Math.max(1, Number(e.target.value) || 1) })}
          className="w-14 px-1.5 py-1 rounded border border-outline bg-surface text-xs font-mono text-right" />
        <span className="text-[11px] text-on-surface-muted">{current.kind === 'daily' ? 'days' : current.kind === 'weekly' ? 'weeks' : 'months'}</span>
      </div>
      {current.kind === 'weekly' && (
        <div className="flex flex-wrap gap-1">
          {WEEKDAYS.map((d, i) => (
            <button key={d} onClick={() => onChange({ ...current, dow: i })}
              className={`text-[10px] font-semibold px-1.5 py-1 rounded ${current.dow === i ? 'bg-accent text-on-accent' : 'bg-surface text-on-surface-muted border border-outline hover:bg-surface-2'}`}>
              {d}
            </button>
          ))}
        </div>
      )}
      {current.kind === 'monthly' && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-on-surface-muted">on day</span>
          <input type="number" min="1" max="31" value={current.dom ?? ''}
            placeholder={dueDate ? String(new Date(dueDate).getDate()) : '1'}
            onChange={e => onChange({ ...current, dom: Number(e.target.value) || 1 })}
            className="w-16 px-1.5 py-1 rounded border border-outline bg-surface text-xs font-mono text-right" />
          <span className="text-[10px] text-on-surface-subtle italic">(clamped to last day for short months)</span>
        </div>
      )}
      {!value && (
        <div className="flex justify-end gap-1.5 pt-1 border-t border-outline">
          <button onClick={() => setOpen(false)} className="px-2 py-1 rounded text-[11px] text-on-surface-muted hover:bg-surface">Cancel</button>
          <button onClick={() => { onChange(current); setOpen(false); }} className="px-2 py-1 rounded bg-accent text-on-accent text-[11px] font-semibold hover:opacity-90">Save</button>
        </div>
      )}
    </div>
  );
}
