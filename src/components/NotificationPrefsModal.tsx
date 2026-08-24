import { useEffect, useMemo, useState } from 'react';
import { X, BellOff, Bell, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { toast } from './Toaster';

// Per-user notification preferences. A muted type still gets stored in
// the notifications table when it's addressed to you, but nothing new
// arrives — the backend skips the insert entirely, so the bell stays
// quiet until you re-enable it.

interface Props {
  onClose: () => void;
}

// Grouped catalog of notification types. Anything a producer fires
// should show up here so the user can mute it. Keep the labels
// human — "Interview feedback submitted" beats "interview_feedback_submitted".
const CATALOG: Array<{ group: string; hint: string; types: Array<{ id: string; label: string; hint?: string }> }> = [
  {
    group: 'Hiring',
    hint: 'Candidate pipeline updates',
    types: [
      { id: 'candidate_review_requested',     label: 'Tech-review requested',     hint: 'HR asked you to review a candidate' },
      { id: 'candidate_recommendation_ready', label: 'Recommendation ready',      hint: 'A reviewer submitted their verdict' },
      { id: 'interview_scheduled',            label: 'Interview scheduled',       hint: 'You were slotted as interviewer' },
      { id: 'interview_feedback_submitted',   label: 'Interview feedback',        hint: 'Feedback landed on a candidate' },
      { id: 'offer_released',                 label: 'Offer released',            hint: 'HR sent an offer to a candidate' },
      { id: 'candidate_hired',                label: 'Candidate hired',           hint: 'Someone became an employee' },
    ],
  },
  {
    group: 'Tasks',
    hint: 'Work assigned or commented on',
    types: [
      { id: 'task_assigned', label: 'Task assigned to you' },
      { id: 'task_mention',  label: 'Someone @mentions you' },
      { id: 'task_comment',  label: 'New comment on a task you own or watch' },
    ],
  },
  {
    group: 'Attendance & Leave',
    hint: 'Portal-side approvals',
    types: [
      { id: 'attendance_note_pending', label: 'Attendance note awaiting approval' },
      { id: 'leave_applied',           label: 'Leave applied (to you as manager)' },
      { id: 'leave_needs_hr_approval', label: 'Leave needs HR approval' },
      { id: 'leave_submitted',         label: 'Leave submitted (FYI)' },
      { id: 'wfh_applied',             label: 'WFH request applied' },
      { id: 'leave_approved',          label: 'Your leave was approved' },
    ],
  },
  {
    group: 'Hours & Time',
    hint: 'Timesheet approvals + mentions',
    types: [
      { id: 'internal_hours_review',       label: 'Internal hours awaiting review' },
      { id: 'hours_mention',               label: 'Someone tagged you in an hour-log comment' },
    ],
  },
  {
    group: 'Performance & HR',
    hint: 'Reviews and self-assessments',
    types: [
      { id: 'appraisal_submitted',   label: 'Appraisal submitted' },
      { id: 'self_review_submitted', label: 'Self review submitted' },
      { id: 'pulse_score_drop',      label: 'Pulse score drop alert' },
      { id: 'warning_issued',        label: "Warning issued to your team" },
      { id: 'pip_assigned',          label: 'PIP assigned to your team' },
    ],
  },
  {
    group: 'Expenses, Assets, Ops',
    hint: 'Everything else',
    types: [
      { id: 'expense_submitted',        label: 'Expense submitted' },
      { id: 'upsell_submitted',         label: 'Upsell submitted' },
      { id: 'invoice_clear_requested',  label: 'Invoice clear requested' },
      { id: 'asset_takeout_requested',  label: 'Asset takeout requested' },
      { id: 'repair_ticket_created',    label: 'Repair ticket created' },
      { id: 'repair_approval_needed',   label: 'Repair approval needed' },
      { id: 'feature_draft',            label: 'New feature draft awaiting approval' },
      { id: 'allocation_request',       label: 'Allocation request' },
    ],
  },
];

const HIRING_TYPES = CATALOG.find(g => g.group === 'Hiring')!.types.map(t => t.id);

export default function NotificationPrefsModal({ onClose }: Props) {
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.getMyNotificationMutes()
      .then(rows => setMuted(new Set(rows.map(r => r.type))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (t: string) => {
    setMuted(s => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
    setDirty(true);
  };

  const muteAll = (types: string[]) => {
    setMuted(s => {
      const next = new Set(s);
      types.forEach(t => next.add(t));
      return next;
    });
    setDirty(true);
  };
  const unmuteAll = (types: string[]) => {
    setMuted(s => {
      const next = new Set(s);
      types.forEach(t => next.delete(t));
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.setMyNotificationMutes(Array.from(muted));
      toast.success('Preferences saved', muted.size ? `${muted.size} type${muted.size === 1 ? '' : 's'} muted.` : 'All notifications re-enabled.');
      setDirty(false);
      onClose();
    } catch (e: any) {
      toast.error('Could not save', e?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  const summary = useMemo(() => {
    if (muted.size === 0) return 'Everything is on.';
    const groupCounts = CATALOG.map(g => ({
      group: g.group,
      n: g.types.filter(t => muted.has(t.id)).length,
      total: g.types.length,
    })).filter(g => g.n > 0);
    if (groupCounts.length === 1 && groupCounts[0].n === groupCounts[0].total) return `${groupCounts[0].group} muted.`;
    return `${muted.size} type${muted.size === 1 ? '' : 's'} muted.`;
  }, [muted]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] rounded-xl-3 bg-surface border border-outline shadow-elev-4 flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-outline flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-on-surface">Notification preferences</h2>
            <p className="text-[11px] text-on-surface-muted mt-0.5">{summary}</p>
          </div>
          <button onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-on-surface-muted">Loading…</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {CATALOG.map(g => {
              const groupTypes = g.types.map(t => t.id);
              const allMuted = groupTypes.every(t => muted.has(t));
              const anyMuted = groupTypes.some(t => muted.has(t));
              return (
                <div key={g.group}>
                  <div className="flex items-baseline justify-between mb-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-on-surface-muted font-bold">{g.group}</p>
                      <p className="text-[10px] text-on-surface-subtle">{g.hint}</p>
                    </div>
                    <button onClick={() => allMuted ? unmuteAll(groupTypes) : muteAll(groupTypes)}
                      className="text-[10px] font-semibold text-accent hover:opacity-80">
                      {allMuted ? 'Turn all on' : anyMuted ? 'Mute the rest' : 'Mute all'}
                    </button>
                  </div>
                  <div className="rounded-lg border border-outline divide-y divide-outline">
                    {g.types.map(t => (
                      <label key={t.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-2 cursor-pointer">
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold ${muted.has(t.id) ? 'text-on-surface-subtle' : 'text-on-surface'}`}>{t.label}</p>
                          {t.hint && <p className="text-[10px] text-on-surface-subtle">{t.hint}</p>}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {muted.has(t.id) ? <BellOff size={13} className="text-danger" /> : <Bell size={13} className="text-success" />}
                          <input type="checkbox"
                            checked={!muted.has(t.id)}
                            onChange={() => toggle(t.id)}
                            className="sr-only peer" />
                          <span onClick={() => toggle(t.id)}
                            className={`relative inline-block w-8 h-4 rounded-full transition-colors ${muted.has(t.id) ? 'bg-outline' : 'bg-success'}`}>
                            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${muted.has(t.id) ? 'left-0.5' : 'left-[18px]'}`} />
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="rounded-lg bg-brand/5 border border-brand/20 p-3">
              <p className="text-xs text-on-surface">
                <b>Quick action:</b>{' '}
                <button onClick={() => muteAll(HIRING_TYPES)}
                  className="text-brand font-semibold hover:opacity-80">Mute all hiring notifications</button>
                {' · '}
                <button onClick={() => unmuteAll(HIRING_TYPES)}
                  className="text-brand font-semibold hover:opacity-80">Turn hiring back on</button>
              </p>
              <p className="text-[10px] text-on-surface-muted mt-1">
                Muting doesn't lose history — old items stay in your bell. New ones just stop arriving until you switch them back on.
              </p>
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-outline flex justify-end gap-2 bg-surface-2/40">
          <button onClick={onClose}
            className="px-3 py-2 rounded-lg border border-outline text-xs font-semibold hover:bg-surface">Cancel</button>
          <button onClick={save} disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-50">
            {saving && <Loader2 size={12} className="animate-spin" />} Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}
