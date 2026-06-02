import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Search, Trash2, Filter, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { TYPE_CONFIG, getNotifRoute } from '../components/layout/TopBar';

interface Notif {
  id: number;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
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

// Bucket the type strings into a few human-readable categories so the filter
// dropdown is short. Keys map to a label + a predicate over the type string.
const CATEGORY_RULES: Array<{ key: string; label: string; match: (t: string) => boolean }> = [
  { key: 'leave',    label: 'Leave',           match: t => t.startsWith('leave_') },
  { key: 'wfh',      label: 'WFH',             match: t => t.startsWith('wfh_') },
  { key: 'hours',    label: 'Project Hours',   match: t => t.startsWith('hours_') },
  { key: 'invoice',  label: 'Invoices',        match: t => t.startsWith('invoice_') },
  { key: 'expense',  label: 'Expense Claims',  match: t => t.startsWith('expense_') },
  { key: 'upsell',   label: 'Incentives',      match: t => t.startsWith('upsell_') },
  { key: 'repair',   label: 'IT Repairs',      match: t => t.startsWith('repair_') },
  { key: 'review',   label: 'Performance',     match: t => t.startsWith('review_') || t.startsWith('appraisal_') || t === 'self_assessment_updated' },
  { key: 'discipline', label: 'Warnings & PIP', match: t => t === 'warning_issued' || t === 'pip_assigned' },
];

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = () => {
    if (!user?.id) return;
    setLoading(true); setErr('');
    api.getNotifications(user.id, 300)
      .then(d => setItems(d as Notif[]))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [user?.id]);

  const counts = useMemo(() => ({
    all: items.length,
    unread: items.filter(n => !n.is_read).length,
    read: items.filter(n => n.is_read).length,
  }), [items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const cat = CATEGORY_RULES.find(c => c.key === categoryFilter);
    return items.filter(n => {
      if (readFilter === 'unread' && n.is_read) return false;
      if (readFilter === 'read' && !n.is_read) return false;
      if (cat && !cat.match(n.type)) return false;
      if (!term) return true;
      return (
        n.title.toLowerCase().includes(term) ||
        (n.body ?? '').toLowerCase().includes(term) ||
        n.type.toLowerCase().includes(term)
      );
    });
  }, [items, readFilter, categoryFilter, search]);

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
    const route = getNotifRoute(n.type, user?.role ?? '');
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
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="appearance-none pl-9 pr-9 py-2 text-sm bg-surface border border-outline rounded-lg text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
            <option value="">All categories</option>
            {CATEGORY_RULES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
        </div>
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or body…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-outline rounded-lg text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
      </div>

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
