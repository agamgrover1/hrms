import { useCallback, useEffect, useMemo, useState } from 'react';
import { IndianRupee, Plus, Pencil, Trash2, X, Loader2, History, TrendingUp, Info } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../Toaster';

// Salary structure per employee — Phase 1 of the payroll rebuild.
//
// One "structure" = a snapshot of CTC + components effective from a
// specific date. A raise adds a NEW row rather than editing an old
// one, so a payslip run in month M for a historical month H still
// resolves the CTC that was in effect on H's end-of-month.
//
// This panel shows:
//   • Current structure card (the latest row where effective_from <= today)
//   • + Add structure button (only admin/HR) — opens the editor
//   • History list below (older rows, most recent first)
//
// Payslip generation from these structures is Phase 2.

interface Component { label: string; amount: number }

interface Structure {
  id: string;
  employee_id: string;
  effective_from: string;
  ctc_annual: number | string;
  basic: number | string;
  hra: number | string;
  special_allowance: number | string;
  employer_pf: number | string;
  other_components: Component[];
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function fmtINR(n: number | string | null | undefined): string {
  const num = Number(n ?? 0);
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(String(iso).slice(0, 10) + 'T12:00:00Z')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SalaryPanel({ employeeId, employeeName, employeeMonthlySalary = 0, employeeCtc = 0 }: {
  employeeId: string; employeeName?: string;
  employeeMonthlySalary?: number; employeeCtc?: number;
}) {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'hr_manager';
  const canDelete = user?.role === 'admin';

  const [rows, setRows] = useState<Structure[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Structure | null>(null);
  const [creating, setCreating] = useState(false);
  // Org-wide salary mode drives what UI to render: 'flat' collapses the
  // whole thing to a single Monthly Salary field; 'structured' keeps
  // the 4-component breakdown.
  const [salaryMode, setSalaryMode] = useState<'flat' | 'structured'>('flat');
  useEffect(() => {
    api.getPayrollConfig().then(c => setSalaryMode(c.salary_mode ?? 'flat')).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api.getSalaryStructures(employeeId)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [employeeId]);
  useEffect(load, [load]);

  // Latest structure with effective_from <= today. If nothing is
  // effective yet (a future-dated row is the only one), fall back to
  // whatever is most recent so the card still shows something useful.
  const today = new Date().toISOString().slice(0, 10);
  const current = useMemo(() => {
    const past = rows.filter(r => String(r.effective_from).slice(0, 10) <= today);
    return past[0] ?? rows[0] ?? null;
  }, [rows, today]);
  const historyRows = useMemo(() => rows.filter(r => r.id !== current?.id), [rows, current]);

  const remove = async (s: Structure) => {
    if (!window.confirm(`Delete the salary structure effective ${fmtDate(s.effective_from)}? This cannot be undone.`)) return;
    try {
      await api.deleteSalaryStructure(s.id);
      toast.success('Deleted', `Salary structure removed.`);
      load();
    } catch (e: any) { toast.error('Delete failed', e?.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-on-surface flex items-center gap-2">
            <IndianRupee className="w-5 h-5 text-accent" /> Salary
          </h3>
          <p className="text-xs text-on-surface-muted mt-0.5">
            {employeeName ?? 'This employee'}'s pay. Payslip runs read the current monthly directly from the Employee record —
            only add a dated row below if you want to log a raise / adjustment for audit history.
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-accent border border-accent/40 hover:bg-accent/10 text-sm font-semibold">
            <Plus className="w-4 h-4" /> Log a dated adjustment
          </button>
        )}
      </div>

      {/* Current salary (source of truth) — pulled from the Employee record,
          not the salary_structures table. This is what the payroll run
          uses when no dated structure exists. */}
      <div className="rounded-xl-2 border border-outline bg-surface p-5 shadow-elev-1">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-subtle">Current salary</p>
            <p className="num-mono text-3xl font-bold text-on-surface mt-1">
              {fmtINR(employeeMonthlySalary)}
              <span className="text-on-surface-subtle font-normal text-sm ml-2">/ month</span>
            </p>
            {employeeCtc > 0 && (
              <p className="text-xs text-on-surface-muted mt-0.5">
                CTC <span className="num-mono font-semibold text-on-surface">{fmtINR(employeeCtc)}</span> / year
              </p>
            )}
            {employeeMonthlySalary === 0 && (
              <p className="text-[11px] text-warning mt-1 flex items-center gap-1">
                <Info size={11} /> No salary set. Edit the employee to add one — payslips will otherwise be zero.
              </p>
            )}
          </div>
          <p className="text-[11px] text-on-surface-subtle max-w-xs">
            Set / edit on the <span className="font-semibold text-on-surface">Overview</span> tab (Employee → Edit).
            This is what monthly payroll uses.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="h-40 rounded-xl-2 bg-surface-2 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl-2 border border-dashed border-outline bg-surface-2/30 p-6 text-center">
          <p className="text-sm text-on-surface-muted">No dated adjustments logged.</p>
          <p className="text-xs text-on-surface-subtle mt-1">
            Optional — payroll works without this. Use it if you want a raise to take effect from a specific date and be visible on historical payslips.
          </p>
        </div>
      ) : (
        <>
          {/* All rows shown chronologically. The one currently in effect
              (latest with effective_from <= today) gets an "Overriding
              now" pill so HR knows what payroll will pick up. */}
          <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-outline bg-surface-2 flex items-center gap-2">
              <History size={13} className="text-on-surface-muted" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-subtle">
                Dated adjustments · {rows.length}
              </p>
            </div>
            <ul className="divide-y divide-outline">
              {rows.map(s => {
                const isActive = current?.id === s.id;
                return (
                  <li key={s.id} className={`px-4 py-3 flex items-center gap-4 ${isActive ? 'bg-accent/5' : 'hover:bg-surface-2/40'}`}>
                    <div className="w-32 shrink-0">
                      <p className="text-[10px] uppercase font-bold text-on-surface-subtle">Effective from</p>
                      <p className="text-sm font-semibold text-on-surface">{fmtDate(s.effective_from)}</p>
                    </div>
                    <div className="flex-1 min-w-0 flex items-baseline gap-3 flex-wrap text-sm">
                      <span className="num-mono font-bold text-on-surface">{fmtINR(s.ctc_annual)}<span className="text-on-surface-subtle font-normal text-[11px]"> / year</span></span>
                      {salaryMode === 'structured' && (
                        <span className="text-[11px] text-on-surface-muted">
                          Basic {fmtINR(s.basic)} · HRA {fmtINR(s.hra)} · SA {fmtINR(s.special_allowance)}
                        </span>
                      )}
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-accent/15 text-accent">
                          <TrendingUp size={10} /> Overriding now
                        </span>
                      )}
                    </div>
                    {canEdit && (
                      <div className="shrink-0 flex items-center gap-1">
                        <button onClick={() => setEditing(s)} title="Edit"
                          className="p-1.5 text-on-surface-muted hover:text-accent hover:bg-accent/10 rounded-md">
                          <Pencil size={13} />
                        </button>
                        {canDelete && (
                          <button onClick={() => remove(s)} title="Delete"
                            className="p-1.5 text-on-surface-muted hover:text-danger hover:bg-danger-container/40 rounded-md">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="px-4 py-2 border-t border-outline bg-surface-2/50 text-[11px] text-on-surface-muted">
              A dated adjustment overrides the Employee record's salary for any payroll run whose month-end is on or after its effective-from date.
            </div>
          </div>
        </>
      )}

      {(creating || editing) && (
        <StructureFormModal
          employeeId={employeeId}
          employeeName={employeeName}
          existing={editing}
          mode={salaryMode}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
    </div>
  );
}

function CurrentStructureCard({ s, mode, canEdit, canDelete, onEdit, onDelete }: {
  s: Structure; mode: 'flat' | 'structured'; canEdit: boolean; canDelete: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const monthlyGross = Number(s.basic) + Number(s.hra) + Number(s.special_allowance);
  const others = (s.other_components ?? []).reduce((sum, c) => sum + Number(c.amount ?? 0), 0);
  const monthlyTotal = monthlyGross + others;
  const yearlyDerived = monthlyTotal * 12 + Number(s.employer_pf) * 12;
  const drift = Math.abs(yearlyDerived - Number(s.ctc_annual));
  const isFlat = mode === 'flat';

  return (
    <div className="rounded-xl-2 border border-accent/40 bg-accent/5 p-5 shadow-elev-1">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-accent flex items-center gap-1.5">
            <TrendingUp size={11} /> Current · effective {fmtDate(s.effective_from)}
          </p>
          <p className="num-mono text-3xl font-bold text-on-surface mt-1">
            {fmtINR(s.ctc_annual)}
            <span className="text-on-surface-subtle font-normal text-sm ml-2">CTC / year</span>
          </p>
          <p className="text-xs text-on-surface-muted mt-0.5">
            {isFlat
              ? <>Monthly salary <span className="num-mono font-semibold text-on-surface">{fmtINR(monthlyTotal)}</span></>
              : <>Monthly gross <span className="num-mono font-semibold text-on-surface">{fmtINR(monthlyTotal)}</span>{' + '}Employer PF <span className="num-mono font-semibold text-on-surface">{fmtINR(s.employer_pf)}</span> / month</>
            }
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <button onClick={onEdit}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold text-accent border border-accent/40 hover:bg-accent/10">
              <Pencil size={11} /> Edit
            </button>
            {canDelete && (
              <button onClick={onDelete}
                className="p-1.5 text-on-surface-muted hover:text-danger hover:bg-danger-container/40 rounded-md">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Component tiles only shown in structured mode — in flat mode
          the "big number" at the top already tells the whole story. */}
      {!isFlat && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ComponentTile label="Basic" monthly={Number(s.basic)} />
          <ComponentTile label="HRA" monthly={Number(s.hra)} />
          <ComponentTile label="Special Allowance" monthly={Number(s.special_allowance)} />
          <ComponentTile label="Employer PF" monthly={Number(s.employer_pf)} />
        </div>
      )}

      {s.other_components && s.other_components.length > 0 && (
        <div className="mt-3 rounded-lg bg-surface/60 border border-outline p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-subtle mb-2">Other components</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {s.other_components.map((c, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="text-on-surface">{c.label}</span>
                <span className="num-mono font-semibold text-on-surface">{fmtINR(c.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {drift > 1 && (
        <div className="mt-3 flex items-start gap-2 text-[11px] text-warning bg-warning-container/40 border border-warning/30 rounded-lg px-3 py-2">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>
            {isFlat
              ? <>Monthly × 12 = <span className="num-mono font-semibold">{fmtINR(monthlyTotal * 12)}</span> doesn't match CTC <span className="num-mono font-semibold">{fmtINR(s.ctc_annual)}</span> — difference {fmtINR(drift)}/year.</>
              : <>Components (monthly × 12 + employer PF × 12 = <span className="num-mono font-semibold">{fmtINR(monthlyTotal * 12 + Number(s.employer_pf) * 12)}</span>) don't match the CTC (<span className="num-mono font-semibold">{fmtINR(s.ctc_annual)}</span>) — difference {fmtINR(drift)}/year.</>
            }
            {' '}Payslip generation uses the monthly number, not the CTC.
          </span>
        </div>
      )}

      {s.notes && (
        <p className="text-[11px] text-on-surface-muted mt-3 italic whitespace-pre-wrap">"{s.notes}"</p>
      )}
    </div>
  );
}

function ComponentTile({ label, monthly }: { label: string; monthly: number }) {
  return (
    <div className="rounded-lg bg-surface/70 border border-outline px-3 py-2">
      <p className="text-[10px] uppercase font-bold tracking-wider text-on-surface-subtle">{label}</p>
      <p className="num-mono text-base font-bold text-on-surface mt-0.5">{fmtINR(monthly)}</p>
      <p className="text-[10px] text-on-surface-subtle">/ month</p>
    </div>
  );
}

function StructureFormModal({ employeeId, employeeName, existing, mode, onClose, onSaved }: {
  employeeId: string; employeeName?: string;
  existing: Structure | null;
  mode: 'flat' | 'structured';
  onClose: () => void; onSaved: () => void;
}) {
  const isFlat = mode === 'flat';
  const [effectiveFrom, setEffectiveFrom] = useState<string>(
    existing ? String(existing.effective_from).slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [ctcAnnual, setCtcAnnual] = useState<string>(existing ? String(existing.ctc_annual) : '');
  const [basic, setBasic] = useState<string>(existing ? String(existing.basic) : '0');
  const [hra, setHra] = useState<string>(existing ? String(existing.hra) : '0');
  const [special, setSpecial] = useState<string>(existing ? String(existing.special_allowance) : '0');
  const [employerPf, setEmployerPf] = useState<string>(existing ? String(existing.employer_pf) : '0');
  const [others, setOthers] = useState<Component[]>(existing?.other_components ?? []);
  const [notes, setNotes] = useState<string>(existing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cfgLoaded, setCfgLoaded] = useState(false);

  // Auto-fill from payroll_config on CTC change — but only when creating
  // a new structure. Editing an existing one keeps HR's saved numbers
  // even if they retype the CTC (they probably meant to change one
  // component, not blow the whole split away).
  const applyAutoSplit = useCallback((ctcValue: number) => {
    if (existing || !cfgLoaded) return;
    if (!Number.isFinite(ctcValue) || ctcValue <= 0) return;
    api.getPayrollConfig().then(cfg => {
      const monthlyGross = ctcValue / 12 - Number(cfg.employer_pf_pct) / 100 * (ctcValue / 12);
      // gross monthly = monthly CTC less employer PF chunk.
      // Practical simplification: employer PF is a % of monthly CTC.
      const pfMonthly = (Number(cfg.employer_pf_pct) / 100) * (ctcValue / 12);
      const grossMonthly = ctcValue / 12 - pfMonthly;
      setBasic(String(Math.round(grossMonthly * Number(cfg.basic_pct) / 100)));
      setHra(String(Math.round(grossMonthly * Number(cfg.hra_pct) / 100)));
      setSpecial(String(Math.round(grossMonthly * Number(cfg.special_allowance_pct) / 100)));
      setEmployerPf(String(Math.round(pfMonthly)));
      void monthlyGross;
    }).catch(() => {/* stay with 0s */});
  }, [existing, cfgLoaded]);

  useEffect(() => { setCfgLoaded(true); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const payload = {
      effective_from: effectiveFrom,
      ctc_annual: Number(ctcAnnual),
      basic: Number(basic),
      hra: Number(hra),
      special_allowance: Number(special),
      employer_pf: Number(employerPf),
      other_components: others.filter(o => o.label.trim() && Number(o.amount) > 0),
      notes: notes.trim() || undefined,
    };
    try {
      if (existing) await api.updateSalaryStructure(existing.id, payload);
      else await api.createSalaryStructure({ ...payload, employee_id: employeeId });
      onSaved();
    } catch (err: any) { setError(err?.message ?? 'Save failed'); }
    finally { setBusy(false); }
  };

  const monthlyGross = Number(basic) + Number(hra) + Number(special);
  const monthlyOthers = others.reduce((s, c) => s + Number(c.amount || 0), 0);
  const monthlyTotal = monthlyGross + monthlyOthers;
  const yearlyDerived = monthlyTotal * 12 + Number(employerPf) * 12;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-outline flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-on-surface">
              {existing ? 'Edit salary structure' : 'New salary structure'}
            </h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              {employeeName ?? 'This employee'}
              {existing ? ' · editing an existing row' : ' · a new effective-from row is created'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg">
            <X size={16} className="text-on-surface-muted" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">Effective from *</span>
              <input required type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
              <span className="block text-[11px] text-on-surface-muted mt-1">
                Payslips generated for months on/after this date use this structure.
              </span>
            </label>
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">Annual CTC * (₹)</span>
              <input required type="number" min="0" step="1000" value={ctcAnnual}
                onChange={e => { setCtcAnnual(e.target.value); }}
                onBlur={e => applyAutoSplit(Number(e.target.value))}
                className="w-full num-mono px-3 py-2 rounded-lg border border-outline bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
              <span className="block text-[11px] text-on-surface-muted mt-1">
                {existing
                  ? 'Editing keeps your saved components; retype below if changing them.'
                  : 'Tab out to auto-fill components from Payroll settings. Then edit any component below.'}
              </span>
            </label>
          </div>

          {isFlat ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-2">Monthly salary</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <RupeeField label="Monthly salary" value={basic} onChange={v => {
                  // Flat mode: the single field is Basic; HRA/SA/PF stay 0.
                  // We also flush the split fields to 0 in case the user
                  // previously entered structured values and the org has
                  // since flipped to flat mode.
                  setBasic(v); setHra('0'); setSpecial('0'); setEmployerPf('0');
                }} />
              </div>
              <p className="text-[11px] text-on-surface-muted mt-2">
                Payslip generation multiplies this by (paid days / working days) each month. Add one-off allowances or deductions when running payroll.
              </p>
            </div>
          ) : (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-2">Monthly components</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <RupeeField label="Basic" value={basic} onChange={setBasic} />
                <RupeeField label="HRA" value={hra} onChange={setHra} />
                <RupeeField label="Special Allowance" value={special} onChange={setSpecial} />
                <RupeeField label="Employer PF" value={employerPf} onChange={setEmployerPf} />
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle">Other monthly components</p>
              <button type="button" onClick={() => setOthers(o => [...o, { label: '', amount: 0 }])}
                className="text-[11px] font-semibold text-accent hover:underline inline-flex items-center gap-1">
                <Plus size={11} /> Add
              </button>
            </div>
            {others.length === 0 ? (
              <p className="text-[11px] text-on-surface-subtle italic">
                Nothing extra. Add rows for conveyance, medical, LTA, custom allowances etc.
              </p>
            ) : (
              <ul className="space-y-2">
                {others.map((c, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <input value={c.label} placeholder="Label (e.g. Conveyance)"
                      onChange={e => setOthers(prev => prev.map((p, idx) => idx === i ? { ...p, label: e.target.value } : p))}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-outline bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    <div className="relative w-32">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-on-surface-subtle">₹</span>
                      <input type="number" min="0" step="1" value={c.amount}
                        onChange={e => setOthers(prev => prev.map((p, idx) => idx === i ? { ...p, amount: Number(e.target.value) } : p))}
                        className="w-full pl-5 pr-2 py-1.5 rounded-lg border border-outline bg-surface text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    </div>
                    <button type="button" onClick={() => setOthers(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-1.5 text-on-surface-muted hover:text-danger hover:bg-danger-container/40 rounded-md">
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg bg-surface-2 border border-outline p-3">
            <div className={`grid ${isFlat ? 'grid-cols-2' : 'grid-cols-3'} gap-3 text-center`}>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle">{isFlat ? 'Monthly' : 'Monthly gross'}</p>
                <p className="num-mono text-lg font-bold text-on-surface">{fmtINR(monthlyTotal)}</p>
              </div>
              {!isFlat && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle">+ Employer PF</p>
                  <p className="num-mono text-lg font-bold text-on-surface">{fmtINR(Number(employerPf))}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle">= Derived yearly</p>
                <p className={`num-mono text-lg font-bold ${Math.abs(yearlyDerived - Number(ctcAnnual)) > 1 ? 'text-warning' : 'text-success'}`}>
                  {fmtINR(yearlyDerived)}
                </p>
              </div>
            </div>
            {Math.abs(yearlyDerived - Number(ctcAnnual)) > 1 && Number(ctcAnnual) > 0 && (
              <p className="text-[11px] text-warning mt-2 text-center">
                Derived yearly doesn't match CTC ({fmtINR(ctcAnnual)}) — off by {fmtINR(Math.abs(yearlyDerived - Number(ctcAnnual)))}. You can still save — payslips use the monthly number, not CTC.
              </p>
            )}
          </div>

          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">Notes (optional)</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Reason for this structure — e.g. annual raise, joining offer, correction after promotion."
              className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none" />
          </label>

          {error && (
            <p className="text-sm text-danger bg-danger-container/40 border border-danger/30 rounded-lg px-3 py-2">{error}</p>
          )}
        </form>

        <div className="px-6 py-4 border-t border-outline bg-surface-2/40 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-3 rounded-lg">Cancel</button>
          <button onClick={submit as any} disabled={busy}
            className="px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5">
            {busy && <Loader2 size={14} className="animate-spin" />}
            {existing ? 'Save changes' : 'Save structure'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RupeeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">{label}</span>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-on-surface-subtle">₹</span>
        <input type="number" min="0" step="1" value={value} onChange={e => onChange(e.target.value)}
          className="w-full pl-5 pr-2 py-1.5 rounded-lg border border-outline bg-surface text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
      </div>
    </label>
  );
}
