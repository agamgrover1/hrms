import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Copy, Pencil, Trash2, Mail, FileText, X, Check, Tag, Filter } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toaster';

// HR-curated library of email + letter templates. Anyone signed in can
// browse and copy; admin / HR can author, edit, and soft-delete entries.
// Bodies are plain text with {{placeholders}} the user fills in after
// pasting (no auto-fill yet — keeping v1 simple).
interface Template {
  id: string;
  title: string;
  category: string | null;
  format: 'email' | 'letter';
  subject: string | null;
  body: string;
  description: string | null;
  tags: string[] | null;
  active: boolean;
  created_by_name: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

export default function TemplatesHub() {
  const { user } = useAuth();
  const isEditor = user?.role === 'admin' || user?.role === 'hr_manager';
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [formatFilter, setFormatFilter] = useState<'all' | 'email' | 'letter'>('all');
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    api.getTemplates()
      .then(r => setTemplates(r as any))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const t of templates) if (t.category) s.add(t.category);
    return Array.from(s).sort();
  }, [templates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter(t => {
      if (categoryFilter !== 'all' && (t.category || '') !== categoryFilter) return false;
      if (formatFilter !== 'all' && t.format !== formatFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.subject ?? '').toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        (t.body ?? '').toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q) ||
        (t.tags ?? []).some(tag => tag.toLowerCase().includes(q))
      );
    });
  }, [templates, search, categoryFilter, formatFilter]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">Template Hub</h1>
          <p className="text-sm text-on-surface-muted mt-0.5">
            Official emails + letters, ready to copy and paste. HR / admin only for now.
          </p>
        </div>
        {isEditor && (
          <button onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-accent text-on-accent hover:opacity-90 shadow-elev-1">
            <Plus size={15} /> New template
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, body, tag…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
        <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-lg p-1">
          {[
            { k: 'all', label: 'All' },
            { k: 'email', label: 'Emails' },
            { k: 'letter', label: 'Letters' },
          ].map(opt => (
            <button key={opt.k} onClick={() => setFormatFilter(opt.k as any)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                formatFilter === opt.k ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'
              }`}>{opt.label}</button>
          ))}
        </div>
        {categories.length > 0 && (
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="rounded-lg bg-surface border border-outline px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
            <option value="all">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <div className="ml-auto text-xs text-on-surface-subtle">
          <Filter size={11} className="inline -mt-0.5 mr-1" />
          {filtered.length} of {templates.length}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="rounded-xl-2 border border-outline bg-surface px-5 py-12 text-center text-sm text-on-surface-subtle">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl-2 border border-outline bg-surface px-5 py-12 text-center">
          <Mail size={28} className="mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">
            {templates.length === 0
              ? 'No templates yet — HR can seed the library by clicking New template.'
              : 'No matches for the current filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map(t => (
            <TemplateCard key={t.id} template={t}
              isEditor={isEditor}
              onEdit={() => setEditing(t)}
              onChanged={load} />
          ))}
        </div>
      )}

      {/* Editor modals */}
      {(creating || editing) && (
        <TemplateEditor
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function TemplateCard({ template: t, isEditor, onEdit, onChanged }: {
  template: Template; isEditor: boolean; onEdit: () => void; onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<'body' | 'subject' | 'both' | null>(null);

  const copy = (kind: 'body' | 'subject' | 'both') => {
    let text = '';
    if (kind === 'body') text = t.body;
    else if (kind === 'subject') text = t.subject ?? '';
    else text = (t.subject ? `Subject: ${t.subject}\n\n` : '') + t.body;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
      toast.success('Copied to clipboard', kind === 'both' ? 'Subject + body ready to paste' : `${kind === 'body' ? 'Body' : 'Subject'} ready to paste`);
    }).catch(() => toast.error('Copy failed', 'Your browser blocked clipboard access'));
  };

  const remove = async () => {
    if (!confirm(`Archive "${t.title}"? Existing references stay; new users won't see it in the library.`)) return;
    try { await api.deleteTemplate(t.id); onChanged(); toast.success('Archived', t.title); }
    catch (e: any) { toast.error('Archive failed', e?.message); }
  };

  const previewLines = t.body.split('\n').slice(0, 4);
  const truncated = t.body.split('\n').length > 4 || t.body.length > 360;

  return (
    <article className={`rounded-xl-2 border ${t.active ? 'border-outline' : 'border-outline opacity-60'} bg-surface overflow-hidden`}>
      <div className="px-5 py-3 border-b border-outline flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {t.format === 'email'
              ? <Mail size={14} className="text-accent flex-shrink-0" />
              : <FileText size={14} className="text-brand flex-shrink-0" />}
            <h3 className="font-semibold text-on-surface truncate">{t.title}</h3>
            {t.category && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-surface-2 text-on-surface-muted border border-outline">
                {t.category}
              </span>
            )}
            {!t.active && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-danger-container text-danger">Archived</span>
            )}
          </div>
          {t.description && <p className="text-xs text-on-surface-muted mt-1">{t.description}</p>}
          {t.tags && t.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {t.tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                  <Tag size={9} />{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        {isEditor && (
          <div className="flex gap-1 flex-shrink-0">
            <button onClick={onEdit} className="p-1.5 rounded hover:bg-surface-2 text-on-surface-subtle hover:text-on-surface" title="Edit">
              <Pencil size={13} />
            </button>
            <button onClick={remove} className="p-1.5 rounded hover:bg-surface-2 text-on-surface-subtle hover:text-danger" title="Archive">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {t.format === 'email' && t.subject && (
        <div className="px-5 py-2 bg-surface-2/40 border-b border-outline text-xs">
          <span className="text-on-surface-subtle font-semibold uppercase tracking-wider mr-2">Subject</span>
          <span className="text-on-surface">{t.subject}</span>
        </div>
      )}

      <div className="px-5 py-3">
        <pre className="text-xs text-on-surface whitespace-pre-wrap font-sans leading-relaxed">
          {expanded ? t.body : previewLines.join('\n')}
        </pre>
        {!expanded && truncated && (
          <button onClick={() => setExpanded(true)}
            className="mt-2 text-[11px] font-semibold text-accent hover:underline">
            Show full template ↓
          </button>
        )}
        {expanded && (
          <button onClick={() => setExpanded(false)}
            className="mt-2 text-[11px] font-semibold text-on-surface-muted hover:text-on-surface">
            Collapse
          </button>
        )}
      </div>

      <div className="px-5 py-3 border-t border-outline bg-surface-2/30 flex items-center gap-2 flex-wrap">
        {t.format === 'email' && t.subject && (
          <button onClick={() => copy('subject')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-on-surface-muted hover:bg-surface-3 border border-outline">
            {copied === 'subject' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
            {copied === 'subject' ? 'Copied' : 'Copy subject'}
          </button>
        )}
        <button onClick={() => copy('body')}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:opacity-90">
          {copied === 'body' ? <Check size={12} /> : <Copy size={12} />}
          {copied === 'body' ? 'Copied' : 'Copy body'}
        </button>
        {t.format === 'email' && t.subject && (
          <button onClick={() => copy('both')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-outline text-on-surface hover:bg-surface-2">
            {copied === 'both' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
            {copied === 'both' ? 'Copied' : 'Copy both'}
          </button>
        )}
        <p className="ml-auto text-[10px] text-on-surface-subtle">
          {t.updated_by_name ? `Updated by ${t.updated_by_name}` : 'No editor on record'}
        </p>
      </div>
    </article>
  );
}

function TemplateEditor({ existing, onClose, onSaved }: {
  existing: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: existing?.title ?? '',
    category: existing?.category ?? '',
    format: existing?.format ?? 'email' as 'email' | 'letter',
    subject: existing?.subject ?? '',
    body: existing?.body ?? '',
    description: existing?.description ?? '',
    tags: (existing?.tags ?? []).join(', '),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) { setErr('Title and body are required.'); return; }
    setBusy(true); setErr('');
    try {
      const payload = {
        title: form.title.trim(),
        category: form.category.trim() || undefined,
        format: form.format,
        subject: form.format === 'email' ? (form.subject.trim() || undefined) : undefined,
        body: form.body,
        description: form.description.trim() || undefined,
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
      };
      if (existing) await api.updateTemplate(existing.id, payload as any);
      else          await api.addTemplate(payload as any);
      onSaved();
    } catch (e: any) { setErr(e?.message ?? 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-elev-4 w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <h2 className="font-display text-lg font-bold text-on-surface">{existing ? 'Edit template' : 'New template'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-on-surface-muted">Title <span className="text-danger">*</span></label>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Offer letter — full-time"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </div>
            <div>
              <label className="text-xs font-semibold text-on-surface-muted">Format</label>
              <select value={form.format} onChange={e => setForm({ ...form, format: e.target.value as any })}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
                <option value="email">Email</option>
                <option value="letter">Letter</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-on-surface-muted">Category</label>
              <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Offer, Leave, Warning, Appraisal"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </div>
            <div>
              <label className="text-xs font-semibold text-on-surface-muted">Tags <span className="text-on-surface-subtle font-normal">— comma separated</span></label>
              <input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })}
                placeholder="onboarding, hr, formal"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-on-surface-muted">Description <span className="text-on-surface-subtle font-normal">— when to use this</span></label>
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="One-line hint for the next person"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          {form.format === 'email' && (
            <div>
              <label className="text-xs font-semibold text-on-surface-muted">Subject line</label>
              <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}
                placeholder="e.g. Welcome to Digital Leap — your offer details"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-on-surface-muted">
              Body <span className="text-danger">*</span>
              {' '}<span className="text-on-surface-subtle font-normal">— use {'{{employee_name}}'} {'{{date}}'} placeholders</span>
            </label>
            <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })}
              rows={10}
              placeholder={`Dear {{employee_name}},\n\nWe are pleased to extend an offer…\n\nRegards,\nHR Team`}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 font-mono leading-relaxed" />
            <p className="text-[11px] text-on-surface-subtle mt-1">
              Placeholders are kept as-is on copy — users fill them in after pasting.
            </p>
          </div>
          {err && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded px-3 py-2">{err}</p>}
        </div>
        <div className="px-6 py-3 border-t border-outline bg-surface-2/30 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
          <button onClick={save} disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent disabled:opacity-50">
            {busy ? 'Saving…' : (existing ? 'Save changes' : 'Create template')}
          </button>
        </div>
      </div>
    </div>
  );
}
