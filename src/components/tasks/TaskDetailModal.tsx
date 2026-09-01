import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Loader2, Trash2, Send, Plus, MessageSquare, History, GitBranch, Check, Eye, EyeOff,
  Link2, Flag, Diamond, Play, Square, Clock, Repeat, Paperclip, Download, Upload, ChevronDown,
  Lock, ShieldAlert,
} from 'lucide-react';
import { taskFilesApi, type TaskAttachment } from '../../services/taskFilesApi';
import { notifyTaskTimerChanged } from '../layout/TaskTimerChip';
import { firePromptForStoppedTimer } from '../hours/TimerStopPrompt';
import { api } from '../../services/api';
import type { Task, TaskActivity, TaskComment, TaskPriority, TaskStatus, TaskCustomField } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../Toaster';
import { TASK_PRIORITIES, PRIORITY_META, initials, formatHoursHuman } from '../../lib/taskMeta';

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
  const [customFields, setCustomFields] = useState<TaskCustomField[]>([]);
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
  // When the task fetch 403s with needs_access:true, the modal renders
  // a request-access panel instead of the generic error string. See
  // load() below — the server ships the board name + admin list in the
  // 403 body so we have everything we need to render the panel.
  const [denied, setDenied] = useState<null | {
    board_id: string; board_name: string;
    project_id: string | null; project_name: string | null;
    admins: { employee_id: string; name: string }[];
  }>(null);
  const [reqBusy, setReqBusy] = useState(false);
  const [reqSent, setReqSent] = useState<null | string[]>(null);
  const [saving, setSaving] = useState(false);
  // Post-save "Saved" flash. Flips true right after a patch succeeds
  // and reverts after ~2s so people who don't read spinners still see
  // a green tick confirming their edit landed.
  const [justSaved, setJustSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Every mention the user has picked in this compose session. On send
  // we walk the composer text and re-wrap `@Name` occurrences back into
  // the storage form `@[Name](id)` before hitting the API. Keeping the
  // display clean (`@Name`) while preserving the id-carrying storage
  // form is why we track them here instead of just parsing the text.
  const [pickedMentions, setPickedMentions] = useState<Array<{ name: string; id: string }>>([]);
  // Board-move picker state — fetched lazily the first time it opens.
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [boardsList, setBoardsList] = useState<Array<{ id: string; name: string; project_name?: string | null }>>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardSearch, setBoardSearch] = useState('');
  const openBoardPicker = async () => {
    setMovePickerOpen(true);
    if (boardsList.length === 0) {
      setBoardsLoading(true);
      try {
        const list = await api.listTaskBoards();
        setBoardsList(list.map((b: any) => ({ id: b.id, name: b.name, project_name: b.project_name })));
      } catch { /* the server-side gate will still reject bad moves */ }
      finally { setBoardsLoading(false); }
    }
  };
  const moveToBoard = async (newListId: string) => {
    if (!task || newListId === task.list_id) return;
    setMovePickerOpen(false);
    try {
      await patch({ list_id: newListId });
      toast.success('Task moved');
    } catch { /* patch already toasts on failure */ }
  };

  // Attachments (stored on the VPS files module, per-task scope).
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAttachments = useCallback(() => {
    if (!taskId) return;
    setAttachmentsLoading(true);
    taskFilesApi.list(taskId)
      .then(setAttachments)
      .catch(() => { /* attachments are non-critical — swallow so the rest of the modal still renders */ })
      .finally(() => setAttachmentsLoading(false));
  }, [taskId]);
  useEffect(() => { loadAttachments(); }, [loadAttachments]);

  const handleFileUpload = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length || !task) return;
    // Client-side cap that mirrors the VPS cap so the user hears about
    // an oversize file before the round-trip.
    const OVERSIZE = arr.find(f => f.size > 25 * 1024 * 1024);
    if (OVERSIZE) {
      toast.error('File too large', `${OVERSIZE.name} exceeds the 25 MB per-file limit.`);
      return;
    }
    setUploading(true);
    try {
      const saved = await taskFilesApi.upload(task.id, arr);
      setAttachments(prev => [...saved, ...prev]);
    } catch (e: any) {
      toast.error('Upload failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setUploading(false); }
  };
  const deleteAttachment = async (att: TaskAttachment) => {
    if (!task) return;
    if (!window.confirm(`Delete "${att.filename}"?`)) return;
    setAttachments(prev => prev.filter(a => a.id !== att.id));
    try { await taskFilesApi.del(task.id, att.id); }
    catch (e: any) {
      // Roll back on failure so the UI stays truthful.
      loadAttachments();
      toast.error('Delete failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    }
  };
  const downloadAttachment = async (att: TaskAttachment) => {
    if (!task) return;
    try {
      const url = await taskFilesApi.downloadUrl(task.id, att.id);
      // Open in a new tab — the Content-Disposition header on the response
      // will trigger the browser's Save dialog. Same tab would navigate
      // the whole SPA away from the modal, which is worse UX.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error('Download failed', e?.message ?? 'Please try again.');
    }
  };

  const mentionMatches = useMemo(() => {
    if (mentionAnchor == null) return [];
    const q = mentionQuery.toLowerCase();
    return employees
      .filter((e: any) => e.name && (!q || e.name.toLowerCase().includes(q) || (e.employee_id ?? '').toLowerCase().includes(q)))
      .slice(0, 6);
  }, [employees, mentionAnchor, mentionQuery]);

  const load = useCallback(() => {
    setLoading(true); setDenied(null); setErr('');
    api.getTask(taskId)
      .then((r: any) => {
        const { task: t, subtasks: st, comments: cs, activity: acts, custom_fields: cf } = r;
        setTask(t); setSubtasks(st); setComments(cs); setActivity(acts);
        setCustomFields(cf ?? []);
        setTitle(t.title); setDescription(t.description ?? '');
        // Reflect the task name in the browser tab so an open modal
        // is easy to spot in the task-switcher / pinned-tabs view.
        try { document.title = `${t.title} · Tasks · Digital Leap HRMS`; } catch { /* noop */ }
      })
      .catch((e: any) => {
        // 403 with needs_access → render the friendly access-denied
        // panel instead of a generic error string. The body carries
        // just enough (board + admins) to show who to ask.
        if (e?.status === 403 && e?.body?.needs_access) {
          setDenied({
            board_id: e.body.board_id,
            board_name: e.body.board_name,
            project_id: e.body.project_id ?? null,
            project_name: e.body.project_name ?? null,
            admins: Array.isArray(e.body.admins) ? e.body.admins : [],
          });
          return;
        }
        setErr(e?.message ?? 'Failed to load task');
      })
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
  //
  // Source-of-truth for "am I timing this task" is /api/me/timer
  // (authoritative for the signed-in user across the whole app),
  // not the task's own timeEntries list — which can be stale or miss
  // the row if myEmpId drifts from the server-side resolveUserToEmployee.
  // We keep the timeEntries fallback so a manually-inserted running
  // entry still surfaces.
  const [myGlobalTimer, setMyGlobalTimer] = useState<{ task_id: string; started_at: string; id: string } | null>(null);
  const refreshMyTimer = useCallback(() => {
    api.getRunningTimer()
      .then(t => setMyGlobalTimer(t as any))
      .catch(() => setMyGlobalTimer(null));
  }, []);
  useEffect(() => {
    refreshMyTimer();
    const onChange = () => refreshMyTimer();
    window.addEventListener('hrms-task-timer-changed', onChange);
    return () => window.removeEventListener('hrms-task-timer-changed', onChange);
  }, [refreshMyTimer]);
  const openTimerFromMe = myGlobalTimer && myGlobalTimer.task_id === taskId ? myGlobalTimer : null;
  const openTimerFromEntries = timeEntries.find(e => e.source === 'timer' && !e.stopped_at && e.employee_id === myEmpId);
  const openTimer = openTimerFromMe ?? openTimerFromEntries ?? null;
  // Also expose "I'm timing a DIFFERENT task" so the modal can offer a
  // stop-anywhere path instead of leaving the user with no button.
  const timingOtherTask = !openTimer && myGlobalTimer && myGlobalTimer.task_id !== taskId ? myGlobalTimer : null;
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
      notifyTaskTimerChanged();
      refreshMyTimer();
    } catch (e: any) { toast.error('Could not start timer', e?.message ?? 'Please try again.'); }
    finally { setTimerBusy(false); }
  };
  const stopTimer = async () => {
    if (timerBusy) return;
    // Stop whichever task we actually have a running timer on. If the
    // page still thinks it's this task but /api/me/timer says another
    // one, we send stop to the real one.
    const activeTaskId = myGlobalTimer?.task_id ?? taskId;
    setTimerBusy(true);
    try {
      const stopped = await api.stopTaskTimer(activeTaskId);
      const fresh = await api.getTaskTime(taskId);
      setTimeEntries(fresh);
      load();
      notifyTaskTimerChanged();
      refreshMyTimer();
      // Ask whether to also record this against the weekly hour log
      // (global overlay listens for this event; skipped for non-project
      // tasks and sub-minute stops).
      firePromptForStoppedTimer({
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
      });
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
    // If the user manually deleted an inserted `@Name`, drop it from
    // pickedMentions so the "Tagging:" chips reflect reality.
    setPickedMentions(prev => prev.filter(p => val.includes(`@${p.name}`)));
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
    // Insert the clean "@Name " form the user actually wants to see.
    // The id-carrying storage form is stitched back in during addComment.
    const insert = `@${emp.name} `;
    const next = before + insert + after;
    setComment(next);
    setPickedMentions(prev => prev.some(p => p.id === emp.id) ? prev : [...prev, { name: emp.name, id: emp.id }]);
    setMentionAnchor(null);
    setMentionQuery('');
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

  // Restore the plain "Tasks · Digital Leap HRMS" title when the modal
  // closes — Layout's title effect only fires on pathname change, so
  // dropping the ?task= search param doesn't retitle on its own.
  useEffect(() => {
    return () => { try { document.title = 'Tasks · Digital Leap HRMS'; } catch { /* noop */ } };
  }, []);

  const patch = async (data: Record<string, any>) => {
    if (!task) return;
    setSaving(true);
    try {
      await api.patchTask(task.id, data);
      load();
      onChanged();
      // Flash "Saved" for 2s so the change is legibly acknowledged.
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setJustSaved(true);
      savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000);
    } catch (e: any) {
      toast.error('Could not save', e?.message ?? 'Please try again.');
      load();
    } finally { setSaving(false); }
  };

  const addComment = async () => {
    const body = comment.trim();
    if (!body || !task) return;
    // Re-wrap picked mentions from the clean display form (`@Name`)
    // into the id-carrying storage form (`@[Name](id)`) so the backend
    // mention-fanout + the render pass on other clients still resolve.
    // Longest names first so "@Anshum Sharma" doesn't get partially
    // matched by a shorter "@Anshum" mention.
    const wrapped = pickedMentions
      .slice()
      .sort((a, b) => b.name.length - a.name.length)
      .reduce((acc, m) => {
        const needle = `@${m.name}`;
        // Only wrap occurrences that AREN'T already wrapped (idempotent
        // if the user pastes a pre-formatted mention back in).
        const parts: string[] = [];
        let i = 0;
        while (i < acc.length) {
          const hit = acc.indexOf(needle, i);
          if (hit < 0) { parts.push(acc.slice(i)); break; }
          parts.push(acc.slice(i, hit));
          const nextChar = acc[hit + needle.length] ?? '';
          const alreadyWrapped = acc.slice(0, hit).endsWith('[') || acc.startsWith(`@[${m.name}]`, hit);
          const followedByWordChar = /[A-Za-z0-9_]/.test(nextChar);
          if (alreadyWrapped || followedByWordChar) {
            parts.push(needle);
          } else {
            parts.push(`@[${m.name}](${m.id})`);
          }
          i = hit + needle.length;
        }
        return parts.join('');
      }, body);
    setComment('');
    setPickedMentions([]);
    try {
      await api.addTaskComment(task.id, wrapped);
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
              <div className="relative">
                <button onClick={openBoardPicker}
                  title="Move to another board"
                  className="text-[11px] text-on-surface-subtle hover:text-on-surface inline-flex items-center gap-1 group truncate max-w-full">
                  <span className="truncate">{task.project_name ? `${task.project_name} · ` : ''}{task.list_name}</span>
                  <ChevronDown size={10} className="text-on-surface-subtle opacity-60 group-hover:opacity-100" />
                </button>
                {movePickerOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMovePickerOpen(false)} />
                    <div className="absolute z-20 top-full left-0 mt-1 w-72 rounded-lg border border-outline bg-surface shadow-elev-3 py-1">
                      <div className="px-2 pb-1 border-b border-outline">
                        <input value={boardSearch} onChange={e => setBoardSearch(e.target.value)}
                          autoFocus placeholder="Search boards…"
                          className="w-full px-2 py-1.5 rounded border border-outline bg-surface-2 text-xs" />
                      </div>
                      <div className="max-h-56 overflow-y-auto py-1">
                        {boardsLoading && <p className="px-3 py-2 text-[11px] text-on-surface-subtle italic">Loading…</p>}
                        {!boardsLoading && boardsList
                          .filter(b => b.id !== task.list_id)
                          .filter(b => !boardSearch.trim() || `${b.project_name ?? ''} ${b.name}`.toLowerCase().includes(boardSearch.toLowerCase()))
                          .slice(0, 40)
                          .map(b => (
                            <button key={b.id} onClick={() => moveToBoard(b.id)}
                              className="w-full text-left px-3 py-1.5 hover:bg-surface-2 text-xs text-on-surface">
                              <div className="font-semibold">{b.name}</div>
                              {b.project_name && <div className="text-[10px] text-on-surface-subtle">{b.project_name}</div>}
                            </button>
                          ))}
                        {!boardsLoading && boardsList.length === 0 && (
                          <p className="px-3 py-2 text-[11px] text-on-surface-subtle italic">No other boards you can move this to.</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[10px] text-on-surface-subtle font-mono">{taskId}</p>
              {/* Explicit auto-save affordance — replaces the previous
                  bare spinner. Users don't expect an inline-save modal,
                  so the label + state pill removes any doubt about
                  whether their edits landed. */}
              {saving ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent">
                  <Loader2 size={10} className="animate-spin" /> Saving…
                </span>
              ) : justSaved ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success">
                  <Check size={10} /> Saved
                </span>
              ) : (
                <span className="text-[10px] text-on-surface-subtle italic">Changes save automatically</span>
              )}
            </div>
          </div>
          {task && (
            <button
              onClick={async () => {
                // Deep-link format matches the router's ?board=&task=
                // params so pasting the URL into any browser reopens
                // this exact task in a modal. Only the recipient's own
                // board permissions decide whether they get in; anyone
                // without access sees the request-access panel.
                const url = `${window.location.origin}/tasks?board=${task.list_id}&task=${task.id}`;
                try {
                  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
                  else {
                    // clipboard API is HTTPS-only and gated on some
                    // browsers — fall back to a hidden textarea so
                    // the button still works over LAN / older Safari.
                    const ta = document.createElement('textarea');
                    ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
                    document.body.appendChild(ta); ta.select();
                    document.execCommand('copy'); document.body.removeChild(ta);
                  }
                  toast.success('Link copied', 'Share it — only people with board access will be able to open it.');
                } catch (e: any) {
                  toast.error('Copy failed', e?.message ?? 'Copy the URL from the address bar instead.');
                }
              }}
              title="Copy shareable link — access-gated to board members"
              className="p-1.5 rounded-lg text-on-surface-subtle hover:text-accent hover:bg-accent/10"><Link2 size={16} /></button>
          )}
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
        {denied && (
          <div className="p-6 space-y-4">
            <div className="inline-flex items-center gap-2 text-danger">
              <Lock size={18} />
              <h2 className="font-display text-lg font-bold">You don't have access to this task</h2>
            </div>
            <p className="text-sm text-on-surface-muted leading-relaxed">
              This task lives on{' '}
              <span className="font-semibold text-on-surface">{denied.board_name}</span>
              {denied.project_name && <> · {denied.project_name}</>}
              , and you aren't a member of that board. The task's title and content stay private until an admin adds you.
            </p>
            {denied.admins.length > 0 && (
              <div className="rounded-lg border border-outline bg-surface-2 p-3 space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-subtle">Ask one of these people</p>
                <ul className="text-sm text-on-surface space-y-0.5">
                  {denied.admins.map(a => (
                    <li key={a.employee_id} className="flex items-center gap-2">
                      <ShieldAlert size={12} className="text-accent" /> {a.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {reqSent ? (
              <div className="rounded-lg border border-success/30 bg-success-container/40 p-3 text-sm text-on-surface">
                <p className="font-semibold text-success">Request sent.</p>
                <p className="text-xs text-on-surface-muted mt-1">
                  Notified {reqSent.length > 0 ? reqSent.join(', ') : 'the board admins'}. They'll add you if that's the right call.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={async () => {
                    setReqBusy(true);
                    try {
                      const r = await api.requestTaskAccess(taskId);
                      if (r.already_has_access) {
                        toast.success('Access already granted', 'Reloading…');
                        load();
                      } else {
                        setReqSent(r.notified ?? r.admins ?? []);
                        toast.success(r.already_notified ? 'Already asked' : 'Access requested',
                          r.already_notified ? 'You asked in the last 24 hours — admins already have it in their bell.' : 'Board admins have been notified.');
                      }
                    } catch (e: any) {
                      toast.error('Request failed', e?.body?.error ?? e?.message ?? 'Please try again.');
                    } finally { setReqBusy(false); }
                  }}
                  disabled={reqBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                  {reqBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {reqBusy ? 'Sending…' : 'Request access'}
                </button>
                <button onClick={onClose}
                  className="px-3 py-2 rounded-lg border border-outline text-sm font-semibold text-on-surface hover:bg-surface-2">
                  Close
                </button>
              </div>
            )}
          </div>
        )}
        {err && !denied && <div className="p-5 text-sm text-danger">{err}</div>}

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

              {/* Attachments — stored on the VPS files module. Drag files
                  onto the drop zone or click Upload. Downloads open in a
                  new tab via a signed short-lived URL. */}
              <div
                onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); setDragOver(false);
                  if (e.dataTransfer.files?.length) handleFileUpload(e.dataTransfer.files);
                }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Paperclip size={13} className="text-on-surface-muted" />
                  <span className="text-xs font-semibold text-on-surface-muted">
                    Attachments {attachments.length > 0 && `· ${attachments.length}`}
                  </span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">
                    {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                    {uploading ? 'Uploading…' : 'Upload'}
                  </button>
                  <input ref={fileInputRef} type="file" multiple className="hidden"
                    onChange={e => { if (e.target.files?.length) { handleFileUpload(e.target.files); e.target.value = ''; } }} />
                </div>

                {dragOver && (
                  <div className="mb-2 px-3 py-4 rounded-lg border-2 border-dashed border-accent bg-accent/5 text-center text-xs font-semibold text-accent">
                    Drop files to upload
                  </div>
                )}

                {attachmentsLoading && attachments.length === 0 ? (
                  <p className="text-[11px] text-on-surface-subtle italic">Loading…</p>
                ) : attachments.length === 0 && !dragOver ? (
                  <p className="text-[11px] text-on-surface-subtle italic">
                    No files yet. Drag files here or click Upload. Max 25 MB per file, 10 files at a time.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {attachments.map(att => (
                      <div key={att.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-outline bg-surface hover:bg-surface-2 group">
                        <Paperclip size={12} className="text-on-surface-muted shrink-0" />
                        <button onClick={() => downloadAttachment(att)}
                          className="flex-1 text-left text-xs font-medium text-on-surface hover:text-accent truncate">
                          {att.filename}
                        </button>
                        <span className="text-[10px] font-mono text-on-surface-subtle shrink-0">
                          {att.size < 1024 ? `${att.size} B`
                            : att.size < 1024 * 1024 ? `${(att.size / 1024).toFixed(1)} KB`
                            : `${(att.size / (1024 * 1024)).toFixed(1)} MB`}
                        </span>
                        <button onClick={() => downloadAttachment(att)}
                          title="Download"
                          className="p-1 rounded hover:bg-surface-3 text-on-surface-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                          <Download size={12} />
                        </button>
                        <button onClick={() => deleteAttachment(att)}
                          title="Delete"
                          className="p-1 rounded hover:bg-surface-3 text-on-surface-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Time tracking */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Clock size={13} className="text-on-surface-muted" />
                  <span className="text-xs font-semibold text-on-surface-muted">Time</span>
                  <span className="ml-auto text-[11px] font-mono text-on-surface-muted">
                    {formatHoursHuman(totalWithRunningH)} logged
                    {task.estimate_hours ? <> · est {formatHoursHuman(task.estimate_hours)}</> : null}
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {openTimer ? (
                    <button onClick={stopTimer} disabled={timerBusy}
                      className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-semibold bg-danger-container/40 border border-danger/40 text-danger hover:bg-danger-container/60 disabled:opacity-60">
                      <Square size={12} className="fill-current" />
                      <span>Stop timer</span>
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
                  {/* Belt-and-braces: if the caller is currently timing
                      a DIFFERENT task (e.g. they picked the wrong task
                      to time), offer to stop that one from here so
                      they aren't stuck opening the other modal. */}
                  {timingOtherTask && (
                    <button
                      onClick={async () => {
                        try {
                          await api.stopTaskTimer(timingOtherTask.task_id);
                          window.dispatchEvent(new Event('hrms-task-timer-changed'));
                          const fresh = await api.getTaskTime(taskId).catch(() => timeEntries);
                          setTimeEntries(fresh);
                          load();
                        } catch (e: any) { toast.error('Could not stop timer', e?.message ?? 'Please try again.'); }
                      }}
                      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold bg-warning-container/40 border border-warning/40 text-warning hover:bg-warning-container/60"
                      title="You have a timer running on another task — click to stop it">
                      <Square size={11} className="fill-current" /> Stop other timer
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
                              : formatHoursHuman(e.hours)}
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
                      {/* Chips showing everyone the current draft will tag.
                          Type @ to add another; hit × here to drop one
                          without deleting the text. */}
                      {pickedMentions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                          <span className="text-[10px] text-on-surface-subtle self-center mr-1">Tagging:</span>
                          {pickedMentions.map(pm => (
                            <span key={pm.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold">
                              @{pm.name}
                              <button
                                onClick={() => setPickedMentions(prev => prev.filter(p => p.id !== pm.id))}
                                title="Remove tag"
                                className="text-accent/60 hover:text-accent leading-none">×</button>
                            </span>
                          ))}
                        </div>
                      )}
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

              <TagsField
                tags={task.tags ?? []}
                onChange={next => patch({ tags: next })}
              />

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

              {customFields.length > 0 && (
                <div className="pt-2 border-t border-outline space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-on-surface-muted font-semibold">Custom fields</p>
                  {customFields.map(cf => (
                    <CustomFieldEditor key={cf.id} field={cf} taskId={taskId}
                      onChanged={next => setCustomFields(prev => prev.map(f => f.id === cf.id ? { ...f, value: next } : f))} />
                  ))}
                </div>
              )}

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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
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

// Inline editor for one custom field on the task drawer. Auto-saves on
// blur / change so nothing needs a Save button.
function CustomFieldEditor({ field, taskId, onChanged }: {
  field: TaskCustomField; taskId: string; onChanged: (next: any) => void;
}) {
  const [local, setLocal] = useState<any>(field.value ?? '');
  useEffect(() => setLocal(field.value ?? ''), [field.value]);
  const commit = async (v: any) => {
    try {
      await api.setTaskFieldValue(taskId, field.id, v === '' ? null : v);
      onChanged(v === '' ? null : v);
    } catch (e: any) {
      toast.error('Could not save', e?.message ?? 'Please try again.');
      setLocal(field.value ?? '');
    }
  };
  const wrap = 'text-sm w-full px-2 py-1 rounded border border-outline bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40';
  return (
    <div>
      <label className="block text-[10px] text-on-surface-muted font-semibold uppercase tracking-wider mb-1">{field.name}</label>
      {field.kind === 'text' && (
        <input value={local ?? ''} onChange={e => setLocal(e.target.value)} onBlur={() => local !== (field.value ?? '') && commit(local)} className={wrap} />
      )}
      {field.kind === 'number' && (
        <input type="number" value={local ?? ''} onChange={e => setLocal(e.target.value)} onBlur={() => { const n = local === '' ? '' : Number(local); if (String(n) !== String(field.value ?? '')) commit(n); }} className={wrap + ' font-mono'} />
      )}
      {field.kind === 'date' && (
        <input type="date" value={local ?? ''} onChange={e => { setLocal(e.target.value); commit(e.target.value); }} className={wrap} />
      )}
      {field.kind === 'checkbox' && (
        <label className="flex items-center gap-2 text-sm text-on-surface">
          <input type="checkbox" checked={!!local} onChange={e => { setLocal(e.target.checked); commit(e.target.checked); }} />
          {local ? 'Yes' : 'No'}
        </label>
      )}
      {field.kind === 'dropdown' && (
        <select value={local ?? ''} onChange={e => { setLocal(e.target.value); commit(e.target.value); }} className={wrap}>
          <option value="">— none —</option>
          {(field.options?.choices ?? []).map((c: string) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
    </div>
  );
}

// TagsField — freeform tag input. Type + Enter (or comma) to add,
// click × to remove. Server caps at 8 tags per task; we mirror that
// here so the user isn't confused when a 9th silently disappears.
function TagsField({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const MAX_TAGS = 8;
  const clean = (t: string) => t.trim().toLowerCase().replace(/[,\s]+/g, '-').slice(0, 32);
  const commit = () => {
    const raw = draft.split(',').map(clean).filter(Boolean);
    if (!raw.length) return;
    const next = Array.from(new Set([...(tags ?? []), ...raw])).slice(0, MAX_TAGS);
    if (next.length !== (tags ?? []).length || next.some((t, i) => t !== tags?.[i])) onChange(next);
    setDraft('');
  };
  const remove = (t: string) => onChange((tags ?? []).filter(x => x !== t));
  return (
    <div>
      <label className="block text-[11px] font-semibold text-on-surface-muted mb-1">Tags</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {(tags ?? []).map(t => (
          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold">
            {t}
            <button onClick={() => remove(t)} className="text-accent/70 hover:text-accent" title="Remove tag">
              <X size={9} />
            </button>
          </span>
        ))}
      </div>
      {(tags ?? []).length < MAX_TAGS && (
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
            if (e.key === 'Backspace' && !draft && tags?.length) remove(tags[tags.length - 1]);
          }}
          onBlur={commit}
          placeholder={tags?.length ? 'Add another…' : 'design, urgent, bug…'}
          className="text-sm w-full px-2 py-1 rounded border border-outline bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40" />
      )}
      {tags?.length >= MAX_TAGS && (
        <p className="text-[10px] text-on-surface-subtle italic">Max {MAX_TAGS} tags. Remove one to add another.</p>
      )}
    </div>
  );
}

