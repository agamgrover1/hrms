import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users2, Clock, KanbanSquare, Calendar, Target, LineChart as LineIcon, Activity,
  Wallet, ExternalLink, Video, MapPin, Loader2, Briefcase, ChevronRight, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../services/api';
import { toast } from '../components/Toaster';
import { formatHoursHuman } from '../lib/taskMeta';

// Single-screen project dashboard. Everything a manager wants for a
// project sits on this page, hydrated from one aggregate endpoint
// (/api/projects/:id/dashboard). Cards deep-link to their source
// module for edits/drilldowns.

type Data = Awaited<ReturnType<typeof api.getProjectDashboard>>;

export default function ProjectDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.getProjectDashboard(id)
      .then(setData)
      .catch(e => toast.error('Failed to load project', e?.body?.error ?? e?.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading || !data) {
    return <div className="p-10 text-center text-sm text-on-surface-muted"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading project…</div>;
  }

  const p = data.project;
  const consumedMonth = data.hours_this_month;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <button onClick={() => navigate('/projects')}
          className="inline-flex items-center gap-1 text-xs text-on-surface-muted hover:text-on-surface mb-2">
          <ArrowLeft size={12} /> All projects
        </button>
        <div className="rounded-xl-2 border border-outline bg-surface p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">{p.name}</h1>
                <StatusPill status={p.status} />
                {p.project_type && <span className="text-[10px] font-bold uppercase tracking-wider bg-surface-2 text-on-surface-muted px-2 py-0.5 rounded">{p.project_type}</span>}
              </div>
              {p.client_name && <p className="text-sm text-on-surface-muted mt-1"><Briefcase size={12} className="inline mr-1 -mt-0.5" />{p.client_name}</p>}
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-on-surface-muted">
                {p.project_lead_name && <span>Lead: <b className="text-on-surface">{p.project_lead_name}</b></span>}
                {p.project_reporting_name && <span>Reviewer: <b className="text-on-surface">{p.project_reporting_name}</b></span>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-subtle">This month</p>
              <p className="num-mono text-3xl font-bold text-on-surface">{formatHoursHuman(consumedMonth)}</p>
              <p className="text-[11px] text-on-surface-muted">logged across the team</p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiTile icon={Users2} label="Team this month" value={String(data.team.length)} tone="text-on-surface" />
        <KpiTile icon={Clock} label="Hours this month" value={formatHoursHuman(consumedMonth)} tone="text-info" />
        <KpiTile icon={KanbanSquare} label="Active boards" value={String(data.boards.length)} tone="text-on-surface" />
        <KpiTile icon={Calendar} label="Meetings (7d)" value={String(data.upcoming_meetings.length)} tone="text-accent" />
        <KpiTile icon={Target} label="Active goals" value={String(data.goals.length)} tone="text-success" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Team allocation — spans 2 cols */}
        <Card className="xl:col-span-2" icon={Users2} title="Team & allocation"
          right={<Link to={`/hours?project_id=${p.id}`} className="text-[11px] text-accent hover:underline inline-flex items-center gap-0.5">Open in Hours <ExternalLink size={10} /></Link>}>
          {data.team.length === 0 ? (
            <EmptyLine text="No one is planned on this project this month." />
          ) : (
            <div className="space-y-1.5">
              {data.team.map(t => {
                const alloc = Number(t.monthly_hours || 0);
                const done = Number(t.logged_hours || 0);
                const pct = alloc > 0 ? Math.min(100, Math.round((done / alloc) * 100)) : 0;
                return (
                  <div key={t.employee_id} className="flex items-center gap-3 py-1.5">
                    <Avatar name={t.employee_name} avatar={t.avatar} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm text-on-surface truncate">{t.employee_name}</p>
                        <p className="text-[11px] font-mono text-on-surface-muted shrink-0">
                          {formatHoursHuman(done)} <span className="text-on-surface-subtle">/ {formatHoursHuman(alloc)}</span>
                        </p>
                      </div>
                      {alloc > 0 && (
                        <div className="mt-1 h-1 bg-surface-2 rounded-full overflow-hidden">
                          <div className={`h-full ${pct >= 90 ? 'bg-success' : pct >= 50 ? 'bg-info' : 'bg-warning'}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Top contributors */}
        <Card icon={Activity} title="Top contributors · 30d">
          {data.top_contributors_30d.length === 0 ? (
            <EmptyLine text="No hours logged in the last 30 days." />
          ) : (
            <div className="space-y-1.5">
              {data.top_contributors_30d.map(t => (
                <div key={t.employee_id} className="flex items-center gap-2">
                  <Avatar name={t.employee_name} avatar={t.avatar} size="sm" />
                  <p className="text-sm text-on-surface flex-1 truncate">{t.employee_name}</p>
                  <p className="text-[11px] font-mono font-semibold text-accent">{formatHoursHuman(t.hours)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Hours trend — spans 2 */}
        <Card className="xl:col-span-2" icon={LineIcon} title="Hours · last 12 weeks">
          {data.hours_trend_weekly.length === 0 ? (
            <EmptyLine text="No hours history to chart yet." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.hours_trend_weekly.map(r => ({ week: r.week.slice(5), hours: r.hours }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any) => [`${v}h`, 'Hours']} />
                <Line type="monotone" dataKey="hours" stroke="#EE2770" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Financials */}
        {data.financials && (
          <Card icon={Wallet} title="Financials"
            right={<Link to="/finance?tab=revenue" className="text-[11px] text-accent hover:underline inline-flex items-center gap-0.5">Open in Finance <ExternalLink size={10} /></Link>}>
            <div className="grid grid-cols-2 gap-3">
              <MoneyStat label="Pending (invoiced)" value={data.financials.invoiced_pending} tone="text-warning" sub={`${data.financials.pending_count} entr${data.financials.pending_count === 1 ? 'y' : 'ies'}`} />
              <MoneyStat label="Received" value={data.financials.received} tone="text-success" sub={`${data.financials.cleared_count} cleared`} />
            </div>
          </Card>
        )}

        {/* Boards */}
        <Card icon={KanbanSquare} title="Task boards"
          right={<Link to={`/tasks`} className="text-[11px] text-accent hover:underline inline-flex items-center gap-0.5">Open in Tasks <ExternalLink size={10} /></Link>}>
          {data.boards.length === 0 ? (
            <EmptyLine text="No boards on this project yet." />
          ) : (
            <div className="space-y-2">
              {data.boards.map(b => {
                const pct = b.task_count > 0 ? Math.round((b.done_count / b.task_count) * 100) : 0;
                return (
                  <Link key={b.id} to={`/tasks?board=${b.id}`}
                    className="block rounded-lg border border-outline hover:border-outline-strong hover:bg-surface-2 p-2.5 transition">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: b.color ?? '#94a3b8' }} />
                      <p className="text-sm font-semibold text-on-surface flex-1 truncate">{b.name}</p>
                      <span className="text-[11px] font-mono text-on-surface-muted">{b.done_count}/{b.task_count}</span>
                      <ChevronRight size={12} className="text-on-surface-subtle" />
                    </div>
                    {b.task_count > 0 && (
                      <div className="mt-1.5 h-1 bg-surface-2 rounded-full overflow-hidden">
                        <div className="h-full bg-success" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* My open tasks */}
        <Card className="xl:col-span-2" icon={KanbanSquare} title="My open tasks on this project">
          {data.my_open_tasks.length === 0 ? (
            <EmptyLine text="Nothing assigned to you here right now." />
          ) : (
            <div className="divide-y divide-outline">
              {data.my_open_tasks.map(t => (
                <Link key={t.id} to={`/tasks?board=${t.list_id}&task=${t.id}`}
                  className="flex items-center gap-2 py-2 hover:bg-surface-2/50 -mx-2 px-2 rounded transition">
                  <p className="text-sm text-on-surface flex-1 truncate">{t.title}</p>
                  <span className="text-[10px] text-on-surface-subtle truncate">{t.list_name}</span>
                  {t.due_date && (
                    <span className="text-[11px] font-mono text-on-surface-muted shrink-0">
                      {new Date(t.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                  <ChevronRight size={12} className="text-on-surface-subtle" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Meetings — upcoming */}
        <Card icon={Calendar} title="Upcoming meetings · 7d"
          right={<Link to={`/meetings?project_id=${p.id}`} className="text-[11px] text-accent hover:underline inline-flex items-center gap-0.5">Open in Meetings <ExternalLink size={10} /></Link>}>
          {data.upcoming_meetings.length === 0 ? (
            <EmptyLine text="No meetings scheduled in the next 7 days." />
          ) : (
            <div className="space-y-2">
              {data.upcoming_meetings.map(m => (
                <Link key={m.id} to={`/meetings?meeting=${m.id}`}
                  className="block rounded-lg border border-outline hover:border-outline-strong hover:bg-surface-2 p-2.5 transition">
                  <div className="flex items-baseline gap-2 mb-1">
                    <p className="text-[11px] font-mono font-semibold text-on-surface-muted">
                      {new Date(m.start_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
                    </p>
                    <span className="ml-auto text-[10px] text-on-surface-subtle">{m.attendee_count} 👥</span>
                  </div>
                  <p className="text-sm font-semibold text-on-surface truncate">{m.title}</p>
                  <p className="text-[11px] text-on-surface-muted mt-0.5 inline-flex items-center gap-1">
                    {m.location_kind === 'virtual' ? <><Video size={10} /> Virtual</>
                      : m.location_kind === 'hybrid' ? <><Video size={10} /> Hybrid · {m.location ?? '—'}</>
                      : <><MapPin size={10} /> {m.location ?? 'In office'}</>}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Meetings — recent past */}
        <Card icon={Calendar} title="Recent meetings · 30d">
          {data.recent_meetings.length === 0 ? (
            <EmptyLine text="No meetings in the last 30 days." />
          ) : (
            <div className="space-y-1">
              {data.recent_meetings.map(m => (
                <Link key={m.id} to={`/meetings?meeting=${m.id}`}
                  className="flex items-center gap-2 py-1 hover:bg-surface-2/50 -mx-2 px-2 rounded">
                  <p className="text-[11px] font-mono text-on-surface-subtle shrink-0">
                    {new Date(m.start_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </p>
                  <p className="text-sm text-on-surface flex-1 truncate">{m.title}</p>
                  <span className="text-[10px] text-on-surface-subtle">by {m.organizer_name.split(' ')[0]}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Goals */}
        <Card className="xl:col-span-2" icon={Target} title="Active goals"
          right={<Link to="/goals" className="text-[11px] text-accent hover:underline inline-flex items-center gap-0.5">Open in Goals <ExternalLink size={10} /></Link>}>
          {data.goals.length === 0 ? (
            <EmptyLine text="No active goals tagged to this project." />
          ) : (
            <div className="space-y-2">
              {data.goals.map(g => {
                const pct = Number(g.progress_pct ?? 0);
                return (
                  <div key={g.id} className="rounded-lg border border-outline p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface">{g.title}</p>
                        {g.owner_name && <p className="text-[11px] text-on-surface-muted mt-0.5">Owner: {g.owner_name}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg num-mono font-bold text-on-surface">{pct}%</p>
                        {g.target_date && <p className="text-[10px] text-on-surface-muted">due {new Date(g.target_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>}
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div className={`h-full ${pct >= 75 ? 'bg-success' : pct >= 30 ? 'bg-info' : 'bg-warning'}`}
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                    </div>
                    {g.kr_count > 0 && <p className="text-[10px] text-on-surface-subtle mt-1">{g.kr_count} key result{g.kr_count === 1 ? '' : 's'}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Activity feed */}
        <Card icon={Activity} title="Recent activity">
          {data.recent_activity.length === 0 ? (
            <EmptyLine text="No recent activity captured for this project." />
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {data.recent_activity.map((a, i) => (
                <div key={i} className="text-[11px] text-on-surface-muted border-l-2 border-outline pl-2 py-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-semibold text-on-surface">{a.actor_name ?? 'System'}</span>
                    <span className="text-[10px] text-on-surface-subtle ml-auto">{new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                  </div>
                  <p className="text-on-surface-muted"><span className="font-mono text-[10px] text-on-surface-subtle">{a.action}</span> {a.body ?? ''}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────
function KpiTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">
        <Icon size={11} /> {label}
      </div>
      <p className={`text-xl font-display font-bold num-mono mt-1 ${tone}`}>{value}</p>
    </div>
  );
}
function Card({ icon: Icon, title, right, children, className }: { icon: any; title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl-2 border border-outline bg-surface p-4 ${className ?? ''}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={13} className="text-accent" />
        <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </div>
  );
}
function EmptyLine({ text }: { text: string }) {
  return <p className="text-[11px] text-on-surface-subtle italic">{text}</p>;
}
function Avatar({ name, avatar, size = 'md' }: { name: string; avatar: string | null; size?: 'sm' | 'md' }) {
  const px = size === 'sm' ? 'w-6 h-6 text-[9px]' : 'w-7 h-7 text-[10px]';
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  if (avatar) return <img src={avatar} alt={name} className={`${px} rounded-full object-cover shrink-0`} />;
  return <span className={`${px} rounded-full bg-brand-container text-on-brand-container font-bold grid place-items-center shrink-0`}>{initials}</span>;
}
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string }> = {
    active:   { label: 'Active',   tone: 'bg-success-container text-success' },
    on_hold:  { label: 'On hold',  tone: 'bg-warning-container text-warning' },
    completed:{ label: 'Completed', tone: 'bg-info-container text-info' },
    archived: { label: 'Archived', tone: 'bg-surface-2 text-on-surface-muted' },
  };
  const s = map[status] ?? { label: status, tone: 'bg-surface-2 text-on-surface-muted' };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${s.tone}`}>{s.label}</span>;
}
function MoneyStat({ label, value, tone, sub }: { label: string; value: number; tone: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">{label}</p>
      <p className={`text-lg font-display font-bold num-mono ${tone}`}>₹{Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
      {sub && <p className="text-[10px] text-on-surface-subtle">{sub}</p>}
    </div>
  );
}
