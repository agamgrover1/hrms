import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { api } from '../services/api';

// Pulse Context Panel — shown on the monthly review form so the reporting
// manager can see the data view (Pulse pillars) while filling the human
// view (qualitative ratings). Each pillar shows which review field it
// most directly informs, so the manager isn't left guessing.
//
// Pulse pillars are computed automatically. The review form is where the
// human judgement goes in. This panel bridges them.

const PILLAR_HINTS: Array<{
  key: string;
  label: string;
  feeds: string;   // which review field this Pulse pillar informs
  whatItSays: string;
}> = [
  { key: 'discipline',        label: 'Discipline',        feeds: 'Attendance',      whatItSays: 'Unplanned absences + leave-without-notice. Direct input for the Attendance rating.' },
  { key: 'hours_hygiene',     label: 'Hours',             feeds: 'Productivity',    whatItSays: 'Daily logging + notes filled. Low score = days missed.' },
  { key: 'output',            label: 'Output',            feeds: 'Productivity + Quality', whatItSays: 'Allocation fulfilled + approval rate. Low approval rate signals quality issues.' },
  { key: 'contribution',      label: 'Contribution',      feeds: 'Initiative',      whatItSays: 'Upsells raised. Above baseline (60) means initiative beyond core work.' },
  { key: 'manager_pulse',     label: 'Manager Pulse',     feeds: 'Teamwork',        whatItSays: 'Your own weekly 1-tap ratings. Reflects collaboration + attitude.' },
  { key: 'team_stewardship',  label: 'Team Stewardship',  feeds: 'Teamwork + Initiative', whatItSays: 'Approval responsiveness + team logging + review timeliness. For managers.' },
  { key: 'project_hygiene',   label: 'Project Hygiene',   feeds: 'Productivity',    whatItSays: 'Logging coverage + approval flow across projects. For coordinators.' },
  { key: 'client_handling',   label: 'Client Handling',   feeds: 'Client Handling', whatItSays: 'Last month\'s Client Handling slider value. This pillar IS your previous rating — fill the current one based on what you\'ve observed since.' },
];

function pillarColor(s: number | null) {
  if (s == null) return '#94a3b8';
  if (s >= 85) return '#16a34a';
  if (s >= 70) return '#3730a3';
  if (s >= 50) return '#d97706';
  return '#dc2626';
}

export default function PulseContextPanel({ employeeId }: { employeeId: string | null }) {
  const [data, setData] = useState<{ latest: any; trend: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employeeId) { setLoading(false); return; }
    setLoading(true);
    api.getEmployeePulse(employeeId)
      .then(r => setData({ latest: r.latest, trend: r.trend ?? [] }))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [employeeId]);

  if (!employeeId) return null;
  if (loading) return (
    <div className="rounded-xl-2 border border-outline bg-surface-2/40 p-4 text-xs text-on-surface-subtle">
      Loading Pulse context…
    </div>
  );
  if (!data?.latest) return (
    <div className="rounded-xl-2 border border-dashed border-outline bg-surface-2/40 p-4 text-xs text-on-surface-subtle">
      No Pulse snapshot for this employee yet. Pulse can't help with this review until the next nightly recompute.
    </div>
  );

  const snap = data.latest;
  const last = data.trend.length > 1 ? data.trend[data.trend.length - 2]?.total_score : null;
  const delta = last != null ? snap.total_score - last : null;

  return (
    <div className="rounded-xl-2 border border-accent/30 bg-accent-container/15 overflow-hidden">
      <div className="px-4 py-3 border-b border-accent/20 bg-accent-container/30 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-accent flex items-center gap-1.5">
            <TrendingUp size={11} /> Pulse context · last 30 days
          </p>
          <p className="text-xs text-on-surface-muted mt-1">
            The automated data view. Use this as a reference while you fill the qualitative ratings below.
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="num-mono text-2xl font-bold" style={{ color: pillarColor(snap.total_score) }}>{snap.total_score}</p>
          <p className="text-[10px] text-on-surface-subtle">{(snap.band ?? '').replace('_', ' ')}</p>
          {delta != null && (
            <p className={`text-[10px] num-mono ${delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-on-surface-subtle'}`}>
              {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} {Math.abs(delta)} vs prev
            </p>
          )}
        </div>
      </div>

      <div className="divide-y divide-outline/60">
        {PILLAR_HINTS.map(p => {
          const v = (snap as any)[p.key];
          if (v == null) return null; // pillar not applicable to this employee
          const c = pillarColor(v);
          return (
            <div key={p.key} className="px-4 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="text-xs font-semibold text-on-surface">{p.label}</p>
                  <p className="text-[10px] text-on-surface-subtle">
                    informs <span className="font-semibold text-accent">{p.feeds}</span>
                  </p>
                </div>
                <p className="text-[11px] text-on-surface-muted leading-snug mt-0.5">{p.whatItSays}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="num-mono text-base font-bold" style={{ color: c }}>{v}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
