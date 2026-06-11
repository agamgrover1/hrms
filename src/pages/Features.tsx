import { useEffect, useMemo, useState } from 'react';
import { Plus, X, Edit2, Trash2, Megaphone, CheckCircle, Clock, Eye, Sparkles } from 'lucide-react';
import { api } from '../services/api';
import type { FeatureAnnouncement } from '../services/api';
import { useAuth } from '../context/AuthContext';

// "What's new" management. Anyone with admin/HR access can draft an
// announcement; only admin can publish it. Drafts sit in the top section
// with a big "Approve & Publish" button so the path to going live is
// one click from review. Once published, the row drops into the lower
// section as a record.
export default function Features() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canDraft = isAdmin || user?.role === 'hr_manager';

  const [items, setItems] = useState<FeatureAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FeatureAnnouncement | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    api.getFeatures()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const { drafts, published } = useMemo(() => ({
    drafts:    items.filter(i => i.status === 'draft'),
    published: items.filter(i => i.status === 'published'),
  }), [items]);

  const publish = async (it: FeatureAnnouncement) => {
    if (!confirm(`Publish "${it.title}" to everyone? Each user will see a popup on their next page load.`)) return;
    try { await api.updateFeature(it.id, { status: 'published' }); load(); }
    catch (e: any) { alert(e?.message ?? 'Failed to publish'); }
  };

  const unpublish = async (it: FeatureAnnouncement) => {
    if (!confirm('Unpublish this announcement? Existing acknowledgements are kept, so re-publishing will only popup for new users.')) return;
    try { await api.updateFeature(it.id, { status: 'draft' }); load(); }
    catch (e: any) { alert(e?.message ?? 'Failed to unpublish'); }
  };

  const remove = async (it: FeatureAnnouncement) => {
    if (!confirm(`Delete "${it.title}"? This also wipes the acknowledgement history for it.`)) return;
    try { await api.deleteFeature(it.id); load(); }
    catch (e: any) { alert(e?.message ?? 'Failed to delete'); }
  };

  if (!canDraft) {
    return (
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-12 text-center">
        <Megaphone size={32} className="mx-auto text-on-surface-subtle mb-2" />
        <p className="text-sm text-on-surface-muted">Only admin and HR can manage feature announcements.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface inline-flex items-center gap-2">
            <Sparkles size={20} className="text-accent" /> Features
          </h1>
          <p className="text-sm text-on-surface-muted mt-0.5">
            Draft announcements as you build. {isAdmin ? 'Approve & publish to surface them as a one-time popup for everyone.' : 'Admin will review and publish.'}
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
          <Plus size={14} /> New draft
        </button>
      </div>

      {/* Drafts pending approval */}
      <Section
        title={isAdmin ? 'Awaiting your approval' : 'Drafts'}
        subtitle={isAdmin ? "Drafted but not yet pushed to everyone — review and publish to go live." : "Once admin approves, the popup goes to everyone."}
        accent="warning"
        count={drafts.length}
        emptyText="No drafts. Click New draft to create one."
        loading={loading}
        items={drafts}
        renderItem={it => (
          <FeatureCard key={it.id} item={it} isAdmin={isAdmin}
            onEdit={() => setEditing(it)}
            onPublish={() => publish(it)}
            onDelete={() => remove(it)}
          />
        )}
      />

      {/* Published */}
      <Section
        title="Published"
        subtitle="Live to everyone — the popup shows once per user, then they can revisit it from notifications."
        accent="success"
        count={published.length}
        emptyText="No live announcements yet."
        loading={loading}
        items={published}
        renderItem={it => (
          <FeatureCard key={it.id} item={it} isAdmin={isAdmin}
            onEdit={isAdmin ? () => setEditing(it) : undefined}
            onUnpublish={isAdmin ? () => unpublish(it) : undefined}
            onDelete={isAdmin ? () => remove(it) : undefined}
          />
        )}
      />

      {creating && (
        <FeatureFormModal
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
      {editing && (
        <FeatureFormModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function Section({ title, subtitle, accent, count, emptyText, loading, items, renderItem }: {
  title: string; subtitle: string; accent: 'warning' | 'success';
  count: number; emptyText: string; loading: boolean;
  items: FeatureAnnouncement[]; renderItem: (it: FeatureAnnouncement) => React.ReactNode;
}) {
  const ring = accent === 'warning' ? 'border-warning/30' : 'border-success/20';
  const tag  = accent === 'warning' ? 'bg-warning-container text-warning' : 'bg-success-container text-success';
  return (
    <div className={`bg-surface rounded-xl-3 border ${ring} shadow-elev-1 overflow-hidden`}>
      <div className="px-5 py-4 border-b border-outline flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-on-surface">{title}</h2>
          <p className="text-xs text-on-surface-muted mt-0.5">{subtitle}</p>
        </div>
        <span className={`num-mono text-xs font-bold px-2.5 py-0.5 rounded-full ${tag}`}>{count}</span>
      </div>
      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-on-surface-subtle">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-on-surface-subtle">{emptyText}</div>
      ) : (
        <div className="divide-y divide-outline">{items.map(renderItem)}</div>
      )}
    </div>
  );
}

function FeatureCard({ item, isAdmin, onEdit, onPublish, onUnpublish, onDelete }: {
  item: FeatureAnnouncement;
  isAdmin: boolean;
  onEdit?: () => void;
  onPublish?: () => void;
  onUnpublish?: () => void;
  onDelete?: () => void;
}) {
  const isDraft = item.status === 'draft';
  return (
    <div className="px-5 py-4 flex items-start gap-4 hover:bg-surface-2/40">
      {item.image_url ? (
        <img src={item.image_url} alt="" className="w-20 h-20 rounded-lg object-cover border border-outline flex-shrink-0" />
      ) : (
        <div className="w-20 h-20 rounded-lg bg-gradient-to-br from-accent/10 to-brand-container/30 border border-outline flex items-center justify-center text-accent flex-shrink-0">
          <Sparkles size={22} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="font-display font-bold text-on-surface tracking-tight">{item.title}</h3>
          {isDraft ? (
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-warning-container text-warning">Draft</span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-success-container text-success inline-flex items-center gap-1">
              <CheckCircle size={9} /> Live
            </span>
          )}
        </div>
        <p className="text-sm text-on-surface-muted leading-snug mt-1 whitespace-pre-line">{item.body}</p>
        {item.cta_label && item.cta_url && (
          <a href={item.cta_url} target="_blank" rel="noopener noreferrer"
            className="text-xs font-semibold text-accent mt-1.5 inline-flex items-center gap-1 hover:underline">
            {item.cta_label} →
          </a>
        )}
        <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px] text-on-surface-subtle">
          {item.drafted_by_name && (
            <span><Edit2 size={9} className="inline mr-1" />Drafted by {item.drafted_by_name}</span>
          )}
          {item.published_at && (
            <span className="text-success-fg">
              <CheckCircle size={9} className="inline mr-1" />
              Published {new Date(item.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              {item.approved_by_name ? ` by ${item.approved_by_name}` : ''}
            </span>
          )}
          {isDraft && !item.published_at && (
            <span className="text-warning">
              <Clock size={9} className="inline mr-1" />Awaiting publish
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        {isDraft && isAdmin && (
          <button onClick={onPublish}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-success text-white hover:opacity-90">
            <CheckCircle size={11} /> Approve & Publish
          </button>
        )}
        {!isDraft && onUnpublish && (
          <button onClick={onUnpublish}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold text-on-surface-muted border border-outline hover:bg-surface-2">
            <Eye size={11} /> Unpublish
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold text-on-surface-muted border border-outline hover:bg-surface-2">
            <Edit2 size={11} /> Edit
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold text-danger border border-danger/30 hover:bg-danger-container">
            <Trash2 size={11} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

function FeatureFormModal({ item, onClose, onSaved }: {
  item?: FeatureAnnouncement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? '');
  const [ctaLabel, setCtaLabel] = useState(item?.cta_label ?? '');
  const [ctaUrl, setCtaUrl] = useState(item?.cta_url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!title.trim() || !body.trim()) { setError('Title and body are required'); return; }
    setBusy(true); setError('');
    try {
      const data = {
        title: title.trim(),
        body: body.trim(),
        image_url: imageUrl.trim() || undefined,
        cta_label: ctaLabel.trim() || undefined,
        cta_url: ctaUrl.trim() || undefined,
      };
      if (item) await api.updateFeature(item.id, data);
      else      await api.createFeature(data);
      onSaved();
    } catch (e: any) { setError(e?.message ?? 'Failed to save'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <h2 className="font-display text-lg font-bold text-on-surface">
            {item ? 'Edit announcement' : 'New feature draft'}
          </h2>
          <button onClick={onClose}><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="p-6 space-y-3 overflow-y-auto">
          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
              placeholder="e.g. New To-Do tab on My Portal"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Body *</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={5}
              placeholder="What's new, who it helps, and where to find it. Plain text, line breaks preserved."
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Image URL <span className="text-on-surface-subtle/70 normal-case">(optional)</span></label>
            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              placeholder="https://… (screenshot, GIF, illustration)"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">CTA label</label>
              <input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)}
                placeholder="e.g. Try it"
                className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">CTA link</label>
              <input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)}
                placeholder="/my?tab=todos"
                className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </div>
          </div>
          {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50">
            {busy ? 'Saving…' : item ? 'Save changes' : 'Create draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
