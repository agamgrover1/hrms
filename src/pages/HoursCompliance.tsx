import { useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Users as UsersIcon, ChevronDown, AlertTriangle, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function ago(ts: string | null): string {
  if (!ts) return '';
  const ms = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(ms)) return '';
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function HoursCompliance() {
  const { user } = useAuth();
  const role = user?.role ?? 'employee';
  const isAdminLike = role === 'admin' || role === 'hr_manager' || role === 'project_coordinator';

  const [date, setDate] = useState(todayISO());
  const [scope, setScope] = useState<'all' | 'mine'>(isAdminLike ? 'all' : 'mine');
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getHoursCompliance>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // Resolve current user's employee db-id so "Mine" mode can scope to their reports.
  useEffect(() => {
    if (!user?.employee_id_ref) return;
    api.getEmployeesSlim()
      .then(emps => {
        const m = (emps as any[]).find(e => e.employee_id === user.employee_id_ref);
        if (m) setMe({ id: m.id, name: m.name });
      })
      .catch(() => {});
  }, [user?.employee_id_ref]);

  // Force "mine" scope for non-admin viewers (a team lead who navigated here).
  useEffect(() => { if (!isAdminLike) setScope('mine'); }, [isAdminLike]);

  const load = () => {
    setLoading(true); setErr('');
    const managerId = scope === 'mine' && me ? me.id : undefined;
    api.getHoursCompliance({ date, manager_id: managerId })
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };
  // Wait for `me` to resolve before firing for non-admin viewers — otherwise
  // we briefly fetch org-wide data with managerId=undefined, then refire with
  // the correct id, causing a flash of "all employees" on first load.
  useEffect(() => {
    if (scope === 'mine' && !me) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, scope, me?.id]);

  const compliance = useMemo(() => {
    if (!data || data.eligible_count === 0) return 0;
    return data.logged_count / data.eligible_count;
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">Daily log compliance</h1>
          <p className="text-sm text-on-surface-muted mt-0.5">Who hasn't logged hours · who's sitting on pending approvals.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-2 bg-surface rounded-lg border border-outline px-3 py-2">
            <Calendar size={14} className="text-on-surface-subtle" />
            <input type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value)}
              className="text-sm bg-transparent focus:outline-none num-mono" />
          </div>
          {isAdminLike && me && (
            <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-lg p-0.5">
              <button onClick={() => setScope('all')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${scope === 'all' ? 'bg-accent text-on-accent' : 'text-on-surface-muted'}`}>
                All
              </button>
              <button onClick={() => setScope('mine')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${scope === 'mine' ? 'bg-accent text-on-accent' : 'text-on-surface-muted'}`}>
                My team
              </button>
            </div>
          )}
        </div>
      </div>

      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      {/* Headline tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Eligible today"
          value={String(data?.eligible_count ?? 0)}
          sub={scope === 'mine' ? 'in your sub-tree' : 'org-wide'} />
        <Tile label="Logged"
          value={String(data?.logged_count ?? 0)}
          sub={data ? `${Math.round(compliance * 100)}% compliance` : undefined}
          tone="text-success" />
        <Tile label="Hasn't logged"
          value={String(data?.not_logged_count ?? 0)}
          sub="needs follow-up"
          tone={(data?.not_logged_count ?? 0) > 0 ? 'text-danger' : 'text-on-surface-subtle'} />
        <Tile label="Pending approvals"
          value={String(data?.pending_by_employee.reduce((s, e) => s + e.log_count, 0) ?? 0)}
          sub={`${data?.pending_by_employee.length ?? 0} employees, ${data?.pending_by_reviewer.length ?? 0} reviewers`}
          tone={(data?.pending_by_employee.length ?? 0) > 0 ? 'text-warning' : 'text-on-surface-subtle'} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Hasn't logged */}
        <Card icon={AlertTriangle} title="Hasn't logged hours" subtitle={`for ${formatDate(date)}`} tone="danger">
          {loading ? <Loading /> :
            !data || data.not_logged_count === 0 ? (
              <Empty icon={CheckCircle2} title="Everyone's logged." sub="Nice — full compliance for this date." />
            ) : (
              <div className="divide-y divide-outline">
                {data.not_logged.map(e => (
                  <div key={e.employee_id} className="px-4 py-2.5 hover:bg-surface-2/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-on-surface truncate">{e.employee_name}</div>
                        <div className="text-xs text-on-surface-subtle truncate">
                          {e.designation || '—'}{e.department && ` · ${e.department}`}
                          {e.reporting_manager_name && <> · reports to <span className="text-on-surface-muted">{e.reporting_manager_name}</span></>}
                        </div>
                      </div>
                      <span className="num-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-surface-3 text-on-surface-muted shrink-0">
                        {e.assignment_count} project{e.assignment_count === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </Card>

        {/* Pending approvals */}
        <Card icon={ClipboardCheck} title="Pending approvals" subtitle="by reviewer" tone="warning">
          {loading ? <Loading /> :
            !data || data.pending_by_reviewer.length === 0 ? (
              <Empty icon={CheckCircle2} title="No pending approvals." sub="Reviewers are caught up." />
            ) : (
              <div className="divide-y divide-outline">
                {data.pending_by_reviewer.map((r, idx) => (
                  <div key={r.reviewer_id ?? `unassigned-${idx}`} className="px-4 py-2.5 hover:bg-surface-2/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-on-surface truncate">{r.reviewer_name}</div>
                        <div className="text-xs text-on-surface-subtle">
                          {r.log_count} log{r.log_count === 1 ? '' : 's'} · {Math.round(r.total_hours)}h
                          {r.oldest_pending_at && <> · oldest <span className="text-warning">{ago(r.oldest_pending_at)}</span></>}
                        </div>
                      </div>
                      <Link to="/hours/approvals"
                        className="text-xs font-semibold text-accent hover:underline shrink-0">Review →</Link>
                    </div>
                  </div>
                ))}
                {data.pending_by_employee.length > 0 && (
                  <PendingByEmployeeAccordion list={data.pending_by_employee} />
                )}
              </div>
            )
          }
        </Card>
      </div>
    </div>
  );
}

function PendingByEmployeeAccordion({ list }: { list: Array<{ employee_id: string; employee_name: string; log_count: number; total_hours: number; oldest_pending_at: string | null }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-sm hover:bg-surface-2/40 text-on-surface-muted">
        <span className="inline-flex items-center gap-2">
          <UsersIcon size={13} />
          By employee ({list.length})
        </span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="divide-y divide-outline bg-surface-2/30">
          {list.map(e => (
            <div key={e.employee_id} className="px-4 py-2 text-xs text-on-surface-muted">
              <span className="text-on-surface font-medium">{e.employee_name}</span>
              <span className="ml-2">{e.log_count} log{e.log_count === 1 ? '' : 's'} · {Math.round(e.total_hours)}h</span>
              {e.oldest_pending_at && <span className="ml-2 text-warning">oldest {ago(e.oldest_pending_at)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ icon: Icon, title, subtitle, tone, children }: { icon: any; title: string; subtitle?: string; tone: 'danger' | 'warning'; children: React.ReactNode }) {
  const bg = tone === 'danger' ? 'from-danger-container/40' : 'from-warning-container/40';
  const iconCls = tone === 'danger' ? 'text-danger' : 'text-warning';
  return (
    <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-2 overflow-hidden">
      <div className={`px-5 py-3.5 border-b border-outline bg-gradient-to-r ${bg} to-surface flex items-center gap-2`}>
        <Icon size={15} className={iconCls} />
        <div>
          <h3 className="font-display text-base font-bold tracking-tight text-on-surface">{title}</h3>
          {subtitle && <p className="text-[11px] text-on-surface-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-4">
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">{label}</div>
      <div className={`mt-1 text-2xl font-bold num-mono ${tone || 'text-on-surface'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-on-surface-subtle">{sub}</div>}
    </div>
  );
}

function Loading() { return <div className="px-4 py-10 text-center text-sm text-on-surface-subtle">Loading…</div>; }
function Empty({ icon: Icon, title, sub }: { icon: any; title: string; sub?: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <Icon size={26} className="mx-auto text-success mb-2" />
      <p className="text-sm text-on-surface">{title}</p>
      {sub && <p className="text-xs text-on-surface-subtle mt-1">{sub}</p>}
    </div>
  );
}

function formatDate(d: string): string {
  try {
    return new Date(d + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return d; }
}
