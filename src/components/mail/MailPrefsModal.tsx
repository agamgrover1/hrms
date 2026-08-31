import { useEffect, useState } from 'react';
import { X, Loader2, Plus, Trash2, Save } from 'lucide-react';
import { mailApi, type MailAccount, type MailTemplate, type MailFilter, type MailFolder } from '../../services/mailApi';
import { toast } from '../Toaster';

// Signature + Templates + Filters preferences, tabbed. Templates are
// per-user (persist across accounts); Signature + Filters are per-
// account (the settings surface preselects the current account).

interface Props {
  account: MailAccount;
  folders: MailFolder[];
  onClose: () => void;
}
type Tab = 'signature' | 'templates' | 'filters';

export default function MailPrefsModal({ account, folders, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('signature');

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] rounded-xl-3 bg-surface border border-outline shadow-elev-4 flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-outline flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-on-surface">Mail preferences</h2>
            <p className="text-[10px] text-on-surface-subtle">{account.email_address}</p>
          </div>
          <button onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={18} /></button>
        </div>
        <div className="px-4 py-2 border-b border-outline flex items-center gap-1">
          {(['signature', 'templates', 'filters'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === t ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {tab === 'signature' && <SignaturePane accountId={account.id} />}
          {tab === 'templates' && <TemplatesPane />}
          {tab === 'filters'   && <FiltersPane accountId={account.id} folders={folders} />}
        </div>
      </div>
    </div>
  );
}

function SignaturePane({ accountId }: { accountId: string }) {
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setLoading(true);
    mailApi.getSignature(accountId)
      .then(s => setBody(s.body_text || ''))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accountId]);
  const save = async () => {
    setSaving(true);
    try {
      await mailApi.saveSignature(accountId, body, body);
      toast.success('Signature saved');
    } catch (e: any) { toast.error('Could not save', e?.body?.error ?? e?.message); }
    finally { setSaving(false); }
  };
  if (loading) return <p className="text-sm text-on-surface-muted">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-on-surface-muted">
        Automatically appended to every outgoing message from this account. Plain text only in this version.
      </p>
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
        placeholder={"—\nYour Name\nJob title · Digital Leap\nphone · linkedin.com/in/you"}
        className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-accent/30" />
      <div className="flex justify-end">
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-60">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save signature
        </button>
      </div>
    </div>
  );
}

function TemplatesPane() {
  const [rows, setRows] = useState<MailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MailTemplate | { new: true } | null>(null);
  const load = () => {
    setLoading(true);
    mailApi.listTemplates().then(setRows).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);
  if (loading) return <p className="text-sm text-on-surface-muted">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-on-surface-muted">
        Reusable snippets you can drop into a compose. Kept per-user (available across all your mailboxes).
      </p>
      <div className="divide-y divide-outline rounded-lg border border-outline">
        {rows.length === 0 && (
          <p className="p-6 text-center text-xs text-on-surface-subtle italic">No templates yet.</p>
        )}
        {rows.map(r => (
          <div key={r.id} className="group flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-on-surface">{r.name}</p>
              {r.subject && <p className="text-[10px] text-on-surface-muted truncate">subject · {r.subject}</p>}
            </div>
            <button onClick={() => setEditing(r)} className="text-[11px] text-brand hover:opacity-80 font-semibold">Edit</button>
            <button onClick={async () => {
              if (!window.confirm(`Delete template "${r.name}"?`)) return;
              try { await mailApi.deleteTemplate(r.id); load(); }
              catch (e: any) { toast.error('Delete failed', e?.body?.error ?? e?.message); }
            }} className="p-1 rounded text-on-surface-subtle hover:text-danger hover:bg-danger/10">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button onClick={() => setEditing({ new: true })}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">
          <Plus size={12} /> New template
        </button>
      </div>
      {editing && <TemplateEditor value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
function TemplateEditor({ value, onClose, onSaved }: { value: MailTemplate | { new: true }; onClose: () => void; onSaved: () => void }) {
  const isNew = 'new' in value;
  const [name, setName]     = useState(isNew ? '' : value.name);
  const [subject, setSubj]  = useState(isNew ? '' : value.subject ?? '');
  const [body, setBody]     = useState(isNew ? '' : value.body);
  const [busy, setBusy]     = useState(false);
  const save = async () => {
    if (!name.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    try {
      if (isNew) await mailApi.createTemplate({ name: name.trim(), subject: subject || null, body });
      else       await mailApi.patchTemplate((value as MailTemplate).id, { name: name.trim(), subject: subject || null, body });
      toast.success('Template saved');
      onSaved();
    } catch (e: any) { toast.error('Save failed', e?.body?.error ?? e?.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl-3 bg-surface border border-outline shadow-elev-4 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold">{isNew ? 'New template' : 'Edit template'}</h3>
          <button onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={16} /></button>
        </div>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">Name</span>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Client kickoff intro"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">Subject (optional)</span>
          <input value={subject} onChange={e => setSubj(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">Body</span>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm font-mono resize-y" />
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-outline text-xs font-semibold hover:bg-surface-2">Cancel</button>
          <button onClick={save} disabled={busy}
            className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {busy && <Loader2 size={12} className="animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

function FiltersPane({ accountId, folders }: { accountId: string; folders: MailFolder[] }) {
  const [rows, setRows] = useState<MailFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MailFilter | { new: true } | null>(null);
  const load = () => {
    setLoading(true);
    mailApi.listFilters(accountId).then(setRows).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, [accountId]);
  if (loading) return <p className="text-sm text-on-surface-muted">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-on-surface-muted">
        Rules run on new mail as it arrives (via IMAP-IDLE). First matching rule wins. Turn a rule off to keep it configured without applying it.
      </p>
      <div className="divide-y divide-outline rounded-lg border border-outline">
        {rows.length === 0 && (
          <p className="p-6 text-center text-xs text-on-surface-subtle italic">No filters yet.</p>
        )}
        {rows.map(r => (
          <div key={r.id} className="group flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={r.enabled} onChange={async e => {
                try { await mailApi.patchFilter(accountId, r.id, { enabled: e.target.checked }); load(); }
                catch (err: any) { toast.error('Update failed', err?.body?.error ?? err?.message); }
              }} />
            </label>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-on-surface truncate">{r.name}</p>
              <p className="text-[10px] text-on-surface-muted truncate">
                if <b>{r.match_field}</b> {r.match_op.replace('_', ' ')} "{r.match_value}" → <b>{r.action}</b>{r.action === 'move' && r.action_target ? ` to ${r.action_target}` : ''}
              </p>
            </div>
            <button onClick={() => setEditing(r)} className="text-[11px] text-brand hover:opacity-80 font-semibold">Edit</button>
            <button onClick={async () => {
              if (!window.confirm(`Delete filter "${r.name}"?`)) return;
              try { await mailApi.deleteFilter(accountId, r.id); load(); }
              catch (e: any) { toast.error('Delete failed', e?.body?.error ?? e?.message); }
            }} className="p-1 rounded text-on-surface-subtle hover:text-danger hover:bg-danger/10">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button onClick={() => setEditing({ new: true })}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">
          <Plus size={12} /> New filter
        </button>
      </div>
      {editing && <FilterEditor accountId={accountId} folders={folders} value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
function FilterEditor({ accountId, folders, value, onClose, onSaved }: {
  accountId: string; folders: MailFolder[]; value: MailFilter | { new: true };
  onClose: () => void; onSaved: () => void;
}) {
  const isNew = 'new' in value;
  const [form, setForm] = useState<Omit<MailFilter, 'id' | 'account_id' | 'created_at'>>(() =>
    isNew
      ? { name: '', match_field: 'from', match_op: 'contains', match_value: '', action: 'move', action_target: null, enabled: true, sort_order: 0 }
      : { ...value as MailFilter }
  );
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!form.name.trim() || !form.match_value.trim()) { toast.error('Name and match value required'); return; }
    if (form.action === 'move' && !form.action_target) { toast.error('Pick a destination folder'); return; }
    setBusy(true);
    try {
      if (isNew) await mailApi.createFilter(accountId, form);
      else       await mailApi.patchFilter(accountId, (value as MailFilter).id, form);
      toast.success('Filter saved');
      onSaved();
    } catch (e: any) { toast.error('Save failed', e?.body?.error ?? e?.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl-3 bg-surface border border-outline shadow-elev-4 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold">{isNew ? 'New filter' : 'Edit filter'}</h3>
          <button onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={16} /></button>
        </div>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">Name</span>
          <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Archive LinkedIn notifications"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm" />
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <label className="block col-span-1">
            <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">If</span>
            <select value={form.match_field} onChange={e => setForm(f => ({ ...f, match_field: e.target.value as any }))}
              className="mt-1 w-full px-2 py-1.5 rounded-lg border border-outline bg-surface text-xs">
              <option value="from">From</option>
              <option value="to">To</option>
              <option value="subject">Subject</option>
              <option value="body">Body</option>
            </select>
          </label>
          <label className="block col-span-1">
            <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">Op</span>
            <select value={form.match_op} onChange={e => setForm(f => ({ ...f, match_op: e.target.value as any }))}
              className="mt-1 w-full px-2 py-1.5 rounded-lg border border-outline bg-surface text-xs">
              <option value="contains">contains</option>
              <option value="equals">equals</option>
              <option value="starts_with">starts with</option>
            </select>
          </label>
          <label className="block col-span-1">
            <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">Value</span>
            <input value={form.match_value} onChange={e => setForm(f => ({ ...f, match_value: e.target.value }))}
              className="mt-1 w-full px-2 py-1.5 rounded-lg border border-outline bg-surface text-xs" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">Then</span>
            <select value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value as any }))}
              className="mt-1 w-full px-2 py-1.5 rounded-lg border border-outline bg-surface text-xs">
              <option value="move">Move to folder</option>
              <option value="delete">Delete</option>
              <option value="seen">Mark as read</option>
              <option value="flag">Star (flag)</option>
            </select>
          </label>
          {form.action === 'move' && (
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">Target folder</span>
              <select value={form.action_target ?? ''} onChange={e => setForm(f => ({ ...f, action_target: e.target.value || null }))}
                className="mt-1 w-full px-2 py-1.5 rounded-lg border border-outline bg-surface text-xs">
                <option value="">— pick —</option>
                {folders.map(f => <option key={f.path} value={f.path}>{f.name.replace(/^INBOX\./, '')}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-on-surface">
          <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
          Enabled
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-outline text-xs font-semibold hover:bg-surface-2">Cancel</button>
          <button onClick={save} disabled={busy}
            className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {busy && <Loader2 size={12} className="animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
