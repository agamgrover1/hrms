import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  KanbanSquare, Plus, Search, Loader2, LayoutList, Columns3, Inbox,
  MessageSquare, GitBranch, Archive, X, Briefcase, ChevronDown,
} from 'lucide-react';
import { api } from '../services/api';
import type { Task, TaskBoard } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toaster';
import TaskDetailModal from '../components/tasks/TaskDetailModal';
import {
  PRIORITY_META, DEFAULT_STATUSES, dueMeta, DUE_TONE_CLASS, midpoint, initials, todayISO, defaultBoardParams } from '../lib/taskMeta';

// Tasks — ClickUp-style boards layered on top of the projects the agency
// already runs. A board ("list") hangs off a project, or stands alone for
// internal work. Columns come from the board's own statuses, so a team can
// shape its workflow without a schema change.
//
// This module is additive: it reads `projects` for names and writes only to
// the task_* tables. Nothing in HR, attendance, payroll or hours is touched.

const MANAGER_ROLES = ['admin', 'hr_manager', 'project_coordinator'];

type View = 'board' | 'list';

export default function Tasks() {
  const { user } = useAuth();
  const canManageBoards = MANAGER_ROLES.includes(user?.role ?? '');

  const [params, setParams] = useSearchParams();
  const [boards, setBoards] = useState<TaskBoard[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState<View>('board');
  const [search, setSearch] = useState('');
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // `?board=` and `?task=` live in the URL so a board is bookmarkable and a
  // "task assigned to you" notification can deep-link straight to the card.
  const boardParam = params.get('board');
  const openTaskId = params.get('task');
  const isMine = boardParam === 'mine';

  const setBoardParam = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('board', id); else next.delete('board');
    next.delete('task');
    setParams(next, { replace: true });
  };
  const setOpenTask = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('task', id); else next.delete('task');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    Promise.all([
      api.listTaskBoards().catch(() => [] as TaskBoard[]),
      api.getEmployees().catch(() => [] as any[]),
    ])
      .then(([bs, emps]) => {
        setBoards(bs);
        setEmployees((emps as any[]).filter(e => e.status === 'active'));
      })
      .catch((e: any) => setErr(e?.message ?? 'Failed to load boards'))
      .finally(() => setLoading(false));
  }, []);

  // Default the selection once boards arrive. Someone who runs boards wants
  // to land on one; everyone else opens Tasks to see what's on their plate,
  // so they land on My tasks. Keeping the default here (rather than in a
  // `?board=mine` sidebar link) means the nav link stays a plain /tasks and
  // still highlights as the active route.
  useEffect(() => {
    if (loading || boardParam) return;
    // Set the param inline rather than via setBoardParam: that helper means
    // "the user switched board", so it clears ?task= on purpose. This is
    // first-paint defaulting, and a `/tasks?task=…` notification deep-link
    // arrives with no ?board= — routing it through setBoardParam wiped the
    // task id before the modal could open it.
    setParams(defaultBoardParams(params, canManageBoards && boards.length ? boards[0].id : 'mine'), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, boards, boardParam, canManageBoards]);

  const activeBoard = useMemo(
    () => boards.find(b => b.id === boardParam) ?? null,
    [boards, boardParam],
  );

  const loadTasks = useCallback(() => {
    if (!boardParam) return;
    setTasksLoading(true);
    const req = isMine ? api.listTasks({ mine: true }) : api.listTasks({ list_id: boardParam });
    req
      .then(setTasks)
      .catch((e: any) => setErr(e?.message ?? 'Failed to load tasks'))
      .finally(() => setTasksLoading(false));
  }, [boardParam, isMine]);
  useEffect(loadTasks, [loadTasks]);

  // My tasks spans boards, so its columns would be meaningless — it always
  // renders as a list grouped by urgency instead.
  const effectiveView: View = isMine ? 'list' : view;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(t =>
      t.title.toLowerCase().includes(q)
      || (t.description ?? '').toLowerCase().includes(q)
      || (t.assignee_name ?? '').toLowerCase().includes(q));
  }, [tasks, search]);

  const statuses = activeBoard?.statuses?.length ? activeBoard.statuses : DEFAULT_STATUSES;

  const byStatus = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const s of statuses) map[s.id] = [];
    for (const t of filtered) (map[t.status] ??= []).push(t);
    return map;
  }, [filtered, statuses]);

  // Boards grouped by the project they belong to, for the left rail.
  const boardGroups = useMemo(() => {
    const groups = new Map<string, TaskBoard[]>();
    for (const b of boards) {
      const key = b.project_name ?? 'Internal';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(b);
    }
    return Array.from(groups.entries()).sort((a, b) =>
      a[0] === 'Internal' ? 1 : b[0] === 'Internal' ? -1 : a[0].localeCompare(b[0]));
  }, [boards]);

  // ── Drag to another column ─────────────────────────────────────────────
  const onDropTo = async (statusId: string) => {
    const id = dragging;
    setDragging(null); setDragOverCol(null);
    if (!id) return;
    const card = tasks.find(t => t.id === id);
    if (!card || card.status === statusId) return;
    const col = statuses.find(s => s.id === statusId);
    const last = byStatus[statusId]?.[byStatus[statusId].length - 1] ?? null;
    const sort = midpoint(last ? Number(last.sort_order) : null, null);
    const prev = tasks;
    // Optimistic — flip the card now, roll the whole list back on failure.
    setTasks(ts => ts.map(t => t.id === id
      ? { ...t, status: statusId, sort_order: sort, completed_at: col?.type === 'done' ? new Date().toISOString() : null }
      : t));
    try {
      await api.patchTask(id, { status: statusId, sort_order: sort });
    } catch (e: any) {
      setTasks(prev);
      toast.error('Could not move task', e?.message ?? 'Please try again.');
    }
  };

  const quickAdd = async (statusId: string, title: string) => {
    if (!activeBoard || !title.trim()) return;
    try {
      const created = await api.createTask({ list_id: activeBoard.id, title: title.trim(), status: statusId });
      setTasks(ts => [...ts, created]);
    } catch (e: any) {
      toast.error('Could not add task', e?.message ?? 'Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-on-surface-muted">
        <Loader2 size={16} className="animate-spin" /> Loading boards…
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2">
            <KanbanSquare className="text-accent" size={22} />
            <h1 className="font-display text-2xl font-bold text-on-surface">Tasks</h1>
          </div>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Boards for the work inside each project · drag cards between columns · click a card for detail, comments and subtasks.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search tasks…"
              className="w-56 pl-8 pr-3 py-2 rounded-lg border border-outline bg-surface text-sm placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          {!isMine && (
            <div className="inline-flex rounded-lg border border-outline overflow-hidden">
              <button onClick={() => setView('board')}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${view === 'board' ? 'bg-accent text-on-accent' : 'text-on-surface hover:bg-surface-2'}`}>
                <Columns3 size={14} /> Board
              </button>
              <button onClick={() => setView('list')}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${view === 'list' ? 'bg-accent text-on-accent' : 'text-on-surface hover:bg-surface-2'}`}>
                <LayoutList size={14} /> List
              </button>
            </div>
          )}
          {canManageBoards && (
            <button onClick={() => setShowNewBoard(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
              <Plus size={14} /> New board
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger flex items-center justify-between">
          <span>{err}</span>
          <button onClick={() => setErr('')} className="text-danger/70 hover:text-danger"><X size={14} /></button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex gap-4">
        {/* ── Left rail: My tasks + boards by project ── */}
        <aside className="w-60 flex-shrink-0 overflow-y-auto rounded-xl-2 border border-outline bg-surface p-2">
          <button onClick={() => setBoardParam('mine')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold mb-2 ${isMine ? 'bg-accent-container text-on-accent-container' : 'text-on-surface hover:bg-surface-2'}`}>
            <Inbox size={15} /> My tasks
          </button>

          {boardGroups.length === 0 && (
            <p className="px-3 py-6 text-xs text-on-surface-subtle text-center">
              No boards yet.{canManageBoards ? ' Create one to get started.' : ' Ask a coordinator to create one.'}
            </p>
          )}

          {boardGroups.map(([project, list]) => (
            <div key={project} className="mb-3">
              <div className="px-3 py-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-subtle">
                <Briefcase size={10} /> {project}
              </div>
              {list.map(b => {
                const total = b.task_count ?? 0;
                const done = b.done_count ?? 0;
                return (
                  <button key={b.id} onClick={() => setBoardParam(b.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left ${b.id === boardParam ? 'bg-accent-container text-on-accent-container font-semibold' : 'text-on-surface hover:bg-surface-2'}`}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: b.color ?? '#94a3b8' }} />
                    <span className="flex-1 truncate">{b.name}</span>
                    <span className="text-[10px] text-on-surface-subtle tabular-nums flex-shrink-0">{done}/{total}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* ── Main pane ── */}
        <section className="flex-1 min-w-0 flex flex-col">
          {tasksLoading && (
            <div className="mb-2 text-xs text-on-surface-subtle inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          )}

          {isMine
            ? <MyTasksList tasks={filtered} onOpen={setOpenTask} />
            : !activeBoard
              ? <EmptyPane label="Select a board on the left." />
              : effectiveView === 'board'
                ? (
                  <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto pb-2">
                    {statuses.map(s => (
                      <BoardColumn
                        key={s.id}
                        status={s}
                        tasks={byStatus[s.id] ?? []}
                        isDragOver={dragOverCol === s.id}
                        onDragOver={() => setDragOverCol(s.id)}
                        onDragLeave={() => setDragOverCol(c => (c === s.id ? null : c))}
                        onDrop={() => onDropTo(s.id)}
                        onDragStartCard={setDragging}
                        onOpen={setOpenTask}
                        onQuickAdd={(title) => quickAdd(s.id, title)}
                      />
                    ))}
                  </div>
                )
                : <BoardListView statuses={statuses} byStatus={byStatus} onOpen={setOpenTask} />}
        </section>
      </div>

      {openTaskId && (
        <TaskDetailModal
          taskId={openTaskId}
          employees={employees}
          onClose={() => setOpenTask(null)}
          onChanged={loadTasks}
        />
      )}

      {showNewBoard && (
        <NewBoardModal
          onClose={() => setShowNewBoard(false)}
          onCreated={(b) => { setBoards(bs => [...bs, b]); setShowNewBoard(false); setBoardParam(b.id); }}
        />
      )}
    </div>
  );
}

function EmptyPane({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-on-surface-subtle">{label}</div>
  );
}

// ── Board column ─────────────────────────────────────────────────────────

function BoardColumn({
  status, tasks, isDragOver, onDragOver, onDragLeave, onDrop, onDragStartCard, onOpen, onQuickAdd,
}: {
  status: { id: string; label: string; color: string; type: string };
  tasks: Task[];
  isDragOver: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragStartCard: (id: string) => void;
  onOpen: (id: string) => void;
  onQuickAdd: (title: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    if (draft.trim()) onQuickAdd(draft);
    setDraft(''); setAdding(false);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      className={`w-72 flex-shrink-0 flex flex-col rounded-xl-2 border bg-surface ${isDragOver ? 'border-accent' : 'border-outline'}`}
    >
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-outline">
        <span className="w-2 h-2 rounded-full" style={{ background: status.color }} />
        <span className="text-sm font-semibold text-on-surface">{status.label}</span>
        <span className="ml-auto text-[11px] text-on-surface-subtle tabular-nums">{tasks.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {tasks.map(t => (
          <TaskCard key={t.id} task={t} onDragStart={() => onDragStartCard(t.id)} onOpen={() => onOpen(t.id)} />
        ))}

        {adding ? (
          <textarea
            autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setDraft(''); setAdding(false); }
            }}
            rows={2} placeholder="Task title — Enter to save, Esc to cancel"
            className="w-full px-2.5 py-2 rounded-lg border border-accent bg-surface text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        ) : (
          <button onClick={() => setAdding(true)}
            className="w-full inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-on-surface-muted hover:bg-surface-2">
            <Plus size={12} /> Add task
          </button>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, onDragStart, onOpen }: { task: Task; onDragStart: () => void; onOpen: () => void }) {
  const prio = PRIORITY_META[task.priority];
  const due = dueMeta(task.due_date, !!task.completed_at);
  return (
    <div
      draggable onDragStart={onDragStart} onClick={onOpen}
      className="rounded-lg border border-outline bg-surface-2 p-2.5 cursor-pointer hover:border-outline-strong hover:shadow-elev-1 transition"
    >
      <div className="flex items-start gap-2">
        {task.priority !== 'none' && (
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: prio.color }} title={`${prio.label} priority`} />
        )}
        <p className={`text-sm leading-snug text-on-surface ${task.completed_at ? 'line-through text-on-surface-subtle' : ''}`}>
          {task.title}
        </p>
      </div>

      {(due || task.assignee_name || (task.subtask_count ?? 0) > 0 || (task.comment_count ?? 0) > 0) && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {due && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${DUE_TONE_CLASS[due.tone]}`}>{due.label}</span>
          )}
          {(task.subtask_count ?? 0) > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-on-surface-subtle">
              <GitBranch size={10} /> {task.subtask_done_count ?? 0}/{task.subtask_count}
            </span>
          )}
          {(task.comment_count ?? 0) > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-on-surface-subtle">
              <MessageSquare size={10} /> {task.comment_count}
            </span>
          )}
          {task.assignee_name && (
            <span className="ml-auto w-5 h-5 rounded-full bg-brand-container text-on-brand-container text-[9px] font-bold grid place-items-center"
              title={task.assignee_name}>
              {initials(task.assignee_name)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── List view of one board ───────────────────────────────────────────────

function BoardListView({
  statuses, byStatus, onOpen,
}: {
  statuses: Array<{ id: string; label: string; color: string; type: string }>;
  byStatus: Record<string, Task[]>;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
      {statuses.map(s => {
        const rows = byStatus[s.id] ?? [];
        if (!rows.length) return null;
        return (
          <div key={s.id} className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-outline bg-surface-2">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              <span className="text-sm font-semibold text-on-surface">{s.label}</span>
              <span className="text-[11px] text-on-surface-subtle tabular-nums">{rows.length}</span>
            </div>
            <TaskRows rows={rows} onOpen={onOpen} />
          </div>
        );
      })}
    </div>
  );
}

function TaskRows({ rows, onOpen }: { rows: Task[]; onOpen: (id: string) => void }) {
  return (
    <div className="divide-y divide-outline">
      {rows.map(t => {
        const prio = PRIORITY_META[t.priority];
        const due = dueMeta(t.due_date, !!t.completed_at);
        return (
          <button key={t.id} onClick={() => onOpen(t.id)}
            className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-surface-2">
            {t.priority !== 'none'
              ? <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: prio.color }} title={`${prio.label} priority`} />
              : <span className="w-1.5 flex-shrink-0" />}
            <span className={`flex-1 truncate text-sm text-on-surface ${t.completed_at ? 'line-through text-on-surface-subtle' : ''}`}>
              {t.title}
            </span>
            {t.list_name && <span className="text-[10px] text-on-surface-subtle truncate max-w-[10rem]">{t.list_name}</span>}
            {due && <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${DUE_TONE_CLASS[due.tone]}`}>{due.label}</span>}
            <span className="w-24 truncate text-xs text-on-surface-muted text-right">{t.assignee_name ?? '—'}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── My tasks — across every board, bucketed by urgency ───────────────────

function MyTasksList({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const buckets = useMemo(() => {
    const today = todayISO();
    const weekEnd = new Date(`${today}T00:00:00`);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndISO = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

    const out: Array<{ key: string; label: string; rows: Task[] }> = [
      { key: 'overdue', label: 'Overdue',      rows: [] },
      { key: 'today',   label: 'Today',        rows: [] },
      { key: 'week',    label: 'Next 7 days',  rows: [] },
      { key: 'later',   label: 'Later',        rows: [] },
      { key: 'nodate',  label: 'No due date',  rows: [] },
      { key: 'done',    label: 'Completed',    rows: [] },
    ];
    const put = (k: string, t: Task) => out.find(b => b.key === k)!.rows.push(t);
    for (const t of tasks) {
      if (t.completed_at) { put('done', t); continue; }
      const d = t.due_date?.slice(0, 10) ?? null;
      if (!d) put('nodate', t);
      else if (d < today) put('overdue', t);
      else if (d === today) put('today', t);
      else if (d <= weekEndISO) put('week', t);
      else put('later', t);
    }
    return out.filter(b => b.rows.length);
  }, [tasks]);

  if (!buckets.length) {
    return <EmptyPane label="Nothing assigned to you right now." />;
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
      {buckets.map(b => (
        <div key={b.key} className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
          <div className="px-4 py-2.5 flex items-center gap-2 border-b border-outline bg-surface-2">
            <span className={`text-sm font-semibold ${b.key === 'overdue' ? 'text-danger' : 'text-on-surface'}`}>{b.label}</span>
            <span className="text-[11px] text-on-surface-subtle tabular-nums">{b.rows.length}</span>
          </div>
          <TaskRows rows={b.rows} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

// ── New board ────────────────────────────────────────────────────────────

function NewBoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: TaskBoard) => void }) {
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getProjects({ status: 'active' }).then(setProjects).catch(() => setProjects([]));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Board name is required.'); return; }
    setBusy(true); setError('');
    try {
      const b = await api.createTaskBoard({ project_id: projectId || null, name: name.trim() });
      toast.success('Board created', `${name.trim()} is ready.`);
      onCreated(b);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create board.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-xl-3 bg-surface border border-outline shadow-elev-4 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-on-surface">New board</h2>
          <button type="button" onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={18} /></button>
        </div>

        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Board name</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. August content calendar"
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Project</label>
          <div className="relative">
            <select value={projectId} onChange={e => setProjectId(e.target.value)}
              className="w-full appearance-none px-3 py-2 pr-8 rounded-lg border border-outline bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/30">
              <option value="">Internal — not tied to a project</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.client_name ? ` · ${p.client_name}` : ''}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
          </div>
        </div>

        <p className="text-[11px] text-on-surface-subtle inline-flex items-start gap-1.5">
          <Archive size={11} className="mt-0.5 flex-shrink-0" />
          Starts with To do · In progress · In review · Done. Columns are per-board and editable later.
        </p>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg border border-outline text-sm font-semibold text-on-surface hover:bg-surface-2">Cancel</button>
          <button type="submit" disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-60">
            {busy && <Loader2 size={14} className="animate-spin" />} Create board
          </button>
        </div>
      </form>
    </div>
  );
}
