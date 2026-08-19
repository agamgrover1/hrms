import { useEffect, useState } from 'react';
import { X, Loader2, UserPlus, ExternalLink } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../Toaster';

// Stage-A candidate entry — per the workflow PDF, initial entry captures
// only resume-based fields. Salary, experience, notice period etc. are
// filled later on the profile page after the HR screening call. Keeps
// the form short so HR can dump a new resume in under 30 seconds.

interface Props {
  onClose: () => void;
  onSaved: (candidate: any) => void;
}

export default function NewCandidateModal({ onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    profile_applied_for: '',
    source: '',
    source_other: '',
    resume_url: '',
  });
  const [designations, setDesignations] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Both dropdowns come from config so admin can manage them from the
    // Configuration page without touching code. Fetched in parallel; on
    // failure we just show an empty select (form still submittable).
    api.getConfigDesignations().then(setDesignations).catch(() => setDesignations([]));
    api.getConfigSources().then(setSources).catch(() => setSources([]));
  }, []);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Candidate name is required.'); return; }
    setBusy(true);
    try {
      const cand: any = await api.createCandidate({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        profile_applied_for: form.profile_applied_for || undefined,
        source: form.source || undefined,
        source_other: form.source === 'Other' ? form.source_other.trim() : undefined,
        resume_url: form.resume_url.trim() || undefined,
      });
      toast.success('Candidate added', `${form.name.trim()} is now in the Sourced column.`);
      onSaved(cand);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to add candidate.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl border border-outline shadow-elev-4 w-full max-w-lg flex flex-col">
        <div className="px-6 py-4 border-b border-outline flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
              <UserPlus size={18} />
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-on-surface">New candidate</h3>
              <p className="text-xs text-on-surface-muted mt-0.5">
                Enter what's on the resume. Salary, experience, notice period etc. fill in after the HR screening call.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-2">
            <X size={16} className="text-on-surface-muted" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-on-surface-muted mb-1">
              Candidate name <span className="text-danger">*</span>
            </label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              required autoFocus
              placeholder="Full name from resume"
              className="w-full px-3 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-on-surface-muted mb-1">Contact number</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="+91…"
                className="w-full px-3 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent text-sm num-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-muted mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="candidate@example.com"
                className="w-full px-3 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-on-surface-muted mb-1">Profile applied for</label>
              <select value={form.profile_applied_for} onChange={e => set('profile_applied_for', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent text-sm">
                <option value="">— pick a designation —</option>
                {designations.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-muted mb-1">Source</label>
              <select value={form.source} onChange={e => set('source', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent text-sm">
                <option value="">— pick a source —</option>
                {sources.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          </div>
          {form.source === 'Other' && (
            <div>
              <label className="block text-xs font-semibold text-on-surface-muted mb-1">Which source? <span className="text-danger">*</span></label>
              <input value={form.source_other} onChange={e => set('source_other', e.target.value)}
                placeholder="e.g. Instagram DM, meetup, cold outreach"
                className="w-full px-3 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-on-surface-muted mb-1">
              Resume link <span className="text-on-surface-subtle font-normal">(Drive / Dropbox / OneDrive)</span>
            </label>
            <div className="relative">
              <input type="url" value={form.resume_url} onChange={e => set('resume_url', e.target.value)}
                placeholder="https://drive.google.com/…"
                className="w-full pl-3 pr-9 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
              {form.resume_url && (
                <a href={form.resume_url} target="_blank" rel="noopener noreferrer"
                  title="Open the link"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-muted hover:text-accent">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
            <p className="text-[10px] text-on-surface-subtle mt-1">
              Paste a shareable link to the resume. Anyone with the link should be able to view it.
            </p>
          </div>
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{error}</div>
          )}
        </form>

        <div className="px-6 py-3 border-t border-outline bg-surface-2/40 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm text-on-surface-muted hover:bg-surface-2 rounded-lg font-semibold">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy || !form.name.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            {busy ? 'Adding…' : 'Add candidate'}
          </button>
        </div>
      </div>
    </div>
  );
}
