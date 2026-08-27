import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  KanbanSquare, Plus, Search, Loader2, LayoutList, Columns3, Inbox,
  MessageSquare, GitBranch, Archive, X, Briefcase, ChevronDown, CalendarDays,
  ChevronLeft, ChevronRight, Diamond, Repeat, GanttChartSquare, MoreVertical, Trash2, Lock, Globe, Users2, Settings, BarChart3, Square, Layers,
} from 'lucide-react';
import { api } from '../services/api';
import type { Task, TaskBoard, TaskFilters, TaskSavedView, BoardPermission, BoardPermissionLevel } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toaster';
import TaskDetailModal from '../components/tasks/TaskDetailModal';
import TaskFilterBar from '../components/tasks/TaskFilterBar';
import TaskFieldsAndTemplatesMenu from '../components/tasks/TaskFieldsAndTemplatesMenu';
import {
  PRIORITY_META, DEFAULT_STATUSES, dueMeta, DUE_TONE_CLASS, midpoint, initials, todayISO, defaultBoardParams, formatHoursHuman } from '../lib/taskMeta';

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
  const [boardSettings, setBoardSettings] = useState<TaskBoard | null>(null);
  // Which task currently has a running timer for the signed-in user. Used
  // by TaskCard to show an inline Stop button so people don't need to
  // open the modal to end their timer.
  const [runningTimerTaskId, setRunningTimerTaskId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // `?board=` and `?task=` live in the URL so a board is bookmarkable and a
  // "task assigned to you" notification can deep-link straight to the card.
  const boardParam = params.get('board');
  const openTaskId = params.get('task');
  const isMine = boardParam === 'mine';
  // "All tasks" scope — every task the caller can see across every
  // board and project. Filters + search on the top bar work over the
  // combined set so people can drill in without knowing which board.
  const isAll = boardParam === 'all';

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

  const reloadBoards = useCallback(() => {
    api.listTaskBoards().then(setBoards).catch(() => {});
  }, []);
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

  // Track the current user's running-timer task so the board can render
  // an inline Stop button on that card. Same event bus as the TopBar
  // chip, so start/stop from anywhere refreshes both surfaces.
  const refreshRunningTimer = useCallback(() => {
    api.getRunningTimer()
      .then(r => setRunningTimerTaskId(r?.task_id ?? null))
      .catch(() => setRunningTimerTaskId(null));
  }, []);
  useEffect(() => {
    refreshRunningTimer();
    const onChange = () => refreshRunningTimer();
    window.addEventListener('hrms-task-timer-changed', onChange);
    return () => window.removeEventListener('hrms-task-timer-changed', onChange);
  }, [refreshRunningTimer]);
  const stopRunningTimer = async (taskId: string) => {
    try {
      const stopped = await api.stopTaskTimer(taskId);
      setRunningTimerTaskId(null);
      window.dispatchEvent(new Event('hrms-task-timer-changed'));
      loadTasks();
      // Fire the global "log this to your hour sheet?" prompt so the
      // employee gets the same one-click flow whether they stopped
      // from the card, the modal, or the TopBar chip.
      const detail = {
        entry_id: stopped.id,
        task_id: stopped.task_id,
        task_title: stopped.task_title,
        project_id: stopped.project_id,
        project_name: stopped.project_name,
        project_client: stopped.project_client,
        assignment_id: stopped.assignment_id,
        log_date: stopped.log_date,
        hours: Number(stopped.hours),
        employee_id: stopped.employee_id,
        employee_name: stopped.employee_name ?? user?.name ?? null,
      };
      window.dispatchEvent(new CustomEvent('hrms-timer-stopped', { detail }));
    } catch (e: any) { toast.error('Could not stop timer', e?.body?.error ?? e?.message); }
  };

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
    const req = isMine ? api.listTasks({ mine: true })
      : isAll ? api.listTasks({})
      : api.listTasks({ list_id: boardParam });
    req
      .then(setTasks)
      .catch((e: any) => setErr(e?.message ?? 'Failed to load tasks'))
      .finally(() => setTasksLoading(false));
  }, [boardParam, isMine, isAll]);
  useEffect(loadTasks, [loadTasks]);

  // My tasks spans boards, so its columns would be meaningless — it always
  // renders as a list grouped by urgency instead.
  // Both cross-board views (Mine + All) force list layout — a Kanban
  // grouped by statuses would be meaningless when the statuses come
  // from many different boards' schemas.
  const effectiveView: View = (isMine || isAll) ? 'list' : view;

  // Structured filters (Phase 5a) — applied client-side over the loaded
  // tasks. Nothing here is persisted unless the user saves a view.
  const [filters, setFilters] = useState<TaskFilters>({});
  const [savedViews, setSavedViews] = useState<TaskSavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  useEffect(() => {
    api.listTaskViews().then(setSavedViews).catch(() => setSavedViews([]));
  }, []);

  const filtered = useMemo(() => filterTasks(tasks, filters, search, user?.id ?? null), [tasks, filters, search, user?.id]);

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
          {!isMine && !isAll && (
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
          <TaskFieldsAndTemplatesMenu board={activeBoard ?? null} canManage={canManageBoards} onApplied={() => { reloadBoards(); loadTasks(); }} />
          <a href="/tasks/analytics"
            title="Cross-organisation task analytics"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline text-xs font-semibold text-on-surface-muted hover:bg-surface-2 hover:text-on-surface">
            <BarChart3 size={13} /> Analytics
          </a>
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

      <TaskFilterBar
        filters={filters}
        onChange={f => { setFilters(f); setActiveViewId(null); }}
        savedViews={savedViews}
        activeViewId={activeViewId}
        onLoadView={v => {
          setFilters(v.filters ?? {});
          if (v.board_id && v.board_id !== boardParam) setBoardParam(v.board_id);
          setActiveViewId(v.id);
        }}
        onSaved={v => { setSavedViews(prev => [...prev.filter(x => x.id !== v.id), v]); setActiveViewId(v.id); }}
        onDeleted={id => { setSavedViews(prev => prev.filter(v => v.id !== id)); if (activeViewId === id) setActiveViewId(null); }}
        employees={employees}
        statuses={statuses.map(s => ({ id: s.id, label: s.label }))}
        boardId={(boardParam === 'mine' || boardParam === 'all') ? null : (boardParam ?? null)}
      />

      <div className="flex-1 min-h-0 flex gap-4">
        {/* ── Left rail: My tasks + boards by project ── */}
        <aside className="w-60 flex-shrink-0 overflow-y-auto rounded-xl-2 border border-outline bg-surface p-2">
          <button onClick={() => setBoardParam('mine')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold mb-1 ${isMine ? 'bg-accent-container text-on-accent-container' : 'text-on-surface hover:bg-surface-2'}`}>
            <Inbox size={15} /> My tasks
          </button>
          {/* Cross-board dashboard — same TaskFilterBar the boards use,
              scoped to every task the caller can see. Filters like
              "assigned by me", "priority: urgent", or "due this week"
              become one-click org-wide surfaces from here. */}
          <button onClick={() => setBoardParam('all')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold mb-2 ${isAll ? 'bg-accent-container text-on-accent-container' : 'text-on-surface hover:bg-surface-2'}`}>
            <Layers size={15} /> All tasks
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
                const restricted = b.visibility === 'restricted';
                return (
                  <div key={b.id} className={`group relative flex items-stretch rounded-lg ${b.id === boardParam ? 'bg-accent-container text-on-accent-container font-semibold' : 'hover:bg-surface-2'}`}>
                    <button onClick={() => setBoardParam(b.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-sm text-left text-on-surface">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: b.color ?? '#94a3b8' }} />
                      <span className="flex-1 truncate">{b.name}</span>
                      {restricted && <Lock size={10} className="text-on-surface-subtle flex-shrink-0" />}
                      <span className="text-[10px] text-on-surface-subtle tabular-nums flex-shrink-0">{done}/{total}</span>
                    </button>
                    {canManageBoards && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setBoardSettings(b); }}
                        title="Board settings"
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 px-2 py-2 text-on-surface-muted hover:text-on-surface transition-opacity">
                        <MoreVertical size={14} />
                      </button>
                    )}
                  </div>
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

          {(isMine || isAll)
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
                        runningTimerTaskId={runningTimerTaskId}
                        onStopTimer={stopRunningTimer}
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

      {boardSettings && (
        <BoardSettingsModal
          board={boardSettings}
          employees={employees}
          isAdmin={user?.role === 'admin'}
          onClose={() => setBoardSettings(null)}
          onSaved={(updated) => {
            setBoards(prev => prev.map(b => b.id === updated.id ? { ...b, ...updated } : b));
            setBoardSettings(null);
          }}
          onDeleted={(id) => {
            setBoards(prev => prev.filter(b => b.id !== id));
            if (boardParam === id) setBoardParam(null);
            setBoardSettings(null);
          }}
        />
      )}
    </div>
  );
}

// ── BoardSettingsModal ───────────────────────────────────────────────────
// Rename, recolor, retitle, archive, delete, and configure visibility
// (public vs restricted to specific members / departments). Backend
// endpoints already exist (patchTaskBoard + deleteTaskBoard) — this is
// the missing UI surface.
function BoardSettingsModal({ board, employees, isAdmin, onClose, onSaved, onDeleted }: {
  board: TaskBoard;
  employees: any[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (b: TaskBoard) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description ?? '');
  const [color, setColor] = useState(board.color ?? '#94a3b8');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  // Permissions state. Seed from board.permissions if set, otherwise
  // synthesise from the legacy visibility/member fields to match what
  // the server does — so the modal always shows a truthful starting point.
  const initialPermissions = useMemo<BoardPermission[]>(() => {
    if (Array.isArray(board.permissions) && board.permissions.length) return board.permissions;
    const out: BoardPermission[] = [];
    if ((board.visibility ?? 'public') === 'public') {
      out.push({ kind: 'everyone', ref: null, level: 'edit' });
    }
    for (const id of board.member_employee_ids ?? []) out.push({ kind: 'employee', ref: id, level: 'edit' });
    for (const d  of board.member_departments  ?? []) out.push({ kind: 'department', ref: d,  level: 'edit' });
    return out;
  }, [board.permissions, board.visibility, board.member_employee_ids, board.member_departments]);
  const [perms, setPerms] = useState<BoardPermission[]>(initialPermissions);
  const [empSearch, setEmpSearch] = useState('');

  const everyone = perms.find(p => p.kind === 'everyone');
  const defaultLevel: BoardPermissionLevel | 'none' = everyone?.level ?? 'none';
  const memberPerms = perms.filter(p => p.kind !== 'everyone');

  const allDepartments = useMemo(() => (
    Array.from(new Set((employees ?? []).map((e: any) => e.department).filter(Boolean))).sort()
  ), [employees]);
  const filteredEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    return (employees ?? [])
      .filter((e: any) => !q || e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q))
      .filter((e: any) => !perms.some(p => p.kind === 'employee' && p.ref === e.id))
      .slice(0, 100);
  }, [employees, empSearch, perms]);
  const remainingDepts = useMemo(() => (
    allDepartments.filter(d => !perms.some(p => p.kind === 'department' && p.ref === d))
  ), [allDepartments, perms]);

  const setDefaultLevel = (level: BoardPermissionLevel | 'none') => {
    setPerms(prev => {
      const without = prev.filter(p => p.kind !== 'everyone');
      return level === 'none' ? without : [{ kind: 'everyone', ref: null, level }, ...without];
    });
  };
  const addMember = (kind: 'employee' | 'department', ref: string) => {
    setPerms(prev => [...prev, { kind, ref, level: 'edit' }]);
    if (kind === 'employee') setEmpSearch('');
  };
  const removeMember = (kind: 'employee' | 'department', ref: string | null) => {
    setPerms(prev => prev.filter(p => !(p.kind === kind && p.ref === ref)));
  };
  const changeMemberLevel = (kind: 'employee' | 'department', ref: string | null, level: BoardPermissionLevel) => {
    setPerms(prev => prev.map(p => (p.kind === kind && p.ref === ref) ? { ...p, level } : p));
  };

  const save = async () => {
    if (!name.trim()) { toast.error('Board needs a name'); return; }
    setSaving(true);
    try {
      // Derive visibility from the presence of an 'everyone' entry so
      // legacy consumers of the visibility column still work.
      const derivedVisibility: 'public' | 'restricted' = everyone ? 'public' : 'restricted';
      const patch = {
        name: name.trim(),
        description: description.trim() || null,
        color,
        visibility: derivedVisibility,
        // Keep the legacy arrays in sync too so any pre-permissions
        // reader (e.g. an older tab still open) sees consistent data.
        member_employee_ids: memberPerms.filter(p => p.kind === 'employee').map(p => p.ref!).filter(Boolean),
        member_departments:  memberPerms.filter(p => p.kind === 'department').map(p => p.ref!).filter(Boolean),
        permissions: perms,
      };
      const updated = await api.patchTaskBoard(board.id, patch);
      onSaved(updated);
      toast.success('Board updated');
    } catch (e: any) { toast.error('Save failed', e?.body?.error ?? e?.message); }
    finally { setSaving(false); }
  };
  const archive = async () => {
    setBusy(true);
    try {
      const updated = await api.patchTaskBoard(board.id, { archived: !board.archived });
      onSaved(updated);
      toast.success(board.archived ? 'Board un-archived' : 'Board archived');
    } catch (e: any) { toast.error('Failed', e?.body?.error ?? e?.message); }
    finally { setBusy(false); }
  };
  const del = async () => {
    if (!window.confirm(`Delete board "${board.name}"?\n\nIf it holds tasks you'll be asked again to force-delete.`)) return;
    setBusy(true);
    try {
      await api.deleteTaskBoard(board.id);
      onDeleted(board.id);
      toast.success('Board deleted');
    } catch (e: any) {
      if (e?.body?.task_count != null) {
        if (window.confirm(`This board still holds ${e.body.task_count} task${e.body.task_count === 1 ? '' : 's'}. Delete anyway (permanent)?`)) {
          try {
            await api.deleteTaskBoard(board.id, true);
            onDeleted(board.id);
            toast.success('Board + tasks deleted');
          } catch (e2: any) { toast.error('Delete failed', e2?.body?.error ?? e2?.message); }
        }
      } else {
        toast.error('Delete failed', e?.body?.error ?? e?.message);
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onMouseDown={onClose}>
      <div className="bg-surface rounded-xl-2 w-full max-w-lg shadow-elev-4 border border-outline my-8" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
          <h2 className="text-lg font-display font-bold text-on-surface">Board settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-on-surface-muted"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">Colour</label>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              {['#94a3b8', '#EE2770', '#7c3aed', '#2563eb', '#0891b2', '#15803d', '#d97706', '#dc2626'].map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-on-surface' : 'border-transparent'}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>

          {/* Default access — the level granted to anyone not in the
              members list below. 'None' hides the board from everyone
              except admins, the creator, and explicit members. */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">Default access (everyone else)</label>
            <div className="mt-1 grid grid-cols-4 gap-1">
              {([
                { key: 'none',    label: 'None',    icon: Lock,  hint: 'Only members' },
                { key: 'view',    label: 'View',    icon: Globe, hint: 'Read-only' },
                { key: 'comment', label: 'Comment', icon: Globe, hint: 'View + comment' },
                { key: 'edit',    label: 'Edit',    icon: Globe, hint: 'Full edit' },
              ] as const).map(opt => {
                const active = defaultLevel === opt.key;
                return (
                  <button key={opt.key} onClick={() => setDefaultLevel(opt.key)}
                    title={opt.hint}
                    className={`px-2 py-2 rounded-lg border text-center ${active ? 'border-accent bg-accent/10 text-accent' : 'border-outline hover:bg-surface-2 text-on-surface-muted'}`}>
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-[10px] text-on-surface-subtle mt-0.5">{opt.hint}</div>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-on-surface-subtle">Admins and the board's creator always have full access regardless of this setting.</p>
          </div>

          {/* Explicit members — each entry has a role dropdown. */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted flex items-center gap-1">
              <Users2 size={11} /> Members <span className="normal-case font-normal text-on-surface-subtle">({memberPerms.length})</span>
            </label>

            {memberPerms.length > 0 && (
              <div className="mt-1 divide-y divide-outline rounded-lg border border-outline">
                {memberPerms.map(p => {
                  const label = p.kind === 'employee'
                    ? (employees.find((e: any) => e.id === p.ref)?.name ?? p.ref ?? 'Unknown employee')
                    : `Department: ${p.ref}`;
                  const badge = p.kind === 'department' ? 'DEPT' : 'USER';
                  return (
                    <div key={`${p.kind}-${p.ref}`} className="flex items-center gap-2 px-3 py-2">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${p.kind === 'department' ? 'bg-info/10 text-info' : 'bg-surface-2 text-on-surface-muted'}`}>{badge}</span>
                      <span className="flex-1 text-sm text-on-surface truncate">{label}</span>
                      <select value={p.level} onChange={e => changeMemberLevel(p.kind as 'employee' | 'department', p.ref, e.target.value as BoardPermissionLevel)}
                        className="text-xs px-2 py-1 rounded border border-outline bg-surface-2 text-on-surface">
                        <option value="view">Viewer</option>
                        <option value="comment">Commenter</option>
                        <option value="edit">Editor</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button onClick={() => removeMember(p.kind as 'employee' | 'department', p.ref)}
                        title="Remove"
                        className="p-1 rounded hover:bg-danger/10 text-on-surface-muted hover:text-danger">
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Department quick-add pills */}
            {remainingDepts.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle mb-1">Add a department</p>
                <div className="flex flex-wrap gap-1.5">
                  {remainingDepts.map(d => (
                    <button key={d} onClick={() => addMember('department', d)}
                      className="px-2.5 py-1 rounded-full text-[11px] font-semibold border border-outline text-on-surface-muted hover:text-on-surface hover:bg-surface-2">
                      + {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Employee search + add */}
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle mb-1">Add a member</p>
              <input value={empSearch} onChange={e => setEmpSearch(e.target.value)}
                placeholder="Search employees…"
                className="w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
              {empSearch.trim() && (
                <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-outline divide-y divide-outline">
                  {filteredEmployees.length === 0 && (
                    <p className="p-3 text-xs text-on-surface-subtle italic">No matches.</p>
                  )}
                  {filteredEmployees.map((emp: any) => (
                    <button key={emp.id} onClick={() => addMember('employee', emp.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-2 text-left">
                      <span className="text-sm text-on-surface flex-1 truncate">{emp.name}</span>
                      <span className="text-[10px] text-on-surface-subtle">{emp.department ?? '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-outline flex items-center gap-2">
          <button onClick={archive} disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-outline text-on-surface-muted hover:bg-surface-2 disabled:opacity-50">
            <Archive size={12} /> {board.archived ? 'Un-archive' : 'Archive'}
          </button>
          {isAdmin && (
            <button onClick={del} disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-danger border border-danger/30 hover:bg-danger/10 disabled:opacity-50">
              <Trash2 size={12} /> Delete
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-on-surface-muted hover:text-on-surface">Cancel</button>
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-accent text-on-accent text-sm font-semibold disabled:opacity-60">
              {saving && <Loader2 size={12} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </div>
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
  runningTimerTaskId, onStopTimer,
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
  runningTimerTaskId: string | null;
  onStopTimer: (id: string) => void;
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
          <TaskCard key={t.id} task={t} onDragStart={() => onDragStartCard(t.id)} onOpen={() => onOpen(t.id)}
            timerRunning={runningTimerTaskId === t.id}
            onStopTimer={() => onStopTimer(t.id)} />
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

function TaskCard({ task, onDragStart, onOpen, timerRunning = false, onStopTimer }: {
  task: Task;
  onDragStart: () => void;
  onOpen: () => void;
  timerRunning?: boolean;
  onStopTimer?: () => void;
}) {
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
        <p className={`text-sm leading-snug text-on-surface flex-1 ${task.completed_at ? 'line-through text-on-surface-subtle' : ''}`}>
          {task.title}
        </p>
        {timerRunning && (
          <button
            onClick={e => { e.stopPropagation(); onStopTimer?.(); }}
            title="Stop your running timer on this task"
            className="ml-1 inline-flex items-center gap-1 shrink-0 h-6 px-1.5 rounded-full text-[10px] font-bold bg-danger text-white hover:bg-danger/90">
            <Square size={9} className="fill-current animate-pulse" /> Stop
          </button>
        )}
      </div>

      {(task.tags ?? []).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(task.tags ?? []).slice(0, 4).map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-semibold">
              {t}
            </span>
          ))}
          {(task.tags ?? []).length > 4 && (
            <span className="text-[10px] text-on-surface-subtle">+{(task.tags ?? []).length - 4}</span>
          )}
        </div>
      )}

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
              title={task.estimate_hours ? `${formatHoursHuman(task.logged_hours)} logged of ${formatHoursHuman(task.estimate_hours)} estimate` : `${formatHoursHuman(task.logged_hours)} logged`}>
              ⏱ {formatHoursHuman(task.logged_hours)}{task.estimate_hours ? ` / ${formatHoursHuman(task.estimate_hours)}` : ''}
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
        <p className="text-[11px] text-on-surface-muted inline-flex items-start gap-1.5">
          <Lock size={11} className="mt-0.5 flex-shrink-0" />
          <span>
            Private by default — only you can see it. Open <b className="text-on-surface">Board settings</b> after creating to share with members or teams.
          </span>
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

// Apply structured filters + free-text search to the loaded task set.
// Every field on `filters` is optional; an empty filters + empty query
// returns the input untouched. Deliberately client-side — the server
// already loads a bounded set (per-board or "mine"), so this is cheap.
function filterTasks(tasks: Task[], f: TaskFilters, q: string, currentUserId?: string | null): Task[] {
  const query = q.trim().toLowerCase();
  const activeFilter = f && Object.values(f).some(v => v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0));
  if (!query && !activeFilter) return tasks;
  const today = ymd(new Date());
  const now = new Date();
  const startOfWeek = new Date(now); const dow = now.getDay(); startOfWeek.setDate(now.getDate() - dow);
  const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6);
  const startOfNextWeek = new Date(endOfWeek); startOfNextWeek.setDate(endOfWeek.getDate() + 1);
  const endOfNextWeek = new Date(startOfNextWeek); endOfNextWeek.setDate(startOfNextWeek.getDate() + 6);
  return tasks.filter(t => {
    if (query) {
      const hay = `${t.title} ${t.description ?? ''} ${t.assignee_name ?? ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (f.assignee_ids?.length) {
      const wantsUnassigned = f.assignee_ids.includes('__unassigned__');
      if (!wantsUnassigned) { if (!t.assignee_id || !f.assignee_ids.includes(t.assignee_id)) return false; }
      else if (t.assignee_id && !f.assignee_ids.includes(t.assignee_id)) return false;
    }
    if (f.assigned_by_me) {
      // task.created_by_id stores the app_users.id of the creator;
      // no match when we don't know who the caller is (no session).
      if (!currentUserId || t.created_by_id !== currentUserId) return false;
    }
    if (f.statuses?.length && !f.statuses.includes(t.status)) return false;
    if (f.priorities?.length && !f.priorities.includes(t.priority)) return false;
    if (f.tags?.length) {
      const set = new Set((t.tags ?? []).map(String));
      if (!f.tags.some(g => set.has(g))) return false;
    }
    if (f.is_milestone === true && !t.is_milestone) return false;
    if (f.is_milestone === false && t.is_milestone) return false;
    if (f.has_recurrence === true && !t.recurrence) return false;
    if (f.has_recurrence === false && t.recurrence) return false;
    if (f.due === 'no_date' && t.due_date) return false;
    if (f.due === 'overdue') {
      if (!t.due_date || t.completed_at || t.due_date >= today) return false;
    } else if (f.due === 'today') {
      if (!t.due_date || t.due_date.slice(0, 10) !== today) return false;
    } else if (f.due === 'this_week') {
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      if (d < startOfWeek || d > endOfWeek) return false;
    } else if (f.due === 'next_week') {
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      if (d < startOfNextWeek || d > endOfNextWeek) return false;
    } else if (f.due === 'custom') {
      if (!t.due_date) return false;
      if (f.due_from && t.due_date < f.due_from) return false;
      if (f.due_to   && t.due_date > f.due_to)   return false;
    }
    return true;
  });
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
