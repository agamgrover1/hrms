import { useEffect, useMemo, useState } from 'react';
import { Award, Plus, Trash2, Loader2, MessageCircle, Send } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../Toaster';

// Peer-to-peer praise wall — used on the Dashboard as a compact "last 7
// days" feed and on the /praise page as a full history. Same component
// with a `mode` prop; the composer + full-comment threads only render
// on the page mode. Dashboard mode is a passive feed with one-tap
// reactions and a short comment preview.

const REACTION_SET = ['👏', '🎉', '❤️', '🔥', '💯', '🙌', '👀'] as const;
type ReactionEmoji = typeof REACTION_SET[number];

interface PraiseReaction { emoji: string; count: number; mine: boolean; }
interface Praise {
  id: string;
  recipient_id: string;
  recipient_name: string;
  from_user_id: string;
  from_name: string;
  message: string;
  category: string | null;
  created_at: string;
  reactions: PraiseReaction[];
  comment_count: number;
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';

// Little colour hash so the avatar tint reads as "someone specific",
// not a generic grey blob. Deterministic per name.
function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 68% 80% / 0.85)`;
}

// Human-readable "3h ago". Same shape used on task cards.
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function PraiseWall({
  mode = 'page',
  limit,
  sinceDays,
  recipientId,
  onGive,
  showGive = true,
}: {
  mode?: 'page' | 'dashboard';
  limit?: number;
  sinceDays?: number;
  recipientId?: string;
  onGive?: () => void;
  showGive?: boolean;
}) {
  const { user } = useAuth();
  const [praises, setPraises] = useState<Praise[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.listPraises({ limit: limit ?? (mode === 'dashboard' ? 5 : 60), since_days: sinceDays ?? (mode === 'dashboard' ? 7 : 90), recipient_id: recipientId })
      .then(rs => setPraises((rs as Praise[]) ?? []))
      .catch(e => toast.error('Failed to load praises', e?.body?.error ?? e?.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [limit, sinceDays, recipientId]);

  const toggleReact = async (praiseId: string, emoji: ReactionEmoji) => {
    // Optimistic — flip locally, revert on failure.
    setPraises(rs => rs.map(p => {
      if (p.id !== praiseId) return p;
      const existing = p.reactions.find(r => r.emoji === emoji);
      let next: PraiseReaction[];
      if (existing) {
        if (existing.mine) {
          // toggle off
          const nc = existing.count - 1;
          next = nc <= 0 ? p.reactions.filter(r => r.emoji !== emoji) : p.reactions.map(r => r.emoji === emoji ? { ...r, count: nc, mine: false } : r);
        } else {
          next = p.reactions.map(r => r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r);
        }
      } else {
        next = [...p.reactions, { emoji, count: 1, mine: true }];
      }
      return { ...p, reactions: next };
    }));
    try { await api.togglePraiseReaction(praiseId, emoji); }
    catch (e: any) {
      toast.error('Reaction failed', e?.body?.error ?? e?.message);
      load();
    }
  };

  const remove = async (p: Praise) => {
    if (!confirm(`Delete this shout-out for ${p.recipient_name}?`)) return;
    try {
      await api.deletePraise(p.id);
      setPraises(rs => rs.filter(r => r.id !== p.id));
    } catch (e: any) { toast.error('Delete failed', e?.body?.error ?? e?.message); }
  };

  if (loading) {
    return (
      <div className={mode === 'dashboard' ? 'py-8' : 'py-16'}>
        <p className="text-center text-xs text-on-surface-subtle">
          <Loader2 size={14} className="inline animate-spin mr-1" /> Loading shout-outs…
        </p>
      </div>
    );
  }

  if (!praises.length) {
    return (
      <div className={`text-center ${mode === 'dashboard' ? 'py-6' : 'py-16'}`}>
        <Award size={mode === 'dashboard' ? 20 : 32} className="mx-auto text-on-surface-subtle mb-2" />
        <p className="text-sm text-on-surface-muted">
          {mode === 'dashboard' ? 'No shout-outs this week.' : 'No shout-outs in the selected window yet.'}
        </p>
        {showGive && onGive && (
          <button onClick={onGive}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">
            <Plus size={12} /> Give the first one
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={mode === 'dashboard' ? 'space-y-2' : 'space-y-3'}>
      {praises.map(p => (
        <PraiseCard
          key={p.id}
          praise={p}
          mode={mode}
          expanded={expanded === p.id}
          onExpand={() => setExpanded(x => x === p.id ? null : p.id)}
          onReact={emoji => toggleReact(p.id, emoji)}
          onDelete={p.from_user_id === user?.id || user?.role === 'admin' ? () => remove(p) : undefined}
        />
      ))}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────

function PraiseCard({
  praise, mode, expanded, onExpand, onReact, onDelete,
}: {
  praise: Praise;
  mode: 'page' | 'dashboard';
  expanded: boolean;
  onExpand: () => void;
  onReact: (emoji: ReactionEmoji) => void;
  onDelete?: () => void;
}) {
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const tint = useMemo(() => tintFor(praise.recipient_name), [praise.recipient_name]);
  const compact = mode === 'dashboard';

  return (
    <div className={`rounded-xl-2 border ${compact ? 'border-outline bg-surface-2/40 p-3' : 'border-outline bg-surface p-4 shadow-elev-1'}`}>
      <div className="flex items-start gap-3">
        <div className={`${compact ? 'w-8 h-8 text-[11px]' : 'w-10 h-10 text-xs'} rounded-full flex items-center justify-center font-bold text-on-surface flex-shrink-0 ring-2 ring-white/10`}
          style={{ background: tint }}>
          {initials(praise.recipient_name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`${compact ? 'text-xs' : 'text-sm'} text-on-surface leading-snug`}>
            <span className="font-semibold">{praise.from_name}</span>
            <span className="text-on-surface-subtle"> praised </span>
            <span className="font-semibold text-accent-ink" style={{ color: 'var(--accent, #EE2770)' }}>{praise.recipient_name}</span>
          </p>
          <p className={`${compact ? 'text-sm' : 'text-[15px]'} text-on-surface mt-1 whitespace-pre-line leading-relaxed`}>
            {praise.message}
          </p>
          <p className="text-[10px] text-on-surface-subtle mt-1.5">
            {timeAgo(praise.created_at)}{praise.category ? ` · ${praise.category}` : ''}
          </p>

          {/* Reactions row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            {praise.reactions.map(r => (
              <button key={r.emoji} onClick={() => onReact(r.emoji as ReactionEmoji)}
                className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all ${
                  r.mine
                    ? 'bg-accent/10 border-accent/40 text-accent-ink'
                    : 'bg-surface border-outline text-on-surface-muted hover:border-accent/40'
                }`}
                title={r.mine ? 'Click to remove your reaction' : 'Click to react'}>
                <span>{r.emoji}</span>
                <span className="num-mono font-semibold">{r.count}</span>
              </button>
            ))}
            <div className="relative">
              <button onClick={() => setShowReactionPicker(v => !v)}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-dashed border-outline text-on-surface-subtle hover:text-on-surface hover:border-accent/40">
                <span>😊</span>
                <Plus size={10} />
              </button>
              {showReactionPicker && (
                <div className="absolute z-10 top-full left-0 mt-1 flex gap-0.5 bg-surface border border-outline rounded-lg p-1 shadow-elev-3">
                  {REACTION_SET.map(e => (
                    <button key={e} onClick={() => { onReact(e); setShowReactionPicker(false); }}
                      className="w-8 h-8 flex items-center justify-center hover:bg-surface-2 rounded text-lg">
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onExpand}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full text-on-surface-muted hover:text-on-surface hover:bg-surface-2">
              <MessageCircle size={11} />
              <span>{praise.comment_count > 0 ? praise.comment_count : ''}</span>
            </button>
            {onDelete && (
              <button onClick={onDelete}
                className="ml-auto p-1 text-on-surface-subtle hover:text-danger rounded"
                title="Delete this shout-out">
                <Trash2 size={11} />
              </button>
            )}
          </div>

          {expanded && <CommentThread praiseId={praise.id} />}
        </div>
      </div>
    </div>
  );
}

// ── Comment thread — lazy-loaded when a card is expanded ─────────────

function CommentThread({ praiseId }: { praiseId: string }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getPraiseComments(praiseId)
      .then(rs => setComments(Array.isArray(rs) ? rs : []))
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  }, [praiseId]);

  const submit = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const c = await api.addPraiseComment(praiseId, draft.trim());
      setComments(cs => [...cs, c]);
      setDraft('');
    } catch (e: any) { toast.error('Comment failed', e?.body?.error ?? e?.message); }
    finally { setBusy(false); }
  };

  const remove = async (cid: string) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.deletePraiseComment(praiseId, cid);
      setComments(cs => cs.filter(c => c.id !== cid));
    } catch (e: any) { toast.error('Delete failed', e?.body?.error ?? e?.message); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-outline space-y-2">
      {loading ? (
        <p className="text-[11px] text-on-surface-subtle italic">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-[11px] text-on-surface-subtle italic">No comments yet. Add one below.</p>
      ) : comments.map(c => (
        <div key={c.id} className="text-xs flex items-start gap-2">
          <span className="font-semibold text-on-surface">{c.from_name}</span>
          <span className="text-on-surface flex-1 leading-snug">{c.text}</span>
          <span className="text-[10px] text-on-surface-subtle">{timeAgo(c.created_at)}</span>
          {(c.from_user_id === user?.id || user?.role === 'admin') && (
            <button onClick={() => remove(c.id)}
              className="text-on-surface-subtle hover:text-danger" title="Delete">
              <Trash2 size={10} />
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <input type="text" value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Add a comment…"
          className="flex-1 text-xs bg-surface border border-outline rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent" />
        <button onClick={submit} disabled={!draft.trim() || busy}
          className="p-1.5 rounded-lg bg-accent text-on-accent disabled:opacity-40 hover:opacity-90">
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}
