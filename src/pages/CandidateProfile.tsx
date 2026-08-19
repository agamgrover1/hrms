import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, MapPin, ExternalLink, Pencil, ChevronDown, Clock } from 'lucide-react';
import { api } from '../services/api';
import { HIRING_STAGES, TERMINAL_STAGES, STAGE_COLOR, stageLabel } from '../lib/hiringStages';
import { toast } from '../components/Toaster';

// Candidate profile — Slice 1 covers the hero header (name, stage,
// contact) + Overview tab (with inline edit for the resume-based fields)
// + Activity tab (event log from candidate_stage_events). Slices 2/3
// add Screening / Tech Review / Interviews / Offer / Hire tabs to the
// same layout.

type Tab = 'overview' | 'activity';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'activity', label: 'Activity' },
];

export default function CandidateProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<any | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [stageMenuOpen, setStageMenuOpen] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true); setErr('');
    api.getCandidate(id)
      .then(r => { setCandidate(r.candidate); setEvents(r.events); })
      .catch((e: any) => setErr(e?.message ?? 'Failed to load candidate'))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(load, [load]);

  const setStage = async (nextStage: string) => {
    if (!candidate || nextStage === candidate.stage) { setStageMenuOpen(false); return; }
    const prev = candidate;
    setCandidate({ ...candidate, stage: nextStage });
    setStageMenuOpen(false);
    try {
      await api.patchCandidate(candidate.id, { stage: nextStage });
      toast.success('Stage updated', `${candidate.name} → ${stageLabel(nextStage)}`);
      load();
    } catch (e: any) {
      setCandidate(prev);
      toast.error('Stage change failed', e?.message ?? 'Please try again.');
    }
  };

  if (loading) return <div className="p-8 text-sm text-on-surface-muted">Loading…</div>;
  if (err) return <div className="p-8 text-sm text-danger">{err}</div>;
  if (!candidate) return null;

  const color = STAGE_COLOR[candidate.stage] ?? STAGE_COLOR.sourced;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <button onClick={() => navigate('/hiring')}
        className="inline-flex items-center gap-1.5 text-xs text-on-surface-muted hover:text-on-surface">
        <ArrowLeft size={13} /> Back to Hiring
      </button>

      {/* Hero */}
      <div className="rounded-xl-3 border border-outline bg-surface shadow-elev-1 overflow-hidden">
        <div className="px-6 py-5 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl-2 bg-accent/15 text-accent flex items-center justify-center text-lg font-bold flex-shrink-0">
              {candidate.name?.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold text-on-surface">{candidate.name}</h1>
              {candidate.profile_applied_for && (
                <p className="text-sm text-on-surface-muted mt-0.5">Applied for: {candidate.profile_applied_for}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-on-surface-muted">
                {candidate.email && <span className="inline-flex items-center gap-1"><Mail size={11} />{candidate.email}</span>}
                {candidate.phone && <span className="inline-flex items-center gap-1"><Phone size={11} />{candidate.phone}</span>}
                {candidate.current_location && <span className="inline-flex items-center gap-1"><MapPin size={11} />{candidate.current_location}</span>}
                {candidate.resume_url && (
                  <a href={candidate.resume_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline">
                    <ExternalLink size={11} /> Resume
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* Stage picker — click to change stage from anywhere on the
                profile (not just the kanban). Same list as the board. */}
            <div className="relative">
              <button onClick={() => setStageMenuOpen(v => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${color.bg} ${color.text} ring-1 ${color.ring} hover:opacity-90`}>
                {stageLabel(candidate.stage)} <ChevronDown size={12} />
              </button>
              {stageMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-10 min-w-52 rounded-lg border border-outline bg-surface shadow-elev-3 py-1 max-h-72 overflow-auto">
                  {HIRING_STAGES.map(s => (
                    <button key={s.key} onClick={() => setStage(s.key)}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 ${s.key === candidate.stage ? 'font-bold text-accent' : 'text-on-surface'}`}>
                      {s.label}
                    </button>
                  ))}
                  <div className="border-t border-outline my-1" />
                  {TERMINAL_STAGES.map(s => (
                    <button key={s.key} onClick={() => setStage(s.key)}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 ${s.key === candidate.stage ? 'font-bold text-accent' : 'text-on-surface'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[10px] text-on-surface-subtle">Added {new Date(candidate.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-t border-outline px-6 py-2 bg-surface-2/40 flex items-center gap-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === t.key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <OverviewTab candidate={candidate} onSaved={load} editing={editing} setEditing={setEditing} />
      )}
      {tab === 'activity' && (
        <ActivityTab events={events} />
      )}
    </div>
  );
}

// Overview — the Stage-A resume-based fields plus source. Everything is
// editable inline; the field for "Applied for" / "Source" is a dropdown
// pulled from Config so it stays in sync with the New Candidate modal.
function OverviewTab({ candidate, onSaved, editing, setEditing }: {
  candidate: any;
  onSaved: () => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  const [form, setForm] = useState({
    name: candidate.name ?? '',
    email: candidate.email ?? '',
    phone: candidate.phone ?? '',
    profile_applied_for: candidate.profile_applied_for ?? '',
    source: candidate.source ?? '',
    source_other: candidate.source_other ?? '',
    resume_url: candidate.resume_url ?? '',
  });
  const [designations, setDesignations] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    api.getConfigDesignations().then(setDesignations).catch(() => {});
    api.getConfigSources().then(setSources).catch(() => {});
  }, [editing]);

  const save = async () => {
    setBusy(true);
    try {
      await api.patchCandidate(candidate.id, form);
      toast.success('Saved', 'Candidate details updated.');
      setEditing(false);
      onSaved();
    } catch (e: any) {
      toast.error('Save failed', e?.message ?? 'Please try again.');
    } finally { setBusy(false); }
  };

  const Field = ({ label, value, edit }: { label: string; value: React.ReactNode; edit?: React.ReactNode }) => (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-subtle">{label}</p>
      {editing && edit ? <div className="mt-1">{edit}</div> : <p className="text-sm text-on-surface mt-1">{value ?? <span className="text-on-surface-subtle">—</span>}</p>}
    </div>
  );

  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-on-surface">Overview</h3>
        {editing ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(false)} disabled={busy}
              className="text-xs text-on-surface-muted hover:text-on-surface font-semibold">Cancel</button>
            <button onClick={save} disabled={busy}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline font-semibold">
            <Pencil size={11} /> Edit
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Name" value={candidate.name}
          edit={<input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />} />
        <Field label="Email" value={candidate.email}
          edit={<input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />} />
        <Field label="Contact number" value={candidate.phone}
          edit={<input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm num-mono" />} />
        <Field label="Applied for" value={candidate.profile_applied_for}
          edit={<select value={form.profile_applied_for} onChange={e => setForm(f => ({ ...f, profile_applied_for: e.target.value }))}
            className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
            <option value="">— pick —</option>
            {designations.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>} />
        <Field label="Source" value={candidate.source === 'Other' && candidate.source_other ? `${candidate.source} · ${candidate.source_other}` : candidate.source}
          edit={<div className="space-y-1">
            <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
              className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
              <option value="">— pick —</option>
              {sources.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            {form.source === 'Other' && (
              <input value={form.source_other} onChange={e => setForm(f => ({ ...f, source_other: e.target.value }))}
                placeholder="Specify"
                className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
            )}
          </div>} />
        <Field label="Resume link" value={candidate.resume_url
          ? <a href={candidate.resume_url} target="_blank" rel="noopener noreferrer"
              className="text-accent hover:underline inline-flex items-center gap-1">
              Open <ExternalLink size={11} />
            </a>
          : null}
          edit={<input type="url" value={form.resume_url} onChange={e => setForm(f => ({ ...f, resume_url: e.target.value }))}
            placeholder="https://drive.google.com/…"
            className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />} />
      </div>

      {/* Placeholder for Slice 2/3 tabs — surface progress hint */}
      <div className="border-t border-outline pt-4 mt-2 text-xs text-on-surface-subtle">
        Screening call, tech review, interviews, and offer capture will unlock in follow-up slices.
        For now, use the stage picker in the header to move the candidate through the pipeline.
      </div>
    </div>
  );
}

// Activity log — reverse-chronological event list from candidate_stage_events.
// Same shape as the audit trail on employee warnings / project activity.
function ActivityTab({ events }: { events: any[] }) {
  if (events.length === 0) {
    return <div className="rounded-xl-2 border border-outline bg-surface p-8 text-center text-sm text-on-surface-muted">No activity yet.</div>;
  }
  return (
    <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <ul className="divide-y divide-outline">
        {events.map((e: any) => (
          <li key={e.id} className="px-5 py-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
              <Clock size={13} className="text-on-surface-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-on-surface">
                <b>{e.actor_name ?? 'System'}</b>{' '}
                {e.action === 'stage_change' ? (
                  <>moved to <span className="font-semibold">{stageLabel(e.after_stage)}</span>{e.before_stage ? <> from <span className="font-semibold">{stageLabel(e.before_stage)}</span></> : ''}</>
                ) : e.action}
              </p>
              {e.body && <p className="text-xs text-on-surface-muted italic mt-0.5">"{e.body}"</p>}
              <p className="text-[10px] text-on-surface-subtle mt-1">
                {new Date(e.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
