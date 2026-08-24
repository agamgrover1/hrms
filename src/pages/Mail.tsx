import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Mail as MailIcon, Plus, X, Loader2, CheckCircle2, Star, Trash2, ShieldCheck,
  Inbox, Send, Archive, AlertOctagon, FileText, Folder as FolderIcon, RefreshCw,
  Paperclip, ChevronLeft, ChevronRight, Settings2,
} from 'lucide-react';
import { mailApi, mailAttachmentUrl, type MailAccount, type MailFolder, type MailEnvelope, type MailMessage } from '../services/mailApi';
import { toast } from '../components/Toaster';

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
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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
  useEffect(loadMessages, [selectedAccountId, selectedFolder]);

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
          <button onClick={() => { loadFolders(); loadMessages(); }}
            title="Refresh"
            className="p-2 rounded-lg hover:bg-surface-2 text-on-surface-muted"><RefreshCw size={14} className={loadingList ? 'animate-spin' : ''} /></button>
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">
            <Plus size={12} /> Add mailbox
          </button>
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
        <section className="rounded-xl-2 border border-outline bg-surface overflow-y-auto">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-on-surface-muted font-bold border-b border-outline flex items-center justify-between">
            <span>{friendlyFolderName(folders.find(f => f.path === selectedFolder))} · {listTotal}</span>
            {loadingList && <Loader2 size={10} className="animate-spin" />}
          </div>
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
            <MessageReader message={message} accountId={selectedAccountId!} folder={selectedFolder} onRefresh={loadMessages} />
          )}
        </section>
      </div>

      {showAdd && <AddMailboxModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); loadAccounts(); }} />}
      {showSettings && currentAccount && (
        <SettingsModal
          account={currentAccount}
          onClose={() => setShowSettings(false)}
          onChanged={() => { setShowSettings(false); loadAccounts(); }}
        />
      )}
    </div>
  );
}

// ── Reader ────────────────────────────────────────────────────────────

function MessageReader({ message, accountId, folder, onRefresh }: {
  message: MailMessage; accountId: string; folder: string; onRefresh: () => void;
}) {
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
