import { useEffect, useMemo, useState } from 'react';
import { Search, Sliders, X, RefreshCw, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../services/api';
import type { PulseTeamRow, PulseWeights } from '../services/api';

// Admin/HR org-wide pulse view. Lets you:
//  - browse the grid sorted/filtered by score, dept, manager
//  - open any employee's drawer (pillar breakdown)
//  - trigger a manual recompute (e.g. after a backfill)
//  - tune per-department weight multipliers

const PILLARS: Array<{ key: keyof PulseTeamRow; label: string }> = [
  { key: 'discipline',       label: 'Disc.' },
  { key: 'hours_hygiene',    label: 'Hyg.' },
  { key: 'output',           label: 'Out.' },
  { key: 'contribution',     label: 'Contr.' },
  { key: 'manager_pulse',    label: 'M.Pulse' },
  { key: 'team_stewardship', label: 'Stew.' },
  { key: 'project_hygiene',  label: 'Proj.' },
];

function pillarColor(s: number | null) {
  if (s == null) return '#94a3b8';
  if (s >= 85) return '#16a34a';
  if (s >= 70) return '#3730a3';
  if (s >= 50) return '#d97706';
  return '#dc2626';
}
function bandTone(b?: string | null): React.CSSProperties {
  switch (b) {
    case 'excellent':     return { background: '#dcfce7', color: '#15803d' };
    case 'strong':        return { background: '#e0e7ff', color: '#3730a3' };
    case 'building':      return { background: '#fef3c7', color: '#92400e' };
    case 'needs_support': return { background: '#fee2e2', color: '#b91c1c' };
    default:              return { background: '#f1f5f9', color: '#475569' };
  }
}

export default function PerformancePulse() {
  const [rows, setRows] = useState<PulseTeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState<'all' | 'excellent' | 'strong' | 'building' | 'needs_support'>('all');
  const [drawer, setDrawer] = useState<{ row: PulseTeamRow; data: any | null } | null>(null);
  const [showWeights, setShowWeights] = useState(false);
  const [weights, setWeights] = useState<PulseWeights[]>([]);
  const [savingDept, setSavingDept] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.getOrgPulse()
      // Defend against {employees: undefined} from older deploys — array methods
      // would otherwise blow up the page on render.
      .then(d => setRows(Array.isArray(d?.employees) ? d.employees : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // KPI counts
  const counts = useMemo(() => {
    const c = { total: rows.length, excellent: 0, strong: 0, building: 0, needs: 0, baseline: 0, missing: 0 };
    for (const r of rows) {
      if (r.is_baseline) c.baseline++;
      else if (!r.band) c.missing++;
      else if (r.band === 'excellent') c.excellent++;
      else if (r.band === 'strong') c.strong++;
      else if (r.band === 'building') c.building++;
      else if (r.band === 'needs_support') c.needs++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(r => {
      if (bandFilter !== 'all' && r.band !== bandFilter) return false;
      if (!term) return true;
      return (r.name + ' ' + (r.department ?? '') + ' ' + (r.designation ?? '')).toLowerCase().includes(term);
    });
  }, [rows, search, bandFilter]);

  async function openDrawer(row: PulseTeamRow) {
    setDrawer({ row, data: null });
    try {
      const d = await api.getEmployeePulse(row.id);
      setDrawer({ row, data: d.latest });
    } catch {
      setDrawer({ row, data: null });
    }
  }
  const [recomputeMsg, setRecomputeMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [recomputeProgress, setRecomputeProgress] = useState<{ done: number; total: number } | null>(null);
  // Chunked recompute. Vercel function timeout is 10s — a full-org compute
  // genuinely doesn't fit on this codebase. We chunk client-side into small
  // batches of employees, each call finishing in well under a second, then
  // present aggregate progress to the user.
  async function recompute() {
    setRecomputing(true);
    setRecomputeMsg(null);
    setRecomputeProgress(null);
    try {
      const { employee_ids } = await api.getPulseRecomputeTargets();
      const all = Array.isArray(employee_ids) ? employee_ids : [];
      if (all.length === 0) {
        setRecomputeMsg({ tone: 'error', text: 'No employees to compute.' });
        return;
      }
      const CHUNK = 3;
      // Strictly sequential. Concurrent requests cause Vercel to scale out to
      // new Lambda instances, each paying a 5-8s cold-start tax on this
      // 6500-line api bundle. Serial keeps one Lambda warm across all chunks.
      const chunks: string[][] = [];
      for (let i = 0; i < all.length; i += CHUNK) chunks.push(all.slice(i, i + CHUNK));
      setRecomputeProgress({ done: 0, total: all.length });

      let computed = 0;
      let failed = 0;
      for (const ids of chunks) {
        try {
          const r = await api.recomputePulse(undefined, ids);
          computed += r.computed;
        } catch (e: any) {
          failed += 1;
        }
        setRecomputeProgress({ done: Math.min(computed + failed * CHUNK, all.length), total: all.length });
      }

      if (failed > 0) {
        setRecomputeMsg({
          tone: 'error',
          text: `Computed ${computed}/${all.length}. ${failed} batch${failed === 1 ? '' : 'es'} failed — try Recompute again to retry the missing ones.`,
        });
      } else {
        setRecomputeMsg({ tone: 'success', text: `Computed ${computed} snapshot${computed === 1 ? '' : 's'} across ${chunks.length} batches.` });
      }
      load();
    } catch (e: any) {
      setRecomputeMsg({ tone: 'error', text: e.message ?? 'Recompute failed' });
    } finally {
      setRecomputing(false);
      setTimeout(() => setRecomputeProgress(null), 2000);
    }
  }
  async function openWeights() {
    setShowWeights(true);
    try {
      const w = await api.getPulseWeights();
      // Guard against missing/wrong shape — undefined.map() blows up the modal.
      setWeights(Array.isArray(w?.weights) ? w.weights : []);
    } catch { setWeights([]); }
  }
  async function saveWeights(w: PulseWeights) {
    setSavingDept(w.department);
    try { await api.updatePulseWeights(w.department, w); }
    finally { setSavingDept(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">Performance Pulse</h1>
          <p className="text-sm text-on-surface-muted mt-0.5">Automated 30-day score, recomputed nightly. Manual reviews continue on the Performance page.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openWeights} className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg font-medium border border-outline hover:bg-surface-2">
            <Sliders size={14} /> Weights
          </button>
          <button onClick={recompute} disabled={recomputing}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg font-medium border border-outline hover:bg-surface-2 disabled:opacity-50">
            <RefreshCw size={14} className={recomputing ? 'animate-spin' : ''} />
            {recomputing
              ? (recomputeProgress
                  ? `Recomputing… ${recomputeProgress.done}/${recomputeProgress.total}`
                  : 'Recomputing…')
              : 'Recompute now'}
          </button>
        </div>
      </div>

      {/* Recompute feedback */}
      {recomputeMsg && (
        <div className={`rounded-xl-2 border p-3 text-sm ${
          recomputeMsg.tone === 'success'
            ? 'border-success/30 bg-success-container/40 text-success'
            : 'border-danger/30 bg-danger-container/40 text-danger'
        }`}>{recomputeMsg.text}</div>
      )}

      {/* Empty-state banner — common confusion: "the page shows people but no numbers".
          Triggers when no employee has a snapshot yet. Tells admin exactly what to click. */}
      {!loading && rows.length > 0 && counts.missing === rows.length && (
        <div className="rounded-xl-2 border border-warning/40 bg-warning-container/30 p-4 flex items-center justify-between gap-4">
          <div className="text-xs text-on-surface-muted">
            <p className="text-on-surface font-semibold text-sm mb-0.5">No snapshots yet</p>
            <p>The nightly cron hasn't run since the Pulse tables were created. Click <b className="text-on-surface">Recompute now</b> above to populate scores for everyone. After that, snapshots refresh automatically every night.</p>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        {[
          { k: 'all', label: 'Total', n: counts.total, tone: 'text-on-surface' },
          { k: 'excellent', label: 'Excellent', n: counts.excellent, tone: 'text-success' },
          { k: 'strong', label: 'Strong', n: counts.strong, tone: 'text-brand' },
          { k: 'building', label: 'Building', n: counts.building, tone: 'text-warning' },
          { k: 'needs_support', label: 'Needs support', n: counts.needs, tone: 'text-danger' },
          { k: 'baseline', label: 'New (baseline)', n: counts.baseline, tone: 'text-on-surface-subtle' },
        ].map(t => (
          <button key={t.k} onClick={() => setBandFilter(t.k as any)}
            className={`text-left rounded-xl-2 border p-4 transition shadow-elev-1 ${bandFilter === t.k ? 'border-accent ring-2 ring-accent/20' : 'border-outline hover:border-accent/40'}`}>
            <p className={`num-mono text-2xl font-bold ${t.tone}`}>{t.n}</p>
            <p className="text-xs text-on-surface-subtle mt-0.5">{t.label}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, department, designation"
          className="w-full text-sm pl-9 pr-3 py-2 border border-outline rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200" />
      </div>

      {/* Grid */}
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-1 overflow-hidden">
        {loading ? (
          <div className="px-5 py-16 text-center text-on-surface-subtle text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-16 text-center text-on-surface-subtle text-sm">No employees match this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 border-b border-outline">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Employee</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Department</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Manager</th>
                  {PILLARS.map(p => (
                    <th key={String(p.key)} className="text-center px-2 py-3 text-[10px] font-semibold text-on-surface-subtle uppercase tracking-wide">{p.label}</th>
                  ))}
                  <th className="text-right px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Score</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} onClick={() => openDrawer(r)} className="border-b border-outline hover:bg-surface-2/40 transition-colors cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="font-medium text-on-surface">{r.name}</p>
                      <p className="text-[11px] text-on-surface-subtle">{r.designation ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-on-surface-muted text-xs">{r.department ?? '—'}</td>
                    <td className="px-4 py-3 text-on-surface-muted text-xs">{r.reporting_manager_name ?? '—'}</td>
                    {PILLARS.map(p => {
                      const v = r[p.key] as number | null;
                      return (
                        <td key={String(p.key)} className="px-2 py-3 text-center num-mono text-xs font-bold" style={{ color: pillarColor(v) }}>
                          {v ?? '—'}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      <span className="inline-block px-3 py-1 rounded-lg text-xs font-bold num-mono" style={bandTone(r.is_baseline ? 'baseline' : r.band)}>
                        {r.is_baseline ? '…' : r.total_score ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setDrawer(null)}>
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
              <div>
                <h2 className="font-display font-bold text-lg" style={{ color: '#192250' }}>{drawer.row.name}</h2>
                <p className="text-xs text-on-surface-subtle mt-0.5">{drawer.row.designation ?? '—'} · {drawer.row.department ?? '—'}</p>
              </div>
              <button onClick={() => setDrawer(null)}><X size={18} className="text-on-surface-subtle" /></button>
            </div>
            <div className="overflow-y-auto px-6 py-5 space-y-5">
              {!drawer.data ? (
                <p className="text-sm text-on-surface-subtle py-8 text-center">Loading…</p>
              ) : (
                <>
                  <div className="flex items-center gap-4 p-4 rounded-xl-2 border border-outline bg-surface-2/40">
                    <div className="w-20 h-20 rounded-2xl flex items-center justify-center font-display font-bold text-3xl num-mono" style={bandTone(drawer.data.band)}>
                      {drawer.data.is_baseline ? '…' : drawer.data.total_score}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-on-surface capitalize">{(drawer.data.band ?? '').replace('_', ' ')}</p>
                      <p className="text-xs text-on-surface-muted mt-0.5">Snapshot {new Date(drawer.data.snapshot_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle">Pillars</p>
                    {PILLARS.map(p => {
                      const v = drawer.data[p.key];
                      if (v == null) return null;
                      const c = pillarColor(v);
                      return (
                        <div key={String(p.key)} className="py-1.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-sm font-semibold text-on-surface">{p.label}</p>
                            <p className="text-xs num-mono font-bold" style={{ color: c }}>{v}</p>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${v}%`, background: c }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <RecentSignals breakdown={drawer.data.breakdown ?? {}} />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Weights modal */}
      {showWeights && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowWeights(false)}>
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
              <div>
                <h2 className="font-display font-bold text-lg" style={{ color: '#192250' }}>Pillar weight overrides</h2>
                <p className="text-xs text-on-surface-subtle mt-0.5">Multipliers per department. 1 = default. Change a row, click Save.</p>
              </div>
              <button onClick={() => setShowWeights(false)}><X size={18} className="text-on-surface-subtle" /></button>
            </div>
            <div className="overflow-y-auto px-4 py-5">
              <p className="text-xs text-on-surface-subtle px-2 mb-2">
                Tip: changes take effect on the next recompute. Click <strong>Recompute now</strong> to apply immediately.
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-2 border-b border-outline">
                    <th className="text-left px-3 py-2 font-semibold text-on-surface-subtle uppercase tracking-wide">Dept.</th>
                    {['Disc.', 'Hyg.', 'Out.', 'Contr.', 'M.Pulse', 'Stew.', 'Proj.'].map(h => (
                      <th key={h} className="text-center px-2 py-2 font-semibold text-on-surface-subtle uppercase tracking-wide">{h}</th>
                    ))}
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {weights.map(w => (
                    <WeightsRow key={w.department} w={w} saving={savingDept === w.department} onSave={saveWeights} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WeightsRow({ w, saving, onSave }: { w: PulseWeights; saving: boolean; onSave: (w: PulseWeights) => void }) {
  const [d, setD] = useState(w);
  const dirty = JSON.stringify(d) !== JSON.stringify(w);
  return (
    <tr className="border-b border-outline">
      <td className="px-3 py-2 font-medium text-on-surface">{w.department}</td>
      {(['discipline', 'hours_hygiene', 'output', 'contribution', 'manager_pulse', 'team_stewardship', 'project_hygiene'] as Array<keyof PulseWeights>).map(k => (
        <td key={String(k)} className="px-2 py-2 text-center">
          <input type="number" min="0" max="3" step="0.1" value={d[k] as number}
            onChange={e => setD(s => ({ ...s, [k]: Number(e.target.value) }))}
            className="w-14 text-xs text-center num-mono border border-outline rounded px-1 py-1" />
        </td>
      ))}
      <td className="px-2 py-2">
        <button disabled={!dirty || saving} onClick={() => onSave(d)}
          className="text-xs px-2.5 py-1 rounded-md bg-accent text-on-accent font-semibold disabled:opacity-30">
          {saving ? '…' : 'Save'}
        </button>
      </td>
    </tr>
  );
}

function RecentSignals({ breakdown }: { breakdown: any }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle">Recent signals (30d)</p>
      <ul className="text-xs text-on-surface-muted space-y-1">
        {breakdown.discipline_misses && <li>Discipline: <strong>{breakdown.discipline_misses.absences}</strong> absent · <strong>{breakdown.discipline_misses.leave_without_notice}</strong> last-minute</li>}
        {breakdown.hygiene && <li>Hours: <strong>{breakdown.hygiene.days_logged}/{breakdown.hygiene.working_days}</strong> days logged · <strong>{breakdown.hygiene.days_with_notes}</strong> with notes</li>}
        {breakdown.output_detail && <li>Output: <strong>{breakdown.output_detail.utilization_pct}%</strong> utilization · <strong>{breakdown.output_detail.approval_rate_pct}%</strong> approval rate</li>}
        {breakdown.contribution_detail && <li>Contribution: <strong>{breakdown.contribution_detail.goals_on_track}/{breakdown.contribution_detail.goals_total}</strong> goals · <strong>{breakdown.contribution_detail.upsells}</strong> upsells</li>}
        {breakdown.manager_pulse_detail?.ratings_in_window > 0 && <li>Manager pulse: <strong>{breakdown.manager_pulse_detail.ratings_in_window}</strong> ratings · avg <strong>{breakdown.manager_pulse_detail.avg}</strong></li>}
        {breakdown.team_stewardship_detail && <li>Team stewardship: <strong>{breakdown.team_stewardship_detail.team_logging_hygiene}%</strong> logging · <strong>{breakdown.team_stewardship_detail.approval_timeliness}%</strong> approvals on time</li>}
        {breakdown.project_hygiene_detail && <li>Project hygiene: <strong>{breakdown.project_hygiene_detail.logging_coverage}%</strong> coverage · <strong>{breakdown.project_hygiene_detail.approval_flow_through}%</strong> flow-through</li>}
      </ul>
    </div>
  );
}
