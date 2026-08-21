import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  KanbanSquare, Plus, Search, Loader2, LayoutList, Columns3, Inbox,
  MessageSquare, GitBranch, Archive, X, Briefcase, ChevronDown, CalendarDays,
  ChevronLeft, ChevronRight, Diamond, Repeat, GanttChartSquare,
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

type View = 'board' | 'list' | 'calendar' | 'timeline';

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
              <button onClick={() => setView('calendar')}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${view === 'calendar' ? 'bg-accent text-on-accent' : 'text-on-surface hover:bg-surface-2'}`}>
                <CalendarDays size={14} /> Calendar
              </button>
              <button onClick={() => setView('timeline')}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${view === 'timeline' ? 'bg-accent text-on-accent' : 'text-on-surface hover:bg-surface-2'}`}>
                <GanttChartSquare size={14} /> Timeline
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
                : effectiveView === 'calendar'
                  ? <CalendarView tasks={filtered} onOpen={setOpenTask} />
                  : effectiveView === 'timeline'
                    ? <TimelineView tasks={filtered} onOpen={setOpenTask} />
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
      className={`rounded-lg border p-2.5 cursor-pointer transition ${
        task.is_milestone
          ? 'border-accent/40 bg-accent/5 hover:border-accent hover:shadow-elev-1'
          : 'border-outline bg-surface-2 hover:border-outline-strong hover:shadow-elev-1'
      }`}
    >
      <div className="flex items-start gap-2">
        {task.is_milestone && (
          <span className="mt-1 w-3 h-3 rotate-45 bg-accent flex-shrink-0" title="Milestone" />
        )}
        {!task.is_milestone && task.priority !== 'none' && (
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
          {task.recurrence && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-accent" title="Recurring task">
              <Repeat size={10} />
            </span>
          )}
          {Number(task.logged_hours ?? 0) > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-on-surface-subtle font-mono tabular-nums"
              title={task.estimate_hours ? `${Number(task.logged_hours).toFixed(1)}h logged of ${task.estimate_hours}h estimate` : `${Number(task.logged_hours).toFixed(1)}h logged`}>
              ⏱ {Number(task.logged_hours).toFixed(1)}h{task.estimate_hours ? `/${task.estimate_hours}` : ''}
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

// Month-grid calendar. Tasks with a due_date land on that cell; the
// current day is highlighted; overdue-and-open cells carry a red rail;
// milestones show as an accent diamond. Rendered as pure divs (no
// external calendar dep) so it inherits the app's design tokens.
function CalendarView({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const today = new Date();
  const todayStr = ymd(today);
  const [cursor, setCursor] = useState<{ m: number; y: number }>({ m: today.getMonth(), y: today.getFullYear() });
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const gridStart = firstGridDay(cursor.y, cursor.m); // Sunday on/before day 1
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  // Bucket tasks by due-date YMD. Cheap re-bucket on every render — the
  // filtered list is small enough that memoising here would be overkill.
  const byDay: Record<string, Task[]> = {};
  for (const t of tasks) {
    if (!t.due_date) continue;
    const key = t.due_date.slice(0, 10);
    (byDay[key] ??= []).push(t);
  }
  const undated = tasks.filter(t => !t.due_date);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1">
          <button onClick={() => setCursor(c => ({ m: c.m === 0 ? 11 : c.m - 1, y: c.m === 0 ? c.y - 1 : c.y }))}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-on-surface"><ChevronLeft size={16} /></button>
          <button onClick={() => setCursor(c => ({ m: c.m === 11 ? 0 : c.m + 1, y: c.m === 11 ? c.y + 1 : c.y }))}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-on-surface"><ChevronRight size={16} /></button>
          <h3 className="font-display text-lg font-bold text-on-surface ml-2">{monthLabel}</h3>
        </div>
        <button onClick={() => setCursor({ m: today.getMonth(), y: today.getFullYear() })}
          className="text-xs font-semibold text-on-surface-muted hover:text-on-surface px-2.5 py-1.5 rounded-lg border border-outline">
          Today
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] gap-px bg-outline border border-outline rounded-xl-2 overflow-hidden">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="bg-surface-2 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-subtle">{d}</div>
        ))}
        {days.map((d, i) => {
          const key = ymd(d);
          const cellTasks = byDay[key] ?? [];
          const inMonth = d.getMonth() === cursor.m;
          const isToday = key === todayStr;
          const hasOverdue = cellTasks.some(t => !t.completed_at && key < todayStr);
          return (
            <div key={i}
              className={`relative min-h-[92px] p-1 bg-surface flex flex-col gap-0.5 overflow-hidden ${inMonth ? '' : 'bg-surface-2/40'}`}>
              <div className={`flex items-center gap-1 px-1 pt-0.5 ${inMonth ? 'text-on-surface' : 'text-on-surface-subtle'}`}>
                <span className={`inline-flex items-center justify-center text-[11px] font-mono font-semibold ${isToday ? 'w-5 h-5 rounded-full bg-accent text-on-accent' : ''}`}>
                  {d.getDate()}
                </span>
                {cellTasks.length > 0 && !isToday && (
                  <span className="ml-auto text-[9px] text-on-surface-subtle font-mono">{cellTasks.length}</span>
                )}
              </div>
              {hasOverdue && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-danger" />}
              <div className="flex-1 min-h-0 flex flex-col gap-0.5 overflow-hidden">
                {cellTasks.slice(0, 3).map(t => {
                  const p = PRIORITY_META[t.priority];
                  return (
                    <button key={t.id} onClick={() => onOpen(t.id)}
                      className={`text-left text-[11px] px-1.5 py-0.5 rounded truncate flex items-center gap-1 ${
                        t.completed_at
                          ? 'bg-success/10 text-on-surface-subtle line-through'
                          : t.is_milestone
                            ? 'bg-accent/10 text-accent font-semibold'
                            : 'bg-surface-2 text-on-surface hover:bg-brand-container'
                      }`}
                      title={t.title}>
                      {t.is_milestone
                        ? <Diamond size={9} className="fill-current flex-shrink-0" />
                        : t.priority !== 'none' && <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: p.color }} />}
                      <span className="truncate">{t.title}</span>
                    </button>
                  );
                })}
                {cellTasks.length > 3 && (
                  <span className="text-[10px] text-on-surface-subtle px-1.5">+{cellTasks.length - 3} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {undated.length > 0 && (
        <div className="rounded-lg border border-outline bg-surface p-3">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle font-semibold mb-1.5">No due date · {undated.length}</p>
          <div className="flex flex-wrap gap-1.5">
            {undated.slice(0, 12).map(t => (
              <button key={t.id} onClick={() => onOpen(t.id)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-outline text-[11px] hover:bg-surface-2 max-w-[220px] truncate">
                {t.is_milestone && <Diamond size={9} className="fill-accent text-accent flex-shrink-0" />}
                <span className="truncate">{t.title}</span>
              </button>
            ))}
            {undated.length > 12 && <span className="text-[11px] text-on-surface-subtle self-center">+{undated.length - 12} more</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// YYYY-MM-DD in LOCAL time (never toISOString, which shifts IST users
// past midnight backwards a day and puts tasks on the wrong cell).
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Sunday on or before day 1 of the given (0-indexed) month.
function firstGridDay(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const dow = first.getDay(); // 0 = Sunday
  const g = new Date(first);
  g.setDate(first.getDate() - dow);
  return g;
}

// Horizontal timeline / Gantt. Each task with a due_date renders as a
// bar spanning start_date → due_date (or a single-day pin if no start).
// Milestones render as diamonds at their due_date. Zoom by week (14
// days visible) or month (~45 days). Undated tasks are skipped — they
// live in the Calendar view's "No due date" strip.
function TimelineView({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const [zoom, setZoom] = useState<'week' | 'month'>('week');
  const dayPx = zoom === 'week' ? 46 : 22;
  const rowH = 30;

  const today = new Date();
  const todayStr = ymd(today);
  const dated = tasks.filter(t => !!t.due_date);
  // Range: earliest task date → latest, padded a week either side. Fall
  // back to a today-centred window when nothing has dates yet.
  const allDates = dated.flatMap(t => [t.start_date, t.due_date].filter(Boolean) as string[]);
  const min = allDates.length ? new Date(Math.min(...allDates.map(d => +new Date(d)))) : new Date(today.getTime() - 7 * 86_400_000);
  const max = allDates.length ? new Date(Math.max(...allDates.map(d => +new Date(d)))) : new Date(today.getTime() + 21 * 86_400_000);
  const rangeStart = new Date(min); rangeStart.setDate(min.getDate() - 3);
  const rangeEnd = new Date(max); rangeEnd.setDate(max.getDate() + 7);
  const totalDays = Math.max(21, Math.round((+rangeEnd - +rangeStart) / 86_400_000) + 1);
  const totalWidth = totalDays * dayPx;
  const days = Array.from({ length: totalDays }, (_, i) => {
    const d = new Date(rangeStart); d.setDate(rangeStart.getDate() + i);
    return d;
  });

  const rows = dated
    .slice()
    .sort((a, b) => {
      const ad = a.due_date ?? ''; const bd = b.due_date ?? '';
      return ad.localeCompare(bd);
    });

  if (dated.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-on-surface-subtle">
        No tasks with a due date. Add dates in the drawer to see them on the timeline.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border border-outline bg-surface p-1">
          {(['week','month'] as const).map(z => (
            <button key={z} onClick={() => setZoom(z)}
              className={`px-3 py-1 rounded-md text-xs font-semibold ${zoom === z ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>
              {z === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-on-surface-subtle ml-2">
          {new Date(rangeStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} — {new Date(rangeEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>

      <div className="flex-1 min-h-0 border border-outline rounded-xl-2 bg-surface overflow-hidden flex">
        {/* Left: task titles column */}
        <div className="w-56 flex-shrink-0 border-r border-outline overflow-y-auto">
          <div className="h-10 border-b border-outline bg-surface-2 px-3 flex items-center text-[10px] uppercase tracking-wider text-on-surface-muted font-semibold">
            Task
          </div>
          {rows.map(t => (
            <button key={t.id} onClick={() => onOpen(t.id)}
              style={{ height: rowH }}
              className="w-full text-left px-3 border-b border-outline hover:bg-surface-2 flex items-center gap-2 text-xs">
              {t.is_milestone && <Diamond size={9} className="fill-accent text-accent flex-shrink-0" />}
              <span className={`truncate ${t.completed_at ? 'line-through text-on-surface-subtle' : 'text-on-surface'}`}>
                {t.title}
              </span>
            </button>
          ))}
        </div>

        {/* Right: scrollable date axis + bars */}
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          <div style={{ width: totalWidth }}>
            {/* Date axis */}
            <div className="h-10 flex border-b border-outline bg-surface-2 sticky top-0 z-10">
              {days.map((d, i) => {
                const isMonthStart = d.getDate() === 1;
                const isWeekStart = d.getDay() === 1;
                const isToday = ymd(d) === todayStr;
                return (
                  <div key={i} style={{ width: dayPx, minWidth: dayPx }}
                    className={`flex flex-col items-center justify-center border-r ${isMonthStart ? 'border-outline-strong' : 'border-outline/50'} ${isToday ? 'bg-accent/10' : ''}`}>
                    {zoom === 'week' || isMonthStart || isWeekStart ? (
                      <>
                        <span className="text-[9px] uppercase tracking-wider text-on-surface-subtle font-semibold">
                          {d.toLocaleDateString('en-IN', { month: 'short' })}
                        </span>
                        <span className={`text-[11px] font-mono ${isToday ? 'text-accent font-bold' : 'text-on-surface-muted'}`}>
                          {d.getDate()}
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] font-mono text-on-surface-subtle">{d.getDate()}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Rows with bars */}
            <div className="relative">
              {/* Today rail */}
              {(() => {
                const idx = days.findIndex(d => ymd(d) === todayStr);
                if (idx < 0) return null;
                return (
                  <div className="absolute top-0 bottom-0 w-px bg-accent/60 pointer-events-none z-[1]"
                    style={{ left: idx * dayPx + dayPx / 2 }} />
                );
              })()}
              {rows.map(t => {
                const dueIdx = days.findIndex(d => ymd(d) === (t.due_date ?? '').slice(0, 10));
                const startIdx = t.start_date ? days.findIndex(d => ymd(d) === t.start_date!.slice(0, 10)) : dueIdx;
                const spanStart = Math.max(0, Math.min(startIdx, dueIdx));
                const spanEnd   = Math.max(startIdx, dueIdx);
                const left  = spanStart * dayPx + 2;
                const width = Math.max(dayPx - 4, (spanEnd - spanStart + 1) * dayPx - 4);
                const p = PRIORITY_META[t.priority];
                const overdue = !t.completed_at && (t.due_date ?? '') < todayStr;
                return (
                  <div key={t.id} style={{ height: rowH }} className="relative border-b border-outline">
                    {/* faint grid */}
                    <div className="absolute inset-0 flex pointer-events-none">
                      {days.map((_, i) => (
                        <div key={i} style={{ width: dayPx }} className="border-r border-outline/40" />
                      ))}
                    </div>
                    {dueIdx >= 0 && (
                      t.is_milestone ? (
                        <button onClick={() => onOpen(t.id)}
                          title={t.title}
                          style={{ left: dueIdx * dayPx + dayPx / 2 - 7, top: (rowH - 14) / 2 }}
                          className="absolute w-3.5 h-3.5 rotate-45 bg-accent border border-accent shadow-md hover:scale-110 transition-transform" />
                      ) : (
                        <button onClick={() => onOpen(t.id)}
                          title={`${t.title}${t.assignee_name ? ' · ' + t.assignee_name : ''}`}
                          style={{
                            left, width,
                            top: (rowH - 20) / 2,
                            background: t.completed_at ? undefined : (overdue ? undefined : `linear-gradient(90deg, ${p.color}22, ${p.color}44)`),
                            borderColor: p.color,
                          }}
                          className={`absolute h-5 rounded flex items-center px-2 text-[10px] font-semibold truncate border transition ${
                            t.completed_at ? 'bg-success/20 text-on-surface-subtle line-through hover:bg-success/30'
                              : overdue ? 'bg-danger/20 text-danger hover:bg-danger/30'
                              : 'text-on-surface hover:brightness-110'
                          }`}>
                          {t.assignee_name ? initials(t.assignee_name) : ''}
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
