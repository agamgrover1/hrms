import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Mail, Phone, MapPin, ExternalLink, Pencil, ChevronDown, Clock,
  UserCheck, Calendar, Send, CheckCircle2, XCircle, Plus, Video, Users as UsersIcon,
  IndianRupee, UserPlus,
} from 'lucide-react';
import { api } from '../services/api';
import { HIRING_STAGES, TERMINAL_STAGES, STAGE_COLOR, stageLabel } from '../lib/hiringStages';
import { toast } from '../components/Toaster';
import { useAuth } from '../context/AuthContext';

// Candidate profile — Phase 2. Hero + Overview + Screening (call +
// details capture) + Tech Review (conditional) + Interviews (multi-round)
// + Activity. Non-HR viewers (assigned reviewer/interviewer) land here
// via a bell notification and only see the tab relevant to their action.

type Tab = 'overview' | 'screening' | 'tech_review' | 'interviews' | 'offer' | 'activity';

export default function CandidateProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [candidate, setCandidate] = useState<any | null>(null);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [viewerRole, setViewerRole] = useState<'hr' | 'reviewer' | 'interviewer' | undefined>();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [stageMenuOpen, setStageMenuOpen] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true); setErr('');
    api.getCandidate(id)
      .then(r => {
        setCandidate(r.candidate);
        setInterviews(r.interviews || []);
        setEvents(r.events || []);
        setViewerRole((r as any).viewer_role);
      })
      .catch((e: any) => setErr(e?.message ?? 'Failed to load candidate'))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(load, [load]);

  const [leftModal, setLeftModal] = useState(false);
  const setStage = async (nextKey: string) => {
    if (!candidate) { setStageMenuOpen(false); return; }
    setStageMenuOpen(false);

    // "Left after joining" needs a date (+ optional reason) and hits a
    // dedicated endpoint that also flips the linked employees row to
    // exit. Route it to a tiny modal instead of a silent status patch.
    if (nextKey === 'left_after_joining') {
      if (candidate.status !== 'joined' && !candidate.hired_employee_id) {
        toast.error('Not applicable', 'Only candidates who actually joined can be marked as left after joining.');
        return;
      }
      setLeftModal(true);
      return;
    }

    // Terminal statuses (rejected / hold) update status, not stage —
    // keeps the original pipeline position visible in the audit trail
    // and lets the kanban re-route via columnKeyFor().
    const isTerminalStatus = nextKey === 'rejected' || nextKey === 'hold';
    const prev = candidate;
    const patch: any = isTerminalStatus ? { status: nextKey } : { stage: nextKey };
    // Leaving a terminal status (moving back into pipeline) should
    // clear the status too so the card returns to its stage column.
    if (!isTerminalStatus && ['rejected', 'hold', 'left_after_joining'].includes(candidate.status)) {
      patch.status = 'active';
    }
    if (isTerminalStatus && candidate.status === nextKey) return;
    if (!isTerminalStatus && candidate.stage === nextKey && !patch.status) return;

    setCandidate({ ...candidate, ...patch });
    try {
      await api.patchCandidate(candidate.id, patch);
      toast.success(isTerminalStatus ? 'Status updated' : 'Stage updated',
        `${candidate.name} → ${stageLabel(nextKey)}`);
      load();
    } catch (e: any) {
      setCandidate(prev);
      toast.error('Update failed', e?.message ?? 'Please try again.');
    }
  };

  // Compute which tabs to show based on viewer role. HR sees everything;
  // reviewer sees only Tech Review; interviewer sees only Interviews.
  const isHR = viewerRole === 'hr';
  const availableTabs = useMemo<{ key: Tab; label: string }[]>(() => {
    if (isHR) {
      const tabs: { key: Tab; label: string }[] = [
        { key: 'overview', label: 'Overview' },
        { key: 'screening', label: 'Screening' },
      ];
      if (candidate?.tech_review_needed) tabs.push({ key: 'tech_review', label: 'Tech Review' });
      tabs.push({ key: 'interviews', label: 'Interviews' });
      tabs.push({ key: 'offer', label: 'Offer' });
      tabs.push({ key: 'activity', label: 'Activity' });
      return tabs;
    }
    if (viewerRole === 'reviewer') return [{ key: 'tech_review' as Tab, label: 'Tech Review' }];
    if (viewerRole === 'interviewer') return [{ key: 'interviews' as Tab, label: 'Interviews' }];
    return [{ key: 'overview' as Tab, label: 'Overview' }];
  }, [isHR, viewerRole, candidate?.tech_review_needed]);

  // Auto-switch tab if current one isn't in the available list (e.g.
  // reviewer landing here from a notification — jump straight to Tech Review).
  useEffect(() => {
    if (availableTabs.length && !availableTabs.find(t => t.key === tab)) {
      setTab(availableTabs[0].key);
    }
  }, [availableTabs, tab]);

  if (loading) return <div className="p-8 text-sm text-on-surface-muted">Loading…</div>;
  if (err) return <div className="p-8 text-sm text-danger">{err}</div>;
  if (!candidate) return null;

  // Display pill: the latest human decision wins over the raw stage
  // so a Selected/Rejected/Hold candidate never keeps reading
  // "Decision Pending". Order matters — status is terminal, stage is
  // pipeline-position, and offer_status splits "Selected but no offer
  // yet" from "Offer released".
  const displayed = (() => {
    if (candidate.status === 'left_after_joining' || candidate.final_status === 'left_after_joining')
                                          return { key: 'left_after_joining', label: 'Left After Joining' };
    if (candidate.status === 'rejected')  return { key: 'rejected', label: 'Rejected' };
    if (candidate.status === 'hold')      return { key: 'hold',     label: 'On Hold' };
    if (candidate.status === 'joined' || candidate.final_status === 'joined')
                                          return { key: 'final',    label: 'Joined' };
    if (candidate.status === 'withdrawn') return { key: 'rejected', label: 'Withdrawn' };
    if (candidate.stage === 'offer' && !candidate.offered_salary && !candidate.offer_status)
                                          return { key: 'offer',    label: 'Selected' };
    return { key: candidate.stage, label: stageLabel(candidate.stage) };
  })();
  const color = STAGE_COLOR[displayed.key] ?? STAGE_COLOR.sourced;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {isHR && (
        <button onClick={() => navigate('/hiring')}
          className="inline-flex items-center gap-1.5 text-xs text-on-surface-muted hover:text-on-surface">
          <ArrowLeft size={13} /> Back to Hiring
        </button>
      )}
      {!isHR && (
        <div className="rounded-lg border border-info/30 bg-info-container/40 px-4 py-2 text-xs text-info">
          You're viewing this candidate as {viewerRole === 'reviewer' ? 'the assigned tech reviewer' : 'an assigned interviewer'}. Full pipeline is HR-only.
        </div>
      )}

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
            <div className="relative">
              <button onClick={() => setStageMenuOpen(v => !v)}
                disabled={!isHR}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${color.bg} ${color.text} ring-1 ${color.ring} ${isHR ? 'hover:opacity-90' : 'cursor-default'}`}>
                {displayed.label} {isHR && <ChevronDown size={12} />}
              </button>
              {stageMenuOpen && isHR && (
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

        <div className="border-t border-outline px-6 py-2 bg-surface-2/40 flex items-center gap-1 overflow-x-auto">
          {availableTabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${tab === t.key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && isHR && (
        <OverviewTab candidate={candidate} onSaved={load} />
      )}
      {tab === 'screening' && isHR && (
        <ScreeningTab candidate={candidate} onSaved={load} />
      )}
      {tab === 'tech_review' && (
        <TechReviewTab candidate={candidate} viewerRole={viewerRole} onSaved={load} />
      )}
      {tab === 'interviews' && (
        <InterviewsTab candidate={candidate} interviews={interviews} viewerRole={viewerRole} currentUserEmpRefId={user?.employee_id_ref ?? undefined} onSaved={load} />
      )}
      {tab === 'offer' && isHR && (
        <OfferTab candidate={candidate} onSaved={load} />
      )}
      {tab === 'activity' && isHR && (
        <ActivityTab events={events} />
      )}

      {leftModal && (
        <LeftAfterJoiningModal
          candidate={candidate}
          onClose={() => setLeftModal(false)}
          onSaved={() => { setLeftModal(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Left-after-joining modal ────────────────────────────────────────────
// Captures the exit date (required) + optional reason for a candidate
// who joined and later resigned. Server also flips the linked employee
// to status='exit' + wipes their future planned hours (same helper the
// HR module uses when adding an exit_date directly on the employee).
function LeftAfterJoiningModal({ candidate, onClose, onSaved }: { candidate: any; onClose: () => void; onSaved: () => void }) {
  const [leftAt, setLeftAt] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!leftAt) { toast.error('Date required', 'Enter the date the person left.'); return; }
    setBusy(true);
    try {
      await api.markLeftAfterJoining(candidate.id, { left_at: leftAt, left_reason: reason || undefined });
      toast.success('Marked as left after joining', candidate.hired_employee_id
        ? 'Employee record moved to exit; future planned hours cleared.'
        : 'Candidate history updated.');
      onSaved();
    } catch (e: any) {
      toast.error('Update failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-surface rounded-xl-2 border border-outline shadow-elev-4 w-full max-w-md p-5 space-y-4">
        <div>
          <h3 className="font-display text-lg font-bold text-on-surface">Mark as Left After Joining</h3>
          <p className="text-xs text-on-surface-muted mt-1">
            {candidate.hired_employee_id
              ? `Records ${candidate.name} as having resigned or been exited from the company. Their employee row will be set to exit, and any hours planned beyond the leaving date will be cleared.`
              : `Records ${candidate.name} as having left, even though a linked employee record wasn't found. Kanban card moves to Left After Joining.`}
          </p>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-on-surface-muted">Left on <span className="text-danger">*</span></span>
          <input type="date" value={leftAt} onChange={e => setLeftAt(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-on-surface-muted">Reason (optional)</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
            placeholder="Personal reasons / better opportunity / performance / etc."
            className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
        </label>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline">
          <button onClick={onClose} disabled={busy}
            className="px-3 py-2 rounded-lg border border-outline text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-danger text-on-danger text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            {busy ? 'Saving…' : 'Mark as left'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Overview tab ────────────────────────────────────────────────────────
function OverviewTab({ candidate, onSaved }: { candidate: any; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
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
    } catch (e: any) { toast.error('Save failed', e?.message ?? 'Please try again.'); }
    finally { setBusy(false); }
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
            <button onClick={() => setEditing(false)} disabled={busy} className="text-xs text-on-surface-muted hover:text-on-surface font-semibold">Cancel</button>
            <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs text-accent hover:underline font-semibold">
            <Pencil size={11} /> Edit
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Name" value={candidate.name}
          edit={<input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />} />
        <Field label="Email" value={candidate.email}
          edit={<input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />} />
        <Field label="Contact number" value={candidate.phone}
          edit={<input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm num-mono" />} />
        <Field label="Applied for" value={candidate.profile_applied_for}
          edit={<select value={form.profile_applied_for} onChange={e => setForm(f => ({ ...f, profile_applied_for: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
            <option value="">— pick —</option>
            {designations.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>} />
        <Field label="Source" value={candidate.source === 'Other' && candidate.source_other ? `${candidate.source} · ${candidate.source_other}` : candidate.source}
          edit={<div className="space-y-1">
            <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
              <option value="">— pick —</option>
              {sources.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            {form.source === 'Other' && (
              <input value={form.source_other} onChange={e => setForm(f => ({ ...f, source_other: e.target.value }))} placeholder="Specify" className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
            )}
          </div>} />
        <Field label="Resume link" value={candidate.resume_url
          ? <a href={candidate.resume_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">Open <ExternalLink size={11} /></a>
          : null}
          edit={<input type="url" value={form.resume_url} onChange={e => setForm(f => ({ ...f, resume_url: e.target.value }))} placeholder="https://drive.google.com/…" className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />} />
      </div>
    </div>
  );
}

// ── Screening tab — HR screening call + post-call details capture ─────
function ScreeningTab({ candidate, onSaved }: { candidate: any; onSaved: () => void }) {
  const [call, setCall] = useState({
    call_status: candidate.call_status ?? '',
    call_remarks: candidate.call_remarks ?? '',
    follow_up_date: candidate.follow_up_date?.slice(0, 10) ?? '',
    // Screening-call outcome + rejection reason. Outcome maps to a
    // pipeline move on save: move_to_interview → stage jumps forward;
    // hold → status=hold; reject → status=rejected (reason required).
    screening_outcome: candidate.screening_outcome ?? '',
    rejection_reason: candidate.rejection_reason ?? '',
  });
  const [details, setDetails] = useState({
    // Experience is text now — "6 months" / "1 year 6 months" / "fresher"
    total_experience_years: candidate.total_experience_years ?? '',
    relevant_experience_years: candidate.relevant_experience_years ?? '',
    experience_type: candidate.experience_type ?? '',
    current_salary: candidate.current_salary ?? '',
    current_ctc: candidate.current_ctc ?? '',
    expected_salary: candidate.expected_salary ?? '',
    expected_ctc: candidate.expected_ctc ?? '',
    last_increment_date: candidate.last_increment_date?.slice(0, 10) ?? '',
    last_increment_amount: candidate.last_increment_amount ?? '',
    reason_for_change: candidate.reason_for_change ?? '',
    current_location: candidate.current_location ?? '',
    notice_period_days: candidate.notice_period_days ?? '',
    face_to_face_available: candidate.face_to_face_available ?? false,
    hr_screening_remarks: candidate.hr_screening_remarks ?? '',
  });
  const [busyCall, setBusyCall] = useState(false);
  const [busyDetails, setBusyDetails] = useState(false);

  const saveCall = async () => {
    if (!call.call_status) { toast.error('Missing', 'Set a call status.'); return; }
    if (call.screening_outcome === 'reject' && !call.rejection_reason.trim()) {
      toast.error('Missing rejection reason', 'Say why you\'re rejecting.'); return;
    }
    setBusyCall(true);
    try {
      await api.logScreeningCall(candidate.id, {
        call_status: call.call_status,
        call_remarks: call.call_remarks || undefined,
        follow_up_date: call.follow_up_date || undefined,
        screening_outcome: call.screening_outcome || undefined,
        rejection_reason: call.screening_outcome === 'reject' ? call.rejection_reason.trim() : undefined,
      } as any);
      const outMsg = call.screening_outcome === 'move_to_interview' ? 'Moved to Interview Scheduling.'
        : call.screening_outcome === 'hold' ? 'Candidate placed on Hold.'
        : call.screening_outcome === 'reject' ? 'Candidate marked Rejected.'
        : 'Screening call details saved.';
      toast.success('Call logged', outMsg);
      onSaved();
    } catch (e: any) { toast.error('Save failed', e?.body?.error ?? e?.message ?? 'Please try again.'); }
    finally { setBusyCall(false); }
  };

  const saveDetails = async () => {
    setBusyDetails(true);
    try {
      await api.patchCandidate(candidate.id, details);
      toast.success('Details saved', 'Post-call fields updated.');
      onSaved();
    } catch (e: any) { toast.error('Save failed', e?.message ?? 'Please try again.'); }
    finally { setBusyDetails(false); }
  };

  return (
    <div className="space-y-4">
      {/* HR screening call */}
      <div className="rounded-xl-2 border border-outline bg-surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-on-surface">Screening call</h3>
          <span className="text-xs text-on-surface-muted">Called by · {candidate.called_by_id ? 'HR' : '—'}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Call status</span>
            <select value={call.call_status} onChange={e => setCall(c => ({ ...c, call_status: e.target.value }))}
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
              <option value="">— pick —</option>
              <option value="done">Done</option>
              <option value="no_response">No response</option>
              <option value="rescheduled">Rescheduled</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Follow-up date</span>
            <input type="date" value={call.follow_up_date} onChange={e => setCall(c => ({ ...c, follow_up_date: e.target.value }))}
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
          </label>
          <div />
          <label className="block md:col-span-3">
            <span className="text-xs font-semibold text-on-surface-muted">Call remarks</span>
            <textarea rows={2} value={call.call_remarks} onChange={e => setCall(c => ({ ...c, call_remarks: e.target.value }))}
              placeholder="What did they say? Any red / green flags?"
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm resize-none" />
          </label>
        </div>

        {/* Screening-call outcome — the pipeline move happens on save. */}
        <div className="pt-3 mt-2 border-t border-outline">
          <p className="text-xs font-semibold text-on-surface-muted mb-2">After-call outcome</p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'move_to_interview', label: 'Move to Interview', tone: 'bg-brand text-on-accent border-brand' },
              { id: 'hold',              label: 'Hold',              tone: 'bg-warning text-on-accent border-warning' },
              { id: 'reject',            label: 'Reject',            tone: 'bg-danger text-on-accent border-danger' },
            ].map(o => {
              const active = call.screening_outcome === o.id;
              return (
                <button key={o.id} type="button"
                  onClick={() => setCall(c => ({ ...c, screening_outcome: active ? '' : o.id }))}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${active ? o.tone : 'bg-surface text-on-surface-muted border-outline hover:bg-surface-2'}`}>
                  {o.label}
                </button>
              );
            })}
          </div>
          {call.screening_outcome === 'reject' && (
            <label className="block mt-3">
              <span className="text-xs font-semibold text-on-surface-muted">Rejection reason <span className="text-danger">*</span></span>
              <textarea autoFocus rows={2} value={call.rejection_reason}
                onChange={e => setCall(c => ({ ...c, rejection_reason: e.target.value }))}
                placeholder="Why isn't this candidate a fit? (visible in HR reports)"
                className="mt-1 w-full px-2 py-1.5 rounded border border-danger/40 bg-surface text-sm resize-none focus:outline-none focus:ring-2 focus:ring-danger/30" />
            </label>
          )}
          {call.screening_outcome && (
            <p className="text-[11px] text-on-surface-subtle mt-2 italic">
              {call.screening_outcome === 'move_to_interview' && 'Saving will move the candidate to Interview Scheduling.'}
              {call.screening_outcome === 'hold' && 'Saving will set the candidate\'s status to On Hold.'}
              {call.screening_outcome === 'reject' && 'Saving will mark the candidate Rejected and record the reason.'}
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={saveCall} disabled={busyCall}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50">
            {busyCall ? 'Saving…' : 'Save call'}
          </button>
        </div>
      </div>

      {/* Post-call details */}
      <div className="rounded-xl-2 border border-outline bg-surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-on-surface">Post-call details</h3>
          <span className="text-xs text-on-surface-subtle">Fill after the screening call</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput label="Total experience" placeholder="e.g. 1 year 6 months, 6 months, fresher"
            value={details.total_experience_years}
            onChange={v => setDetails(d => ({ ...d, total_experience_years: v }))} />
          <TextInput label="Relevant experience" placeholder="e.g. 1 year, 3 years"
            value={details.relevant_experience_years}
            onChange={v => setDetails(d => ({ ...d, relevant_experience_years: v }))} />
          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Experience type</span>
            <select value={details.experience_type} onChange={e => setDetails(d => ({ ...d, experience_type: e.target.value }))}
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
              <option value="">—</option>
              <option value="Job">Job</option>
              <option value="Internship">Internship</option>
              <option value="Fresher">Fresher</option>
            </select>
          </label>
          <div />
          <NumInput label="Current salary (₹/mo)" value={details.current_salary} onChange={v => setDetails(d => ({ ...d, current_salary: v }))} />
          <NumInput label="Current CTC (₹/yr)" value={details.current_ctc} onChange={v => setDetails(d => ({ ...d, current_ctc: v }))} />
          <NumInput label="Expected salary (₹/mo)" value={details.expected_salary} onChange={v => setDetails(d => ({ ...d, expected_salary: v }))} />
          <NumInput label="Expected CTC (₹/yr)" value={details.expected_ctc} onChange={v => setDetails(d => ({ ...d, expected_ctc: v }))} />
          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Last increment date</span>
            <input type="date" value={details.last_increment_date} onChange={e => setDetails(d => ({ ...d, last_increment_date: e.target.value }))}
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
          </label>
          <NumInput label="Last increment amount (₹)" value={details.last_increment_amount} onChange={v => setDetails(d => ({ ...d, last_increment_amount: v }))} />
          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Current location</span>
            <input value={details.current_location} onChange={e => setDetails(d => ({ ...d, current_location: e.target.value }))}
              placeholder="City" className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
          </label>
          <NumInput label="Notice period (days · 0 = immediate)" value={details.notice_period_days} onChange={v => setDetails(d => ({ ...d, notice_period_days: v }))} />
          <label className="block md:col-span-2">
            <span className="text-xs font-semibold text-on-surface-muted">Reason for change</span>
            <textarea rows={2} value={details.reason_for_change} onChange={e => setDetails(d => ({ ...d, reason_for_change: e.target.value }))}
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm resize-none" />
          </label>
          <label className="inline-flex items-center gap-2 md:col-span-2 text-sm text-on-surface">
            <input type="checkbox" checked={!!details.face_to_face_available} onChange={e => setDetails(d => ({ ...d, face_to_face_available: e.target.checked }))} className="rounded border-outline" />
            Available for face-to-face interview
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs font-semibold text-on-surface-muted">HR remarks (screening summary)</span>
            <textarea rows={2} value={details.hr_screening_remarks} onChange={e => setDetails(d => ({ ...d, hr_screening_remarks: e.target.value }))}
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm resize-none" />
          </label>
        </div>
        <div className="flex justify-end">
          <button onClick={saveDetails} disabled={busyDetails}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50">
            {busyDetails ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </div>
    </div>
  );
}
function NumInput({ label, value, onChange, disabled }: { label: string; value: any; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-on-surface-muted">{label}</span>
      <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm num-mono disabled:opacity-50 disabled:cursor-not-allowed" />
    </label>
  );
}
function TextInput({ label, value, placeholder, onChange }: { label: string; value: any; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-on-surface-muted">{label}</span>
      <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
    </label>
  );
}

// ── Tech Review tab ─────────────────────────────────────────────────────
// Two modes:
//   HR view — pick a reviewer + send. Once sent, shows status + reviewer.
//   Reviewer view — sees the candidate's basic profile + Recommend / Not
//     Recommended buttons + remarks textarea.
function TechReviewTab({ candidate, viewerRole, onSaved }: { candidate: any; viewerRole?: string; onSaved: () => void }) {
  const [employees, setEmployees] = useState<any[]>([]);
  const [reviewerId, setReviewerId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'recommended' | 'not_recommended' | ''>('');
  const [submitRemarks, setSubmitRemarks] = useState('');
  const isHR = viewerRole === 'hr';
  const isReviewer = viewerRole === 'reviewer';
  const submitted = !!candidate.tech_review_reviewed_at;

  useEffect(() => { if (isHR) api.getEmployeesSlim().then(setEmployees).catch(() => {}); }, [isHR]);

  const send = async () => {
    if (!reviewerId) { toast.error('Missing', 'Pick a reviewer first.'); return; }
    setBusy(true);
    try {
      await api.requestTechReview(candidate.id, { tech_reviewer_id: reviewerId, remarks: remarks || undefined });
      toast.success('Sent for review', 'Reviewer has been notified.');
      onSaved();
    } catch (e: any) { toast.error('Failed', e?.message); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!submitStatus) { toast.error('Pick a verdict', 'Recommended or Not Recommended.'); return; }
    setBusy(true);
    try {
      await api.submitTechReview(candidate.id, { status: submitStatus, remarks: submitRemarks || undefined });
      toast.success('Review submitted', 'HR has been notified.');
      onSaved();
    } catch (e: any) { toast.error('Failed', e?.message); }
    finally { setBusy(false); }
  };

  // Reviewer's submission form — either fresh, or "already submitted" state.
  if (isReviewer) {
    if (submitted) {
      return (
        <div className="rounded-xl-2 border border-outline bg-surface p-5 text-center">
          <CheckCircle2 size={28} className="mx-auto text-success mb-2" />
          <p className="text-sm text-on-surface">You've already submitted your review — <b>{candidate.tech_review_status === 'recommended' ? 'Recommended' : 'Not Recommended'}</b>.</p>
          {candidate.tech_review_remarks && <p className="text-xs text-on-surface-muted italic mt-1">"{candidate.tech_review_remarks}"</p>}
        </div>
      );
    }
    return (
      <div className="rounded-xl-2 border border-outline bg-surface p-5 space-y-4">
        <div>
          <h3 className="font-display text-lg font-bold text-on-surface">Tech review</h3>
          <p className="text-xs text-on-surface-muted mt-0.5">HR asked you to review this candidate's fit. Take a look at their resume, then submit your verdict below.</p>
        </div>
        {candidate.tech_review_remarks && (
          <div className="rounded-lg border border-outline bg-surface-2/60 p-3 text-xs">
            <p className="font-semibold text-on-surface-muted mb-1">HR note</p>
            <p className="text-on-surface italic">"{candidate.tech_review_remarks}"</p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button onClick={() => setSubmitStatus('recommended')}
            className={`px-4 py-3 rounded-lg border-2 flex items-center gap-2 justify-center font-semibold ${submitStatus === 'recommended' ? 'border-success bg-success/10 text-success' : 'border-outline hover:border-success/40'}`}>
            <CheckCircle2 size={16} /> Recommended
          </button>
          <button onClick={() => setSubmitStatus('not_recommended')}
            className={`px-4 py-3 rounded-lg border-2 flex items-center gap-2 justify-center font-semibold ${submitStatus === 'not_recommended' ? 'border-danger bg-danger/10 text-danger' : 'border-outline hover:border-danger/40'}`}>
            <XCircle size={16} /> Not Recommended
          </button>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-on-surface-muted">Remarks (why?)</span>
          <textarea rows={3} value={submitRemarks} onChange={e => setSubmitRemarks(e.target.value)}
            placeholder="What stood out? Any concerns HR should know?"
            className="mt-1 w-full px-3 py-2 rounded border border-outline bg-surface text-sm resize-none" />
        </label>
        <div className="flex justify-end">
          <button onClick={submit} disabled={busy || !submitStatus}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            <Send size={13} /> {busy ? 'Submitting…' : 'Submit review'}
          </button>
        </div>
      </div>
    );
  }

  // HR view
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-5 space-y-4">
      <div>
        <h3 className="font-display text-lg font-bold text-on-surface">Tech review</h3>
        <p className="text-xs text-on-surface-muted mt-0.5">Send this candidate's resume to a Team Lead for a domain check before the HR screening call.</p>
      </div>
      {candidate.tech_reviewer_id ? (
        <div className="rounded-lg border border-outline bg-surface-2/40 p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <UserCheck size={14} className="text-accent" />
            <span className="text-on-surface">
              Sent to reviewer · Status:{' '}
              <span className={`font-bold ${candidate.tech_review_status === 'recommended' ? 'text-success' : candidate.tech_review_status === 'not_recommended' ? 'text-danger' : 'text-warning'}`}>
                {candidate.tech_review_status === 'recommended' ? 'Recommended'
                  : candidate.tech_review_status === 'not_recommended' ? 'Not Recommended'
                  : 'Pending'}
              </span>
            </span>
          </div>
          {candidate.tech_review_sent_at && (
            <p className="text-[11px] text-on-surface-subtle">Sent {new Date(candidate.tech_review_sent_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
          )}
          {candidate.tech_review_reviewed_at && (
            <p className="text-[11px] text-on-surface-subtle">Reviewed {new Date(candidate.tech_review_reviewed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
          )}
          {candidate.tech_review_remarks && (
            <p className="text-xs text-on-surface-muted italic mt-2">"{candidate.tech_review_remarks}"</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Reviewer (Team Lead)</span>
            <select value={reviewerId} onChange={e => setReviewerId(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
              <option value="">— pick a Team Lead —</option>
              {employees.filter((e: any) => e.status !== 'inactive').map((e: any) => (
                <option key={e.id} value={e.id}>{e.name}{e.designation ? ` · ${e.designation}` : ''}</option>
              ))}
            </select>
          </label>
          <div />
          <label className="block md:col-span-2">
            <span className="text-xs font-semibold text-on-surface-muted">Note for the reviewer (optional)</span>
            <textarea rows={2} value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder="e.g. Please check depth on React + system design."
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm resize-none" />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button onClick={send} disabled={busy || !reviewerId}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              <Send size={13} /> {busy ? 'Sending…' : 'Send for review'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Interviews tab ──────────────────────────────────────────────────────
function InterviewsTab({ candidate, interviews, viewerRole, currentUserEmpRefId, onSaved }: {
  candidate: any; interviews: any[]; viewerRole?: string; currentUserEmpRefId?: string; onSaved: () => void;
}) {
  const [scheduling, setScheduling] = useState(false);
  const [openFeedbackId, setOpenFeedbackId] = useState<string | null>(null);
  const isHR = viewerRole === 'hr';

  // Interviewer sees only the round they own. Everyone else sees all.
  const visibleRounds = useMemo(() => {
    if (viewerRole === 'interviewer' && currentUserEmpRefId) {
      // employee_id_ref could be either DL#### code OR internal id — round row
      // stores interviewer_id which is employees.id. Match by both forms.
      return interviews.filter((r: any) => r.interviewer_id === currentUserEmpRefId
        || String(r.interviewer_id).endsWith(currentUserEmpRefId));
    }
    return interviews;
  }, [interviews, viewerRole, currentUserEmpRefId]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl-2 border border-outline bg-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-display text-lg font-bold text-on-surface">Interviews</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              {visibleRounds.length === 0 ? 'No rounds scheduled yet.' : `${visibleRounds.length} round${visibleRounds.length === 1 ? '' : 's'}`}
            </p>
          </div>
          {isHR && (
            <button onClick={() => setScheduling(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-on-accent hover:opacity-90">
              <Plus size={13} /> Schedule round
            </button>
          )}
        </div>
        {visibleRounds.length === 0 ? (
          <p className="text-sm text-on-surface-muted text-center py-8">
            {isHR ? 'Click Schedule round to add the first interview.' : 'No interviews assigned to you on this candidate.'}
          </p>
        ) : (
          <ul className="divide-y divide-outline">
            {visibleRounds.map((r: any) => (
              <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                <InterviewRow round={r} isHR={isHR}
                  isOwnRound={viewerRole === 'interviewer'}
                  open={openFeedbackId === r.id}
                  onToggle={() => setOpenFeedbackId(prev => prev === r.id ? null : r.id)}
                  onSaved={() => { setOpenFeedbackId(null); onSaved(); }} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {scheduling && (
        <ScheduleInterviewModal candidateId={candidate.id} candidateName={candidate.name}
          onClose={() => setScheduling(false)}
          onSaved={() => { setScheduling(false); onSaved(); }} />
      )}
    </div>
  );
}

function InterviewRow({ round, isHR, isOwnRound, open, onToggle, onSaved }: {
  round: any; isHR: boolean; isOwnRound: boolean; open: boolean; onToggle: () => void; onSaved: () => void;
}) {
  const [feedback, setFeedback] = useState(round.feedback ?? '');
  const [decision, setDecision] = useState(round.decision ?? '');
  const [status, setStatus] = useState(round.status ?? 'scheduled');
  const [busy, setBusy] = useState(false);

  const canEdit = isHR || isOwnRound;

  const save = async () => {
    setBusy(true);
    try {
      await api.patchInterview(round.id, {
        feedback: feedback || undefined,
        decision: decision || undefined,
        status: status || undefined,
      });
      toast.success('Saved', 'Interview updated.');
      onSaved();
    } catch (e: any) { toast.error('Failed', e?.message); }
    finally { setBusy(false); }
  };

  const when = round.scheduled_for ? new Date(round.scheduled_for) : null;
  const statusColor = round.status === 'completed' ? 'text-success' : round.status === 'no_show' || round.status === 'cancelled' ? 'text-danger' : 'text-warning';

  return (
    <div>
      <button onClick={onToggle} className="w-full text-left flex items-start justify-between gap-3 hover:bg-surface-2/40 rounded-md p-2 -m-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-on-surface-subtle uppercase tracking-wider">Round {round.round_no}</span>
            <span className={`text-[10px] font-bold uppercase ${statusColor}`}>{round.status}</span>
            {round.decision && (
              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${round.decision === 'selected' ? 'bg-success/15 text-success' : round.decision === 'rejected' ? 'bg-danger/15 text-danger' : round.decision === 'next_round' ? 'bg-accent/15 text-accent' : 'bg-warning/15 text-warning'}`}>
                {round.decision.replace('_', ' ')}
              </span>
            )}
          </div>
          <p className="text-sm text-on-surface mt-1">
            {round.interviewer_name ?? '—'}
            {round.mode && <span className="text-on-surface-muted"> · {round.mode === 'f2f' ? 'F2F' : 'Virtual'}</span>}
          </p>
          {when && (
            <p className="text-[11px] text-on-surface-muted">
              <Clock size={10} className="inline mr-1" />
              {when.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {round.meeting_link && <> · <a href={round.meeting_link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-accent hover:underline inline-flex items-center gap-1"><Video size={10} /> Join</a></>}
            </p>
          )}
          {round.feedback && !open && (
            <p className="text-xs text-on-surface-muted italic mt-1 line-clamp-2">"{round.feedback}"</p>
          )}
        </div>
        <ChevronDown size={14} className={`text-on-surface-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && canEdit && (
        <div className="mt-3 space-y-3 pl-2 pt-3 border-t border-outline">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-muted">Status</span>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
                <option value="no_show">No show</option>
                <option value="rescheduled">Rescheduled</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs font-semibold text-on-surface-muted">Decision</span>
              <select value={decision} onChange={e => setDecision(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
                <option value="">— pick if this round is done —</option>
                <option value="selected">Selected</option>
                <option value="next_round">Next round</option>
                <option value="hold">Hold</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Feedback</span>
            <textarea rows={3} value={feedback} onChange={e => setFeedback(e.target.value)}
              placeholder="Strengths, gaps, red flags…"
              className="mt-1 w-full px-3 py-2 rounded border border-outline bg-surface text-sm resize-none" />
          </label>
          <div className="flex justify-end">
            <button onClick={save} disabled={busy}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save feedback'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleInterviewModal({ candidateId, candidateName, onClose, onSaved }: {
  candidateId: string; candidateName: string; onClose: () => void; onSaved: () => void;
}) {
  const [employees, setEmployees] = useState<any[]>([]);
  const [form, setForm] = useState({
    interviewer_id: '',
    scheduled_for: '',
    mode: 'virtual' as 'virtual' | 'f2f',
    meeting_link: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.getEmployeesSlim().then(setEmployees).catch(() => {}); }, []);

  const submit = async () => {
    if (!form.interviewer_id || !form.scheduled_for) { toast.error('Missing', 'Interviewer + date/time required.'); return; }
    setBusy(true);
    try {
      await api.scheduleInterview(candidateId, {
        interviewer_id: form.interviewer_id,
        scheduled_for: new Date(form.scheduled_for).toISOString(),
        mode: form.mode,
        meeting_link: form.mode === 'virtual' ? (form.meeting_link || undefined) : undefined,
      });
      toast.success('Interview scheduled', 'The interviewer has been notified.');
      onSaved();
    } catch (e: any) { toast.error('Failed', e?.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-outline flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/15 text-accent flex items-center justify-center flex-shrink-0"><Calendar size={18} /></div>
            <div>
              <h3 className="font-display text-lg font-bold text-on-surface">Schedule interview</h3>
              <p className="text-xs text-on-surface-muted mt-0.5">{candidateName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-2"><XCircle size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Interviewer</span>
            <select value={form.interviewer_id} onChange={e => setForm(f => ({ ...f, interviewer_id: e.target.value }))}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm">
              <option value="">— pick from your team —</option>
              {employees.filter((e: any) => e.status !== 'inactive').map((e: any) => (
                <option key={e.id} value={e.id}>{e.name}{e.designation ? ` · ${e.designation}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Date & time</span>
            <input type="datetime-local" value={form.scheduled_for} onChange={e => setForm(f => ({ ...f, scheduled_for: e.target.value }))}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm" />
          </label>
          <div>
            <span className="text-xs font-semibold text-on-surface-muted block mb-1">Mode</span>
            <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-lg p-0.5 text-xs">
              <button onClick={() => setForm(f => ({ ...f, mode: 'virtual' }))}
                className={`px-3 py-1.5 rounded-md font-semibold inline-flex items-center gap-1.5 ${form.mode === 'virtual' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
                <Video size={11} /> Virtual
              </button>
              <button onClick={() => setForm(f => ({ ...f, mode: 'f2f' }))}
                className={`px-3 py-1.5 rounded-md font-semibold inline-flex items-center gap-1.5 ${form.mode === 'f2f' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
                <UsersIcon size={11} /> Face-to-face
              </button>
            </div>
          </div>
          {form.mode === 'virtual' && (
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-muted">Meeting link (optional)</span>
              <input type="url" value={form.meeting_link} onChange={e => setForm(f => ({ ...f, meeting_link: e.target.value }))}
                placeholder="https://meet.google.com/…"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm" />
            </label>
          )}
        </div>
        <div className="px-6 py-3 border-t border-outline bg-surface-2/40 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-on-surface-muted hover:bg-surface-2 rounded-lg font-semibold">Cancel</button>
          <button onClick={submit} disabled={busy || !form.interviewer_id || !form.scheduled_for}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            <Calendar size={13} /> {busy ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Activity tab ────────────────────────────────────────────────────────
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
                ) : e.action === 'tech_review_sent' ? 'sent for tech review'
                : e.action === 'tech_review_submitted' ? `submitted tech review${e.metadata?.status ? ` — ${e.metadata.status.replace('_', ' ')}` : ''}`
                : e.action === 'call_logged' ? `logged screening call${e.metadata?.call_status ? ` — ${e.metadata.call_status.replace('_', ' ')}` : ''}`
                : e.action === 'interview_scheduled' ? `scheduled a round${e.metadata?.round_no ? ` (round ${e.metadata.round_no})` : ''}`
                : e.action === 'interview_feedback' ? `submitted feedback${e.metadata?.round_no ? ` (round ${e.metadata.round_no})` : ''}${e.metadata?.decision ? ` — ${e.metadata.decision.replace('_', ' ')}` : ''}`
                : e.action === 'offer_drafted' ? 'drafted the offer'
                : e.action === 'offer_released' ? 'released the offer'
                : e.action === 'hired' ? <>marked <span className="font-semibold">Hired</span>{e.metadata?.employee_code ? <> as <span className="font-semibold">{e.metadata.employee_code}</span></> : ''}</>
                : e.action}
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

// ── Offer tab ──────────────────────────────────────────────────────────
// Three states the tab progresses through:
//   1. No offer yet — form to capture salary/CTC/date → Draft Offer.
//   2. Draft on file — same form (editable) + Release button + status pill.
//   3. Released — locked numbers, options: Mark Accepted / Mark Declined,
//      and once accepted, the Hire → Employee button appears.
function OfferTab({ candidate, onSaved }: { candidate: any; onSaved: () => void }) {
  const [salary, setSalary] = useState<string>(candidate.offered_salary != null ? String(candidate.offered_salary) : '');
  const [ctc, setCtc] = useState<string>(candidate.offered_ctc != null ? String(candidate.offered_ctc) : '');
  const [offerDate, setOfferDate] = useState<string>(candidate.offer_date ? String(candidate.offer_date).slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState<string>(candidate.offer_remarks ?? '');
  const [isUnpaid, setIsUnpaid] = useState<boolean>(!!candidate.offer_is_unpaid);
  const [busy, setBusy] = useState(false);
  const [showHire, setShowHire] = useState(false);

  const status = candidate.offer_status as string | null;
  const released = status === 'released' || status === 'accepted' || candidate.final_status === 'accepted' || candidate.final_status === 'joined';
  const accepted = candidate.final_status === 'accepted' || candidate.final_status === 'joined';
  const alreadyHired = !!candidate.hired_employee_id;

  const draftOffer = async () => {
    setBusy(true);
    try {
      // Two-step for unpaid: draftOffer (dedicated endpoint) can't take
      // the unpaid flag — persist it via patchCandidate first so the
      // release-offer guard sees it, then draft with zero numbers.
      if (isUnpaid) {
        await api.patchCandidate(candidate.id, { offer_is_unpaid: true });
      } else if (candidate.offer_is_unpaid) {
        await api.patchCandidate(candidate.id, { offer_is_unpaid: false });
      }
      await api.draftOffer(candidate.id, {
        offered_salary: isUnpaid ? 0 : (salary === '' ? null : Number(salary)),
        offered_ctc:    isUnpaid ? 0 : (ctc === '' ? null : Number(ctc)),
        offer_date: offerDate,
        offer_remarks: remarks || undefined,
      });
      toast.success('Offer saved', isUnpaid
        ? 'Unpaid internship draft stored — release when you\'re ready.'
        : 'Draft is stored — release it when you\'re ready to send.');
      onSaved();
    } catch (e: any) {
      toast.error('Save failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy(false); }
  };

  const releaseOffer = async () => {
    if (!window.confirm('Release this offer to the candidate? The numbers get locked after this.')) return;
    setBusy(true);
    try {
      await api.releaseOffer(candidate.id);
      toast.success('Offer released', 'Admin has been notified.');
      onSaved();
    } catch (e: any) {
      toast.error('Release failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy(false); }
  };

  const markFinal = async (final_status: 'accepted' | 'declined') => {
    setBusy(true);
    try {
      await api.patchCandidate(candidate.id, { final_status, status: final_status === 'declined' ? 'withdrawn' : 'active' });
      toast.success(final_status === 'accepted' ? 'Offer accepted' : 'Offer declined',
        final_status === 'accepted' ? 'You can now convert them into an employee.' : 'Candidate moved to withdrawn.');
      onSaved();
    } catch (e: any) {
      toast.error('Update failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <div className="px-6 py-4 border-b border-outline flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-display text-lg font-bold text-on-surface">Offer</h3>
          {status && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              status === 'released' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' :
              status === 'accepted' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' :
              status === 'declined' ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' :
              'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
            }`}>{status.replace('_', ' ')}</span>
          )}
          {alreadyHired && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-accent/15 text-accent">
              <CheckCircle2 size={10} /> Hired
            </span>
          )}
        </div>
        {accepted && !alreadyHired && (
          <button onClick={() => setShowHire(true)} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            <UserPlus size={14} /> Hire → Employee
          </button>
        )}
      </div>

      <div className="p-6 space-y-4">
        {/* Unpaid-internship flag. Ticked, the salary + CTC inputs go
            to zero and get disabled so HR can't accidentally send a
            paid offer they didn't mean to; the release-offer guard on
            the server also drops the "salary or CTC required" rule
            when this flag is set. Un-ticking restores the last-typed
            numbers (React keeps the local strings across toggles). */}
        <label className={`flex items-start gap-2 p-2.5 rounded-lg border ${isUnpaid ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20' : 'border-outline bg-surface-2'} ${released ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}>
          <input type="checkbox" checked={isUnpaid}
            onChange={e => setIsUnpaid(e.target.checked)}
            disabled={released}
            className="mt-0.5 h-4 w-4 accent-amber-600" />
          <div className="flex-1">
            <span className="block text-sm font-semibold text-on-surface">Unpaid internship</span>
            <span className="block text-[11px] text-on-surface-muted">Skip the salary / CTC requirement — the offer can be released and the candidate hired with ₹0 pay.</span>
          </div>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumInput label={isUnpaid ? 'Offered salary (₹/month) — unpaid' : 'Offered salary (₹/month)'}
            value={isUnpaid ? '' : salary} onChange={setSalary} disabled={isUnpaid || released} />
          <NumInput label={isUnpaid ? 'Offered CTC (₹/year) — unpaid' : 'Offered CTC (₹/year)'}
            value={isUnpaid ? '' : ctc} onChange={setCtc} disabled={isUnpaid || released} />
          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Offer date</span>
            <input type="date" value={offerDate} onChange={e => setOfferDate(e.target.value)}
              disabled={released}
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm disabled:opacity-60" />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-on-surface-muted">Remarks (internal)</span>
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2}
            placeholder="Negotiation notes, joining bonus, notice buyout, etc."
            className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
        </label>

        {!released && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-outline">
            <button onClick={draftOffer} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">
              <Pencil size={13} /> {status === 'draft' ? 'Update draft' : 'Save draft'}
            </button>
            <button onClick={releaseOffer} disabled={busy || status !== 'draft'}
              title={status === 'draft' ? '' : 'Save the draft first.'}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
              <Send size={13} /> Release offer
            </button>
          </div>
        )}

        {released && !accepted && !alreadyHired && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-outline">
            <button onClick={() => markFinal('accepted')} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-success text-on-success text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              <CheckCircle2 size={13} /> Candidate accepted
            </button>
            <button onClick={() => markFinal('declined')} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline text-sm font-semibold text-danger hover:bg-danger-container/40 disabled:opacity-50">
              <XCircle size={13} /> Candidate declined
            </button>
          </div>
        )}
      </div>

      {showHire && (
        <HireCandidateModal candidate={candidate} onClose={() => setShowHire(false)} onHired={() => { setShowHire(false); onSaved(); }} />
      )}
    </div>
  );
}

// ── Hire → Employee modal ─────────────────────────────────────────────
// Confirmation surface for POST /candidates/:id/hire. Pre-fills every
// field that can be sourced from the candidate record + a suggested next
// employee code, so HR can hire in ~10 seconds if the defaults are right.
function HireCandidateModal({ candidate, onClose, onHired }: { candidate: any; onClose: () => void; onHired: () => void }) {
  const [depts, setDepts] = useState<any[]>([]);
  const [desigs, setDesigs] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [suggestedCode, setSuggestedCode] = useState('');
  const [form, setForm] = useState({
    employee_code: '',
    join_date: new Date().toISOString().slice(0, 10),
    department: '',
    designation: candidate.profile_applied_for ?? '',
    shift: 'day',
    location: candidate.current_location ?? '',
    reporting_manager_id: '',
    role: 'employee',
    password: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getConfigDepartments().then(setDepts).catch(() => {});
    api.getConfigDesignations().then(setDesigs).catch(() => {});
    api.getConfigShifts().then(setShifts).catch(() => {});
    api.getEmployeesSlim().then(rows => {
      setManagers(rows ?? []);
      // Auto-suggest the next DL#### code by looking at the highest
      // existing numeric-suffix code. Falls back to DL0001 if there's
      // nothing to base it on.
      const codes: string[] = (rows ?? []).map((r: any) => r.employee_id).filter(Boolean);
      const max = codes.reduce((acc, c) => {
        const m = /^DL(\d+)$/i.exec(c || '');
        return m ? Math.max(acc, Number(m[1])) : acc;
      }, 0);
      const next = 'DL' + String(max + 1).padStart(4, '0');
      setSuggestedCode(next);
      setForm(f => (f.employee_code ? f : { ...f, employee_code: next }));
    }).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.employee_code.trim() || !form.department.trim() || !form.designation.trim() || !form.join_date) {
      toast.error('Missing fields', 'Employee code, department, designation, and join date are all required.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.hireCandidate(candidate.id, {
        employee_code: form.employee_code.trim(),
        join_date: form.join_date,
        department: form.department.trim(),
        designation: form.designation.trim(),
        shift: form.shift,
        location: form.location || undefined,
        reporting_manager_id: form.reporting_manager_id || undefined,
        role: form.role,
        password: form.password || undefined,
      });
      toast.success('Hired', `${candidate.name} joined as ${res.employee.employee_id}.`);
      onHired();
    } catch (e: any) {
      toast.error('Hire failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
         onClick={busy ? undefined : onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-outline"
           onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-outline flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-on-surface">Hire {candidate.name}</h2>
            <p className="text-xs text-on-surface-muted mt-0.5">
              Creates an Employees record + seeds leave balance + logs the initial salary from the offer.
            </p>
          </div>
          <button onClick={onClose} disabled={busy}
            className="w-8 h-8 rounded-full hover:bg-surface-2 flex items-center justify-center text-on-surface-muted disabled:opacity-50">
            <XCircle size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="rounded-lg border border-outline bg-surface-2/40 px-3 py-2 text-xs text-on-surface-muted flex items-center gap-2">
            <IndianRupee size={12} />
            <span>
              Using offer pay:{' '}
              <b className="text-on-surface">{candidate.offered_salary ? '₹' + Number(candidate.offered_salary).toLocaleString('en-IN') + '/mo' : '—'}</b>
              {candidate.offered_ctc ? <>, CTC <b className="text-on-surface">₹{Number(candidate.offered_ctc).toLocaleString('en-IN')}</b></> : ''}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-muted">Employee code</span>
              <input value={form.employee_code} onChange={e => setForm(f => ({ ...f, employee_code: e.target.value }))}
                placeholder={suggestedCode || 'DL0001'}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm num-mono" />
              {suggestedCode && form.employee_code !== suggestedCode && (
                <button onClick={() => setForm(f => ({ ...f, employee_code: suggestedCode }))}
                  className="mt-1 text-[10px] text-accent hover:underline">Use suggested {suggestedCode}</button>
              )}
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-muted">Join date</span>
              <input type="date" value={form.join_date} onChange={e => setForm(f => ({ ...f, join_date: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-muted">Department</span>
              <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
                <option value="">Select…</option>
                {depts.map((d: any) => <option key={d.id ?? d.name} value={d.name}>{d.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-muted">Designation</span>
              <select value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
                <option value="">Select…</option>
                {desigs.map((d: any) => <option key={d.id ?? d.name} value={d.name}>{d.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-muted">Shift</span>
              <select value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
                {shifts.length === 0 && <option value="day">Day</option>}
                {shifts.map((s: any) => <option key={s.id} value={s.id}>{s.name ?? s.id}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-muted">Reporting manager</span>
              <select value={form.reporting_manager_id} onChange={e => setForm(f => ({ ...f, reporting_manager_id: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
                <option value="">— None —</option>
                {managers.map((m: any) => <option key={m.id} value={m.id}>{m.name} ({m.employee_id})</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-muted">Location</span>
              <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-on-surface-muted">Portal role</span>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm">
                <option value="employee">Employee</option>
                <option value="project_coordinator">Project Coordinator</option>
                <option value="hr_intern">HR Intern</option>
                <option value="hr_manager">HR Manager</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-on-surface-muted">Temporary portal password (optional)</span>
            <input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder={candidate.email ? 'Leave blank to skip login provisioning' : 'Email missing — login setup skipped'}
              disabled={!candidate.email}
              className="mt-1 w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm disabled:opacity-60" />
            <span className="text-[10px] text-on-surface-subtle">
              If set + email present, an app_users row is created so they can sign in on day one. Share it out-of-band.
            </span>
          </label>
        </div>

        <div className="px-6 py-3 border-t border-outline flex justify-end gap-2 bg-surface-2/40">
          <button onClick={onClose} disabled={busy}
            className="px-3 py-2 rounded-lg text-sm font-semibold border border-outline hover:bg-surface disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5">
            <UserPlus size={13} /> {busy ? 'Hiring…' : 'Confirm hire'}
          </button>
        </div>
      </div>
    </div>
  );
}
