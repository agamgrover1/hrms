import { useEffect, useMemo, useState } from 'react';
import { X, History, Plus, Pencil, Archive, RotateCcw, Flag, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';

// Admin-facing audit trail for /projects. Answers "who added / archived
// / edited which project this month" — historically invisible until the
// header counters shifted and someone noticed. Filters mirror the
// server's query params (see GET /api/project-activity).

type Row = {
  id: string;
  project_id: string | null;
  project_name: string | null;
  client_name: string | null;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  before_status: string | null;
  after_status: string | null;
  changes: string | null;
  reason: string | null;
  created_at: string;
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const ACTION_META: Record<string, { label: string; Icon: any; cls: string }> = {
  created:        { label: 'Created',        Icon: Plus,          cls: 'bg-success-container text-success' },
  edited:         { label: 'Edited',         Icon: Pencil,        cls: 'bg-surface-3 text-on-surface-muted' },
  archived:       { label: 'Archived',       Icon: Archive,       cls: 'bg-danger-container text-danger' },
  restored:       { label: 'Restored',       Icon: RotateCcw,     cls: 'bg-success-container text-success' },
  status_changed: { label: 'Status changed', Icon: RotateCcw,     cls: 'bg-warning-container text-warning' },
  flagged:        { label: 'Flagged',        Icon: Flag,          cls: 'bg-warning-container text-warning' },
  unflagged:      { label: 'Unflagged',      Icon: Flag,          cls: 'bg-surface-3 text-on-surface-muted' },
};

function fmtTs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ago(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function ProjectActivityLogModal({ onClose }: { onClose: () => void }) {
  const now = new Date();
  const [month, setMonth] = useState<number | ''>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [action, setAction] = useState<string>('');
  const [actorQuery, setActorQuery] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    api.getProjectActivity({
      month: month === '' ? undefined : Number(month),
      year,
      action: action || undefined,
      limit: 500,
    })
      .then(r => setRows(r ?? []))
      .catch(e => setError(e?.message ?? 'Failed to load activity'))
      .finally(() => setLoading(false));
  }, [month, year, action]);

  // Text filters (actor / project) applied client-side so typing doesn't
  // spam the server. Trim + case-insensitive.
  const filtered = useMemo(() => {
    const a = actorQuery.trim().toLowerCase();
    const p = projectQuery.trim().toLowerCase();
    if (!a && !p) return rows;
    return rows.filter(r =>
      (!a || (r.actor_name ?? '').toLowerCase().includes(a)) &&
      (!p || (r.project_name ?? '').toLowerCase().includes(p) || (r.client_name ?? '').toLowerCase().includes(p))
    );
  }, [rows, actorQuery, projectQuery]);

  // Group rows by calendar day so the reader can scan "what changed on
  // 15 Jul" without doing the arithmetic themselves.
  const grouped = useMemo(() => {
    const out = new Map<string, Row[]>();
    for (const r of filtered) {
      const key = new Date(r.created_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      const arr = out.get(key) ?? [];
      arr.push(r);
      out.set(key, arr);
    }
    return Array.from(out.entries());
  }, [filtered]);

  const counts = useMemo(() => {
    const c = { created: 0, edited: 0, archived: 0, other: 0 };
    for (const r of filtered) {
      if (r.action === 'created') c.created++;
      else if (r.action === 'edited') c.edited++;
      else if (r.action === 'archived') c.archived++;
      else c.other++;
    }
    return c;
  }, [filtered]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-3xl flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-outline flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold text-on-surface inline-flex items-center gap-2">
              <History size={18} className="text-accent" /> Project history
            </h3>
            <p className="text-xs text-on-surface-muted mt-0.5">Every project created, edited, archived, or restored — with actor + timestamp.</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} className="text-on-surface-muted" /></button>
        </div>

        {/* Filter bar */}
        <div className="px-6 py-3 border-b border-outline bg-surface-2/60 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 bg-surface border border-outline rounded-lg px-2 py-1">
            <select value={month} onChange={e => setMonth(e.target.value === '' ? '' : Number(e.target.value))}
              className="bg-transparent text-sm font-semibold text-on-surface focus:outline-none">
              <option value="">All months</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="bg-transparent text-sm font-semibold text-on-surface num-mono focus:outline-none">
              {[year - 2, year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <select value={action} onChange={e => setAction(e.target.value)}
            className="text-sm bg-surface border border-outline rounded-lg px-3 py-1.5 text-on-surface-muted focus:outline-none focus:ring-2 focus:ring-accent/30">
            <option value="">All actions</option>
            <option value="created">Created</option>
            <option value="edited">Edited</option>
            <option value="archived">Archived</option>
            <option value="restored">Restored</option>
            <option value="status_changed">Status changed</option>
            <option value="flagged">Flagged</option>
            <option value="unflagged">Unflagged</option>
          </select>
          <input value={projectQuery} onChange={e => setProjectQuery(e.target.value)}
            placeholder="Project or client…"
            className="text-sm bg-surface border border-outline rounded-lg px-3 py-1.5 text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
          <input value={actorQuery} onChange={e => setActorQuery(e.target.value)}
            placeholder="Actor name…"
            className="text-sm bg-surface border border-outline rounded-lg px-3 py-1.5 text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>

        {/* Count strip */}
        <div className="px-6 py-2 border-b border-outline text-[11px] text-on-surface-muted flex items-center gap-4 flex-wrap">
          <span><span className="num-mono font-semibold text-on-surface">{filtered.length}</span> events</span>
          <span className="text-success">● <span className="num-mono font-semibold">{counts.created}</span> created</span>
          <span className="text-on-surface-muted">● <span className="num-mono font-semibold">{counts.edited}</span> edited</span>
          <span className="text-danger">● <span className="num-mono font-semibold">{counts.archived}</span> archived</span>
          {counts.other > 0 && <span>● <span className="num-mono font-semibold">{counts.other}</span> other</span>}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-on-surface-subtle text-center py-12">Loading…</p>
          ) : error ? (
            <div className="mx-6 my-4 rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">
              <AlertTriangle size={14} className="inline mr-1" /> {error}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-on-surface-subtle text-center py-12">
              No project activity for the selected filters.
            </p>
          ) : (
            <div className="divide-y divide-outline">
              {grouped.map(([day, dayRows]) => (
                <div key={day}>
                  <div className="px-6 py-2 bg-surface-2/60 sticky top-0 z-10">
                    <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">{day}</p>
                  </div>
                  <ul>
                    {dayRows.map(r => {
                      const meta = ACTION_META[r.action] ?? ACTION_META.edited;
                      const Icon = meta.Icon;
                      return (
                        <li key={r.id} className="px-6 py-3 flex items-start gap-3 hover:bg-surface-2/30 transition-colors">
                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 ${meta.cls}`}>
                            <Icon size={13} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-on-surface leading-snug">
                              <span className="font-semibold">{r.actor_name ?? 'Unknown'}</span>
                              {r.actor_role && (
                                <span className="ml-1 inline-flex items-center px-1.5 py-0 rounded-full text-[9px] font-bold uppercase tracking-wider bg-surface-3 text-on-surface-muted">
                                  {r.actor_role.replace('_', ' ')}
                                </span>
                              )}
                              <span className="text-on-surface-muted"> {meta.label.toLowerCase()} </span>
                              <span className="font-semibold">{r.project_name ?? '(deleted project)'}</span>
                              {r.client_name && <span className="text-on-surface-muted"> · {r.client_name}</span>}
                            </p>
                            {r.action === 'status_changed' && r.before_status && r.after_status && (
                              <p className="text-[11px] text-on-surface-muted mt-0.5">
                                Status: <span className="text-on-surface-subtle">{r.before_status}</span>
                                {' → '}
                                <span className="font-semibold text-on-surface">{r.after_status}</span>
                              </p>
                            )}
                            {r.action === 'edited' && r.changes && (
                              <p className="text-[11px] text-on-surface-muted mt-0.5">
                                Changed: <span className="text-on-surface">{r.changes.split(' ').join(', ')}</span>
                              </p>
                            )}
                            {r.reason && (
                              <p className="text-[11px] mt-1 italic text-warning bg-warning-container px-2 py-1 rounded">
                                "{r.reason}"
                              </p>
                            )}
                          </div>
                          <p className="text-[10px] text-on-surface-subtle font-mono whitespace-nowrap pt-1" title={fmtTs(r.created_at)}>
                            {ago(r.created_at)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-outline bg-surface-2/60 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-3 rounded-lg">Close</button>
        </div>
      </div>
    </div>
  );
}
