import { useEffect, useState } from 'react';
import { Mail as MailIcon, Plus, X, Loader2, CheckCircle2, Star, Trash2, ShieldCheck } from 'lucide-react';
import { mailApi, type MailAccount } from '../services/mailApi';
import { toast } from '../components/Toaster';

// Phase M1 — Mail module scaffold. All this ships is:
//   • account picker sidebar (empty state + Add mailbox modal)
//   • connection-verified proof (IMAP/SMTP round-trip against Bluehost)
//   • per-account default toggle + delete
// The actual inbox reader lands in M2.

export default function Mail() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setErr('');
    mailApi.listAccounts()
      .then(list => {
        setAccounts(list);
        if (!selectedId && list.length) setSelectedId(list.find(a => a.is_default)?.id ?? list[0].id);
      })
      .catch(e => setErr(e?.body?.error ?? e?.message ?? 'Failed to load mailboxes'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const setDefault = async (id: string) => {
    try {
      await mailApi.setDefault(id);
      toast.success('Default mailbox updated');
      load();
    } catch (e: any) { toast.error('Could not update', e?.body?.error ?? e?.message ?? 'Please try again.'); }
  };
  const remove = async (a: MailAccount) => {
    if (!window.confirm(`Disconnect ${a.email_address}? Your emails aren't deleted — this only removes the credentials from HRMS.`)) return;
    try {
      await mailApi.deleteAccount(a.id);
      toast.success('Mailbox disconnected');
      setSelectedId(null);
      load();
    } catch (e: any) { toast.error('Could not disconnect', e?.body?.error ?? e?.message ?? 'Please try again.'); }
  };

  const selected = accounts.find(a => a.id === selectedId) ?? null;

  return (
    <div className="p-6 h-full max-w-7xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="inline-flex items-center gap-2">
            <MailIcon className="text-accent" size={22} />
            <h1 className="font-display text-2xl font-bold text-on-surface">Mail</h1>
            <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand">Phase M1 · setup only</span>
          </div>
          <p className="text-xs text-on-surface-muted mt-0.5">Connect the mailboxes you use — inbox reader ships next.</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
          <Plus size={14} /> Add mailbox
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger mb-3">{err}</div>
      )}
      {loading && !accounts.length && (
        <div className="p-10 text-center text-sm text-on-surface-muted">Loading mailboxes…</div>
      )}
      {!loading && accounts.length === 0 && (
        <div className="rounded-xl-2 border border-dashed border-outline bg-surface p-10 text-center">
          <MailIcon className="mx-auto text-on-surface-subtle" size={32} />
          <p className="mt-2 text-sm font-semibold text-on-surface">No mailboxes connected yet</p>
          <p className="text-xs text-on-surface-subtle mt-1 max-w-md mx-auto">
            Connect your Bluehost email so you can send and read from inside HRMS.
            Credentials are AES-256 encrypted on the mail server and never leave the VPS.
          </p>
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 mt-4 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
            <Plus size={14} /> Connect your first mailbox
          </button>
        </div>
      )}

      {accounts.length > 0 && (
        <div className="grid grid-cols-[280px_1fr] gap-4 h-[calc(100vh-220px)]">
          <aside className="rounded-xl-2 border border-outline bg-surface overflow-y-auto">
            <div className="px-3 py-2 border-b border-outline bg-surface-2/40 text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">
              Mailboxes · {accounts.length}
            </div>
            {accounts.map(a => (
              <button key={a.id} onClick={() => setSelectedId(a.id)}
                className={`w-full text-left px-3 py-3 flex items-start gap-2 border-b border-outline hover:bg-surface-2 ${selectedId === a.id ? 'bg-brand-container/40' : ''}`}>
                <MailIcon size={14} className="text-brand mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate">{a.email_address}</p>
                    {a.is_default && <Star size={10} className="text-warning fill-warning flex-shrink-0" />}
                  </div>
                  {a.display_name && <p className="text-[10px] text-on-surface-subtle truncate">{a.display_name}</p>}
                  <p className="text-[10px] font-mono text-on-surface-subtle mt-0.5">{a.imap_host}:{a.imap_port}</p>
                </div>
              </button>
            ))}
          </aside>

          <section className="rounded-xl-2 border border-outline bg-surface overflow-y-auto">
            {!selected ? (
              <div className="p-10 text-center text-sm text-on-surface-subtle">Select a mailbox on the left.</div>
            ) : (
              <div className="p-6 space-y-4">
                <div>
                  <p className="font-display text-xl font-bold text-on-surface">{selected.email_address}</p>
                  {selected.display_name && <p className="text-sm text-on-surface-muted">{selected.display_name}</p>}
                </div>
                <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-success inline-flex items-center gap-2">
                  <ShieldCheck size={13} />
                  Connected + verified. Last checked {selected.last_verified_at ? new Date(selected.last_verified_at).toLocaleString('en-IN') : '—'}.
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-outline p-3">
                    <p className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold mb-1">Incoming (IMAP)</p>
                    <p className="font-mono">{selected.imap_host}:{selected.imap_port}</p>
                    <p className="text-[10px] text-on-surface-subtle mt-0.5">{selected.imap_secure ? 'SSL/TLS' : 'STARTTLS'}</p>
                  </div>
                  <div className="rounded-lg border border-outline p-3">
                    <p className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold mb-1">Outgoing (SMTP)</p>
                    <p className="font-mono">{selected.smtp_host}:{selected.smtp_port}</p>
                    <p className="text-[10px] text-on-surface-subtle mt-0.5">{selected.smtp_secure ? 'SSL/TLS' : 'STARTTLS'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-3 border-t border-outline">
                  {!selected.is_default && (
                    <button onClick={() => setDefault(selected.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline text-xs font-semibold hover:bg-surface-2">
                      <Star size={11} /> Make default
                    </button>
                  )}
                  <button onClick={() => remove(selected)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-danger hover:bg-danger/10 ml-auto">
                    <Trash2 size={11} /> Disconnect
                  </button>
                </div>
                <div className="rounded-lg border border-dashed border-outline bg-surface-2/40 p-4 text-xs text-on-surface-muted">
                  <p className="font-semibold text-on-surface mb-1">What's next</p>
                  <p>Inbox reader lands in <b>Phase M2</b> — folder tree, message list, thread view. Compose + reply in M3. Real-time push in M5.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {showAdd && <AddMailboxModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddMailboxModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({
    email: '',
    password: '',
    display_name: '',
    imap_host: 'mail.digitalleapmarketing.com',
    imap_port: 993,
    smtp_host: 'mail.digitalleapmarketing.com',
    smtp_port: 465,
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
      toast.success('Mailbox connected', `${r.account.email_address} · ${r.mailboxes} folders · ${r.total_messages} messages`);
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
          <input autoFocus type="email" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="you@digitalleapmarketing.com"
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Password</label>
          <input type="password" value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            placeholder="Your Bluehost mail password"
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
          <p className="text-[10px] text-on-surface-subtle mt-1">
            AES-256 encrypted on the mail server. Never stored in the HRMS database or logged.
          </p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Display name (optional)</label>
          <input type="text" value={form.display_name}
            onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
            placeholder="Shown as From: name on outgoing mail"
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
