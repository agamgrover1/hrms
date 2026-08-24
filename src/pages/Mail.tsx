import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Mail as MailIcon, Plus, X, Loader2, CheckCircle2, Star, Trash2, ShieldCheck,
  Inbox, Send, Archive, AlertOctagon, FileText, Folder as FolderIcon, RefreshCw,
  Paperclip, ChevronLeft, ChevronRight, Settings2, Reply, ReplyAll, Forward,
  Search, FolderInput, Save, Pencil,
} from 'lucide-react';
import { mailApi, mailAttachmentUrl, type MailAccount, type MailFolder, type MailEnvelope, type MailMessage, type MailTemplate } from '../services/mailApi';
import MailPrefsModal from '../components/mail/MailPrefsModal';
import { toast } from '../components/Toaster';
import { useMailStream, type NewMailPush } from '../hooks/useMailStream';
import { resetMailBadge } from '../hooks/useMailBadge';

// M2 — Inbox reader.
// 3-panel layout: mailbox+folder rail | message list | reader.
// Kept deliberately quiet visually so long inboxes don't feel busy.

export default function Mail() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('INBOX');
  const [messages, setMessages] = useState<MailEnvelope[]>([]);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);

  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [listTotal, setListTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [composeSeed, setComposeSeed] = useState<Partial<ComposeSeed> | null>(null);
  const openCompose = (seed: Partial<ComposeSeed> = {}) => setComposeSeed(seed);
  const closeCompose = () => setComposeSeed(null);

  const loadAccounts = () => {
    setLoadingAccounts(true);
    mailApi.listAccounts()
      .then(list => {
        setAccounts(list);
        if (!selectedAccountId && list.length) {
          setSelectedAccountId(list.find(a => a.is_default)?.id ?? list[0].id);
        }
      })
      .catch(e => toast.error('Failed to load mailboxes', e?.body?.error ?? e?.message))
      .finally(() => setLoadingAccounts(false));
  };
  useEffect(loadAccounts, []);

  // Real-time push (M5). Subscribe to every connected account; when a
  // new message lands and it's on the folder we're currently viewing,
  // prepend it to the list. Otherwise just bump the folder's unread
  // count so the folder rail badge updates without a full refresh.
  useEffect(() => { resetMailBadge(); }, []);
  useMailStream(accounts.map(a => a.id), (evt: NewMailPush) => {
    // Refresh folder counts (cheap — one round-trip; the rail bases
    // its badge on this).
    if (selectedAccountId === evt.account_id) {
      // If the user is looking at INBOX for this account, prepend
      // optimistically so the new message appears instantly.
      if (evt.folder === selectedFolder) {
        setMessages(prev => {
          if (prev.some(m => m.uid === evt.uid)) return prev;
          const stub: MailEnvelope = {
            uid: evt.uid, seq: 0,
            subject: evt.subject,
            from: evt.from,
            to: [],
            date: evt.date,
            snippet: '',
            flags: evt.seen ? ['\\Seen'] : [],
            seen: evt.seen,
            flagged: false, answered: false,
            size: 0, has_attachments: false,
          };
          return [stub, ...prev];
        });
        setListTotal(t => t + 1);
      }
      // Always refetch folder counts so the rail badge is honest.
      mailApi.listFolders(selectedAccountId).then(setFolders).catch(() => {});
    }
  });

  const loadFolders = () => {
    if (!selectedAccountId) return;
    setLoadingFolders(true);
    mailApi.listFolders(selectedAccountId)
      .then(setFolders)
      .catch(e => toast.error('Could not list folders', e?.body?.error ?? e?.message))
      .finally(() => setLoadingFolders(false));
  };
  useEffect(loadFolders, [selectedAccountId]);

  const loadMessages = () => {
    if (!selectedAccountId) return;
    setLoadingList(true);
    setMessages([]);
    setSelectedUid(null);
    setMessage(null);
    mailApi.listMessages(selectedAccountId, selectedFolder, { limit: 40 })
      .then(r => { setMessages(r.messages); setListTotal(r.total); })
      .catch(e => toast.error('Could not load messages', e?.body?.error ?? e?.message))
      .finally(() => setLoadingList(false));
  };
  // On folder change: reset search + reload. On account change: same.
  useEffect(() => { setSearch(''); loadMessages(); }, [selectedAccountId, selectedFolder]);

  // Debounced live search. Empty query falls back to the plain listing.
  useEffect(() => {
    if (!selectedAccountId) return;
    const q = search.trim();
    if (!q) { loadMessages(); return; }
    const t = setTimeout(() => {
      setSearching(true);
      mailApi.searchMessages(selectedAccountId, selectedFolder, q, 60)
        .then(r => { setMessages(r.messages); setListTotal(r.total); })
        .catch(e => toast.error('Search failed', e?.body?.error ?? e?.message))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(t);
  }, [search, selectedAccountId, selectedFolder]);

  useEffect(() => {
    if (!selectedAccountId || selectedUid == null) { setMessage(null); return; }
    setLoadingMessage(true);
    mailApi.fetchMessage(selectedAccountId, selectedFolder, selectedUid)
      .then(async msg => {
        setMessage(msg);
        // Auto mark-read on open when it's unread. Optimistic list update
        // + backend flip. No spinner — this is a background nicety.
        const env = messages.find(m => m.uid === selectedUid);
        if (env && !env.seen) {
          setMessages(prev => prev.map(m => m.uid === selectedUid ? { ...m, seen: true } : m));
          setFolders(prev => prev.map(f => f.path === selectedFolder ? { ...f, unread: Math.max(0, f.unread - 1) } : f));
          mailApi.markRead(selectedAccountId, selectedFolder, selectedUid, true).catch(() => {});
        }
      })
      .catch(e => toast.error('Could not open message', e?.body?.error ?? e?.message))
      .finally(() => setLoadingMessage(false));
  }, [selectedAccountId, selectedFolder, selectedUid]);

  const currentAccount = accounts.find(a => a.id === selectedAccountId) ?? null;

  if (!loadingAccounts && accounts.length === 0) {
    return <EmptyState onAdd={() => setShowAdd(true)} onAdded={loadAccounts} showAdd={showAdd} setShowAdd={setShowAdd} />;
  }

  return (
    <div className="h-[calc(100vh-90px)] flex flex-col p-4">
      {/* Header row — compact */}
      <div className="flex items-center gap-3 pb-3 border-b border-outline">
        <MailIcon className="text-accent" size={20} />
        <select value={selectedAccountId ?? ''} onChange={e => setSelectedAccountId(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-outline bg-surface text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-accent/30">
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.email_address}{a.is_default ? ' ★' : ''}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => openCompose()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">
            <Plus size={12} /> Compose
          </button>
          <button onClick={() => { loadFolders(); loadMessages(); }}
            title="Refresh"
            className="p-2 rounded-lg hover:bg-surface-2 text-on-surface-muted"><RefreshCw size={14} className={loadingList ? 'animate-spin' : ''} /></button>
          <button onClick={() => setShowAdd(true)}
            title="Add mailbox"
            className="p-2 rounded-lg hover:bg-surface-2 text-on-surface-muted"><MailIcon size={14} /></button>
          <button onClick={() => setShowSettings(true)}
            title="Mailbox settings"
            className="p-2 rounded-lg hover:bg-surface-2 text-on-surface-muted"><Settings2 size={14} /></button>
        </div>
      </div>

      {/* 3-panel grid */}
      <div className="flex-1 min-h-0 grid grid-cols-[200px_320px_1fr] gap-3 mt-3">
        {/* Folder rail */}
        <aside className="rounded-xl-2 border border-outline bg-surface overflow-y-auto">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-on-surface-muted font-bold border-b border-outline">
            Folders {loadingFolders && <Loader2 size={10} className="inline animate-spin ml-1" />}
          </div>
          {folders.map(f => {
            const Icon = folderIcon(f);
            return (
              <button key={f.path} onClick={() => setSelectedFolder(f.path)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-surface-2 ${selectedFolder === f.path ? 'bg-brand-container/40 border-l-2 border-brand' : ''}`}>
                <Icon size={13} className="text-on-surface-muted flex-shrink-0" />
                <span className={`flex-1 truncate ${f.unread > 0 ? 'font-semibold text-on-surface' : 'text-on-surface-muted'}`}>{friendlyFolderName(f)}</span>
                {f.unread > 0 && <span className="text-[10px] font-mono font-bold text-accent">{f.unread}</span>}
              </button>
            );
          })}
        </aside>

        {/* Message list */}
        <section className="rounded-xl-2 border border-outline bg-surface overflow-y-auto flex flex-col">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-on-surface-muted font-bold border-b border-outline flex items-center justify-between flex-shrink-0">
            <span>{friendlyFolderName(folders.find(f => f.path === selectedFolder))} · {search.trim() ? `${messages.length} found` : listTotal}</span>
            {(loadingList || searching) && <Loader2 size={10} className="animate-spin" />}
          </div>
          <div className="px-2.5 py-1.5 border-b border-outline flex-shrink-0 flex items-center gap-1.5">
            <Search size={12} className="text-on-surface-subtle" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search this folder…"
              className="flex-1 bg-transparent border-0 text-xs focus:outline-none placeholder:text-on-surface-subtle" />
            {search && (
              <button onClick={() => setSearch('')}
                className="p-0.5 rounded text-on-surface-subtle hover:text-on-surface"><X size={11} /></button>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
          {messages.length === 0 && !loadingList && (
            <p className="p-8 text-center text-xs text-on-surface-subtle italic">This folder is empty.</p>
          )}
          {messages.map(m => (
            <button key={m.uid} onClick={() => setSelectedUid(m.uid)}
              className={`w-full text-left px-3 py-2 border-b border-outline hover:bg-surface-2 ${selectedUid === m.uid ? 'bg-brand-container/40' : ''} ${!m.seen ? 'font-semibold' : ''}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-xs truncate flex-1 ${!m.seen ? 'text-on-surface' : 'text-on-surface-muted'}`}>
                  {m.from?.name || m.from?.address || '(unknown)'}
                </span>
                <span className="text-[10px] font-mono text-on-surface-subtle flex-shrink-0">{formatShortDate(m.date)}</span>
              </div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                {!m.seen && <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0 mt-1" />}
                <span className={`text-sm truncate flex-1 ${!m.seen ? 'text-on-surface font-semibold' : 'text-on-surface-muted'}`}>{m.subject}</span>
                {m.has_attachments && <Paperclip size={11} className="text-on-surface-subtle flex-shrink-0" />}
              </div>
            </button>
          ))}
          </div>
        </section>

        {/* Reader */}
        <section className="rounded-xl-2 border border-outline bg-surface overflow-y-auto">
          {loadingMessage && (
            <div className="p-10 text-center text-sm text-on-surface-muted"><Loader2 size={14} className="inline animate-spin" /> Loading message…</div>
          )}
          {!loadingMessage && !message && (
            <div className="p-10 text-center text-sm text-on-surface-subtle">
              Select a message to read.
            </div>
          )}
          {message && !loadingMessage && (
            <MessageReader message={message} accountId={selectedAccountId!} folder={selectedFolder} onRefresh={loadMessages} onCompose={openCompose} account={currentAccount} folders={folders} />
          )}
        </section>
      </div>

      {composeSeed !== null && selectedAccountId && (
        <ComposeModal
          accountId={selectedAccountId}
          fromLabel={currentAccount?.display_name ? `${currentAccount.display_name} <${currentAccount.email_address}>` : currentAccount?.email_address ?? ''}
          seed={composeSeed}
          onClose={closeCompose}
          onSent={() => { closeCompose(); loadMessages(); loadFolders(); }}
        />
      )}
      {showAdd && <AddMailboxModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); loadAccounts(); }} />}
      {showSettings && currentAccount && (
        <MailPrefsModal
          account={currentAccount}
          folders={folders}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ── Reader ────────────────────────────────────────────────────────────

function MessageReader({ message, accountId, folder, onRefresh, onCompose, account, folders }: {
  message: MailMessage; accountId: string; folder: string; onRefresh: () => void;
  onCompose: (seed: Partial<ComposeSeed>) => void;
  account: MailAccount | null;
  folders: MailFolder[];
}) {
  const isDraft = /drafts?/i.test(folder) || folder.toLowerCase().includes('drafts');
  const doDelete = async () => {
    if (!window.confirm('Delete this message? Moves to Trash (or hard-deletes if already in Trash).')) return;
    try {
      const r = await mailApi.deleteMessage(accountId, folder, message.uid);
      toast.success(r.purged ? 'Permanently deleted' : 'Moved to Trash');
      onRefresh();
    } catch (e: any) { toast.error('Delete failed', e?.body?.error ?? e?.message); }
  };
  const doMove = async (destination: string) => {
    try {
      await mailApi.moveMessage(accountId, folder, message.uid, destination);
      toast.success('Moved', destination);
      onRefresh();
    } catch (e: any) { toast.error('Move failed', e?.body?.error ?? e?.message); }
  };
  const doSpam = async () => {
    try {
      const r = await mailApi.markSpam(accountId, folder, message.uid);
      toast.success('Marked as spam', `Moved to ${r.moved_to}`);
      onRefresh();
    } catch (e: any) { toast.error('Move failed', e?.body?.error ?? e?.message); }
  };
  const continueDraft = () => {
    onCompose({
      to: message.to.map(t => t.address).join(', '),
      cc: message.cc.map(t => t.address).join(', '),
      bcc: '',
      subject: message.subject,
      body: message.text ?? '',
      replaces_uid: message.uid,
    });
  };
  const moveTargets = folders.filter(f => f.path !== folder && f.special_use !== '\\Drafts');
  const [moveOpen, setMoveOpen] = useState(false);
  // Use an iframe for HTML bodies — isolates untrusted CSS + JS from
  // the HRMS shell. sandbox="" strips scripts + top-nav; allow-popups
  // opens links in a new window when the user clicks them.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [bodyMode, setBodyMode] = useState<'html' | 'text'>(message.html ? 'html' : 'text');

  useEffect(() => {
    if (bodyMode !== 'html' || !iframeRef.current || !message.html) return;
    // Rewrite anchor targets so link clicks open a new tab rather than
    // navigating the sandboxed iframe (which the sandbox blocks anyway).
    const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
      body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 14px; color: #151321; padding: 4px 8px; }
      img { max-width: 100%; height: auto; }
      a { color: #5b4ce1; }
      blockquote { border-left: 3px solid #E5E2DA; margin-left: 0; padding-left: 12px; color: #6B6577; }
      pre { background: #F0EEE8; padding: 8px; border-radius: 4px; overflow-x: auto; }
    </style></head><body>${message.html}</body></html>`;
    const blob = new Blob([doc], { type: 'text/html' });
    iframeRef.current.src = URL.createObjectURL(blob);
  }, [message.uid, bodyMode]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-outline">
        <h2 className="font-display text-lg font-bold text-on-surface leading-tight">{message.subject}</h2>
        <div className="flex items-baseline justify-between mt-2 gap-3">
          <div className="text-xs text-on-surface-muted">
            <div>
              <span className="font-semibold text-on-surface">{message.from?.name || message.from?.address}</span>
              {message.from?.name && message.from?.address ? <span className="text-on-surface-subtle"> · {message.from.address}</span> : null}
            </div>
            <div className="mt-0.5">
              to {message.to.map(t => t.name || t.address).join(', ') || '—'}
              {message.cc.length > 0 && <>, cc {message.cc.map(t => t.name || t.address).join(', ')}</>}
            </div>
          </div>
          <div className="text-[10px] font-mono text-on-surface-subtle flex-shrink-0">
            {message.date ? new Date(message.date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
          </div>
        </div>
        {message.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.attachments.map(a => (
              <AttachmentChip key={a.index} accountId={accountId} folder={folder} uid={message.uid} att={a} />
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          {isDraft ? (
            <button onClick={continueDraft}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">
              <Pencil size={12} /> Continue editing
            </button>
          ) : (
            <>
              <button onClick={() => onCompose(buildReplySeed(message, account, false))}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold text-on-surface hover:bg-surface-2">
                <Reply size={12} /> Reply
              </button>
              {(message.to.length + message.cc.length) > 1 && (
                <button onClick={() => onCompose(buildReplySeed(message, account, true))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold text-on-surface hover:bg-surface-2">
                  <ReplyAll size={12} /> Reply all
                </button>
              )}
              <button onClick={() => onCompose(buildForwardSeed(message))}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold text-on-surface hover:bg-surface-2">
                <Forward size={12} /> Forward
              </button>
            </>
          )}
          <div className="ml-auto flex items-center gap-1.5 relative">
            <button onClick={() => setMoveOpen(v => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold text-on-surface-muted hover:bg-surface-2">
              <FolderInput size={12} /> Move
            </button>
            {!/junk|spam/i.test(folder) && (
              <button onClick={doSpam}
                title="Move to Junk / Spam folder"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold text-warning hover:bg-warning/10">
                <AlertOctagon size={12} /> Spam
              </button>
            )}
            <button onClick={doDelete}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold text-danger hover:bg-danger/10">
              <Trash2 size={12} /> Delete
            </button>
            {moveOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 min-w-52 rounded-lg border border-outline bg-surface shadow-elev-3 py-1 max-h-72 overflow-auto"
                onMouseLeave={() => setMoveOpen(false)}>
                {moveTargets.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-on-surface-subtle italic">No other folders.</p>
                )}
                {moveTargets.map(f => (
                  <button key={f.path}
                    onClick={() => { setMoveOpen(false); doMove(f.path); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 text-on-surface">
                    {friendlyFolderName(f)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {bodyMode === 'html' && message.html ? (
          <iframe ref={iframeRef} title="message body"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="w-full h-full border-0" />
        ) : (
          <pre className="p-5 text-sm whitespace-pre-wrap font-mono text-on-surface leading-relaxed">{message.text ?? '(no body)'}</pre>
        )}
      </div>

      {message.html && message.text && (
        <div className="px-3 py-2 border-t border-outline flex items-center gap-2 text-[11px]">
          <span className="text-on-surface-subtle">View as:</span>
          <button onClick={() => setBodyMode('html')} className={`px-2 py-0.5 rounded ${bodyMode === 'html' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>HTML</button>
          <button onClick={() => setBodyMode('text')} className={`px-2 py-0.5 rounded ${bodyMode === 'text' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>Plain text</button>
        </div>
      )}
    </div>
  );
}

function AttachmentChip({ accountId, folder, uid, att }: {
  accountId: string; folder: string; uid: number; att: MailMessage['attachments'][number];
}) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const url = await mailAttachmentUrl(accountId, folder, uid, att.index);
      // Newly-opened tab starts the download using the browser's native
      // handler — no client-side blob needed for < 25MB files.
      window.open(url, '_blank', 'noopener');
    } catch (e: any) {
      toast.error('Could not download', e?.message ?? 'Please try again.');
    } finally { setBusy(false); }
  };
  return (
    <button onClick={download} disabled={busy}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-outline text-[11px] text-on-surface hover:bg-surface-2 disabled:opacity-60">
      <Paperclip size={11} />
      <span className="truncate max-w-[220px]">{att.filename}</span>
      <span className="text-[10px] font-mono text-on-surface-subtle">{humanSize(att.size)}</span>
      {busy && <Loader2 size={10} className="animate-spin" />}
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function folderIcon(f: MailFolder) {
  const s = f.special_use ?? '';
  if (f.path === 'INBOX') return Inbox;
  if (s === '\\Sent')    return Send;
  if (s === '\\Drafts')  return FileText;
  if (s === '\\Archive') return Archive;
  if (s === '\\Junk')    return AlertOctagon;
  if (s === '\\Trash')   return Trash2;
  return FolderIcon;
}
function friendlyFolderName(f?: MailFolder) {
  if (!f) return '';
  if (f.path === 'INBOX') return 'Inbox';
  return f.name.replace(/^INBOX\./, '');
}
function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-IN', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' });
}
function humanSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Empty state (no accounts yet) — same as M1 ──────────────────────

function EmptyState({ onAdd, onAdded, showAdd, setShowAdd }: {
  onAdd: () => void; onAdded: () => void; showAdd: boolean; setShowAdd: (v: boolean) => void;
}) {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <MailIcon className="text-accent" size={22} />
        <h1 className="font-display text-2xl font-bold text-on-surface">Mail</h1>
      </div>
      <div className="rounded-xl-2 border border-dashed border-outline bg-surface p-10 text-center">
        <MailIcon className="mx-auto text-on-surface-subtle" size={32} />
        <p className="mt-2 text-sm font-semibold text-on-surface">No mailboxes connected yet</p>
        <p className="text-xs text-on-surface-subtle mt-1 max-w-md mx-auto">
          Connect your Bluehost email so you can read + send from inside HRMS.
          Credentials are AES-256 encrypted on the mail server and never leave the VPS.
        </p>
        <button onClick={onAdd}
          className="inline-flex items-center gap-1.5 mt-4 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
          <Plus size={14} /> Connect your first mailbox
        </button>
      </div>
      {showAdd && <AddMailboxModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); onAdded(); }} />}
    </div>
  );
}

// ── Settings modal (default toggle + disconnect) ─────────────────────

function SettingsModal({ account, onClose, onChanged }: { account: MailAccount; onClose: () => void; onChanged: () => void }) {
  const setDefault = async () => {
    try { await mailApi.setDefault(account.id); toast.success('Default mailbox updated'); onChanged(); }
    catch (e: any) { toast.error('Could not update', e?.body?.error ?? e?.message); }
  };
  const remove = async () => {
    if (!window.confirm(`Disconnect ${account.email_address}?\n\nYour emails aren't deleted — this only removes the credentials from HRMS.`)) return;
    try { await mailApi.deleteAccount(account.id); toast.success('Mailbox disconnected'); onChanged(); }
    catch (e: any) { toast.error('Could not disconnect', e?.body?.error ?? e?.message); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl-3 bg-surface border border-outline shadow-elev-4 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-on-surface">Mailbox settings</h2>
          <button onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={16} /></button>
        </div>
        <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-success inline-flex items-center gap-2 w-full">
          <ShieldCheck size={13} />
          {account.email_address} · connected + verified.
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-outline p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold mb-0.5">IMAP</p>
            <p className="font-mono">{account.imap_host}:{account.imap_port}</p>
          </div>
          <div className="rounded-lg border border-outline p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold mb-0.5">SMTP</p>
            <p className="font-mono">{account.smtp_host}:{account.smtp_port}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-outline">
          {!account.is_default && (
            <button onClick={setDefault} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline text-xs font-semibold hover:bg-surface-2">
              <Star size={11} /> Make default
            </button>
          )}
          <button onClick={remove} className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-danger hover:bg-danger/10">
            <Trash2 size={11} /> Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add-mailbox modal (unchanged from M1) ────────────────────────────

function AddMailboxModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({
    email: '', password: '', display_name: '',
    imap_host: 'mail.digitalleapmarketing.com', imap_port: 993,
    smtp_host: 'mail.digitalleapmarketing.com', smtp_port: 465,
  });
  const [busy, setBusy] = useState<'idle' | 'testing' | 'saving'>('idle');
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string; details?: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const test = async () => {
    setBusy('testing'); setTestResult(null);
    try {
      const r = await mailApi.testAccount(form);
      setTestResult({ ok: true, msg: 'Connected + verified.', details: `${r.mailboxes} folders · ${r.total_messages} messages in INBOX · SMTP OK` });
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.body?.error ?? e?.message ?? 'Connection failed' });
    } finally { setBusy('idle'); }
  };
  const save = async () => {
    setBusy('saving');
    try {
      const r = await mailApi.createAccount(form);
      toast.success('Mailbox connected', `${r.account.email_address} · ${r.mailboxes} folders`);
      onAdded();
    } catch (e: any) {
      toast.error('Could not connect', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy('idle'); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-xl-3 bg-surface border border-outline shadow-elev-4 p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-on-surface">Connect a mailbox</h2>
          <button onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={18} /></button>
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Email address</label>
          <input autoFocus type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="you@digitalleapmarketing.com"
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Password</label>
          <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
          <p className="text-[10px] text-on-surface-subtle mt-1">AES-256 encrypted on the mail server. Never stored in HRMS or logged.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Display name (optional)</label>
          <input type="text" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
        <button type="button" onClick={() => setShowAdvanced(v => !v)}
          className="text-[11px] text-brand font-semibold hover:opacity-80">
          {showAdvanced ? '− Hide' : '+ Server details'} {showAdvanced ? '' : '(default: Bluehost)'}
        </button>
        {showAdvanced && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">IMAP host</span>
              <input value={form.imap_host} onChange={e => setForm(f => ({ ...f, imap_host: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-xs font-mono" />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">IMAP port</span>
              <input type="number" value={form.imap_port} onChange={e => setForm(f => ({ ...f, imap_port: Number(e.target.value) }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-xs font-mono" />
            </label>
            <div />
            <label className="block col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">SMTP host</span>
              <input value={form.smtp_host} onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-xs font-mono" />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">SMTP port</span>
              <input type="number" value={form.smtp_port} onChange={e => setForm(f => ({ ...f, smtp_port: Number(e.target.value) }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-xs font-mono" />
            </label>
          </div>
        )}
        {testResult && (
          <div className={`text-xs p-3 rounded-lg border ${testResult.ok ? 'border-success/30 bg-success/5 text-success' : 'border-danger/30 bg-danger/10 text-danger'}`}>
            <div className="inline-flex items-center gap-1.5 font-semibold">
              {testResult.ok ? <CheckCircle2 size={13} /> : <X size={13} />} {testResult.msg}
            </div>
            {testResult.details && <p className="mt-1 text-[11px] opacity-80">{testResult.details}</p>}
          </div>
        )}
        <div className="flex justify-between gap-2 pt-2 border-t border-outline">
          <button onClick={test} disabled={busy !== 'idle' || !form.email || !form.password}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-outline text-xs font-semibold hover:bg-surface-2 disabled:opacity-50">
            {busy === 'testing' && <Loader2 size={12} className="animate-spin" />} Test connection
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg border border-outline text-xs font-semibold hover:bg-surface-2">Cancel</button>
            <button onClick={save} disabled={busy !== 'idle' || !form.email || !form.password}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-60">
              {busy === 'saving' && <Loader2 size={12} className="animate-spin" />} Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Compose ──────────────────────────────────────────────────────────

interface ComposeSeed {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  in_reply_to?: string;
  references?: string[];
  replaces_uid?: number;   // set when resuming a draft
}

// Build a reply seed from a message. Reply = to the sender only;
// Reply-all = original To + Cc, minus the current user's own address.
function buildReplySeed(m: MailMessage, account: MailAccount | null, all: boolean): Partial<ComposeSeed> {
  const myAddr = account?.email_address.toLowerCase();
  const senderAddr = m.from?.address ?? '';
  const to = [senderAddr].filter(Boolean);
  let cc: string[] = [];
  if (all) {
    const extras = [...m.to, ...m.cc]
      .map(a => a.address)
      .filter(a => a && a.toLowerCase() !== myAddr && a.toLowerCase() !== senderAddr.toLowerCase());
    cc = Array.from(new Set(extras));
  }
  const subj = /^re:\s/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
  const quoted = quoteBody(m);
  return {
    to: to.join(', '),
    cc: cc.join(', '),
    bcc: '',
    subject: subj,
    body: `\n\n${quoted}`,
    // Message-id chaining lives on the raw source; we don't fetch that
    // here so best-effort: pass an empty in_reply_to unless we captured
    // it. A follow-up slice can pull the raw Message-Id via IMAP FETCH.
  };
}
function buildForwardSeed(m: MailMessage): Partial<ComposeSeed> {
  const subj = /^fwd?:\s/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`;
  const quoted = quoteBody(m, true);
  return { to: '', cc: '', bcc: '', subject: subj, body: `\n\n${quoted}` };
}
function quoteBody(m: MailMessage, forward = false): string {
  const dateStr = m.date ? new Date(m.date).toLocaleString('en-IN') : '';
  const sender = m.from?.name ? `${m.from.name} <${m.from.address}>` : (m.from?.address ?? '');
  const header = forward
    ? `----- Forwarded message -----\nFrom: ${sender}\nDate: ${dateStr}\nSubject: ${m.subject}\nTo: ${m.to.map(t => t.address).join(', ')}\n`
    : `On ${dateStr}, ${sender} wrote:`;
  const text = (m.text ?? m.html?.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n') ?? '(no body)').trim();
  return `${header}\n${text.split('\n').map(l => '> ' + l).join('\n')}`;
}

function ComposeModal({ accountId, fromLabel, seed, onClose, onSent }: {
  accountId: string;
  fromLabel: string;
  seed: Partial<ComposeSeed>;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo]           = useState(seed.to ?? '');
  const [cc, setCc]           = useState(seed.cc ?? '');
  const [bcc, setBcc]         = useState(seed.bcc ?? '');
  const [subject, setSubject] = useState(seed.subject ?? '');
  const [body, setBody]       = useState(seed.body ?? '');
  const [showCcBcc, setShowCcBcc] = useState(!!(seed.cc || seed.bcc));
  const [files, setFiles]     = useState<File[]>([]);
  const [busy, setBusy]       = useState<'idle' | 'sending' | 'saving'>('idle');
  const [replacesUid, setReplacesUid] = useState<number | undefined>(seed.replaces_uid);
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  // Auto-append the account's signature to a NEW compose (not replies /
  // forwards / drafts — those already include their own trailing text).
  useEffect(() => {
    if (seed.body || seed.replaces_uid) return;   // don't touch existing bodies
    mailApi.getSignature(accountId).then(s => {
      const sig = s.body_text?.trim();
      if (sig) setBody(prev => `${prev}\n\n${sig}`);
    }).catch(() => {});
  }, [accountId]);
  // Load templates lazily on first picker open.
  const openTemplatePicker = async () => {
    setTemplatePickerOpen(true);
    if (templates.length === 0) {
      try { setTemplates(await mailApi.listTemplates()); } catch { /* leave empty */ }
    }
  };
  const applyTemplate = (t: MailTemplate) => {
    if (t.subject && !subject.trim()) setSubject(t.subject);
    setBody(prev => (prev.trim() ? prev + '\n\n' : '') + t.body);
    setTemplatePickerOpen(false);
  };

  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const overCap = totalSize > 25 * 1024 * 1024 || files.length > 10;

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const added = Array.from(e.target.files ?? []);
    setFiles(prev => [...prev, ...added].slice(0, 10));
    e.target.value = '';
  };
  const removeFile = (i: number) => setFiles(prev => prev.filter((_, j) => j !== i));

  const send = async () => {
    if (!to.trim()) { toast.error('Missing recipient', 'Add at least one To address.'); return; }
    if (overCap)   { toast.error('Attachments too large', '25 MB total, 10 files max.'); return; }
    setBusy('sending');
    try {
      await mailApi.sendMessage(accountId, {
        to: splitAddresses(to),
        cc: splitAddresses(cc),
        bcc: splitAddresses(bcc),
        subject: subject.trim(),
        text: body,
        in_reply_to: seed.in_reply_to,
        references: seed.references,
        attachments: files,
      });
      // If this was a draft being sent, delete the draft copy so it
      // doesn't linger in Drafts. Best-effort — the send already
      // succeeded so we don't error if this fails.
      if (replacesUid) {
        try {
          const dfolder = (await mailApi.listFolders(accountId)).find(f => f.special_use === '\\Drafts' || /drafts?/i.test(f.name));
          if (dfolder) await mailApi.deleteMessage(accountId, dfolder.path, replacesUid);
        } catch { /* leave draft in place */ }
      }
      toast.success('Sent', `Delivered · copy saved to Sent`);
      onSent();
    } catch (e: any) {
      toast.error('Send failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy('idle'); }
  };

  const saveDraft = async () => {
    setBusy('saving');
    try {
      const r = await mailApi.saveDraft(accountId, {
        to: splitAddresses(to),
        cc: splitAddresses(cc),
        bcc: splitAddresses(bcc),
        subject: subject.trim(),
        text: body,
        in_reply_to: seed.in_reply_to,
        references: seed.references,
        replaces_uid: replacesUid,
      });
      setReplacesUid(r.uid);
      toast.success('Draft saved', 'You can close this window and continue later from the Drafts folder.');
    } catch (e: any) {
      toast.error('Draft save failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy('idle'); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-2xl bg-surface border border-outline sm:rounded-xl-3 shadow-elev-4 flex flex-col max-h-[90vh]">
        <div className="px-4 py-3 border-b border-outline flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-on-surface">New message</h2>
          <button onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
          <ComposeField label="From">
            <span className="text-sm text-on-surface-muted">{fromLabel}</span>
          </ComposeField>
          <ComposeField label="To">
            <input value={to} onChange={e => setTo(e.target.value)}
              placeholder="Recipient (comma-separated)"
              className="flex-1 min-w-0 px-1 py-0.5 bg-transparent border-none text-sm focus:outline-none" />
            {!showCcBcc && (
              <button onClick={() => setShowCcBcc(true)} className="text-[11px] text-brand font-semibold hover:opacity-80 flex-shrink-0">Cc / Bcc</button>
            )}
          </ComposeField>
          {showCcBcc && (
            <>
              <ComposeField label="Cc">
                <input value={cc} onChange={e => setCc(e.target.value)}
                  className="flex-1 min-w-0 px-1 py-0.5 bg-transparent border-none text-sm focus:outline-none" />
              </ComposeField>
              <ComposeField label="Bcc">
                <input value={bcc} onChange={e => setBcc(e.target.value)}
                  className="flex-1 min-w-0 px-1 py-0.5 bg-transparent border-none text-sm focus:outline-none" />
              </ComposeField>
            </>
          )}
          <ComposeField label="Subject">
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className="flex-1 min-w-0 px-1 py-0.5 bg-transparent border-none text-sm focus:outline-none" />
          </ComposeField>
          <textarea autoFocus={!seed.body} value={body} onChange={e => setBody(e.target.value)}
            placeholder="Write your message…"
            rows={14}
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent/30" />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-outline bg-surface-2 text-[11px]">
                  <Paperclip size={11} />
                  <span className="truncate max-w-[220px]">{f.name}</span>
                  <span className="text-[10px] font-mono text-on-surface-subtle">{humanSize(f.size)}</span>
                  <button onClick={() => removeFile(i)} className="text-on-surface-subtle hover:text-danger p-0.5">
                    <X size={10} />
                  </button>
                </span>
              ))}
              {overCap && (
                <span className="text-[11px] text-danger self-center">Over 25 MB / 10 files</span>
              )}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-outline flex items-center gap-2 bg-surface-2/40 relative">
          <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold text-on-surface-muted hover:bg-surface-2 cursor-pointer">
            <Paperclip size={12} /> Attach
            <input type="file" multiple onChange={onFileChange} className="hidden" />
          </label>
          <button onClick={openTemplatePicker}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold text-on-surface-muted hover:bg-surface-2">
            <FileText size={12} /> Template
          </button>
          {templatePickerOpen && (
            <div className="absolute bottom-full left-4 mb-2 min-w-56 max-h-72 overflow-y-auto rounded-lg border border-outline bg-surface shadow-elev-4 py-1 z-10">
              {templates.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-on-surface-subtle italic">No templates yet — add one in Mail preferences.</p>
              )}
              {templates.map(t => (
                <button key={t.id} onClick={() => applyTemplate(t)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 text-on-surface">
                  <div className="font-semibold">{t.name}</div>
                  {t.subject && <div className="text-[10px] text-on-surface-subtle truncate">subject · {t.subject}</div>}
                </button>
              ))}
            </div>
          )}
          <span className="text-[10px] text-on-surface-subtle ml-1">Max 25 MB / 10 files</span>
          <button onClick={saveDraft} disabled={busy !== 'idle'}
            title="Save this message to Drafts (no send)"
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold text-on-surface-muted hover:bg-surface-2 disabled:opacity-60">
            {busy === 'saving' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save draft
          </button>
          <button onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-outline text-xs font-semibold hover:bg-surface">
            Cancel
          </button>
          <button onClick={send} disabled={busy !== 'idle' || !to.trim() || overCap}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {busy === 'sending' && <Loader2 size={12} className="animate-spin" />} <Send size={12} /> Send
          </button>
        </div>
      </div>
    </div>
  );
}

function ComposeField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-outline py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold w-14 flex-shrink-0">{label}</span>
      {children}
    </div>
  );
}
function splitAddresses(raw: string): string[] {
  return raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
}
