import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, UserSearch, ExternalLink } from 'lucide-react';
import { api } from '../services/api';
import { HIRING_STAGES, TERMINAL_STAGES, STAGE_COLOR } from '../lib/hiringStages';
import NewCandidateModal from '../components/hr/NewCandidateModal';
import { toast } from '../components/Toaster';

// Hiring kanban — one column per pipeline stage plus terminal columns for
// Hold and Rejected. Cards are draggable to advance stage (native HTML5
// drag-and-drop, no new dep). The board is horizontally scrollable so
// small screens don't force the columns to shrink and become unreadable.

interface Candidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  profile_applied_for: string | null;
  source: string | null;
  resume_url: string | null;
  stage: string;
  status: string;
  updated_at: string;
  created_at: string;
}

export default function Hiring() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setErr('');
    api.listCandidates()
      .then((rs) => setRows(rs as Candidate[]))
      .catch((e: any) => setErr(e?.message ?? 'Failed to load candidates'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  // Client-side search — the endpoint supports server-side too, but the
  // full list is small enough that filtering in memory keeps typing
  // responsive without a debounce dance.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(c =>
      c.name.toLowerCase().includes(q)
      || (c.email ?? '').toLowerCase().includes(q)
      || (c.phone ?? '').toLowerCase().includes(q)
      || (c.profile_applied_for ?? '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const byStage = useMemo(() => {
    const map: Record<string, Candidate[]> = {};
    for (const c of filtered) {
      if (!map[c.stage]) map[c.stage] = [];
      map[c.stage].push(c);
    }
    return map;
  }, [filtered]);

  // Drag handlers — advance stage on drop. Optimistic update: flip the
  // card locally right away, roll back on API error.
  const onDropTo = async (targetStage: string) => {
    const id = dragging;
    setDragging(null); setDragOver(null);
    if (!id) return;
    const card = rows.find(c => c.id === id);
    if (!card || card.stage === targetStage) return;
    const prev = rows;
    setRows(rs => rs.map(c => c.id === id ? { ...c, stage: targetStage } : c));
    try {
      await api.patchCandidate(id, { stage: targetStage });
      toast.success('Stage updated', `${card.name} → ${targetStage.replace(/_/g, ' ')}`);
    } catch (e: any) {
      setRows(prev);
      toast.error('Stage change failed', e?.message ?? 'Please try again.');
    }
  };

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2">
            <UserSearch className="text-accent" size={22} />
            <h1 className="font-display text-2xl font-bold text-on-surface">Hiring</h1>
          </div>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Candidate pipeline · drag cards between columns to advance stage · click a card for the full profile.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email, phone, role…"
              className="w-64 pl-8 pr-3 py-2 rounded-lg border border-outline bg-surface text-sm placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
            <Plus size={14} /> New candidate
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-on-surface-muted">Loading…</div>
      ) : (
        <div className="flex-1 overflow-x-auto pb-2">
          <div className="flex gap-3 min-h-full">
            {[...HIRING_STAGES, ...TERMINAL_STAGES].map(col => {
              const cards = byStage[col.key] ?? [];
              const isTerminal = ['hold', 'rejected'].includes(col.key);
              const color = STAGE_COLOR[col.key] ?? { bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-300' };
              return (
                <div key={col.key}
                  onDragOver={e => { e.preventDefault(); setDragOver(col.key); }}
                  onDragLeave={() => setDragOver(prev => prev === col.key ? null : prev)}
                  onDrop={() => onDropTo(col.key)}
                  className={`w-72 flex-shrink-0 rounded-xl-2 border border-outline bg-surface flex flex-col ${dragOver === col.key ? 'ring-2 ring-accent/50' : ''}`}>
                  <div className={`px-3 py-2 border-b border-outline flex items-center justify-between ${color.bg}`}>
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-wider ${color.text}`}>{col.label}</p>
                      <p className="text-[10px] text-on-surface-subtle mt-0.5">{col.hint}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color.bg} ${color.text} border ${color.ring}`}>
                      {cards.length}
                    </span>
                  </div>
                  <div className="p-2 space-y-2 flex-1 overflow-y-auto" style={{ minHeight: 100 }}>
                    {cards.length === 0 ? (
                      <p className="text-[11px] text-on-surface-subtle text-center py-6 italic">
                        {isTerminal ? 'None here' : 'Empty'}
                      </p>
                    ) : cards.map(c => (
                      <div key={c.id}
                        draggable
                        onDragStart={() => setDragging(c.id)}
                        onDragEnd={() => { setDragging(null); setDragOver(null); }}
                        onClick={() => navigate(`/hiring/${c.id}`)}
                        className={`group cursor-pointer bg-surface border border-outline rounded-lg p-3 hover:shadow-elev-2 hover:border-accent/40 transition-all ${dragging === c.id ? 'opacity-40' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-on-surface text-sm truncate">{c.name}</p>
                          {c.resume_url && (
                            <a href={c.resume_url} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              title="Open resume"
                              className="text-on-surface-subtle hover:text-accent flex-shrink-0">
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                        {c.profile_applied_for && (
                          <p className="text-[11px] text-on-surface-muted truncate mt-0.5">{c.profile_applied_for}</p>
                        )}
                        <div className="flex items-center justify-between mt-2 text-[10px] text-on-surface-subtle">
                          <span>{c.source ?? '—'}</span>
                          <span>{new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showAdd && (
        <NewCandidateModal
          onClose={() => setShowAdd(false)}
          onSaved={cand => { setShowAdd(false); setRows(rs => [cand, ...rs]); }}
        />
      )}
    </div>
  );
}
