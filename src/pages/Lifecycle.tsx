import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserPlus, LogOut, Clock, AlertTriangle, CheckCircle2, ChevronRight, Ban,
} from 'lucide-react';
import { api } from '../services/api';

// One-page picture of every open + recently-closed onboarding /
// offboarding. HR/admin lands here to see "who's mid-joining, who's
// mid-leaving, who's stalled" — then clicks through to the actual
// checklist on the employee's profile.

interface Row {
  kind: 'onboarding' | 'offboarding';
  id: string;
  employee_id: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  employee_name: string;
  designation: string | null;
  department: string | null;
  total_items?: number;
  done_items?: number;
  overdue?: boolean;
}
interface Payload {
  onboarding: Row[];
  offboarding: Row[];
  summary: { onboarding_in_progress: number; offboarding_in_progress: number; overdue: number };
  recent: Row[];
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

export default function Lifecycle() {
  const nav = useNavigate();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getLifecycleDashboard()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6 p-6 max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-on-surface flex items-center gap-2">
            <UserPlus className="w-6 h-6 text-accent" /> Lifecycle
          </h1>
          <p className="text-sm text-on-surface-muted mt-1">
            Every open onboarding and offboarding — plus what closed recently.
          </p>
        </div>
        <button onClick={load}
          className="px-3 py-2 text-xs text-on-surface-muted hover:text-on-surface rounded-lg border border-outline bg-surface">
          Refresh
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <Kpi label="Onboarding in progress" value={data?.summary.onboarding_in_progress ?? 0} icon={UserPlus} tone="text-accent" />
        <Kpi label="Offboarding in progress" value={data?.summary.offboarding_in_progress ?? 0} icon={LogOut} tone="text-warning" />
        <Kpi label="Overdue (> 14 days)" value={data?.summary.overdue ?? 0} icon={AlertTriangle} tone={(data?.summary.overdue ?? 0) > 0 ? 'text-danger' : 'text-on-surface-muted'} />
      </div>

      {loading ? (
        <div className="h-64 rounded-xl-2 bg-surface-2 animate-pulse" />
      ) : (
        <>
          <Section
            title="Onboarding — in progress"
            emptyLabel="No onboardings in progress right now."
            rows={data?.onboarding ?? []}
            onOpen={(r) => nav(`/employees/${r.employee_id}?tab=Onboarding`)}
          />
          <Section
            title="Offboarding — in progress"
            emptyLabel="No offboardings in progress right now."
            rows={data?.offboarding ?? []}
            onOpen={(r) => nav(`/employees/${r.employee_id}?tab=Offboarding`)}
          />
          {(data?.recent?.length ?? 0) > 0 && (
            <RecentSection
              rows={data!.recent}
              onOpen={(r) => nav(`/employees/${r.employee_id}?tab=${r.kind === 'onboarding' ? 'Onboarding' : 'Offboarding'}`)}
            />
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: string }) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle">{label}</span>
        <Icon className={`w-4 h-4 ${tone}`} />
      </div>
      <p className={`text-2xl font-bold num-mono mt-1 ${tone}`}>{value}</p>
    </div>
  );
}

function Section({ title, rows, emptyLabel, onOpen }: {
  title: string; rows: Row[]; emptyLabel: string; onOpen: (r: Row) => void;
}) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-outline bg-surface-2/50 flex items-center justify-between">
        <h2 className="font-semibold text-on-surface text-sm">{title}</h2>
        <span className="text-xs text-on-surface-muted num-mono">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-on-surface-subtle">{emptyLabel}</div>
      ) : (
        <div className="divide-y divide-outline">
          {rows.map(r => {
            const progress = r.total_items ? Math.round(((r.done_items ?? 0) / r.total_items) * 100) : 0;
            return (
              <button key={r.id} onClick={() => onOpen(r)}
                className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-surface-2/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-on-surface truncate">{r.employee_name}</span>
                    {r.designation && <span className="text-xs text-on-surface-subtle truncate">· {r.designation}</span>}
                    {r.overdue && (
                      <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border bg-danger/15 text-danger border-danger/30 flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" /> Overdue
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-on-surface-subtle mt-0.5 flex items-center gap-2">
                    <Clock className="w-3 h-3" /> Started {daysAgo(r.started_at)} days ago
                    <span className="num-mono">· {r.done_items ?? 0}/{r.total_items ?? 0} items</span>
                  </div>
                  {r.total_items ? (
                    <div className="mt-2 h-1 bg-surface-3 rounded-full overflow-hidden max-w-md">
                      <div className={`h-full ${progress >= 100 ? 'bg-success' : progress >= 50 ? 'bg-accent' : 'bg-warning'}`}
                        style={{ width: `${progress}%` }} />
                    </div>
                  ) : null}
                </div>
                <ChevronRight className="w-4 h-4 text-on-surface-subtle shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentSection({ rows, onOpen }: { rows: Row[]; onOpen: (r: Row) => void }) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-outline bg-surface-2/50">
        <h2 className="font-semibold text-on-surface text-sm">Recently closed</h2>
      </div>
      <div className="divide-y divide-outline">
        {rows.map(r => (
          <button key={r.id} onClick={() => onOpen(r)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2/50 text-sm">
            {r.status === 'completed'
              ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              : <Ban className="w-4 h-4 text-on-surface-muted shrink-0" />}
            <span className="font-medium text-on-surface truncate">{r.employee_name}</span>
            <span className="text-xs text-on-surface-muted">· {r.kind === 'onboarding' ? 'Onboarding' : 'Offboarding'}</span>
            <span className="ml-auto text-xs text-on-surface-subtle">
              {r.completed_at ? new Date(r.completed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
