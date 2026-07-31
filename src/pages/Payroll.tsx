import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wallet, Plus, Loader2, Settings, ChevronDown, ChevronRight,
  CheckCircle2, Lock, Unlock, Send, Trash2, ArrowLeft, X, AlertTriangle, Printer, Info,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toaster';

// Phase 2 payroll: runs + payslips.
//
// Flow:
//   /payroll                            → runs list + config panel + [+ New run]
//   /payroll (drilling into a run)      → payslip grid for that run + finalize/distribute/unlock
//   Employee side (/my → Payslips tab)  → their distributed history

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtINR(n: number | string | null | undefined): string {
  const num = Number(n ?? 0);
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Payroll() {
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      {openRunId ? (
        <RunDetail runId={openRunId} onBack={() => setOpenRunId(null)} />
      ) : (
        <>
          <PayrollConfigPanel />
          <RunsList onOpen={setOpenRunId} />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Runs list
// ─────────────────────────────────────────────────────────────────────────

function RunsList({ onOpen }: { onOpen: (id: string) => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.listPayrollRuns().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const remove = async (r: any) => {
    if (!window.confirm(`Delete the draft ${MONTHS[r.month - 1]} ${r.year} run? All ${r.payslip_count} payslips in it will be discarded.`)) return;
    try { await api.deletePayrollRun(r.id); toast.success('Deleted', 'Draft removed.'); load(); }
    catch (e: any) { toast.error('Delete failed', e?.message); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-on-surface flex items-center gap-2">
            <Wallet className="w-6 h-6 text-accent" /> Payroll
          </h1>
          <p className="text-xs text-on-surface-muted mt-0.5">
            One run per month. Snapshots salaries, lets HR review + adjust, then distributes payslips to employees.
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
          <Plus size={14} /> New run
        </button>
      </div>

      {loading ? (
        <div className="h-40 rounded-xl-2 bg-surface-2 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl-2 border border-outline bg-surface p-10 text-center">
          <Wallet className="w-8 h-8 mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">No payroll runs yet.</p>
          <p className="text-xs text-on-surface-subtle mt-1">
            Click "New run" to snapshot everyone's salary for a month.
          </p>
        </div>
      ) : (
        <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-on-surface-subtle">
              <tr>
                <th className="px-4 py-2.5 text-left">Period</th>
                <th className="px-4 py-2.5 text-left">Status</th>
                <th className="px-4 py-2.5 text-right">Payslips</th>
                <th className="px-4 py-2.5 text-right">Total net pay</th>
                <th className="px-4 py-2.5 text-left">Timeline</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-surface-2/40">
                  <td className="px-4 py-3">
                    <button onClick={() => onOpen(r.id)} className="font-semibold text-on-surface hover:text-accent">
                      {MONTHS[r.month - 1]} {r.year}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <RunStatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right num-mono">{r.payslip_count}</td>
                  <td className="px-4 py-3 text-right num-mono font-semibold text-on-surface">{fmtINR(r.total_net_pay)}</td>
                  <td className="px-4 py-3 text-[11px] text-on-surface-muted">
                    Created {fmtDate(r.created_at)}{r.created_by ? ` by ${r.created_by}` : ''}
                    {r.finalized_at && <><br />Finalized {fmtDate(r.finalized_at)}</>}
                    {r.distributed_at && <><br />Distributed {fmtDate(r.distributed_at)}</>}
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <button onClick={() => onOpen(r.id)}
                      className="text-xs font-semibold text-accent hover:underline">Open →</button>
                    {r.status === 'draft' && isAdmin && (
                      <button onClick={() => remove(r)}
                        title="Delete draft"
                        className="ml-1 p-1.5 text-on-surface-muted hover:text-danger hover:bg-danger-container/40 rounded-md">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewRunModal onClose={() => setCreating(false)}
          onCreated={id => { setCreating(false); load(); onOpen(id); }} />
      )}
    </div>
  );
}

function RunStatusPill({ status }: { status: string }) {
  const cfg =
    status === 'distributed' ? { label: 'Distributed', cls: 'bg-success-container text-success', Icon: Send }
    : status === 'finalized' ? { label: 'Finalized',   cls: 'bg-accent/15 text-accent',           Icon: Lock }
    : { label: 'Draft', cls: 'bg-warning-container text-warning', Icon: CheckCircle2 };
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${cfg.cls}`}>
      <Icon size={10} /> {cfg.label}
    </span>
  );
}

function NewRunModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [month, setMonth] = useState(prev.getMonth() + 1);
  const [year, setYear] = useState(prev.getFullYear());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.createPayrollRun(month, year);
      toast.success('Run created',
        r.missing_structure > 0
          ? `${r.snapped} payslips created. ${r.missing_structure} have no salary on record — set it under Employees, then delete + recreate this run.`
          : `${r.snapped} payslips created.`);
      onCreated(r.run_id);
    } catch (e: any) { setError(e?.message ?? 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-md">
        <div className="px-6 py-4 border-b border-outline flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-on-surface">New payroll run</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              Snapshots each active employee's salary + auto-computes LOP from unpaid leaves and absences.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">Month</span>
              <select value={month} onChange={e => setMonth(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">Year</span>
              <input type="number" min="2020" max="2100" value={year} onChange={e => setYear(Number(e.target.value))}
                className="w-full num-mono px-3 py-2 rounded-lg border border-outline bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </label>
          </div>
          {error && <p className="text-sm text-danger bg-danger-container/40 border border-danger/30 rounded px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
            <button disabled={busy} className="px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy && <Loader2 size={13} className="animate-spin" />} Create draft
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Single run detail — payslip grid + status actions
// ─────────────────────────────────────────────────────────────────────────

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState<{ run: any; payslips: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [openPayslip, setOpenPayslip] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getPayrollRun(runId).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [runId]);
  useEffect(load, [load]);

  const finalize = async () => {
    if (!data) return;
    if (!window.confirm(`Finalize the ${MONTHS[data.run.month - 1]} ${data.run.year} run? Payslips will lock. You can unlock later if needed.`)) return;
    try { await api.finalizePayrollRun(runId); toast.success('Finalized'); load(); }
    catch (e: any) { toast.error('Finalize failed', e?.message); }
  };

  const distribute = async () => {
    if (!data) return;
    if (!window.confirm(`Distribute payslips for ${MONTHS[data.run.month - 1]} ${data.run.year}? Employees will be notified and can see their own payslip in their portal.`)) return;
    try {
      const r = await api.distributePayrollRun(runId);
      toast.success('Distributed', `${r.distributed_to} employees notified.`);
      load();
    } catch (e: any) { toast.error('Distribute failed', e?.message); }
  };

  const unlock = async () => {
    const reason = window.prompt('Reason for unlocking this run (audit trail):');
    if (!reason?.trim()) return;
    try { await api.unlockPayrollRun(runId, reason.trim()); toast.success('Unlocked'); load(); }
    catch (e: any) { toast.error('Unlock failed', e?.message); }
  };

  if (loading || !data) {
    return <div className="h-60 rounded-xl-2 bg-surface-2 animate-pulse" />;
  }
  const { run, payslips } = data;
  const totalNet = payslips.reduce((s, p) => s + Number(p.net_pay), 0);
  // A payslip is "truly missing" only if it has no monthly_gross at all —
  // i.e. neither a dated structure NOR an employees.salary fell into
  // place. A payslip with structure_id=null but monthly_gross>0 came
  // from the employees-table fallback and is fine.
  const anyMissing = payslips.some(p => Number(p.monthly_gross) === 0);
  const canEdit = run.status === 'draft';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="p-1.5 rounded-md text-on-surface-muted hover:bg-surface-2">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="font-display text-2xl font-bold text-on-surface">
              {MONTHS[run.month - 1]} {run.year} · Payroll run
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <RunStatusPill status={run.status} />
              <span className="text-[11px] text-on-surface-muted">
                {payslips.length} payslips · <span className="num-mono font-semibold text-on-surface">{fmtINR(totalNet)}</span> total net
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {run.status === 'draft' && (
            <button onClick={finalize}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
              <Lock size={13} /> Finalize
            </button>
          )}
          {run.status === 'finalized' && (
            <>
              {isAdmin && (
                <button onClick={unlock}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-on-surface border border-outline hover:bg-surface-2">
                  <Unlock size={13} /> Unlock
                </button>
              )}
              <button onClick={distribute}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-success text-on-accent text-sm font-semibold hover:opacity-90">
                <Send size={13} /> Distribute
              </button>
            </>
          )}
          {run.status === 'distributed' && isAdmin && (
            <button onClick={unlock}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-on-surface border border-outline hover:bg-surface-2">
              <Unlock size={13} /> Unlock
            </button>
          )}
        </div>
      </div>

      {run.unlocked_reason && (
        <div className="rounded-lg border border-warning/30 bg-warning-container/40 px-3 py-2 text-[11px] text-warning flex items-start gap-2">
          <Info size={12} className="mt-0.5" />
          <span>Unlocked {fmtDate(run.unlocked_at)}{run.unlocked_by ? ` by ${run.unlocked_by}` : ''} — reason: "{run.unlocked_reason}"</span>
        </div>
      )}

      {anyMissing && (
        <div className="rounded-lg border border-warning/40 bg-warning-container/50 px-4 py-3 flex items-start gap-2 text-[13px] text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            One or more employees have no salary on record — their payslips are zero.
            Set a salary on their <b>Employee</b> page, then delete this run and re-create it (draft only).
          </span>
        </div>
      )}

      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-on-surface-subtle">
            <tr>
              <th className="px-4 py-2.5 text-left">Employee</th>
              <th className="px-4 py-2.5 text-right">Monthly gross</th>
              <th className="px-4 py-2.5 text-right">LOP (days)</th>
              <th className="px-4 py-2.5 text-right">LOP deduction</th>
              <th className="px-4 py-2.5 text-right">+ Additions</th>
              <th className="px-4 py-2.5 text-right">− Deductions</th>
              <th className="px-4 py-2.5 text-right font-bold">Net pay</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {payslips.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-on-surface-subtle">No payslips in this run.</td></tr>
            ) : payslips.map(p => (
              <tr key={p.id} className="hover:bg-surface-2/40">
                <td className="px-4 py-3">
                  <p className="font-semibold text-on-surface">{p.employee_name}</p>
                  <p className="text-[11px] text-on-surface-subtle">{p.designation ?? '—'}</p>
                </td>
                <td className="px-4 py-3 text-right num-mono">{fmtINR(p.monthly_gross)}</td>
                <td className="px-4 py-3 text-right num-mono">
                  {Number(p.lop_days)}
                  {Number(p.lop_days) !== Number(p.lop_days_auto) && (
                    <span className="ml-1 text-[10px] text-warning" title={`Auto: ${p.lop_days_auto}`}>*</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right num-mono text-danger">−{fmtINR(p.lop_deduction)}</td>
                <td className="px-4 py-3 text-right num-mono text-success">+{fmtINR(p.additions_total)}</td>
                <td className="px-4 py-3 text-right num-mono text-danger">−{fmtINR(p.deductions_total)}</td>
                <td className="px-4 py-3 text-right num-mono font-bold text-on-surface">{fmtINR(p.net_pay)}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setOpenPayslip(p)}
                    className="text-xs font-semibold text-accent hover:underline">
                    {canEdit ? 'Edit' : 'View'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openPayslip && (
        <PayslipEditorModal
          payslip={openPayslip}
          canEdit={canEdit}
          onClose={() => setOpenPayslip(null)}
          onSaved={updated => {
            setData(d => d && ({ ...d, payslips: d.payslips.map(x => x.id === updated.id ? updated : x) }));
            setOpenPayslip(updated);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Payslip editor (HR side) — used for review during a draft AND for
// read-only inspection after finalize/distribute.
// ─────────────────────────────────────────────────────────────────────────

function PayslipEditorModal({ payslip, canEdit, onClose, onSaved }:
  { payslip: any; canEdit: boolean; onClose: () => void; onSaved: (p: any) => void }
) {
  const [lopDays, setLopDays] = useState<string>(String(payslip.lop_days));
  const [lopReason, setLopReason] = useState<string>(payslip.lop_override_reason ?? '');
  const [additions, setAdditions] = useState<Array<{ label: string; amount: number }>>(payslip.additions ?? []);
  const [deductions, setDeductions] = useState<Array<{ label: string; amount: number }>>(payslip.deductions ?? []);
  const [notes, setNotes] = useState<string>(payslip.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const lopChanged = Number(lopDays) !== Number(payslip.lop_days_auto);

  const save = async () => {
    setBusy(true); setError('');
    try {
      const updated = await api.updatePayslip(payslip.id, {
        lop_days: Number(lopDays),
        lop_override_reason: lopChanged ? lopReason.trim() : undefined,
        additions: additions.filter(a => a.label.trim() && Number(a.amount) > 0),
        deductions: deductions.filter(a => a.label.trim() && Number(a.amount) > 0),
        notes: notes.trim() || undefined,
      });
      toast.success('Saved');
      onSaved(updated);
    } catch (e: any) { setError(e?.message ?? 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-outline flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-on-surface">
              {payslip.employee_name} · {MONTHS[payslip.month - 1]} {payslip.year}
            </h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              {payslip.designation ?? '—'} · Monthly gross <span className="num-mono font-semibold">{fmtINR(payslip.monthly_gross)}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} /></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Components snapshot (read-only) */}
          <div className="rounded-lg bg-surface-2/60 border border-outline p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-subtle mb-2">Salary snapshot</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <SnapField label="Basic" value={fmtINR(payslip.basic)} />
              {Number(payslip.hra) > 0 && <SnapField label="HRA" value={fmtINR(payslip.hra)} />}
              {Number(payslip.special_allowance) > 0 && <SnapField label="Special" value={fmtINR(payslip.special_allowance)} />}
              {Number(payslip.employer_pf) > 0 && <SnapField label="Employer PF" value={fmtINR(payslip.employer_pf)} />}
            </div>
            {(payslip.other_components ?? []).length > 0 && (
              <ul className="mt-2 text-[12px] space-y-0.5">
                {payslip.other_components.map((c: any, i: number) => (
                  <li key={i} className="flex justify-between text-on-surface-muted">
                    <span>{c.label}</span>
                    <span className="num-mono">{fmtINR(c.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* LOP */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-2">Loss of Pay</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[11px] text-on-surface-muted mb-1">LOP days (auto: {Number(payslip.lop_days_auto)})</span>
                <input type="number" min="0" step="0.5" value={lopDays} disabled={!canEdit}
                  onChange={e => setLopDays(e.target.value)}
                  className="w-full num-mono px-3 py-2 rounded-lg border border-outline bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60" />
              </label>
              <label className="block">
                <span className="block text-[11px] text-on-surface-muted mb-1">
                  Override reason {lopChanged ? <span className="text-warning">*</span> : ''}
                </span>
                <input type="text" value={lopReason} disabled={!canEdit || !lopChanged}
                  placeholder={lopChanged ? 'Why the override?' : 'Not needed — matches auto'}
                  onChange={e => setLopReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60" />
              </label>
            </div>
            <p className="text-[11px] text-on-surface-muted mt-1">
              Auto = unpaid-leave days + absent days (weekdays only). Working days basis: {Number(payslip.working_days)}.
            </p>
          </div>

          {/* Additions */}
          <LineItemEditor
            title="Additions (bonus, reimbursement, arrears)"
            tone="success"
            rows={additions}
            setRows={setAdditions}
            canEdit={canEdit}
          />

          {/* Deductions */}
          <LineItemEditor
            title="Deductions (advance recovery, fines, tax)"
            tone="danger"
            rows={deductions}
            setRows={setDeductions}
            canEdit={canEdit}
          />

          {/* Notes */}
          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">Notes (visible to employee)</span>
            <textarea value={notes} rows={2} disabled={!canEdit}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none disabled:opacity-60" />
          </label>

          {/* Summary */}
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 space-y-1 text-sm">
            <SumRow label="Monthly gross" value={fmtINR(payslip.monthly_gross)} />
            <SumRow label={`LOP deduction (${Number(payslip.lop_days)}d)`} value={`− ${fmtINR(payslip.lop_deduction)}`} tone="danger" />
            <SumRow label="Earned gross" value={fmtINR(payslip.earned_gross)} bold />
            <SumRow label={`+ Additions`} value={`+ ${fmtINR(payslip.additions_total)}`} tone="success" />
            <SumRow label={`− Deductions`} value={`− ${fmtINR(payslip.deductions_total)}`} tone="danger" />
            <div className="pt-1 mt-1 border-t border-accent/30">
              <SumRow label="Net pay" value={fmtINR(payslip.net_pay)} bold big />
            </div>
          </div>

          {error && <p className="text-sm text-danger bg-danger-container/40 border border-danger/30 rounded px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-outline bg-surface-2/40 flex justify-end gap-2">
          {canEdit ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
              <button onClick={save} disabled={busy}
                className="px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5">
                {busy && <Loader2 size={13} className="animate-spin" />} Save
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-4 py-2 text-sm text-on-surface-muted hover:bg-surface-2 rounded-lg">Close</button>
          )}
        </div>
      </div>
    </div>
  );
}

function SnapField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-on-surface-subtle">{label}</p>
      <p className="num-mono font-semibold text-on-surface">{value}</p>
    </div>
  );
}
function SumRow({ label, value, tone, bold, big }: { label: string; value: string; tone?: 'success' | 'danger'; bold?: boolean; big?: boolean }) {
  const cls = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-on-surface';
  return (
    <div className="flex items-center justify-between">
      <span className={`${bold ? 'font-semibold' : ''} ${big ? 'text-base' : 'text-sm'} text-on-surface-muted`}>{label}</span>
      <span className={`num-mono ${bold ? 'font-bold' : 'font-semibold'} ${big ? 'text-lg' : 'text-sm'} ${cls}`}>{value}</span>
    </div>
  );
}

function LineItemEditor({ title, tone, rows, setRows, canEdit }:
  { title: string; tone: 'success' | 'danger'; rows: Array<{ label: string; amount: number }>; setRows: (r: Array<{ label: string; amount: number }>) => void; canEdit: boolean }
) {
  const add = () => setRows([...rows, { label: '', amount: 0 }]);
  const upd = (i: number, patch: Partial<{ label: string; amount: number }>) =>
    setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const del = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle">{title}</p>
        {canEdit && (
          <button type="button" onClick={add}
            className="text-[11px] font-semibold text-accent hover:underline inline-flex items-center gap-1">
            <Plus size={11} /> Add
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-on-surface-subtle italic">Nothing added.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-2">
              <input value={r.label} disabled={!canEdit} placeholder="Label"
                onChange={e => upd(i, { label: e.target.value })}
                className="flex-1 px-3 py-1.5 rounded-lg border border-outline bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60" />
              <div className="relative w-32">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-on-surface-subtle">₹</span>
                <input type="number" min="0" step="1" value={r.amount} disabled={!canEdit}
                  onChange={e => upd(i, { amount: Number(e.target.value) })}
                  className={`w-full pl-5 pr-2 py-1.5 rounded-lg border border-outline bg-surface text-sm num-mono focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60 ${tone === 'success' ? 'text-success' : 'text-danger'}`} />
              </div>
              {canEdit && (
                <button type="button" onClick={() => del(i)}
                  className="p-1.5 text-on-surface-muted hover:text-danger hover:bg-danger-container/40 rounded-md">
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Config panel — unchanged in shape from Phase 1, now with mode toggle.
// ─────────────────────────────────────────────────────────────────────────

function PayrollConfigPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<{
    basic_pct: number; hra_pct: number; special_allowance_pct: number; employer_pf_pct: number;
    working_days_convention: 'fixed_30' | 'actual_month';
    salary_mode: 'flat' | 'structured';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!open || cfg) return;
    setLoading(true);
    api.getPayrollConfig()
      .then(c => setCfg({
        basic_pct: Number(c.basic_pct),
        hra_pct: Number(c.hra_pct),
        special_allowance_pct: Number(c.special_allowance_pct),
        employer_pf_pct: Number(c.employer_pf_pct),
        working_days_convention: c.working_days_convention,
        salary_mode: c.salary_mode ?? 'flat',
      }))
      .catch(() => setMsg('Failed to load config'))
      .finally(() => setLoading(false));
  }, [open, cfg]);

  const isFlat = cfg?.salary_mode === 'flat';
  const grossSum = cfg ? cfg.basic_pct + cfg.hra_pct + cfg.special_allowance_pct : 0;
  const sumOk = isFlat || Math.abs(grossSum - 100) <= 0.5;

  const save = async () => {
    if (!cfg) return;
    if (!sumOk) { setMsg(`Basic + HRA + Special must sum to 100% (currently ${grossSum}%).`); return; }
    setBusy(true); setMsg('');
    try {
      await api.updatePayrollConfig(cfg);
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2500);
    } catch (e: any) { setMsg(e?.message ?? 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-surface-2/40 transition-colors">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-on-surface">
          <Settings size={14} className="text-accent" /> Payroll settings
        </span>
        <span className="inline-flex items-center gap-2 text-[11px] text-on-surface-muted">
          Salary model · working days convention
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-2 border-t border-outline bg-surface-2/30">
          {loading ? (
            <p className="text-sm text-on-surface-subtle py-4">Loading…</p>
          ) : !cfg ? (
            <p className="text-sm text-danger">Failed to load payroll config.</p>
          ) : (
            <>
              <div className="mb-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-2">Salary model</p>
                <div className="inline-flex items-center gap-1 bg-surface rounded-lg border border-outline p-1">
                  <button type="button" onClick={() => isAdmin && setCfg(c => c && ({ ...c, salary_mode: 'flat', basic_pct: 100, hra_pct: 0, special_allowance_pct: 0, employer_pf_pct: 0 }))}
                    disabled={!isAdmin}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold ${isFlat ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'} disabled:opacity-60`}>
                    Flat monthly
                  </button>
                  <button type="button" onClick={() => isAdmin && setCfg(c => c && ({ ...c, salary_mode: 'structured', basic_pct: c.basic_pct || 50, hra_pct: c.hra_pct || 20, special_allowance_pct: c.special_allowance_pct || 25 }))}
                    disabled={!isAdmin}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold ${!isFlat ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'} disabled:opacity-60`}>
                    Structured (Basic / HRA / SA)
                  </button>
                </div>
                <p className="text-[11px] text-on-surface-muted mt-2">
                  {isFlat
                    ? 'Salary tab shows a single "Monthly salary" field. The whole amount is treated as Basic under the hood.'
                    : 'These percentages pre-fill a new salary structure when HR enters a CTC. Individual employees can still be edited component-by-component after.'}
                </p>
              </div>

              {!isFlat && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <PctField label="Basic %" value={cfg.basic_pct} disabled={!isAdmin} onChange={v => setCfg(c => c && ({ ...c, basic_pct: v }))} />
                    <PctField label="HRA %" value={cfg.hra_pct} disabled={!isAdmin} onChange={v => setCfg(c => c && ({ ...c, hra_pct: v }))} />
                    <PctField label="Special Allowance %" value={cfg.special_allowance_pct} disabled={!isAdmin} onChange={v => setCfg(c => c && ({ ...c, special_allowance_pct: v }))} />
                    <PctField label="Employer PF %" value={cfg.employer_pf_pct} disabled={!isAdmin} onChange={v => setCfg(c => c && ({ ...c, employer_pf_pct: v }))} />
                  </div>
                  <p className={`text-[11px] mt-2 ${sumOk ? 'text-on-surface-subtle' : 'text-danger'}`}>
                    Basic + HRA + Special = <span className="num-mono font-semibold">{grossSum}%</span>
                    {sumOk ? ' · sums correctly.' : ' · must total 100%.'}
                  </p>
                </>
              )}

              <div className="mt-4">
                <label className="block">
                  <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">
                    Working-days convention
                  </span>
                  <select value={cfg.working_days_convention}
                    disabled={!isAdmin}
                    onChange={e => setCfg(c => c && ({ ...c, working_days_convention: e.target.value as any }))}
                    className="bg-surface border border-outline rounded-lg px-3 py-1.5 text-sm text-on-surface disabled:opacity-60">
                    <option value="fixed_30">Fixed 30 days (per-day = monthly/30)</option>
                    <option value="actual_month">Actual month days (per-day = monthly/actual days)</option>
                  </select>
                  <span className="block text-[11px] text-on-surface-muted mt-1">
                    Divisor used when the payslip generator computes LOP deduction (LOP days × monthly / working days).
                  </span>
                </label>
              </div>

              {msg && (
                <p className={`text-xs mt-3 ${msg === 'Saved.' ? 'text-success' : 'text-danger'}`}>{msg}</p>
              )}
              {isAdmin && (
                <div className="mt-4 flex justify-end">
                  <button onClick={save} disabled={busy || !sumOk}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50">
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    Save settings
                  </button>
                </div>
              )}
              {!isAdmin && (
                <p className="text-[11px] text-on-surface-muted mt-3 italic">
                  You can view these settings. Admin edits.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PctField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">{label}</span>
      <div className="relative">
        <input type="number" step="0.5" min="0" max="100" value={value} disabled={disabled}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full num-mono pr-6 pl-3 py-1.5 rounded-lg bg-surface border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60" />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-on-surface-subtle">%</span>
      </div>
    </label>
  );
}

// Print CSS injected once — used by the employee-side PayslipView when
// the user clicks "Download / Print". Kept in this module so any Payroll
// print surface has the same page setup.
export function ensurePayslipPrintCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('payslip-print-css')) return;
  const style = document.createElement('style');
  style.id = 'payslip-print-css';
  style.textContent = `
    @media print {
      body * { visibility: hidden; }
      .payslip-print, .payslip-print * { visibility: visible; }
      .payslip-print { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
      .no-print { display: none !important; }
    }
    @page { size: A4; margin: 20mm; }
  `;
  document.head.appendChild(style);
}

// Small helper used by MyPayslipsPanel; exported so both HR view and
// employee view can render the exact same printable body.
export function PayslipPrintable({ p }: { p: any }) {
  const monthName = MONTHS[p.month - 1];
  return (
    <div className="payslip-print bg-white text-slate-900 p-6">
      <div className="flex items-start justify-between border-b border-slate-300 pb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">Payslip</p>
          <h2 className="text-2xl font-bold">{monthName} {p.year}</h2>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">{p.employee_name}</p>
          {p.employee_code && <p className="text-slate-500">{p.employee_code}</p>}
          {p.designation && <p className="text-slate-500">{p.designation}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mt-6">
        <div>
          <p className="text-xs font-bold uppercase text-slate-500 mb-2">Earnings</p>
          <table className="w-full text-sm">
            <tbody>
              <PrintRow label="Basic" value={p.basic} />
              {Number(p.hra) > 0 && <PrintRow label="HRA" value={p.hra} />}
              {Number(p.special_allowance) > 0 && <PrintRow label="Special Allowance" value={p.special_allowance} />}
              {(p.other_components ?? []).map((c: any, i: number) => (
                <PrintRow key={i} label={c.label} value={c.amount} />
              ))}
              {Number(p.employer_pf) > 0 && <PrintRow label="Employer PF" value={p.employer_pf} />}
              <tr><td colSpan={2}><hr className="my-1 border-slate-200" /></td></tr>
              <PrintRow label="Monthly gross" value={p.monthly_gross} bold />
              {Number(p.lop_days) > 0 && <PrintRow label={`LOP deduction (${Number(p.lop_days)}d)`} value={-Number(p.lop_deduction)} />}
              <PrintRow label="Earned gross" value={p.earned_gross} bold />
              {(p.additions ?? []).map((a: any, i: number) => (
                <PrintRow key={`a${i}`} label={a.label} value={a.amount} />
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-slate-500 mb-2">Deductions</p>
          <table className="w-full text-sm">
            <tbody>
              {(p.deductions ?? []).length === 0 ? (
                <tr><td className="text-slate-400 italic py-1">None</td></tr>
              ) : (p.deductions ?? []).map((d: any, i: number) => (
                <PrintRow key={i} label={d.label} value={-Number(d.amount)} />
              ))}
            </tbody>
          </table>
          <div className="mt-6 border-t border-slate-300 pt-3">
            <div className="flex justify-between text-base font-bold">
              <span>Net pay</span>
              <span className="tabular-nums">₹{Number(p.net_pay).toLocaleString('en-IN')}</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Working days: {Number(p.working_days)} · Paid days: {Number(p.paid_days)}
            </p>
          </div>
        </div>
      </div>

      {p.notes && (
        <div className="mt-8 border-t border-slate-200 pt-3">
          <p className="text-xs font-bold uppercase text-slate-500 mb-1">Notes</p>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{p.notes}</p>
        </div>
      )}

      <p className="text-[10px] text-slate-400 mt-8 text-center">
        Generated by HRMS · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
      </p>
    </div>
  );
}

function PrintRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  const cls = bold ? 'font-bold' : '';
  return (
    <tr>
      <td className={`py-1 ${cls}`}>{label}</td>
      <td className={`py-1 text-right tabular-nums ${cls} ${value < 0 ? 'text-red-700' : ''}`}>
        {value < 0 ? '−' : ''}₹{Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </td>
    </tr>
  );
}

// Exported so MyPortal can use it directly.
export function triggerPrint() {
  ensurePayslipPrintCss();
  window.print();
}

// Icon re-export shim so MyPortal can import a print button without also
// pulling the whole lucide-react bundle (it's already bundled but this
// keeps the import list on MyPortal shorter).
export { Printer };
