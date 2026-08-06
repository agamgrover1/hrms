import { useEffect, useMemo, useState } from 'react';
import { X, TrendingUp, Loader2, Info } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../Toaster';

// Give Increment modal — the ONLY path for HR to change an employee's
// salary. Every submit creates a new dated salary_structures row so
// history is automatic. Backdated effective_from is allowed silently;
// past payslips are already snapshotted so they can't be rewritten,
// only future runs will pick up the new figure.

interface Props {
  employeeId: string;
  employeeName: string;
  currentMonthly: number;
  currentCtc: number;
  onClose: () => void;
  // Called after the row is persisted. Receives the new (currently-
  // effective) monthly + ctc so the caller can patch the employee
  // record locally without a refetch — but this is only the case when
  // effective_from <= today. For a future-dated increment, employees.
  // salary stays at the CURRENT value until that date rolls around.
  onSaved: (result: { newMonthly: number; newCtc: number; effectiveFrom: string; isEffectiveNow: boolean }) => void;
}

function fmtINR(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export default function IncrementModal({ employeeId, employeeName, currentMonthly, currentCtc, onClose, onSaved }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [newMonthly, setNewMonthly] = useState<string>('');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Prefill with the current amount so a small tweak (₹30k → ₹32k)
    // is a two-character edit instead of retyping the whole number.
    if (currentMonthly > 0) setNewMonthly(String(Math.round(currentMonthly)));
  }, [currentMonthly]);

  const parsed = Number(newMonthly);
  const isValid = Number.isFinite(parsed) && parsed >= 0;
  const isChanged = isValid && parsed !== currentMonthly;
  const delta = isValid ? parsed - currentMonthly : 0;
  const deltaPct = currentMonthly > 0 ? (delta / currentMonthly) * 100 : 0;
  const isRaise = delta > 0;
  const isBackdated = effectiveFrom < today;

  // Preserve the CTC ratio if we can. Otherwise fall back to 12x monthly.
  const suggestedCtc = useMemo(() => {
    if (!isValid) return 0;
    if (currentMonthly > 0 && currentCtc > 0) {
      return Math.round(parsed * (currentCtc / currentMonthly));
    }
    return Math.round(parsed * 12);
  }, [parsed, isValid, currentMonthly, currentCtc]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isValid) return setError('Monthly salary must be a valid number.');
    if (!isChanged) return setError('New salary is the same as the current — nothing to record.');
    if (!reason.trim()) return setError('Reason is required. Something short is fine ("annual appraisal", "market correction").');
    setBusy(true);
    try {
      await api.createSalaryStructure({
        employee_id: employeeId,
        effective_from: effectiveFrom,
        ctc_annual: suggestedCtc,
        // Flat-mode convention (matches SalaryPanel & payroll fallback at
        // api/index.ts:8895) — the whole monthly amount goes to basic,
        // splits are 0. If the org later switches to structured mode
        // they can add a full component split via the Salary tab.
        basic: parsed,
        hra: 0,
        special_allowance: 0,
        employer_pf: 0,
        notes: reason.trim(),
      });
      toast.success(
        isRaise ? 'Increment recorded' : 'Salary updated',
        `${employeeName}: ${fmtINR(currentMonthly)} → ${fmtINR(parsed)} effective ${effectiveFrom}.`
      );
      onSaved({
        newMonthly: parsed,
        newCtc: suggestedCtc,
        effectiveFrom,
        isEffectiveNow: effectiveFrom <= today,
      });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save the increment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl border border-outline shadow-elev-4 w-full max-w-lg flex flex-col">
        <div className="px-6 py-4 border-b border-outline flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-success/15 text-success flex items-center justify-center flex-shrink-0">
              <TrendingUp size={18} />
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-on-surface">Give increment</h3>
              <p className="text-xs text-on-surface-muted mt-0.5">
                Records a new dated row in <b>{employeeName}</b>'s salary history and updates the current amount.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-2">
            <X size={16} className="text-on-surface-muted" />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2/50 border border-outline p-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-subtle">Current monthly</p>
              <p className="num-mono text-lg font-bold text-on-surface mt-0.5">{fmtINR(currentMonthly)}</p>
              {currentCtc > 0 && <p className="text-[10px] text-on-surface-subtle mt-0.5">CTC {fmtINR(currentCtc)}/yr</p>}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-subtle">New monthly</p>
              <p className={`num-mono text-lg font-bold mt-0.5 ${isChanged ? (isRaise ? 'text-success' : 'text-warning') : 'text-on-surface'}`}>
                {isValid ? fmtINR(parsed) : '—'}
              </p>
              {isChanged && (
                <p className={`text-[10px] font-semibold mt-0.5 ${isRaise ? 'text-success' : 'text-warning'}`}>
                  {isRaise ? '+' : ''}{fmtINR(Math.abs(delta))} · {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface-muted mb-1">
              New monthly salary <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-muted">₹</span>
              <input
                type="number"
                value={newMonthly}
                onChange={e => setNewMonthly(e.target.value)}
                min="0"
                step="1"
                required
                autoFocus
                className="w-full pl-7 pr-3 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent num-mono"
              />
            </div>
            {isValid && (
              <p className="text-[10px] text-on-surface-subtle mt-1">
                Implied CTC: <span className="num-mono">{fmtINR(suggestedCtc)}</span>/year
                {currentMonthly > 0 && currentCtc > 0 && ' (preserves existing CTC ratio)'}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface-muted mb-1">
              Effective from <span className="text-danger">*</span>
            </label>
            <input
              type="date"
              value={effectiveFrom}
              onChange={e => setEffectiveFrom(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {isBackdated && (
              <p className="text-[10px] text-on-surface-subtle mt-1 flex items-start gap-1">
                <Info size={11} className="mt-0.5 flex-shrink-0 text-warning" />
                Backdated. Payslips already generated for prior months are frozen and won't change; only new / re-created payslip runs will pick up the new figure.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface-muted mb-1">
              Reason <span className="text-danger">*</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              required
              placeholder="e.g. Annual appraisal, promotion to Senior Media Buyer, market correction, retention"
              className="w-full px-3 py-2 rounded-lg border border-outline bg-surface focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
            <p className="text-[10px] text-on-surface-subtle mt-1">Shown in the history and in {employeeName}'s notification.</p>
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
          <button type="button" onClick={submit} disabled={busy || !isChanged || !isValid || !reason.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
            {busy ? 'Saving…' : (isRaise ? 'Give increment' : 'Update salary')}
          </button>
        </div>
      </div>
    </div>
  );
}
