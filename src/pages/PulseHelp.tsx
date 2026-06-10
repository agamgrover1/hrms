import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Target, Clock, TrendingUp, Award, MessageSquare, Users, Briefcase, HeartHandshake } from 'lucide-react';

// Employee-facing explainer for Performance Pulse. Linked from the Hub tile,
// the My Team Pulse tab, and the admin Pulse page so HR can share one URL
// instead of repeating the explanation in chat / email.

const BAND_RUBRIC = [
  { range: '85 – 100', label: 'Excellent', tone: { bg: '#dcfce7', color: '#15803d' }, line: 'Sustained high performance across pillars. Great month.' },
  { range: '70 – 84',  label: 'Strong',    tone: { bg: '#e0e7ff', color: '#3730a3' }, line: 'Good shape. A single weak pillar is usually all that’s between you and Excellent.' },
  { range: '50 – 69',  label: 'Building',  tone: { bg: '#fef3c7', color: '#92400e' }, line: 'Below comfort zone. Use the breakdown to spot which 1–2 pillars are pulling you down.' },
  { range: '0 – 49',   label: 'Needs support', tone: { bg: '#fee2e2', color: '#b91c1c' }, line: 'Worth a conversation with your manager. Score this low usually means multiple pillars are off, not just one bad week.' },
];

const PILLARS = [
  {
    icon: Award, key: 'discipline',
    label: 'Discipline',
    measures: 'Attendance + leave behaviour over the last 30 days.',
    formula: ['Start at 100', 'Each unplanned absence subtracts 15', 'Each leave-without-notice subtracts 20'],
    improve: [
      'Apply for leave in advance — even half-day, even a hour ahead helps.',
      'Plan your week so unplanned absences are rare.',
    ],
  },
  {
    icon: Clock, key: 'hours',
    label: 'Hours',
    measures: 'How consistently you log your daily hours, and whether you fill the notes field.',
    formula: ['70% — days logged ÷ working days', '30% — days with notes ÷ days logged'],
    improve: [
      'Log every day before you sign off. Internal-activity logs count too — not just project hours.',
      'Write one line in the notes field describing what you did. Empty notes pull the score down.',
      'A weekend backfill is allowed (the rule is by date, not creation time) but daily is far less stressful.',
    ],
  },
  {
    icon: TrendingUp, key: 'output',
    label: 'Output',
    measures: 'For people with project allocations: did you log against your allocation? Plus how many of your weekly submissions got approved.',
    formula: [
      'If you have NO project allocation — this pillar is skipped, no penalty (company decides allocation, not you).',
      'If you do: 70% allocation fulfilment + 30% approval rate + up to 20-point bonus for extra effort (project hours beyond allocation + internal hours).',
    ],
    improve: [
      'Log your allocated hours weekly so they hit at least 100% of allocation.',
      'Add a clear description on weekly submissions — unclear ones get sent back.',
      'Internal initiatives, training, and recruitment hours count toward the bonus.',
    ],
  },
  {
    icon: HeartHandshake, key: 'contribution',
    label: 'Contribution',
    measures: 'Whether you’re raising upsell incentives.',
    formula: ['60 baseline for everyone', '+10 per upsell raised, capped at 100'],
    improve: [
      'Spot opportunities with your clients — even a small content add-on or extra deliverable counts.',
      'Raise upsell incentives through MyPortal → Incentives.',
    ],
  },
  {
    icon: MessageSquare, key: 'manager_pulse',
    label: 'Manager Pulse',
    measures: 'Your reporting manager’s weekly 1-tap rating.',
    formula: ['Monday prompt: 🙂 = 100, 😐 = 60, 😞 = 20', 'Average of the last 4 weekly ratings. Fewer than 2 ratings → pillar redistributes.'],
    improve: [
      'This is qualitative — your manager rates you on collaboration, attitude, communication, ownership.',
      'The honest signal lives in 1:1s, not the score. If you see this dropping, ask in your next 1:1.',
    ],
  },
  {
    icon: Users, key: 'team_stewardship',
    label: 'Team Stewardship',
    measures: 'For reporting managers AND HR — how well you steward approvals + your team.',
    formula: [
      'Approval timeliness (combined: hour-log approvals ≤ 48h, leave + WFH approvals ≤ 24h same-day) — both the manager step AND the HR step count.',
      'Team logging hygiene — only for managers with direct reports (avg of reports’ days-logged %).',
      'Review timeliness — only for managers (prior-month reviews submitted by day 5 of new month).',
      'For HR without a team: approvals are the whole pillar.',
      'For managers Day 1–4 of a month: review check skipped, other two redistribute.',
    ],
    improve: [
      'Action leaves and WFH the same day they land.',
      'Clear hour-log approvals daily — don’t let them sit > 48h.',
      'Nudge reports who fall behind on daily logging.',
      'File last month’s reviews by the 5th of every new month. After day 5 you start losing points.',
    ],
  },
  {
    icon: Briefcase, key: 'project_hygiene',
    label: 'Project Hygiene',
    measures: 'For project coordinators — how cleanly projects run end-to-end.',
    formula: [
      '50% logging coverage (% of assigned employees logging on each project)',
      '50% approval flow-through (% of submitted logs cleared within 2 days)',
    ],
    improve: [
      'Chase non-loggers on your projects each Friday.',
      'Coordinate with reporting managers to keep approval queues moving.',
    ],
  },
  {
    icon: HeartHandshake, key: 'client_handling',
    label: 'Client Handling',
    measures: 'For managers + coordinators — how well you handle client interactions.',
    formula: ['Sourced from the monthly review’s Client Handling slider (0–100).', 'Latest month’s rating wins.', 'Rubric: messaging quality · handling tough clients · interaction · retention.'],
    improve: [
      'Be responsive on client comms — don’t leave messages unread overnight.',
      'When a tough conversation comes up, take it on rather than escalate by default.',
      'Retention matters: a client churning under your watch shows up here through the monthly rating.',
    ],
  },
];

export default function PulseHelp() {
  const navigate = useNavigate();
  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      <div>
        <button onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-on-surface mb-3">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="font-display text-3xl font-bold tracking-tight text-on-surface">Performance Pulse — how it works</h1>
        <p className="text-sm text-on-surface-muted mt-2 leading-relaxed">
          Pulse is an <strong>automated 30-day score</strong> recomputed every night. It runs alongside the manual monthly reviews your reporting manager does — the two complement each other; Pulse covers the data side, the manual review covers the human side. This page explains what each pillar measures, how to read your score, and how to improve.
        </p>
      </div>

      {/* Bands */}
      <section className="bg-surface rounded-2xl border border-outline p-5 space-y-3">
        <h2 className="font-display text-lg font-bold text-on-surface flex items-center gap-2"><Target size={16} className="text-accent" /> Score bands</h2>
        <p className="text-xs text-on-surface-muted">
          Your total score (0–100) is the equal-weighted average of whichever pillars apply to your role. The label that goes with it:
        </p>
        <div className="space-y-2">
          {BAND_RUBRIC.map(b => (
            <div key={b.label} className="flex items-start gap-3 p-3 rounded-xl border border-outline bg-surface-2/40">
              <span className="num-mono text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap" style={b.tone}>{b.range}</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: b.tone.color }}>{b.label}</p>
                <p className="text-xs text-on-surface-muted leading-snug mt-0.5">{b.line}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pillars */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-on-surface">The pillars</h2>
        <p className="text-xs text-on-surface-muted">
          Each pillar is scored 0–100. Pillars that don’t apply to your role are skipped — their weight redistributes to the rest. So an IC without an allocation isn’t penalised on Output; a non-manager isn’t penalised on Team Stewardship.
        </p>
        {PILLARS.map(p => {
          const Icon = p.icon;
          return (
            <div key={p.key} className="bg-surface rounded-2xl border border-outline p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-container/50 flex items-center justify-center flex-shrink-0">
                  <Icon size={16} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-base font-bold text-on-surface">{p.label}</h3>
                  <p className="text-sm text-on-surface-muted mt-1 leading-relaxed">{p.measures}</p>

                  <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle mt-4 mb-1.5">How it’s calculated</p>
                  <ul className="text-xs text-on-surface-muted leading-relaxed space-y-1 list-disc ml-4">
                    {p.formula.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>

                  <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle mt-4 mb-1.5">How to improve</p>
                  <ul className="text-xs text-on-surface-muted leading-relaxed space-y-1 list-disc ml-4">
                    {p.improve.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* Visibility */}
      <section className="bg-surface rounded-2xl border border-outline p-5 space-y-3">
        <h2 className="font-display text-lg font-bold text-on-surface">Who can see your score</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-outline">
              <th className="py-2 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Role</th>
              <th className="py-2 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Sees</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            <tr><td className="py-2 text-on-surface font-medium">You</td><td className="py-2 text-on-surface-muted text-xs">Your own score + breakdown on My Portal → Hub.</td></tr>
            <tr><td className="py-2 text-on-surface font-medium">Your reporting manager</td><td className="py-2 text-on-surface-muted text-xs">Your score + breakdown on their My Team → Pulse tab.</td></tr>
            <tr><td className="py-2 text-on-surface font-medium">HR + Admin + Project Coordinator</td><td className="py-2 text-on-surface-muted text-xs">Org-wide grid + every employee’s breakdown.</td></tr>
            <tr><td className="py-2 text-on-surface font-medium">Peers</td><td className="py-2 text-on-surface-muted text-xs">Cannot see your score. No public leaderboard.</td></tr>
          </tbody>
        </table>
      </section>

      {/* FAQ */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-on-surface">Common questions</h2>

        <div className="bg-surface rounded-2xl border border-outline p-5">
          <p className="text-sm font-semibold text-on-surface">Why did my score drop overnight?</p>
          <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">
            Pulse recalculates every night using the last 30 days. If you missed a day of logging yesterday, or a leave you applied last-minute got recorded, you’ll see a small drop today. Open the breakdown drawer — "Recent signals" tells you what changed.
          </p>
        </div>

        <div className="bg-surface rounded-2xl border border-outline p-5">
          <p className="text-sm font-semibold text-on-surface">I just joined. Why is my score showing "new"?</p>
          <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">
            For your first 30 days, the system marks you as a new joiner. Your score is computed honestly from whatever data exists, but the "new" badge signals that the 30-day window doesn’t represent a full picture yet. It clears automatically after a month.
          </p>
        </div>

        <div className="bg-surface rounded-2xl border border-outline p-5">
          <p className="text-sm font-semibold text-on-surface">Some pillars show "—" for me. Am I being penalised?</p>
          <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">
            No. A "—" means the pillar doesn’t apply to your role this period — e.g. Output is skipped if you have no project allocation, Team Stewardship is skipped if you don’t have direct reports. Skipped pillars don’t hurt your average; the remaining ones share the weight equally.
          </p>
        </div>

        <div className="bg-surface rounded-2xl border border-outline p-5">
          <p className="text-sm font-semibold text-on-surface">Does Pulse replace my manual monthly review?</p>
          <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">
            No. Both run alongside. Pulse is the data view (attendance, logs, approvals, upsells, manager weekly pulse). The manual monthly review is the human view (productivity, quality, teamwork, AI usage, client handling). Together they give a complete picture.
          </p>
        </div>

        <div className="bg-surface rounded-2xl border border-outline p-5">
          <p className="text-sm font-semibold text-on-surface">Will Pulse affect appraisals or compensation?</p>
          <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">
            Pulse is a coaching tool, not a salary decision. HR and your manager use it as one of several signals — alongside manual reviews, project outcomes, and 1:1 conversations — when discussing growth, opportunities, or coaching needs.
          </p>
        </div>

        <div className="bg-surface rounded-2xl border border-outline p-5">
          <p className="text-sm font-semibold text-on-surface">My Hours pillar dropped after one missed day. Can I recover?</p>
          <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">
            Yes — the window is rolling 30 days. One missed day will keep affecting your score for 30 days, then drop off. Log every day going forward and the score climbs back. Backfilling the missed day with a real entry also works (the date you log it for is what counts, not when you logged it).
          </p>
        </div>

        <div className="bg-surface rounded-2xl border border-outline p-5">
          <p className="text-sm font-semibold text-on-surface">My manager hasn’t given pulse ratings. Does that hurt me?</p>
          <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">
            No. Fewer than 2 ratings in the 4-week window means the Manager Pulse pillar is skipped — it redistributes to your other pillars. You’re never penalised for your manager’s inaction. (Though it would be useful feedback for you — ask in your next 1:1.)
          </p>
        </div>
      </section>

      <section className="bg-accent-container/30 rounded-2xl border border-accent/20 p-5">
        <p className="text-sm font-semibold text-on-surface">The honest take</p>
        <p className="text-xs text-on-surface-muted mt-1 leading-relaxed">
          Pulse is most useful as a "where am I drifting?" indicator. If your score is consistently Excellent or Strong, you don’t need to think about it. If you see it dipping, the breakdown drawer points exactly to the pillar that needs attention — usually one small habit (daily logging, applying leave in advance, etc.) is what moves it. Don’t obsess over week-to-week wiggle; look at the monthly trend.
        </p>
      </section>
    </div>
  );
}
