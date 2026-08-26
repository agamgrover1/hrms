import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Search, Trash2, Filter, ChevronDown, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { TYPE_CONFIG, getNotifRoute } from '../components/layout/TopBar';
import { isActionRequired } from '../lib/notificationTypes';

interface Notif {
  id: number;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

type ReadFilter = 'all' | 'unread' | 'read';

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Top-level bucket: is this notification about the person's work / tasks /
// projects, or about HR-side lifecycle (leave, attendance, appraisals,
// hiring, expenses, etc.)? Everything not explicitly work-related falls
// into HR — new types default to HR, which is the safer place to surface
// them (people read HR more often than tasks).
function isTaskLike(t: string): boolean {
  return (
    t.startsWith('task_') ||
    t.startsWith('hours_') ||
    t.startsWith('allocation_') ||
    t.startsWith('invoice_') ||
    t.startsWith('meeting_') ||
    t === 'announcement_comment'
  );
}

// Within a bucket, offer a per-type category chip filter so the user can
// zoom in ("show me only leave" or "show me only mentions"). Keys map
// to a label + a predicate + which bucket they belong to.
const CATEGORY_RULES: Array<{ key: string; label: string; bucket: 'tasks' | 'hr'; match: (t: string) => boolean }> = [
  // Task bucket
  { key: 'task',       label: 'Tasks',           bucket: 'tasks', match: t => t.startsWith('task_') },
  { key: 'hours',      label: 'Project Hours',   bucket: 'tasks', match: t => t.startsWith('hours_') },
  { key: 'allocation', label: 'Allocation',      bucket: 'tasks', match: t => t.startsWith('allocation_') },
  { key: 'invoice',    label: 'Invoices',        bucket: 'tasks', match: t => t.startsWith('invoice_') },
  { key: 'meeting',    label: 'Meetings',        bucket: 'tasks', match: t => t.startsWith('meeting_') },
  // HR bucket
  { key: 'leave',      label: 'Leave',           bucket: 'hr',    match: t => t.startsWith('leave_') },
  { key: 'wfh',        label: 'WFH',             bucket: 'hr',    match: t => t.startsWith('wfh_') },
  { key: 'attendance', label: 'Attendance',      bucket: 'hr',    match: t => t.startsWith('attendance_') },
  { key: 'expense',    label: 'Expenses',        bucket: 'hr',    match: t => t.startsWith('expense_') },
  { key: 'upsell',     label: 'Incentives',      bucket: 'hr',    match: t => t.startsWith('upsell_') },
  { key: 'repair',     label: 'IT Repairs',      bucket: 'hr',    match: t => t.startsWith('repair_') },
  { key: 'review',     label: 'Performance',     bucket: 'hr',    match: t => t.startsWith('review_') || t.startsWith('appraisal_') || t === 'self_assessment_updated' },
  { key: 'pulse',      label: 'Pulse',           bucket: 'hr',    match: t => t.startsWith('pulse_') },
  { key: 'discipline', label: 'Warnings & PIP',  bucket: 'hr',    match: t => t === 'warning_issued' || t === 'pip_assigned' },
  { key: 'hiring',     label: 'Hiring',          bucket: 'hr',    match: t => t.startsWith('candidate_') || t === 'interview_scheduled' || t === 'interview_feedback_submitted' || t === 'offer_released' },
  { key: 'feature',    label: 'Features',        bucket: 'hr',    match: t => t.startsWith('feature_') },
];

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [actionOnly, setActionOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Top-level split. Defaults to "all" so an existing session's URL still
  // shows everything; user picks Tasks / HR to zoom in.
  const [bucket, setBucket] = useState<'all' | 'tasks' | 'hr'>('all');

  const load = () => {
    if (!user?.id) return;
    setLoading(true); setErr('');
    api.getNotifications(user.id, 300)
      .then(d => setItems(d as Notif[]))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [user?.id]);

  // Items that survive only the top-level bucket filter — used both for
  // per-bucket counts and as the input to the finer-grained filters below.
  const bucketItems = useMemo(() => (
    bucket === 'all' ? items
      : bucket === 'tasks' ? items.filter(n => isTaskLike(n.type))
      : items.filter(n => !isTaskLike(n.type))
  ), [items, bucket]);

  const counts = useMemo(() => ({
    // Bucket-scoped: drives the read/unread pill labels + header.
    all: bucketItems.length,
    unread: bucketItems.filter(n => !n.is_read).length,
    read: bucketItems.filter(n => n.is_read).length,
    actionUnread: bucketItems.filter(n => !n.is_read && isActionRequired(n.type)).length,
    // Global tallies for the top-level tab pills.
    totalAll: items.length,
    totalTasks: items.filter(n => isTaskLike(n.type)).length,
    totalHr: items.filter(n => !isTaskLike(n.type)).length,
    unreadAll: items.filter(n => !n.is_read).length,
    unreadTasks: items.filter(n => !n.is_read && isTaskLike(n.type)).length,
    unreadHr: items.filter(n => !n.is_read && !isTaskLike(n.type)).length,
  }), [items, bucketItems]);

  // Reset the category chip when switching buckets — a "leave" chip has no
  // meaning under the Tasks bucket and vice versa.
  useEffect(() => { setCategoryFilter(''); }, [bucket]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const cat = CATEGORY_RULES.find(c => c.key === categoryFilter);
    return bucketItems.filter(n => {
      if (readFilter === 'unread' && n.is_read) return false;
      if (readFilter === 'read' && !n.is_read) return false;
      if (cat && !cat.match(n.type)) return false;
      if (actionOnly && !isActionRequired(n.type)) return false;
      if (!term) return true;
      return (
        n.title.toLowerCase().includes(term) ||
        (n.body ?? '').toLowerCase().includes(term) ||
        n.type.toLowerCase().includes(term)
      );
    });
  }, [bucketItems, readFilter, categoryFilter, actionOnly, search]);

  // The chip filters visible under this bucket. All-bucket sees everything.
  const visibleCategoryRules = useMemo(() => (
    bucket === 'all' ? CATEGORY_RULES : CATEGORY_RULES.filter(c => c.bucket === bucket)
  ), [bucket]);

  const allSelected = filtered.length > 0 && filtered.every(n => selected.has(n.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(n => n.id)));
  };
  const toggleOne = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const markRead = async (id: number) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    await api.markNotificationRead(id).catch(() => {});
  };
  const markAllRead = async () => {
    if (!user?.id) return;
    setItems(prev => prev.map(n => ({ ...n, is_read: true })));
    await api.markAllNotificationsRead(user.id).catch(() => {});
  };
  const deleteOne = async (id: number) => {
    setItems(prev => prev.filter(n => n.id !== id));
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
    await api.deleteNotification(id).catch(() => {});
  };
  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} notification${selected.size === 1 ? '' : 's'}?`)) return;
    const ids = Array.from(selected);
    setItems(prev => prev.filter(n => !selected.has(n.id)));
    setSelected(new Set());
    await Promise.all(ids.map(id => api.deleteNotification(id).catch(() => {})));
  };
  const markSelectedRead = async () => {
    if (!selected.size) return;
    const ids = Array.from(selected);
    setItems(prev => prev.map(n => selected.has(n.id) ? { ...n, is_read: true } : n));
    setSelected(new Set());
    await Promise.all(ids.map(id => api.markNotificationRead(id).catch(() => {})));
  };
  const clearAll = async () => {
    if (!user?.id) return;
    if (!confirm('Delete ALL notifications? This cannot be undone.')) return;
    setItems([]); setSelected(new Set());
    await api.clearAllNotifications(user.id).catch(() => {});
  };

  const onRowClick = (n: Notif) => {
    if (!n.is_read) markRead(n.id);
    // Prefer the deep-link the notification producer stamped on the
    // row (e.g. /tasks?task=<id>, /meetings?meeting=<id>) so a
    // "commented on your task" click opens THAT task's modal directly
    // instead of dumping the user on a generic /tasks board.
    // getNotifRoute is the fallback for older rows that pre-date the
    // .link column being populated.
    const route = n.link || getNotifRoute(n.type, user?.role ?? '');
    navigate(route);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">Notifications</h1>
          <p className="text-sm text-on-surface-muted mt-0.5">
            {counts.unread > 0 ? <><b className="text-on-surface">{counts.unread}</b> unread of {counts.all}</> : `${counts.all} notification${counts.all === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {counts.unread > 0 && (
            <button onClick={markAllRead}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-outline bg-surface text-on-surface hover:bg-surface-2">
              <Check size={13} /> Mark all read
            </button>
          )}
          {counts.all > 0 && (
            <button onClick={clearAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-danger/30 bg-danger-container/40 text-danger hover:bg-danger-container">
              <Trash2 size={13} /> Clear all
            </button>
          )}
        </div>
      </div>

      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      {/* Bucket tabs — top-level split between task-related and HR-related. */}
      <div className="flex items-center gap-1 border-b border-outline">
        {([
          { key: 'all',   label: 'All',            unread: counts.unreadAll,   total: counts.totalAll },
          { key: 'tasks', label: 'Task-related',   unread: counts.unreadTasks, total: counts.totalTasks },
          { key: 'hr',    label: 'HR-related',     unread: counts.unreadHr,    total: counts.totalHr },
        ] as const).map(t => {
          const active = bucket === t.key;
          return (
            <button key={t.key} onClick={() => setBucket(t.key)}
              className={`px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold transition-colors ${
                active ? 'border-accent text-accent' : 'border-transparent text-on-surface-muted hover:text-on-surface'
              }`}>
              {t.label}
              {t.unread > 0 && (
                <span className={`ml-2 num-mono text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-accent text-on-accent' : 'bg-warning/15 text-warning'}`}>
                  {t.unread}
                </span>
              )}
              <span className="ml-1.5 text-[10px] text-on-surface-subtle num-mono">{t.total}</span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-lg p-0.5">
          {(['all', 'unread', 'read'] as ReadFilter[]).map(k => (
            <button key={k} onClick={() => setReadFilter(k)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${
                readFilter === k ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'
              }`}>
              {k} <span className="num-mono ml-1 opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
        {/* "Action required" toggle — hides FYI notifications and shows
            only items still waiting on the viewer (approvals, review
            requests, submissions). Number is unread + action-required. */}
        <button onClick={() => setActionOnly(v => !v)}
          title="Show only notifications that need you to review or approve something"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            actionOnly
              ? 'bg-warning-container/60 border-warning/40 text-warning'
              : 'bg-surface border-outline text-on-surface-muted hover:text-on-surface hover:bg-surface-2'
          }`}>
          <Zap size={12} /> Action required
          {counts.actionUnread > 0 && (
            <span className="num-mono text-[10px] px-1.5 py-0.5 rounded-full bg-warning text-white">{counts.actionUnread}</span>
          )}
        </button>
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or body…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-outline rounded-lg text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
      </div>

      {/* Category chips — scoped to the current bucket so admin/HR can drill
          straight into a specific noise class without spelunking a dropdown. */}
      {visibleCategoryRules.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Filter size={12} className="text-on-surface-subtle mr-1" />
          <button onClick={() => setCategoryFilter('')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
              categoryFilter === '' ? 'bg-accent text-on-accent border-accent' : 'bg-surface border-outline text-on-surface-muted hover:text-on-surface'
            }`}>
            All
          </button>
          {visibleCategoryRules.map(c => {
            const n = items.filter(it => c.match(it.type)).length;
            if (!n) return null;
            const active = categoryFilter === c.key;
            return (
              <button key={c.key} onClick={() => setCategoryFilter(c.key === categoryFilter ? '' : c.key)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  active ? 'bg-accent text-on-accent border-accent' : 'bg-surface border-outline text-on-surface-muted hover:text-on-surface'
                }`}>
                {c.label} <span className="num-mono opacity-70 ml-0.5">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl-2 bg-accent-container/40 border border-accent/30 px-4 py-2">
          <p className="text-sm text-on-surface">
            <b className="num-mono">{selected.size}</b> selected
          </p>
          <div className="flex items-center gap-2">
            <button onClick={markSelectedRead}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-surface text-on-surface hover:bg-surface-2 border border-outline">
              <Check size={12} /> Mark read
            </button>
            <button onClick={deleteSelected}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-danger-container text-danger hover:opacity-90">
              <Trash2 size={12} /> Delete
            </button>
            <button onClick={() => setSelected(new Set())} className="text-xs text-on-surface-muted hover:text-on-surface">Cancel</button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
        <div className="px-4 py-2 border-b border-outline bg-surface-2/40 flex items-center gap-3">
          <input type="checkbox" checked={allSelected} onChange={toggleAll}
            className="rounded border-outline" />
          <span className="text-xs text-on-surface-muted">
            {filtered.length} of {items.length} {filtered.length === 1 ? 'notification' : 'notifications'}
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-on-surface-subtle">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Bell size={28} className="mx-auto text-on-surface-subtle mb-2" />
            <p className="text-sm text-on-surface-muted">
              {items.length === 0 ? "You're all caught up." : 'No notifications match these filters.'}
            </p>
            {items.length > 0 && (
              <button onClick={() => { setReadFilter('all'); setCategoryFilter(''); setSearch(''); }}
                className="mt-2 text-xs font-semibold text-accent hover:underline">Clear filters</button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-outline">
            {filtered.map(n => {
              const cfg = TYPE_CONFIG[n.type] ?? { icon: Bell, color: '#6b7280', bg: '#f3f4f6' };
              const Icon = cfg.icon;
              const isSel = selected.has(n.id);
              return (
                <div key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors group ${isSel ? 'bg-accent-container/30' : 'hover:bg-surface-2/50'} ${!n.is_read ? 'bg-surface-2/30' : ''}`}>
                  <input type="checkbox" checked={isSel} onChange={() => toggleOne(n.id)} onClick={e => e.stopPropagation()}
                    className="mt-1 rounded border-outline shrink-0" />
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: cfg.bg }}>
                    <Icon size={16} style={{ color: cfg.color }} />
                  </div>
                  <button onClick={() => onRowClick(n)} className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm truncate ${!n.is_read ? 'font-bold text-on-surface' : 'font-medium text-on-surface-muted'}`}>{n.title}</p>
                      {!n.is_read && <span className="w-2 h-2 rounded-full bg-accent shrink-0" />}
                    </div>
                    {n.body && <p className="text-xs text-on-surface-muted mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[10px] text-on-surface-subtle mt-1 font-medium">{timeAgo(n.created_at)} · <span className="text-on-surface-subtle">{n.type}</span></p>
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {!n.is_read && (
                      <button onClick={() => markRead(n.id)} title="Mark read"
                        className="p-1.5 rounded hover:bg-surface-3 text-on-surface-muted hover:text-success">
                        <Check size={14} />
                      </button>
                    )}
                    <button onClick={() => deleteOne(n.id)} title="Delete"
                      className="p-1.5 rounded hover:bg-surface-3 text-on-surface-muted hover:text-danger">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
