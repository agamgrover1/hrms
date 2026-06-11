import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, X, Send } from 'lucide-react';
import { api } from '../services/api';
import { toast } from './Toaster';

// Shared discussion thread for a weekly hour log. Used by reviewers (from
// /hours/approvals) AND by the employee themselves (from My Portal → My
// Hours). Each side gets pinged on the other's reply via the POST endpoint's
// notification logic — this component is just the chat UI.
//
// Kept role-agnostic: any signed-in user can post; the backend decides
// whether to ping the employee or the reviewer based on author identity.

interface HourLogComment {
  id: string;
  author_id: string | null;
  author_name: string | null;
  author_role: string | null;
  body: string;
  created_at: string;
}

function ago(ts: string | null | undefined): string {
  if (!ts) return '';
  const ms = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function HourLogCommentsModal({
  logId, subtitle, currentUser, onClose, onAfterPost,
}: {
  logId: string;
  /** Free-text header line shown under "Discussion" — e.g. "Acme · W2 · 12h" */
  subtitle: string;
  currentUser: { id: string; name: string; role: string };
  onClose: () => void;
  onAfterPost?: () => void;
}) {
  const [comments, setComments] = useState<HourLogComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    api.getHourLogComments(logId)
      .then(setComments)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [logId]);
  useEffect(refresh, [refresh]);

  const post = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await api.addHourLogComment(logId, {
        author_id: currentUser.id,
        author_name: currentUser.name,
        author_role: currentUser.role,
        body: draft.trim(),
      });
      toast.success('Comment posted', 'The other side has been notified.');
      setDraft('');
      refresh();
      onAfterPost?.();
    } catch (e: any) { toast.error('Failed to post comment', e?.message); }
    finally { setPosting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <div>
            <h3 className="font-display text-lg font-semibold text-on-surface inline-flex items-center gap-2">
              <MessageSquare size={18} className="text-accent" /> Discussion
            </h3>
            <p className="text-xs text-on-surface-muted mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3 overflow-y-auto flex-1 bg-surface-2/30">
          {loading ? (
            <p className="text-sm text-on-surface-subtle text-center py-8">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-on-surface-subtle text-center py-8">
              No comments yet. Start the conversation below.
            </p>
          ) : (
            comments.map(c => {
              const isMe = !!c.author_id && c.author_id === currentUser.id;
              return (
                <div key={c.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${isMe ? 'bg-accent text-on-accent' : 'bg-surface border border-outline text-on-surface'}`}>
                    <div className={`text-[10px] font-semibold mb-0.5 ${isMe ? 'text-on-accent/80' : 'text-on-surface-muted'}`}>
                      {c.author_name || 'Unknown'}{c.author_role ? ` · ${c.author_role}` : ''} · {ago(c.created_at)}
                    </div>
                    <div className="whitespace-pre-line leading-snug">{c.body}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="px-6 py-4 border-t border-outline">
          <div className="flex items-end gap-2">
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
              placeholder="Add a comment…"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }}
              className="flex-1 bg-surface border border-outline rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none" />
            <button onClick={post} disabled={!draft.trim() || posting}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-white bg-accent hover:opacity-90 disabled:opacity-50 transition-colors inline-flex items-center gap-1">
              <Send size={13} /> {posting ? '…' : 'Send'}
            </button>
          </div>
          <p className="text-[10px] text-on-surface-subtle mt-1.5">Tip: ⌘/Ctrl + Enter to send.</p>
        </div>
      </div>
    </div>
  );
}
