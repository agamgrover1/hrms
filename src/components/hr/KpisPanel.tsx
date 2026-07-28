import { useEffect, useMemo, useState } from 'react';
import { Target, Plus, X, Trash2, Zap, TrendingUp, TrendingDown, Minus, RefreshCw, Edit3, Check } from 'lucide-react';
import { api, type KpiRow, type KpiTemplate } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../Toaster';

// Per-employee KPI panel. Lead / coordinator / HR assigns templates,
// enters actuals (or refreshes auto-source KPIs), sees achievement %
// against target with a 6-period sparkline.

interface Props {
  employeeId: string;
  employeeName?: string;
  designation?: string | null;
  // When true, hides every write action (assign / measure / override /
  // remove / refresh). Used by MyPortal so the employee sees their KPIs
  // but can't edit them.
  readOnly?: boolean;
}

function fmtPeriod(iso: string, cadence: 'weekly' | 'monthly'): string {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  if (cadence === 'monthly') {
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }
  return `Wk of ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

// Achievement % relative to target. Direction-aware:
//   higher_is_better  → actual / target
//   !higher_is_better → target / actual (lower actual = higher score)
function achievementPct(actual: number, target: number, higherIsBetter: boolean): number {
  if (target === 0) return actual === 0 ? 100 : 0;
  if (higherIsBetter) return Math.round((actual / target) * 100);
  if (actual === 0) return 200;
  return Math.round((target / actual) * 100);
}

function scoreColor(pct: number): string {
  if (pct >= 100) return 'text-success';
  if (pct >= 80)  return 'text-brand';
  if (pct >= 60)  return 'text-warning';
  return 'text-danger';
}
function scoreBg(pct: number): string {
  if (pct >= 100) return 'bg-success/15 border-success/30';
  if (pct >= 80)  return 'bg-brand/10 border-brand/30';
  if (pct >= 60)  return 'bg-warning/15 border-warning/30';
  return 'bg-danger/15 border-danger/30';
}

export default function KpisPanel({ employeeId, employeeName, designation, readOnly }: Props) {
  const { user } = useAuth();
  const canManage = !readOnly && (user?.role === 'admin' || user?.role === 'hr_manager' || user?.role === 'project_coordinator');

  const [rows, setRows] = useState<KpiRow[]>([]);
  const [composite, setComposite] = useState<number | null>(null);
  const [measured, setMeasured] = useState(0);
  const [templates, setTemplates] = useState<KpiTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const [measureFor, setMeasureFor] = useState<KpiRow | null>(null);
  const [editTargetFor, setEditTargetFor] = useState<KpiRow | null>(null);

  const load = () => {
    setLoading(true);
    api.getEmployeeKpis(employeeId)
      .then(r => {
        setRows(Array.isArray(r?.rows) ? r.rows : []);
        setComposite(r?.composite ?? null);
        setMeasured(r?.measured ?? 0);
      })
      .catch(() => { setRows([]); setComposite(null); setMeasured(0); })
      .finally(() => setLoading(false));
  };
  useEffect(load, [employeeId]);
  useEffect(() => {
    api.getKpiTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const unassignedTemplates = useMemo(() => {
    const assigned = new Set(rows.map(r => r.template_id));
    return templates.filter(t => !assigned.has(t.id));
  }, [templates, rows]);

  const removeAssignment = async (r: KpiRow) => {
    if (!confirm(`Remove "${r.name}" from ${employeeName ?? 'this employee'}? Historical measurements will be deleted.`)) return;
    try {
      await api.deleteKpiAssignment(r.id);
      setRows(prev => prev.filter(x => x.id !== r.id));
      toast.success('KPI removed');
    } catch (e: any) { toast.error('Remove failed', e?.message); }
  };

  const refreshAuto = async (r: KpiRow) => {
    try {
      await api.autoComputeKpi(r.id);
      toast.success('Refreshed', `Latest ${r.name} recomputed from HRMS data.`);
      load();
    } catch (e: any) { toast.error('Refresh failed', e?.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg font-bold text-on-surface flex items-center gap-2">
            <Target className="w-5 h-5 text-accent" /> KPIs
          </h3>
          <p className="text-xs text-on-surface-muted mt-0.5">
            {designation && <>Suggested KPIs for role: <b className="text-on-surface">{designation}</b>. </>}
            Auto-source KPIs recompute from HRMS data; manual KPIs get entered each period.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {composite != null && (
            <div className={`px-3 py-2 rounded-lg border ${scoreBg(composite)} flex items-baseline gap-2`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Composite</span>
              <span className={`num-mono text-xl font-bold ${scoreColor(composite)}`}>{composite}</span>
              <span className="text-xs text-on-surface-subtle">/ 150 · {measured}/{rows.length} measured</span>
            </div>
          )}
          {canManage && (
            <button onClick={() => setShowAssign(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
              <Plus className="w-4 h-4" /> Assign KPI
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-40 rounded-xl-2 bg-surface-2 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl-2 border border-outline bg-surface p-8 text-center">
          <Target className="w-8 h-8 mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">No KPIs assigned yet.</p>
          {canManage && (
            <p className="text-xs text-on-surface-subtle mt-1">Click "Assign KPI" to pick one from your template catalog.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map(r => {
            const target = r.target_override != null ? Number(r.target_override) : Number(r.default_target);
            const actual = r.latest?.actual != null ? Number(r.latest.actual) : null;
            const pct = actual != null ? achievementPct(actual, target, r.higher_is_better) : null;
            return (
              <div key={r.id} className="rounded-xl-2 border border-outline bg-surface p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-sm text-on-surface">{r.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 uppercase tracking-wider font-bold">
                        {r.cadence}
                      </span>
                      {r.source !== 'manual' && (
                        <span className="text-[10px] inline-flex items-center gap-0.5 text-success" title="Auto-populated from HRMS data">
                          <Zap className="w-2.5 h-2.5" /> auto
                        </span>
                      )}
                    </div>
                    {r.description && (
                      <p className="text-[11px] text-on-surface-muted mt-1 leading-snug">{r.description}</p>
                    )}
                  </div>
                  {canManage && (
                    <div className="shrink-0 flex items-center gap-0.5">
                      <button onClick={() => setEditTargetFor(r)} title="Override target"
                        className="p-1.5 text-on-surface-muted hover:text-accent hover:bg-surface-2 rounded-md">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => removeAssignment(r)} title="Remove KPI"
                        className="p-1.5 text-on-surface-muted hover:text-danger hover:bg-danger-container/40 rounded-md">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-bold text-on-surface-subtle">Actual</div>
                    <div className="num-mono text-2xl font-bold text-on-surface">
                      {actual != null ? actual : <span className="text-on-surface-subtle">—</span>}
                      <span className="text-xs font-normal text-on-surface-muted ml-1">{r.unit}</span>
                    </div>
                    {r.latest?.period_start && (
                      <div className="text-[10px] text-on-surface-subtle mt-0.5">
                        {fmtPeriod(r.latest.period_start, r.cadence)}
                        {r.latest.entered_by_name && ` · ${r.latest.entered_by_name}`}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-on-surface-subtle">Target</div>
                    <div className="num-mono text-lg font-semibold text-on-surface-muted">
                      {r.higher_is_better ? '≥ ' : '≤ '}{target}
                    </div>
                    {r.target_override != null && (
                      <div className="text-[9px] text-accent uppercase mt-0.5">Custom</div>
                    )}
                  </div>
                  {pct != null && (
                    <div className={`num-mono text-lg font-bold px-2 py-1 rounded border ${scoreBg(pct)} ${scoreColor(pct)}`}>
                      {pct}%
                    </div>
                  )}
                </div>

                {/* Sparkline / trend */}
                {r.history.length > 1 && (
                  <div className="flex items-end gap-1 h-8 pt-1">
                    {r.history.slice().reverse().map((h, i, arr) => {
                      const max = Math.max(...arr.map(x => Number(x.actual)), Number(target));
                      const heightPct = max > 0 ? (Number(h.actual) / max) * 100 : 0;
                      const p = achievementPct(Number(h.actual), target, r.higher_is_better);
                      return (
                        <div key={i} className="flex-1 flex flex-col justify-end" title={`${fmtPeriod(h.period_start, r.cadence)}: ${h.actual} (${p}%)`}>
                          <div className={`w-full rounded-sm ${p >= 100 ? 'bg-success' : p >= 80 ? 'bg-brand' : p >= 60 ? 'bg-warning' : 'bg-danger'}`} style={{ height: `${Math.max(6, heightPct)}%` }} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {canManage && (
                  <div className="flex gap-2 pt-1 border-t border-outline">
                    <button onClick={() => setMeasureFor(r)}
                      className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-md border border-outline text-on-surface hover:bg-surface-2">
                      Enter actual
                    </button>
                    {r.source !== 'manual' && (
                      <button onClick={() => refreshAuto(r)} title="Recompute from HRMS data"
                        className="text-xs font-semibold px-2 py-1.5 rounded-md border border-success/40 text-success hover:bg-success/10 inline-flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" /> Refresh
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAssign && (
        <AssignModal
          employeeId={employeeId} employeeName={employeeName}
          templates={unassignedTemplates}
          onClose={() => setShowAssign(false)}
          onAssigned={() => { setShowAssign(false); load(); }}
        />
      )}
      {measureFor && (
        <MeasureModal
          kpi={measureFor}
          onClose={() => setMeasureFor(null)}
          onSaved={() => { setMeasureFor(null); load(); }}
        />
      )}
      {editTargetFor && (
        <TargetOverrideModal
          kpi={editTargetFor}
          onClose={() => setEditTargetFor(null)}
          onSaved={() => { setEditTargetFor(null); load(); }}
        />
      )}
    </div>
  );
}

function AssignModal({ employeeId, employeeName, templates, onClose, onAssigned }: {
  employeeId: string;
  employeeName?: string;
  templates: KpiTemplate[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [selected, setSelected] = useState<string>('');
  const [overrideTarget, setOverrideTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!selected) { setError('Pick a template.'); return; }
    setBusy(true); setError('');
    try {
      await api.assignKpi({
        employee_id: employeeId,
        template_id: selected,
        target_override: overrideTarget.trim() ? Number(overrideTarget) : null,
      });
      onAssigned();
    } catch (e: any) { setError(e?.message ?? 'Assign failed'); }
    finally { setBusy(false); }
  };
  const inputCls = 'w-full text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div>
            <h3 className="font-display text-lg font-semibold text-on-surface">Assign KPI</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">to {employeeName ?? 'this employee'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X className="w-4 h-4 text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          {error && <div className="rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{error}</div>}
          {templates.length === 0 ? (
            <p className="text-sm text-on-surface-muted italic">All available templates are already assigned. Create a new one in Config → KPI Templates.</p>
          ) : (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Template *</label>
                <select value={selected} onChange={e => setSelected(e.target.value)} className={inputCls}>
                  <option value="">— pick one —</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} · target {t.higher_is_better ? '≥' : '≤'}{t.default_target} {t.unit} · {t.cadence}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Target override (optional)</label>
                <input type="number" step="0.1" value={overrideTarget}
                  onChange={e => setOverrideTarget(e.target.value)}
                  placeholder="Leave blank to use template default"
                  className={inputCls + ' num-mono'} />
              </div>
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy || !templates.length || !selected}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg hover:opacity-90 disabled:opacity-50">
            {busy ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MeasureModal({ kpi, onClose, onSaved }: {
  kpi: KpiRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Default period_start to today; backend snaps to the correct period
  // boundary (Monday for weekly, 1st for monthly).
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 10));
  const [actual, setActual] = useState(kpi.latest?.actual != null ? String(kpi.latest.actual) : '');
  const [notes, setNotes] = useState(kpi.latest?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!actual.trim() || Number.isNaN(Number(actual))) { setError('Actual must be a number.'); return; }
    setBusy(true); setError('');
    try {
      await api.saveKpiMeasurement(kpi.id, {
        period_start: periodStart,
        actual: Number(actual),
        notes: notes.trim() || undefined,
      });
      toast.success('Actual saved', `${kpi.name} for ${fmtPeriod(periodStart, kpi.cadence)}`);
      onSaved();
    } catch (e: any) { setError(e?.message ?? 'Save failed'); }
    finally { setBusy(false); }
  };

  const inputCls = 'w-full text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface';
  const target = kpi.target_override != null ? Number(kpi.target_override) : Number(kpi.default_target);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div>
            <h3 className="font-display text-lg font-semibold text-on-surface">Enter actual</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              {kpi.name} · target {kpi.higher_is_better ? '≥' : '≤'}{target} {kpi.unit} · {kpi.cadence}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X className="w-4 h-4 text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          {error && <div className="rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Period (any date in it)</label>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className={inputCls} />
              <p className="text-[10px] text-on-surface-subtle mt-1">Snaps to {kpi.cadence === 'monthly' ? '1st of month' : 'Monday'}.</p>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Actual</label>
              <input type="number" step="0.1" value={actual} onChange={e => setActual(e.target.value)}
                className={inputCls + ' num-mono text-lg font-semibold'} autoFocus />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Context for this period's number"
              className={inputCls + ' resize-none'} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5">
            <Check className="w-4 h-4" /> {busy ? 'Saving…' : 'Save actual'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TargetOverrideModal({ kpi, onClose, onSaved }: {
  kpi: KpiRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [target, setTarget] = useState(
    kpi.target_override != null ? String(kpi.target_override) : String(kpi.default_target)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (clearOverride: boolean) => {
    setBusy(true); setError('');
    try {
      await api.updateKpiAssignment(kpi.id, {
        target_override: clearOverride ? null : Number(target),
      });
      onSaved();
    } catch (e: any) { setError(e?.message ?? 'Save failed'); }
    finally { setBusy(false); }
  };
  const inputCls = 'w-full text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div>
            <h3 className="font-display text-base font-semibold text-on-surface">Override target</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">{kpi.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X className="w-4 h-4 text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          {error && <div className="rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{error}</div>}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Custom target</label>
            <input type="number" step="0.1" value={target} onChange={e => setTarget(e.target.value)}
              className={inputCls + ' num-mono'} autoFocus />
            <p className="text-[10px] text-on-surface-subtle mt-1">Template default: {kpi.default_target} {kpi.unit}</p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-outline flex items-center justify-between gap-2">
          <button onClick={() => save(true)} disabled={busy || kpi.target_override == null}
            className="px-3 py-2 text-xs text-danger hover:bg-danger/10 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent">
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
            <button onClick={() => save(false)} disabled={busy}
              className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg hover:opacity-90 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
