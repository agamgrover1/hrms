import { useState } from 'react';
import { X, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';
import { toast } from './Toaster';

// Employee-facing self-review form. Fills the SAME 11 categories the
// manager fills, plus two reflection fields. Submitting pings the
// reporting manager and unlocks the side-by-side comparison view on the
// manager's review modal.

const CATEGORIES = [
  { key: 'productivity',        label: 'Productivity' },
  { key: 'quality',             label: 'Quality of Work' },
  { key: 'teamwork',            label: 'Teamwork' },
  { key: 'attendance_score',    label: 'Attendance' },
  { key: 'initiative',          label: 'Initiative' },
  { key: 'client_satisfaction', label: 'Client Handling' },
  { key: 'ai_usage',            label: 'AI Usage' },
  { key: 'communication',       label: 'Communication' },
  { key: 'ownership',           label: 'Ownership' },
  { key: 'planning_accuracy',   label: 'Planning Accuracy' },
  { key: 'learning_growth',     label: 'Learning & Growth' },
] as const;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function SelfReviewModal({
  employeeId, employeeName, month, year, existingSelf, onClose, onSaved,
}: {
  employeeId: string;
  employeeName: string;
  month: number; year: number;
  existingSelf?: {
    self_scores?: Record<string, number> | null;
    self_went_well?: string | null;
    self_would_do_differently?: string | null;
    self_submitted_at?: string | null;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const seed = (k: string) => existingSelf?.self_scores?.[k] ?? 75;
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(CATEGORIES.map(c => [c.key, seed(c.key)]))
  );
  const [wentWell, setWentWell] = useState(existingSelf?.self_went_well ?? '');
  const [diff, setDiff] = useState(existingSelf?.self_would_do_differently ?? '');
  const [saving, setSaving] = useState(false);

  const overall = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / CATEGORIES.length);

  const submit = async () => {
    setSaving(true);
    try {
      await api.submitSelfReview({
        employee_id: employeeId, month, year,
        self_scores: scores,
        self_went_well: wentWell.trim() || undefined,
        self_would_do_differently: diff.trim() || undefined,
      });
      toast.success('Self-review submitted', `${MONTHS[month - 1]} ${year} — your manager has been notified.`);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error('Could not submit', e?.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-outline">
          <div>
            <h3 className="font-display text-base font-bold text-on-surface">Self-review</h3>
            <p className="text-xs text-on-surface-subtle mt-0.5">
              {employeeName} · {MONTHS[month - 1]} {year}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} className="text-on-surface-subtle" /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {existingSelf?.self_submitted_at && (
            <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-success inline-flex items-center gap-2">
              <CheckCircle2 size={12} />
              Already submitted on {new Date(existingSelf.self_submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. Re-submitting will overwrite.
            </div>
          )}

          <div className="rounded-xl-2 p-3 text-center bg-surface-2 border border-outline">
            <p className="text-[10px] uppercase tracking-wide font-bold text-on-surface-subtle">Self overall</p>
            <p className="text-3xl font-bold text-on-surface num-mono mt-1">{overall}</p>
          </div>

          <div className="space-y-2">
            {CATEGORIES.map(c => (
              <div key={c.key} className="flex items-center justify-between gap-3 py-1.5 border-b border-outline/40 last:border-0">
                <label className="text-sm text-on-surface flex-1">{c.label}</label>
                <input type="range" min={0} max={100} value={scores[c.key]}
                  onChange={e => setScores(s => ({ ...s, [c.key]: Number(e.target.value) }))}
                  className="score-slider flex-1" />
                <input type="number" min={0} max={100} value={scores[c.key]}
                  onChange={e => setScores(s => ({ ...s, [c.key]: Math.max(0, Math.min(100, Number(e.target.value))) }))}
                  className="w-16 text-center num-mono text-sm font-bold bg-surface border border-outline rounded-lg px-2 py-1 focus:outline-none focus:border-accent" />
              </div>
            ))}
          </div>

          <div>
            <label className="text-sm font-semibold text-on-surface mb-1.5 block">What went well</label>
            <textarea value={wentWell} onChange={e => setWentWell(e.target.value)} rows={3}
              placeholder="Three wins from this month, in plain language. No need to inflate — be honest."
              className="w-full bg-surface border border-outline rounded-xl-2 px-3 py-2 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
          </div>

          <div>
            <label className="text-sm font-semibold text-on-surface mb-1.5 block">What I'd do differently</label>
            <textarea value={diff} onChange={e => setDiff(e.target.value)} rows={3}
              placeholder="One or two things you'd handle differently next month. Used in the 1-1 conversation."
              className="w-full bg-surface border border-outline rounded-xl-2 px-3 py-2 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
          </div>
        </div>

        <div className="flex gap-3 p-5 border-t border-outline">
          <button onClick={onClose} className="flex-1 py-2.5 border border-outline rounded-xl-2 text-sm font-semibold text-on-surface-muted hover:bg-surface-2">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2.5 bg-accent text-on-accent rounded-xl-2 text-sm font-semibold disabled:opacity-60 hover:opacity-90">
            {saving ? 'Submitting…' : 'Submit self-review'}
          </button>
        </div>
      </div>
    </div>
  );
}
