import { useEffect, useMemo, useState } from 'react';
import { Search, ChevronRight, BookOpen, BarChart3, Users, Clock, ClipboardCheck, Activity, Sparkles, Calendar, DollarSign, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

// Single source of truth for what every card / widget in the HRMS means.
// Linked from the sidebar so anyone confused about a number can look it up
// instead of pinging HR. Cards are grouped by the page they appear on, with
// a search filter at the top for "I forgot which page it was on".

type RolePill = 'admin' | 'hr' | 'coord' | 'manager' | 'employee' | 'reviewer';

interface CardDoc {
  title: string;
  page: string;            // where it appears, for breadcrumb
  whoSees: RolePill[];
  shows: string;           // 1-2 line user-facing description
  howItWorks: string[];    // bullet list of the actual computation / source
  useIt?: string;          // optional "how to use this number"
}

interface Section {
  id: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  cards: CardDoc[];
}

const ROLE_LABELS: Record<RolePill, { label: string; bg: string; color: string }> = {
  admin:    { label: 'Admin',    bg: '#fee2e2', color: '#b91c1c' },
  hr:       { label: 'HR',       bg: '#fef3c7', color: '#92400e' },
  coord:    { label: 'Coord.',   bg: '#dbeafe', color: '#1d4ed8' },
  manager:  { label: 'Manager',  bg: '#ede9fe', color: '#6d28d9' },
  reviewer: { label: 'Reviewer', bg: '#e0e7ff', color: '#3730a3' },
  employee: { label: 'Everyone', bg: '#dcfce7', color: '#15803d' },
};

const SECTIONS: Section[] = [
  // ── Dashboard ─────────────────────────────────────────────────────────
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: BarChart3,
    blurb: 'The HR / admin landing page. High-level org snapshot.',
    cards: [
      {
        title: 'Total Employees',
        page: 'Dashboard',
        whoSees: ['admin', 'hr'],
        shows: 'Total people in the org plus how many are currently marked active.',
        howItWorks: [
          'COUNT(*) from employees, regardless of status, for the headline number',
          'Active = employees.status = "active". Inactive / left employees are counted in the headline but not in the sub-text.',
        ],
      },
      {
        title: "Today's Attendance",
        page: 'Dashboard',
        whoSees: ['admin', 'hr'],
        shows: 'How many of your active employees clocked in today and what % that is.',
        howItWorks: [
          'Numerator: distinct employees with an attendance row for today where status is present, late, wfh, or any non-absent state',
          'Denominator: number of active employees',
          'Percentage updates as people clock in through the day',
        ],
      },
      {
        title: 'Pending Leaves',
        page: 'Dashboard',
        whoSees: ['admin', 'hr'],
        shows: 'Number of leave requests waiting for HR approval, and an actionable list of the most recent ones.',
        howItWorks: [
          'leave_requests where status = "pending" — covers both "manager has approved, HR to action" and "no manager, HR is the only reviewer"',
          'Widget supports inline Approve / Reject — Reject prompts for a reason that goes into the employee\'s notification',
        ],
        useIt: 'Quick triage. For full context (history, action trail, notes), click through to Leave Management.',
      },
      {
        title: 'Monthly Payroll',
        page: 'Dashboard',
        whoSees: ['admin', 'hr'],
        shows: 'Sum of net pay across all employees for the current payroll month, displayed in lakhs.',
        howItWorks: [
          'SUM(net_pay) from payroll_records where month/year = current cycle',
          'Only counts records that have been generated (an unprocessed month shows as —)',
        ],
      },
      {
        title: 'Headcount growth',
        page: 'Dashboard',
        whoSees: ['admin', 'hr'],
        shows: 'Last 7 months of active-employee count, plotted as bars.',
        howItWorks: [
          'For each month, counts employees whose joining was on/before the end of that month AND who hadn\'t left by then',
          'Includes the current (partial) month at the right edge',
        ],
      },
      {
        title: 'Recent activity',
        page: 'Dashboard',
        whoSees: ['admin', 'hr'],
        shows: 'The most recent leave-related events: applied, approved, rejected, cancelled.',
        howItWorks: [
          'Pulled from leave_requests, sorted by the most recent event timestamp',
          'Shows the actor + the affected employee + the leave type',
        ],
      },
    ],
  },

  // ── My Portal ─────────────────────────────────────────────────────────
  {
    id: 'my-portal',
    label: 'My Portal',
    icon: User,
    blurb: 'Your personal hub. Everyone has one regardless of role.',
    cards: [
      {
        title: 'Today\'s status (clock-in card)',
        page: 'My Portal · Overview',
        whoSees: ['employee'],
        shows: 'Whether you\'ve clocked in today, the time, and your current work-from-home / leave state.',
        howItWorks: [
          'Reads your attendance row for today',
          'WFH / Leave override "clocked in" — you don\'t need to clock in on those days',
        ],
      },
      {
        title: 'Attendance ring',
        page: 'My Portal · Overview',
        whoSees: ['employee'],
        shows: 'Your attendance % for the current month so far.',
        howItWorks: [
          'Numerator: days marked present, late, wfh, or on approved leave',
          'Denominator: working days elapsed in the current month (Mon-Fri, skipping holidays)',
          'Resets at month start',
        ],
      },
      {
        title: 'Quick access tiles',
        page: 'My Portal · Hub',
        whoSees: ['employee'],
        shows: 'Each tile shortcuts to a section (Attendance, Leaves, WFH, Hours, Performance, Pay Slip, etc.). Badges highlight pending items.',
        howItWorks: [
          'Badge "3 pending" on Leaves means 3 of your applied leaves are still waiting on a reviewer',
          'Tiles you don\'t need (Performance during onboarding, Pay Slip before first cycle, etc.) hide automatically',
        ],
      },
      {
        title: 'My Attendance — month browser',
        page: 'My Portal · Attendance',
        whoSees: ['employee'],
        shows: 'Day-by-day attendance list for any month you pick.',
        howItWorks: [
          'Each row: status (Present / Late / Short Day / etc.), clock-in → clock-out, total productive hours',
          'Short Day = worked < 9h (excluding break time)',
          'You can add a note to short / late days explaining what happened — HR / your manager see it too',
        ],
      },
      {
        title: 'Leave balance tiles',
        page: 'My Portal · Leaves',
        whoSees: ['employee'],
        shows: 'Full-day balance, short-leave credits, and optional leaves available this year.',
        howItWorks: [
          'Full Day: 1 credit per month, carries forward (unless you\'re on probation — then locked to 0)',
          'Short Leave: 2 credits per month, do NOT carry forward — use them or lose them at month end',
          'Half Day = 2 short leave credits',
          'Optional Leaves: pool of 2 per year, dates published by HR, available to anyone past probation',
        ],
      },
      {
        title: 'My Hours grid',
        page: 'My Portal · My Hours',
        whoSees: ['employee'],
        shows: 'Your project allocations and what you\'ve logged for each week.',
        howItWorks: [
          'Each cell = hours logged / hours allocated for that week',
          'Click a cell to edit (day-by-day entry) or delete (pending / on-hold / rejected only)',
          '💬 chip opens the discussion thread with your reviewer for that week\'s log',
        ],
        useIt: 'Aim to hit your weekly allocation. Internal-hours panel below the grid covers non-project work.',
      },
    ],
  },

  // ── My Team ───────────────────────────────────────────────────────────
  {
    id: 'my-team',
    label: 'My Team',
    icon: Users,
    blurb: 'The reporting manager dashboard — only people with direct reports see this page.',
    cards: [
      {
        title: 'Team Size',
        page: 'My Team',
        whoSees: ['manager', 'hr', 'admin'],
        shows: 'Count of active employees who report to you (directly or further down the chain).',
        howItWorks: [
          'Walks employees.reporting_manager_id transitively, capped at 10 levels',
          'Inactive / left employees aren\'t counted',
        ],
      },
      {
        title: 'Present Today',
        page: 'My Team',
        whoSees: ['manager'],
        shows: 'How many of your team showed up today.',
        howItWorks: [
          'Counts your team members with attendance.status in (present, late, wfh) for today',
          'WFH counts as present — they\'re working, just remote',
        ],
      },
      {
        title: 'WFH Today',
        page: 'My Team',
        whoSees: ['manager'],
        shows: 'How many on your team are on approved Work From Home today.',
        howItWorks: [
          'wfh_requests where status=approved AND today falls in [from_date, to_date]',
          'Pending WFH doesn\'t count yet — you have to approve it first',
        ],
      },
      {
        title: 'Late Today',
        page: 'My Team',
        whoSees: ['manager'],
        shows: 'How many on your team clocked in late today.',
        howItWorks: [
          'attendance.status = "late" — currently triggered by clock-in after the configured cutoff (default 10:00)',
        ],
      },
      {
        title: 'On Leave',
        page: 'My Team',
        whoSees: ['manager'],
        shows: 'How many on your team are on approved leave today (any type).',
        howItWorks: [
          'leave_requests where status=approved AND today is between from_date and to_date',
        ],
      },
      {
        title: 'Attendance This Month',
        page: 'My Team',
        whoSees: ['manager'],
        shows: 'Per-person stacked bar of present (green) vs late (yellow) vs absent (red) working days for the current month.',
        howItWorks: [
          'Bars are scaled to the elapsed working days in the month',
          'Hover any name for the exact day counts',
          'Updates daily as new attendance rows come in',
        ],
        useIt: 'Lots of red on one person? Worth a 1:1 conversation before it shows up in Pulse.',
      },
      {
        title: 'Leave Distribution',
        page: 'My Team',
        whoSees: ['manager'],
        shows: 'Donut chart of WHAT KINDS of leave your team has taken THIS MONTH — split by Full Day, Half Day, Short Leave, Optional.',
        howItWorks: [
          'Counts approved leave_requests where reporting_manager_id traces back to you AND the leave falls in the current month',
          'Each segment shows the % of the total. Hover for the raw count',
          '"No leaves this month" empty state when nobody on the team has taken any',
        ],
        useIt: 'Spot patterns. Half-day skewing high? People may be balancing personal stuff — worth checking in. Short Leave skew? Possibly recurring scheduling crunches.',
      },
    ],
  },

  // ── Project Hours ─────────────────────────────────────────────────────
  {
    id: 'hours',
    label: 'Project Hours',
    icon: Clock,
    blurb: 'Plan, log, and review project work.',
    cards: [
      {
        title: 'How W1-W5 weeks work (read this first)',
        page: 'Project Hours · Plan / Capacity / Mine views',
        whoSees: ['coord', 'manager', 'reviewer', 'admin'],
        shows: 'Each month splits into 5 Mon-Sun calendar weeks, NOT fixed 7-day chunks. W1 and W5 can be partial — check the date under the W label.',
        howItWorks: [
          'W1 = day 1 of the month → first Sunday (partial if the month doesn\'t start on a Monday)',
          'W2 = first Monday → its Sunday (always 7 days when fully inside the month)',
          'W3 / W4 = subsequent full Mon-Sun spans',
          'W5 = last Monday → end of month (partial; absorbs any orphan day)',
          'Example — July 2026 (Jul 1 = Wed):',
          '  W1 = Jul 1-5 (Wed-Sun, 3 working days)',
          '  W2 = Jul 6-12 (full, 5 working days)',
          '  W3 = Jul 13-19 · W4 = Jul 20-26 · W5 = Jul 27-31',
          'Every grid (Plan, Capacity, Mine, Hours Utilization) shows the actual date range under the W label so you never have to compute it',
          'The bucket containing today is highlighted in pink — that\'s "this week"',
        ],
        useIt: 'Before allocating, look at the date range under the W. A "full week" of 35h fits W2-W4 cleanly. For partial W1/W5, prorate by working days — e.g., a 3-weekday W1 maxes out around 21h, not 35h. When using "Copy from previous month", review the first and last weeks before saving — the bucket lengths usually shift across months.',
      },
      {
        title: 'My team\'s capacity',
        page: 'Project Hours · Mine view',
        whoSees: ['manager', 'reviewer'],
        shows: 'Per-direct-report W1-W5 + monthly allocations vs what they\'ve logged.',
        howItWorks: [
          'Each cell = allocated hours for that week. Cell color encodes utilization:',
          'Green: logged ≥ allocation',
          'Yellow: logged but over allocation (+N badge)',
          'Red: under-logged (−N badge)',
          'Month column shows total = monthly_hours + over-plan logged',
          'Headers are sortable — click any to sort, click again to flip direction',
        ],
        useIt: 'Click any cell to drill into the employee\'s logs for that week. The "Edit" chip lets you propose a reallocation that the coordinator approves.',
      },
      {
        title: 'Projects I review',
        page: 'Project Hours · Mine view',
        whoSees: ['reviewer'],
        shows: 'Projects where you\'re the reporting_person, with team list and total planned hours.',
        howItWorks: [
          'Reads projects.reporting_person_id = your employee id',
          'Click any project for the daily-activity breakdown — employees × days × hours',
        ],
      },
      {
        title: 'Logged / Plan column',
        page: 'Project Hours · Detail modal',
        whoSees: ['manager', 'reviewer'],
        shows: 'Cumulative approved hours vs the monthly plan, with pending stacked on top.',
        howItWorks: [
          'Approved hours = SUM(hour_logs.hours_logged) where status=approved',
          'Pending hours rendered separately so over-plan isn\'t misattributed to approved',
        ],
      },
    ],
  },

  // ── Approvals ─────────────────────────────────────────────────────────
  {
    id: 'approvals',
    label: 'Approvals',
    icon: ClipboardCheck,
    blurb: 'Where reviewers act on hour logs and allocation change requests.',
    cards: [
      {
        title: 'Status tiles (Pending / On hold / Approved / Rejected)',
        page: 'Hour Approvals · Hour logs tab',
        whoSees: ['admin', 'hr', 'coord', 'reviewer'],
        shows: 'Count of weekly hour logs in each state for the current filter scope.',
        howItWorks: [
          '"On hold" is the middle state — used when you need clarification before approving or rejecting',
          'Click any tile or use the filter chips to narrow the list',
        ],
      },
      {
        title: 'Discuss (💬) on a log row',
        page: 'Hour Approvals',
        whoSees: ['admin', 'hr', 'coord', 'reviewer', 'employee'],
        shows: 'Comment thread between you and the employee for that specific weekly log.',
        howItWorks: [
          'Available on every log regardless of status — even after approve / reject',
          'Reply pings the other side (employee → reviewer / reviewer → employee)',
          'Notification deep-links straight back to the same thread, so the conversation flows',
        ],
      },
      {
        title: 'Allocation requests tab',
        page: 'Hour Approvals · Allocation requests',
        whoSees: ['admin', 'coord'],
        shows: 'List of proposed W1-W5 / monthly hour changes from managers, with current vs proposed shown side-by-side.',
        howItWorks: [
          'Each card shows the diff with +/- deltas on changed weeks',
          'Approving writes the proposed values to project_assignments — that one click IS the change',
          'Rejecting requires a note',
          'HR can see the queue but only coordinators + admin can action',
        ],
      },
    ],
  },

  // ── Leave Management ─────────────────────────────────────────────────
  {
    id: 'leaves',
    label: 'Leave Management',
    icon: Calendar,
    blurb: 'The two-stage approval workflow lives here.',
    cards: [
      {
        title: 'Action Trail column',
        page: 'Leave Management',
        whoSees: ['admin', 'hr'],
        shows: 'Compact history of who acted on this leave and when — manager stage, HR stage, cancellation if applicable.',
        howItWorks: [
          'Manager stage: shown when manager_status is approved / rejected',
          'HR stage: shown when hr_actioned_at is set',
          'Reason (red) is shown for rejections; Note (muted) is shown for any approver context',
        ],
      },
      {
        title: 'Approve / Override / Reject buttons',
        page: 'Leave Management',
        whoSees: ['admin', 'hr'],
        shows: 'Per-request action cluster. What shows depends on the current state.',
        howItWorks: [
          'Approve appears when manager_status=approved (HR is the final stage)',
          'Override ✓ appears when manager_status=pending — HR can approve without waiting for the manager',
          'Reject is always available',
          'Approve opens a modal with an optional note; Reject requires a reason',
        ],
      },
      {
        title: 'Half day & Short leave slot',
        page: 'Apply for Leave (any page)',
        whoSees: ['employee'],
        shows: 'When you pick Half Day or Short Leave, an extra picker appears: Morning/Evening for Half Day, Q1-Q4 for Short Leave.',
        howItWorks: [
          'The slot tags the request so your manager + HR know which part of the day you\'ll be out',
          'Slot defaults: Half Day → Morning, Short Leave → Q1 (you can change before submitting)',
          'Q1=start of day, Q2=late AM, Q3=early PM, Q4=end of day',
        ],
      },
    ],
  },

  // ── Performance Pulse ────────────────────────────────────────────────
  {
    id: 'pulse',
    label: 'Performance Pulse',
    icon: Sparkles,
    blurb: 'Automated month-over-month performance score. Deeper docs live on the Pulse Help page.',
    cards: [
      {
        title: 'Pulse Score (0-100)',
        page: 'My Portal · Performance · Pulse drawer',
        whoSees: ['employee', 'manager', 'hr', 'admin'],
        shows: 'A single composite score for the current calendar month, broken into pillars (Discipline, Hours, Output, Contribution, etc.).',
        howItWorks: [
          'Each pillar is computed independently then weighted equally (HR can override per-department)',
          'Score band: 85-100 Excellent, 70-84 Strong, 50-69 Building, 0-49 Needs support',
          'Recomputes nightly so the live month shows month-to-date',
        ],
        useIt: 'Deep-dive in the breakdown drawer — see which pillars are pulling you up or down. Full rubric on the Pulse Help page.',
      },
      {
        title: 'Pulse trend',
        page: 'My Portal · Performance',
        whoSees: ['employee', 'manager', 'hr'],
        shows: 'Last 6 months of your Pulse score, plotted.',
        howItWorks: [
          'Each datapoint is the score for that calendar month at its close',
          'Use the MonthSelector to jump to any past month\'s breakdown',
        ],
      },
    ],
  },

  // ── Finance / Project Profitability ──────────────────────────────────
  {
    id: 'finance',
    label: 'Finance',
    icon: DollarSign,
    blurb: 'Project profitability. Admin-only.',
    cards: [
      {
        title: 'Invoiced / Received / Pending tiles',
        page: 'Finance · Dashboard',
        whoSees: ['admin'],
        shows: '3-tile strip showing billed (accrual) vs collected (cash) vs outstanding for the month.',
        howItWorks: [
          'Invoiced: SUM(amount_invoiced) on non-cancelled invoices for the month',
          'Received: SUM(amount_received) where status=cleared',
          'Pending: invoiced - received',
          'Drives both accrual and cash views of profitability',
        ],
      },
      {
        title: 'Project P&L row',
        page: 'Finance · Dashboard',
        whoSees: ['admin'],
        shows: 'Per-project: invoiced, received, pending, direct cost, overhead, net profit, margin %.',
        howItWorks: [
          'Direct cost = salary × allocated_hours / working_hours, summed across employees on the project',
          'Overhead = configurable method (direct_hours, headcount, revenue weight)',
          'Net profit = invoiced - direct cost - overhead',
          'Margin % = net profit / invoiced',
        ],
      },
    ],
  },

  // ── Compliance & Utilization ─────────────────────────────────────────
  {
    id: 'compliance',
    label: 'Compliance & Utilization',
    icon: Activity,
    blurb: 'Behind-the-scenes views for spotting gaps.',
    cards: [
      {
        title: 'Daily Log Compliance',
        page: 'Project Hours · Compliance',
        whoSees: ['manager', 'admin', 'hr', 'coord'],
        shows: 'Who logged today, who didn\'t, by team or org-wide.',
        howItWorks: [
          'For each employee, checks for at least one hour_log_days row for the date',
          'Excludes weekends / approved leave / approved WFH from the "missing" list — those are valid reasons',
        ],
      },
      {
        title: 'Staff Utilization',
        page: 'Project Hours · Utilization',
        whoSees: ['admin', 'hr'],
        shows: 'Per-employee: allocated hours, logged hours, billable %, bench %.',
        howItWorks: [
          'Billable % = approved project hours / available hours (working days × 8)',
          'Available hours net of leaves / WFH days',
          'Cost columns are stripped server-side for non-admin viewers',
        ],
      },
    ],
  },
];

export default function HowItWorks() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  // Manager / reviewer flags follow the same gates Sidebar uses, so the
  // page shows the same scope of cards as the rest of the nav. Without
  // these, an employee with direct reports wouldn't see the My Team
  // explainers even though they actually use that page.
  const [isManager, setIsManager] = useState(false);
  const [isProjectReviewer, setIsProjectReviewer] = useState(false);
  useEffect(() => {
    if (!user?.employee_id_ref) return;
    api.getEmployees()
      .then(emps => {
        const me = (emps as any[]).find(e => e.employee_id === user.employee_id_ref);
        if (!me) return;
        api.getTeamMembers(me.id).then((mem: any[]) => setIsManager(mem.length > 0)).catch(() => {});
        api.getProjects({ status: 'active' })
          .then((projs: any[]) => setIsProjectReviewer(projs.some(p => p.project_reporting_id === me.id)))
          .catch(() => {});
      })
      .catch(() => {});
  }, [user?.employee_id_ref]);

  // Build the set of role pills the current viewer "is". A card is shown
  // when ANY of its whoSees entries is in this set. 'employee' is always
  // included because it's the "everyone" tag.
  const myRoles = useMemo<Set<RolePill>>(() => {
    const set = new Set<RolePill>(['employee']);
    if (user?.role === 'admin') set.add('admin');
    if (user?.role === 'hr_manager') set.add('hr');
    if (user?.role === 'project_coordinator') set.add('coord');
    if (isManager) set.add('manager');
    if (isProjectReviewer) set.add('reviewer');
    return set;
  }, [user?.role, isManager, isProjectReviewer]);

  // Filter cards by role first (so a regular employee never sees admin /
  // coord cards), then by the optional search string. Sections with zero
  // matching cards drop out entirely.
  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SECTIONS
      .map(s => ({
        ...s,
        cards: s.cards.filter(c => {
          if (!c.whoSees.some(r => myRoles.has(r))) return false;
          if (!q) return true;
          return (
            c.title.toLowerCase().includes(q) ||
            c.shows.toLowerCase().includes(q) ||
            c.page.toLowerCase().includes(q) ||
            c.howItWorks.some(h => h.toLowerCase().includes(q))
          );
        }),
      }))
      .filter(s => s.cards.length > 0);
  }, [query, myRoles]);

  const [openSection, setOpenSection] = useState<string>(SECTIONS[0].id);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-on-surface-muted mb-2">
          <BookOpen size={14} />
          <span>Help</span>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-on-surface">How it works</h1>
        <p className="text-sm text-on-surface-muted mt-1 max-w-2xl">
          Every card and number across the HRMS, explained. If you ever see a metric and wonder
          "what does this actually mean?" or "how is it calculated?" — search here first.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by card name, page, or term…"
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface border border-outline rounded-xl-2 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {/* Quick jump nav — only the sections the viewer can actually see */}
      {!query.trim() && filteredSections.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {filteredSections.map(s => {
            const Icon = s.icon;
            return (
              <button key={s.id} onClick={() => {
                  setOpenSection(s.id);
                  document.getElementById(`how-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  openSection === s.id
                    ? 'bg-accent text-on-accent border-accent'
                    : 'bg-surface text-on-surface-muted border-outline hover:bg-surface-2'
                }`}>
                <Icon size={12} /> {s.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Sections */}
      {filteredSections.length === 0 ? (
        <div className="bg-surface rounded-xl-2 border border-outline p-12 text-center">
          <p className="text-sm text-on-surface-muted">No matches for "{query}".</p>
          <p className="text-xs text-on-surface-subtle mt-1">Try a different word, or clear the search to see everything.</p>
        </div>
      ) : (
        filteredSections.map(section => {
          const SIcon = section.icon;
          return (
            <section key={section.id} id={`how-${section.id}`} className="bg-surface rounded-xl-3 border border-outline shadow-elev-1 overflow-hidden">
              <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-brand-container/30 to-surface">
                <div className="flex items-center gap-2">
                  <SIcon size={18} className="text-brand" />
                  <h2 className="font-display text-xl font-bold tracking-tight text-on-surface">{section.label}</h2>
                </div>
                <p className="text-xs text-on-surface-muted mt-1">{section.blurb}</p>
              </div>
              <div className="divide-y divide-outline">
                {section.cards.map((c, idx) => (
                  <article key={idx} className="px-5 py-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="font-display text-base font-bold text-on-surface">{c.title}</h3>
                        <p className="text-[11px] text-on-surface-subtle mt-0.5 inline-flex items-center gap-1">
                          <ChevronRight size={10} /> {c.page}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {c.whoSees.map(r => {
                          const cfg = ROLE_LABELS[r];
                          return (
                            <span key={r} className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                              style={{ background: cfg.bg, color: cfg.color }}>
                              {cfg.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <p className="text-sm text-on-surface-muted mt-2 leading-relaxed">{c.shows}</p>
                    <div className="mt-3 rounded-lg bg-surface-2/50 border border-outline px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-subtle mb-1.5">How it works</p>
                      <ul className="space-y-1">
                        {c.howItWorks.map((bullet, j) => (
                          <li key={j} className="text-xs text-on-surface flex items-start gap-1.5 leading-snug">
                            <span className="text-accent flex-shrink-0">›</span>
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {c.useIt && (
                      <p className="text-xs text-on-surface-muted mt-2 italic">
                        💡 <span className="font-semibold not-italic">How to use it:</span> {c.useIt}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })
      )}

      {/* Pulse deep-link footer */}
      <div className="rounded-xl-2 border border-accent/30 bg-accent/5 px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-on-surface text-sm">Pulse details deeper than this page goes?</p>
          <p className="text-xs text-on-surface-muted mt-0.5">The Pulse Help page documents every pillar, formula, and improvement tip.</p>
        </div>
        <Link to="/help/pulse"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:opacity-90">
          Open Pulse Help <ChevronRight size={12} />
        </Link>
      </div>
    </div>
  );
}
