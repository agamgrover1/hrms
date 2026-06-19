import { useEffect, useState } from 'react';
import { Activity, Clock, BarChart3, CalendarOff, Bed, MessageCircle, TrendingUp, AlertCircle } from 'lucide-react';
import { api } from '../services/api';

// Auto-populated facts the reviewer should see while scoring. Each block
// is independent — a missing or empty block silently disappears so the
// panel doesn't lecture about gaps that aren't actionable. Companion to
// PulseContextPanel: that one shows the COMPUTED pulse pillars, this one
// shows the RAW signals those pillars are built from.

type Signals = Awaited<ReturnType<typeof api.getReviewSignals>>;

export default function ReviewSignalsPanel({ employeeId, month, year }: {
  employeeId: string | null; month: number; year: number;
}) {
  const [data, setData] = useState<Signals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!employeeId) { setLoading(false); return; }
    setLoading(true); setError('');
    api.getReviewSignals(employeeId, month, year)
      .then(setData)
      .catch(e => setError(e?.message ?? 'Could not load signals'))
      .finally(() => setLoading(false));
  }, [employeeId, month, year]);

  if (!employeeId) return null;
  if (loading) return (
    <div className="rounded-xl-2 border border-outline bg-surface-2/40 p-4 text-xs text-on-surface-subtle">
      Loading signals…
    </div>
  );
  if (error) return (
    <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-4 text-xs text-danger inline-flex items-center gap-2">
      <AlertCircle size={12} /> {error}
    </div>
  );
  if (!data) return null;

  const blocks: any[] = [];

  if (data.hours_discipline) {
    const h = data.hours_discipline;
    const cov = h.coverage_pct ?? 0;
    blocks.push({
      key: 'hours',
      icon: Clock,
      title: 'Hours discipline',
      feeds: 'Productivity · Ownership',
      tone: cov >= 90 ? 'good' : cov >= 70 ? 'mid' : 'bad',
      lines: [
        `${h.logged_days}/${h.working_days} working days logged (${h.coverage_pct ?? '—'}%)`,
        h.on_time_pct != null ? `${h.on_time_pct}% logged same / next day (vs. backfilled)` : null,
      ].filter(Boolean) as string[],
    });
  }

  if (data.allocation && (data.allocation.planned > 0 || data.allocation.logged > 0)) {
    const a = data.allocation;
    const v = a.variance_pct;
    const tone = v == null ? 'mid' : Math.abs(v) <= 10 ? 'good' : Math.abs(v) <= 25 ? 'mid' : 'bad';
    blocks.push({
      key: 'alloc',
      icon: BarChart3,
      title: 'Allocation accuracy',
      feeds: 'Planning Accuracy',
      tone,
      lines: [
        `${a.logged.toFixed(1)}h logged · ${a.planned.toFixed(1)}h planned`,
        v != null ? `${v > 0 ? '+' : ''}${v}% variance${Math.abs(v) > 25 ? ' — large gap' : ''}` : null,
      ].filter(Boolean) as string[],
    });
  }

  if (data.internal_mix) {
    const i = data.internal_mix;
    blocks.push({
      key: 'mix',
      icon: Activity,
      title: 'Internal vs billable',
      feeds: 'Productivity context',
      tone: i.internal_pct <= 20 ? 'good' : i.internal_pct <= 40 ? 'mid' : 'bad',
      lines: [
        `${i.billable_hours.toFixed(1)}h billable · ${i.internal_hours.toFixed(1)}h internal`,
        `${i.internal_pct}% of time was internal / admin`,
      ],
    });
  }

  if (data.attendance) {
    const a = data.attendance;
    const hasAny = a.late_count + a.short_day_count + a.absent_count > 0;
    if (hasAny) {
      const total = a.late_count + a.short_day_count + a.absent_count;
      const noted = a.late_noted + a.short_noted + a.absent_noted;
      blocks.push({
        key: 'att',
        icon: CalendarOff,
        title: 'Attendance flags',
        feeds: 'Attendance · Communication',
        tone: total >= 6 ? 'bad' : total >= 3 ? 'mid' : 'good',
        lines: [
          [
            a.late_count   ? `${a.late_count} late`           : null,
            a.short_day_count ? `${a.short_day_count} short day${a.short_day_count > 1 ? 's' : ''}` : null,
            a.absent_count ? `${a.absent_count} absence${a.absent_count > 1 ? 's' : ''}` : null,
          ].filter(Boolean).join(' · '),
          `${noted}/${total} had an explanatory note`,
        ],
      });
    }
  }

  if (data.leaves && data.leaves.total_days > 0) {
    const l = data.leaves;
    const friSpike = l.by_dow.fri >= 2 && l.by_dow.fri > l.by_dow.tue + l.by_dow.wed;
    blocks.push({
      key: 'leaves',
      icon: Bed,
      title: 'Leave pattern',
      feeds: 'Attendance',
      tone: l.total_days <= 2 ? 'good' : l.total_days <= 4 ? 'mid' : 'bad',
      lines: [
        `${l.total_days}d total · ${Object.entries(l.by_type).map(([k, v]) => `${v} ${k}`).join(' · ')}`,
        `Mon ${l.by_dow.mon} · Tue ${l.by_dow.tue} · Wed ${l.by_dow.wed} · Thu ${l.by_dow.thu} · Fri ${l.by_dow.fri}` +
          (friSpike ? ' — Friday-heavy' : ''),
      ],
    });
  }

  if (data.responsiveness && data.responsiveness.prompts_received > 0) {
    const r = data.responsiveness;
    const med = r.median_response_hours;
    const tone = med == null ? 'bad' : med <= 4 ? 'good' : med <= 24 ? 'mid' : 'bad';
    blocks.push({
      key: 'comm',
      icon: MessageCircle,
      title: 'Comment responsiveness',
      feeds: 'Communication',
      tone,
      lines: [
        `${r.replies_sent}/${r.prompts_received} manager comments replied to`,
        med != null ? `Median reply time: ${med}h` : 'No replies on record yet',
      ],
    });
  }

  if (data.pulse) {
    const p = data.pulse;
    const d = p.delta_vs_prev_month;
    const tone = p.band === 'excellent' ? 'good' : p.band === 'good' ? 'good' : p.band === 'average' ? 'mid' : 'bad';
    blocks.push({
      key: 'pulse',
      icon: TrendingUp,
      title: 'Pulse trajectory',
      feeds: 'Anchors all scores',
      tone,
      lines: [
        `Current ${p.current.toFixed(0)} (${p.band})`,
        d != null ? `${d > 0 ? '+' : ''}${d.toFixed(1)} vs. previous month` : 'First month on record',
      ],
    });
  }

  if (blocks.length === 0) return (
    <div className="rounded-xl-2 border border-dashed border-outline bg-surface-2/40 p-4 text-xs text-on-surface-subtle">
      No raw signals available yet for this period — hour logs, attendance, and leave data fill in as the month goes on.
    </div>
  );

  const toneClass = (t: string) =>
    t === 'good' ? 'border-success/30 bg-success/5' :
    t === 'mid'  ? 'border-warning/30 bg-warning/5' :
                   'border-danger/30 bg-danger/5';
  const toneText = (t: string) =>
    t === 'good' ? 'text-success' : t === 'mid' ? 'text-warning' : 'text-danger';

  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface">Review signals</p>
          <p className="text-[10px] text-on-surface-subtle">Hard facts from this month — anchor your scores here.</p>
        </div>
      </div>
      <div className="space-y-2">
        {blocks.map(b => {
          const Icon = b.icon;
          return (
            <div key={b.key} className={`rounded-lg border ${toneClass(b.tone)} px-3 py-2`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon size={12} className={toneText(b.tone)} />
                  <span className="text-xs font-semibold text-on-surface truncate">{b.title}</span>
                </div>
                <span className="text-[9px] uppercase tracking-wider text-on-surface-subtle font-bold">{b.feeds}</span>
              </div>
              {b.lines.map((line: string, i: number) => (
                <p key={i} className="text-[11px] text-on-surface-muted mt-0.5 ml-[18px] leading-snug">{line}</p>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
