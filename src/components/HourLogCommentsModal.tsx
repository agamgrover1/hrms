import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, X, Send, AtSign } from 'lucide-react';
import { api } from '../services/api';
import { toast } from './Toaster';

// Shared discussion thread for a weekly hour log. Used by reviewers (from
// /hours/approvals) AND by the employee themselves (from My Portal → My
// Hours). Each side gets pinged on the other's reply via the POST endpoint's
// notification logic — this component is just the chat UI.
//
// Kept role-agnostic: any signed-in user can post; the backend decides
// whether to ping the employee or the reviewer based on author identity.
//
// @mentions:
//   - Stored inline as `@[Display Name](emp_<id>)`. The backend parses this
//     format and pings the referenced employee. The renderer below extracts
//     the same tokens and shows them as chips.
//   - The picker is triggered when the user types "@" — it filters the
//     employee list against the partial token after the @, and inserts the
//     `@[Name](id)` token into the textarea on selection. Plain "@" text
//     without a picked employee stays inert (no false positives).

interface HourLogComment {
  id: string;
  author_id: string | null;
  author_name: string | null;
  author_role: string | null;
  body: string;
  created_at: string;
}

interface EmployeeOpt {
  id: string;
  name: string;
  designation?: string | null;
}

const MENTION_TOKEN_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

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

// Render a comment body with mention tokens as chips. We return an array of
// nodes (strings + spans) rather than dangerously-set HTML — keeps XSS
// concerns at zero.
function renderBody(body: string, currentUserId: string, onAccentBubble: boolean): Array<React.ReactNode> {
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  // Reset regex state on every call (it's global).
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > lastIndex) out.push(body.slice(lastIndex, m.index));
    const name = m[1];
    const empId = m[2];
    const isYou = empId === currentUserId;
    // Chip style is parent-aware. Inside an accent-coloured bubble (the
    // author's own message), the regular faint-accent fill blends in and
    // the name disappears — we swap to a high-contrast inverted style
    // (white-on-translucent-black) so the chip stays legible.
    const chipClass = onAccentBubble
      ? 'bg-white/20 text-white border border-white/40'
      : isYou
        ? 'bg-warning-container text-warning border border-warning/40'
        : 'bg-accent/15 text-accent border border-accent/30';
    out.push(
      <span key={`mention-${key++}`}
        className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded-md text-[11px] font-semibold mx-px align-baseline ${chipClass}`}>
        <AtSign size={10} strokeWidth={2.5} />
        {name}
      </span>
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < body.length) out.push(body.slice(lastIndex));
  return out;
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

  // Mention picker state. `pickerStart` is the index of the "@" that opened
  // the picker; we replace the whole `@partial` slice when the user picks.
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerStart, setPickerStart] = useState<number | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerIndex, setPickerIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    api.getHourLogComments(logId)
      .then(setComments)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [logId]);
  useEffect(refresh, [refresh]);

  // Employee directory — used by the @-mention picker. Loaded once.
  useEffect(() => {
    api.getEmployeesSlim()
      .then(rows => setEmployees((rows as any[])
        .filter(e => e.status !== 'inactive')
        .map(e => ({ id: e.id, name: e.name, designation: e.designation }))))
      .catch(() => setEmployees([]));
  }, []);

  // Detect "@partial" while typing and open / update the picker.
  const onDraftChange = (next: string) => {
    setDraft(next);
    const ta = textareaRef.current;
    const caret = ta ? ta.selectionStart ?? next.length : next.length;
    // Walk backwards from the caret until we hit whitespace or start.
    let i = caret - 1;
    while (i >= 0 && !/\s/.test(next[i])) i--;
    const tokenStart = i + 1;
    const token = next.slice(tokenStart, caret);
    if (token.startsWith('@')) {
      // Don't reopen if the slice is already a finished `@[Name](id)` token.
      const afterAt = next.slice(tokenStart);
      if (/^@\[[^\]]+\]\([^)]+\)/.test(afterAt)) {
        setPickerOpen(false);
        return;
      }
      setPickerOpen(true);
      setPickerStart(tokenStart);
      setPickerQuery(token.slice(1));
      setPickerIndex(0);
    } else {
      setPickerOpen(false);
    }
  };

  const matches = useMemo(() => {
    if (!pickerOpen) return [] as EmployeeOpt[];
    const q = pickerQuery.toLowerCase().trim();
    const base = q
      ? employees.filter(e => e.name.toLowerCase().includes(q))
      : employees;
    return base.slice(0, 6);
  }, [employees, pickerOpen, pickerQuery]);

  const insertMention = (emp: EmployeeOpt) => {
    if (pickerStart == null) return;
    const ta = textareaRef.current;
    const caret = ta ? ta.selectionStart ?? draft.length : draft.length;
    const before = draft.slice(0, pickerStart);
    const after  = draft.slice(caret);
    const token  = `@[${emp.name}](${emp.id}) `;
    const next   = before + token + after;
    setDraft(next);
    setPickerOpen(false);
    // Move caret right after the inserted token + trailing space.
    setTimeout(() => {
      const pos = before.length + token.length;
      ta?.focus();
      ta?.setSelectionRange(pos, pos);
    }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex(i => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setPickerIndex(i => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(matches[pickerIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setPickerOpen(false); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post();
  };

  const post = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      const r = await api.addHourLogComment(logId, {
        author_id: currentUser.id,
        author_name: currentUser.name,
        author_role: currentUser.role,
        body: draft.trim(),
      }) as any;
      const mentioned = Array.from(draft.matchAll(MENTION_TOKEN_RE))
        .map(m => m[1])
        .filter(name => name);
      // Suffix message depends on whether tagged users were notified too.
      const detail = mentioned.length
        ? `Notified the other side + ${mentioned.length} tagged user${mentioned.length > 1 ? 's' : ''}.`
        : 'The other side has been notified.';
      toast.success('Comment posted', detail);
      setDraft('');
      refresh();
      onAfterPost?.();
      void r;
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
                    <div className="whitespace-pre-line leading-snug">
                      {renderBody(c.body, currentUser.id, isMe)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="px-6 py-4 border-t border-outline relative">
          {/* Mention picker overlay — anchored above the textarea so it
              doesn't shove the layout around when it opens. */}
          {pickerOpen && matches.length > 0 && (
            <div className="absolute bottom-[88px] left-6 right-6 bg-surface border border-outline rounded-lg shadow-elev-3 overflow-hidden z-10">
              <div className="px-3 py-1.5 border-b border-outline bg-surface-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-subtle inline-flex items-center gap-1">
                <AtSign size={10} /> Tag someone — ↑/↓ + Enter to pick
              </div>
              <ul>
                {matches.map((emp, i) => (
                  <li key={emp.id}>
                    <button type="button"
                      onMouseDown={e => { e.preventDefault(); insertMention(emp); }}
                      onMouseEnter={() => setPickerIndex(i)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                        i === pickerIndex ? 'bg-accent/10 text-accent' : 'text-on-surface hover:bg-surface-2'
                      }`}>
                      <span className="font-semibold truncate">{emp.name}</span>
                      {emp.designation && <span className="text-[11px] text-on-surface-subtle truncate">{emp.designation}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea ref={textareaRef} value={draft}
              onChange={e => onDraftChange(e.target.value)}
              rows={2}
              placeholder="Add a comment… type @ to tag someone"
              onKeyDown={onKeyDown}
              className="flex-1 bg-surface border border-outline rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none" />
            <button onClick={post} disabled={!draft.trim() || posting}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-white bg-accent hover:opacity-90 disabled:opacity-50 transition-colors inline-flex items-center gap-1">
              <Send size={13} /> {posting ? '…' : 'Send'}
            </button>
          </div>
          <p className="text-[10px] text-on-surface-subtle mt-1.5">
            Tip: ⌘/Ctrl + Enter to send · type <span className="font-semibold text-on-surface">@</span> to tag someone.
          </p>
        </div>
      </div>
    </div>
  );
}
