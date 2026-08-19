import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, UserCheck, Send, XCircle, Clock, TrendingUp } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import { api } from '../services/api';
import { HIRING_STAGES, stageLabel } from '../lib/hiringStages';
import { toast } from '../components/Toaster';

const CHART_AXIS = '#94a3b8';
const CHART_GRID = 'rgba(148, 163, 184, 0.18)';
const CHART_BRAND = '#7c5cff';
const CHART_ACCENT = '#EE2770';
const CHART_TOOLTIP_BG = 'rgb(var(--surface-3))';
const SOURCE_PALETTE = ['#7c5cff', '#EE2770', '#22c55e', '#f59e0b', '#0ea5e9', '#a855f7', '#ef4444', '#14b8a6'];

type Range = '30' | '90' | '365' | 'all';
type Analytics = Awaited<ReturnType<typeof api.getHiringAnalytics>>;

// Hiring analytics dashboard. Reads one bootstrap endpoint that
// aggregates funnel + source + time-in-stage + rejections + recruiter
// throughput so the page mounts on a single round-trip.
export default function HiringAnalytics() {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('90');
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getHiringAnalytics(range)
      .then(setData)
      .catch((e: any) => toast.error('Failed to load analytics', e?.message ?? 'Please try again.'))
      .finally(() => setLoading(false));
  }, [range]);

  // Funnel chart data — stage rows in canonical pipeline order.
  // For each stage we compute conversion% relative to the previous
  // stage. First stage's conversion is against total applied.
  const funnelRows = useMemo(() => {
    if (!data) return [] as { stage: string; label: string; count: number; conversion: number }[];
    const stages = ['sourced', ...HIRING_STAGES.filter(s => s.key !== 'sourced').map(s => s.key)];
    let prev = 0;
    return stages.map((s, i) => {
      const count = Number(data.funnel[s] ?? 0);
      const conversion = i === 0 ? 100 : prev > 0 ? Math.round((count / prev) * 1000) / 10 : 0;
      prev = i === 0 ? count : (count > 0 ? count : prev); // don't reset the base to 0 mid-funnel
      return { stage: s, label: stageLabel(s), count, conversion };
    });
  }, [data]);

  const pipelineRows = useMemo(() => {
    if (!data) return [] as { stage: string; label: string; count: number }[];
    return HIRING_STAGES.map(s => ({ stage: s.key, label: s.label, count: Number(data.pipeline[s.key] ?? 0) }));
  }, [data]);

  const timeRows = useMemo(() => {
    if (!data) return [] as { stage: string; label: string; median_hours: number; n: number }[];
    return HIRING_STAGES
      .map(s => ({ stage: s.key, label: s.label, median_hours: Number(data.time_in_stage[s.key]?.median_hours ?? 0), n: data.time_in_stage[s.key]?.n ?? 0 }))
      .filter(r => r.median_hours > 0);
  }, [data]);

  const conversionOverall = useMemo(() => {
    if (!data || !data.totals.applied) return 0;
    return Math.round((data.totals.hires / data.totals.applied) * 1000) / 10;
  }, [data]);

  return (
    <div className="p-6 space-y-5 max-w-7xl">
      <button onClick={() => navigate('/hiring')}
        className="inline-flex items-center gap-1.5 text-xs text-on-surface-muted hover:text-on-surface">
        <ArrowLeft size={13} /> Back to Hiring
      </button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2">
            <TrendingUp className="text-accent" size={22} />
            <h1 className="font-display text-2xl font-bold text-on-surface">Hiring Analytics</h1>
          </div>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Funnel, source ROI, time-in-stage and throughput over the selected window.
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-outline bg-surface p-1">
          {(['30', '90', '365', 'all'] as Range[]).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${range === r ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>
              {r === 'all' ? 'All time' : `Last ${r}d`}
            </button>
          ))}
        </div>
      </div>

      {loading || !data ? (
        <div className="rounded-xl-2 border border-outline bg-surface p-10 text-center text-sm text-on-surface-muted">
          Loading analytics…
        </div>
      ) : (
        <>
          {/* KPI band */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
            <Kpi icon={Users} label="Candidates applied" value={data.totals.applied} tone="brand" />
            <Kpi icon={Send} label="Offers released" value={data.totals.offers_released} tone="accent" />
            <Kpi icon={UserCheck} label="Hires" value={data.totals.hires} tone="success"
              hint={data.totals.applied ? `${conversionOverall}% of applied` : undefined} />
            <Kpi icon={XCircle} label="Rejected" value={data.totals.rejected} tone="danger" />
            <Kpi icon={Clock} label="Median time-to-hire"
              value={data.time_to_hire.median_days == null ? '—' : `${data.time_to_hire.median_days}d`}
              hint={data.time_to_hire.p90_days == null ? undefined : `p90 · ${data.time_to_hire.p90_days}d`}
              tone="brand" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Funnel */}
            <div className="rounded-xl-2 border border-outline bg-surface p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-display text-base font-bold text-on-surface">Pipeline funnel</h3>
                <p className="text-[10px] text-on-surface-subtle">candidates ever reached each stage</p>
              </div>
              {funnelRows.every(r => r.count === 0) ? (
                <EmptyMsg text="No stage transitions in this window yet." />
              ) : (
                <div className="space-y-2">
                  {funnelRows.map((r, i) => {
                    const max = Math.max(1, ...funnelRows.map(x => x.count));
                    const w = Math.round((r.count / max) * 100);
                    return (
                      <div key={r.stage} className="flex items-center gap-3">
                        <div className="w-28 text-[11px] text-on-surface-muted truncate">{r.label}</div>
                        <div className="flex-1 relative h-6 bg-surface-2 rounded-md overflow-hidden">
                          <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${w}%`, background: 'linear-gradient(90deg,#7c5cff,#EE2770)' }} />
                          <div className="relative h-full flex items-center justify-between px-2 text-[10px] font-semibold text-on-surface">
                            <span className="num-mono">{r.count}</span>
                            {i > 0 && <span className="num-mono text-on-surface-muted">{r.conversion}% vs prev</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Live pipeline snapshot */}
            <div className="rounded-xl-2 border border-outline bg-surface p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-display text-base font-bold text-on-surface">Active pipeline right now</h3>
                <p className="text-[10px] text-on-surface-subtle">status = active only</p>
              </div>
              {data.totals.active_pipeline === 0 ? (
                <EmptyMsg text="No active candidates in the pipeline." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={pipelineRows} barSize={18} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                    <XAxis type="number" stroke={CHART_AXIS} fontSize={11} />
                    <YAxis type="category" dataKey="label" stroke={CHART_AXIS} fontSize={11} width={110} />
                    <Tooltip contentStyle={{ background: CHART_TOOLTIP_BG, border: '1px solid rgba(148,163,184,0.3)', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="count" fill={CHART_BRAND} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Source of hire */}
            <div className="rounded-xl-2 border border-outline bg-surface p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-display text-base font-bold text-on-surface">Source of hire</h3>
                <p className="text-[10px] text-on-surface-subtle">applied → hired per channel</p>
              </div>
              {data.source_of_hire.length === 0 ? (
                <EmptyMsg text="No candidates with a source in this window." />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-1">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={data.source_of_hire.filter(s => s.applied > 0)} dataKey="applied" nameKey="source"
                          innerRadius={40} outerRadius={72} paddingAngle={2}>
                          {data.source_of_hire.map((_, i) => (
                            <Cell key={i} fill={SOURCE_PALETTE[i % SOURCE_PALETTE.length]} />
                          ))}
                        </Pie>
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="sm:col-span-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] text-on-surface-subtle uppercase tracking-wider">
                          <th className="pb-2 font-semibold">Source</th>
                          <th className="pb-2 font-semibold text-right num-mono">Applied</th>
                          <th className="pb-2 font-semibold text-right num-mono">Hired</th>
                          <th className="pb-2 font-semibold text-right num-mono">Conv</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline">
                        {data.source_of_hire.map((s, i) => (
                          <tr key={s.source} className="hover:bg-surface-2">
                            <td className="py-1.5 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SOURCE_PALETTE[i % SOURCE_PALETTE.length] }} />
                              <span className="truncate">{s.source}</span>
                            </td>
                            <td className="py-1.5 text-right num-mono">{s.applied}</td>
                            <td className="py-1.5 text-right num-mono font-semibold">{s.hired}</td>
                            <td className="py-1.5 text-right num-mono text-accent">{s.conversion}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Time in stage */}
            <div className="rounded-xl-2 border border-outline bg-surface p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-display text-base font-bold text-on-surface">Median time in stage</h3>
                <p className="text-[10px] text-on-surface-subtle">hours between consecutive stage transitions</p>
              </div>
              {timeRows.length === 0 ? (
                <EmptyMsg text="Need at least one candidate moving through two stages to compute this." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={timeRows} barSize={22} margin={{ top: 4, right: 12, bottom: 20, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                    <XAxis dataKey="label" stroke={CHART_AXIS} fontSize={10} angle={-30} textAnchor="end" height={60} />
                    <YAxis stroke={CHART_AXIS} fontSize={11} label={{ value: 'hours', angle: -90, position: 'insideLeft', fill: CHART_AXIS, fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: CHART_TOOLTIP_BG, border: '1px solid rgba(148,163,184,0.3)', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: any) => [`${v}h`, 'Median']} />
                    <Bar dataKey="median_hours" fill={CHART_ACCENT} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recruiter throughput */}
            <div className="rounded-xl-2 border border-outline bg-surface p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-display text-base font-bold text-on-surface">Hires by recruiter</h3>
                <p className="text-[10px] text-on-surface-subtle">who converted the candidate</p>
              </div>
              {data.recruiters.length === 0 ? (
                <EmptyMsg text="No hires in this window." />
              ) : (
                <div className="divide-y divide-outline">
                  {data.recruiters.map(r => (
                    <div key={r.actor} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-on-surface">{r.actor}</span>
                      <span className="num-mono font-semibold text-accent">{r.hires}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top rejections */}
            <div className="rounded-xl-2 border border-outline bg-surface p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-display text-base font-bold text-on-surface">Top rejection reasons</h3>
                <p className="text-[10px] text-on-surface-subtle">what's killing candidates</p>
              </div>
              {data.rejections.length === 0 ? (
                <EmptyMsg text="No rejections logged in this window." />
              ) : (
                <div className="space-y-2">
                  {data.rejections.map(r => {
                    const max = Math.max(1, ...data.rejections.map(x => x.n));
                    const w = Math.round((r.n / max) * 100);
                    return (
                      <div key={r.reason} className="text-xs">
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-on-surface truncate mr-2">{r.reason}</span>
                          <span className="num-mono text-on-surface-muted">{r.n}</span>
                        </div>
                        <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-danger" style={{ width: `${w}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <p className="text-[10px] text-on-surface-subtle text-right">
            Generated {new Date(data.generated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' · window: '}{data.range === 'all' ? 'all time' : `last ${data.range} days`}
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: any; label: string; value: React.ReactNode; hint?: string; tone: 'brand' | 'accent' | 'success' | 'danger' }) {
  const toneCls = {
    brand:   'text-brand bg-brand/10',
    accent:  'text-accent bg-accent/10',
    success: 'text-success bg-success/10',
    danger:  'text-danger bg-danger/10',
  }[tone];
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${toneCls}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-subtle">{label}</p>
        <p className="font-display text-xl font-bold text-on-surface mt-0.5">{value}</p>
        {hint && <p className="text-[10px] text-on-surface-muted mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function EmptyMsg({ text }: { text: string }) {
  return <p className="text-xs text-on-surface-subtle italic text-center py-6">{text}</p>;
}
