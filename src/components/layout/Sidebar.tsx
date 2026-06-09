import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clock3, CalendarDays, Wallet, Sparkles,
  ChevronLeft, ChevronRight, UserCog, User, SlidersHorizontal, TrendingUp, Wrench,
  Briefcase, ClipboardCheck, Layers, LineChart, AlertTriangle, Activity, type LucideIcon,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';

type NavItem = { to: string; icon: LucideIcon; label: string; end?: boolean };
type NavGroup = { id: string; label: string; items: NavItem[] };

const workspaceGroup: NavGroup = {
  id: 'workspace',
  label: 'Workspace',
  items: [
    { to: '/', icon: LayoutDashboard, label: 'Overview', end: true },
    { to: '/employees', icon: Users, label: 'People' },
    { to: '/attendance', icon: Clock3, label: 'Attendance' },
    { to: '/leave', icon: CalendarDays, label: 'Time off' },
  ],
};

const opsGroup: NavGroup = {
  id: 'ops',
  label: 'Operations',
  items: [
    { to: '/payroll', icon: Wallet, label: 'Payroll' },
    { to: '/performance', icon: Sparkles, label: 'Performance' },
    { to: '/performance/pulse', icon: Activity, label: 'Pulse (auto)' },
    { to: '/incentives', icon: TrendingUp, label: 'Finance' },
    { to: '/asset-repairs', icon: Wrench, label: 'IT & Repairs' },
  ],
};

const projectGroup: NavGroup = {
  id: 'projects',
  label: 'Project Mgmt',
  items: [
    { to: '/projects', icon: Briefcase, label: 'Projects' },
    { to: '/hours', icon: Layers, label: 'Hours grid' },
    { to: '/hours/compliance', icon: AlertTriangle, label: 'Compliance' },
    { to: '/hours/utilization', icon: Activity, label: 'Utilization' },
    { to: '/hours/approvals', icon: ClipboardCheck, label: 'Approvals' },
  ],
};

const financeGroup: NavGroup = {
  id: 'finance',
  label: 'Finance (Admin)',
  items: [
    { to: '/finance', icon: LineChart, label: 'Profitability' },
  ],
};

// Coordinators get a single Invoices link instead of the full Finance suite —
// they raise invoices but can't see profitability, salaries, overhead, etc.
const coordFinanceGroup: NavGroup = {
  id: 'finance-coord',
  label: 'Finance',
  items: [
    { to: '/finance?tab=invoices', icon: LineChart, label: 'Invoices' },
  ],
};

const settingsGroup: NavGroup = {
  id: 'settings',
  label: 'Settings',
  items: [
    { to: '/users', icon: UserCog, label: 'User mgmt' },
    { to: '/config', icon: SlidersHorizontal, label: 'Configuration' },
  ],
};

const ROLE_PILL: Record<string, { label: string; bg: string; color: string }> = {
  admin:               { label: 'Admin',         bg: 'rgba(255,109,168,0.18)', color: '#ffd7e4' },
  hr_manager:          { label: 'HR Manager',    bg: 'rgba(174,184,232,0.18)', color: '#dae0fa' },
  project_coordinator: { label: 'Project Coord.', bg: 'rgba(103,232,249,0.16)', color: '#a5f3fc' },
  employee:            { label: 'Employee',      bg: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' },
};

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [isProjectReviewer, setIsProjectReviewer] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  const role = user?.role ?? 'employee';

  const isEmployee = role === 'employee';
  const isCoord = role === 'project_coordinator';
  const isAdminLike = role === 'admin' || role === 'hr_manager';

  // Is this user a project lead (project_lead_id) on any active project?
  // Same gate as project reviewer — both relationships should unlock the
  // Mine tab on /hours.
  const [isProjectLead, setIsProjectLead] = useState(false);

  useEffect(() => {
    const showPersonal = isEmployee || isCoord;
    if (!showPersonal || !user?.employee_id_ref) return;
    api.getEmployees()
      .then(emps => {
        const emp = emps.find((e: any) => e.employee_id === user.employee_id_ref);
        if (!emp) return;
        api.getTeamMembers(emp.id)
          .then((members: any[]) => setIsManager(members.length > 0))
          .catch(() => {});
        api.getProjects({ status: 'active' })
          .then((projs: any[]) => {
            setIsProjectReviewer(projs.some(p => p.project_reporting_id === emp.id));
            setIsProjectLead(projs.some(p => p.project_lead_id === emp.id));
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, [user?.employee_id_ref, isEmployee, isCoord]);

  const isTeamLead = isProjectReviewer || isProjectLead;

  // Build the set of groups visible to this role.
  // HR is people-ops only — they don't need Project Mgmt (Projects / Hours
  // grid / Approvals / Compliance), so it's gated behind admin only here.
  // HR also has a personal portal (they're employees too).
  const groups: NavGroup[] = [];
  if (isAdminLike) {
    groups.push(workspaceGroup, opsGroup);
    if (role === 'admin') groups.push(projectGroup);
    if (role === 'admin') groups.push(financeGroup); // admin-only finance module
    groups.push(settingsGroup);
  } else if (isCoord) {
    // Coord sees Project Mgmt + Invoices + their own personal nav (rendered below)
    groups.push(projectGroup);
    groups.push(coordFinanceGroup);
  }

  // Personal nav — everyone with an employee profile (including admin) gets
  // a "You" section, so they can log internal hours and see their own pulse.
  const showPersonal = isEmployee || isCoord || role === 'hr_manager' || role === 'admin';
  const personalGroup: NavGroup | null = showPersonal ? {
    id: 'personal',
    label: 'You',
    items: [
      { to: '/my', icon: User, label: 'My portal', end: true },
      ...(isManager ? [{ to: '/my-team', icon: Users, label: 'My team' } as NavItem] : []),
      // Team leads (project_reporting OR project_lead on any project) need to see
      // all the projects they own, not just hours from their direct reports.
      // /hours's Mine tab is the right view for that.
      ...(isEmployee && isTeamLead ? [{ to: '/hours', icon: Briefcase, label: 'My projects', end: true } as NavItem] : []),
      // Managers (anyone with reports) can check who in their team hasn't logged today.
      ...(isManager ? [{ to: '/hours/compliance', icon: AlertTriangle, label: 'Team compliance' } as NavItem] : []),
      ...(isManager ? [{ to: '/hours/utilization', icon: Activity, label: 'Team utilization' } as NavItem] : []),
      ...(isEmployee && isProjectReviewer ? [{ to: '/hours/approvals', icon: ClipboardCheck, label: 'Approvals', end: true } as NavItem] : []),
    ],
  } : null;
  if (personalGroup) groups.push(personalGroup);

  const rolePill = ROLE_PILL[role] ?? ROLE_PILL.employee;

  return (
    <aside
      className={`${collapsed ? 'w-[72px]' : 'w-64'} transition-all duration-300 flex flex-col min-h-screen flex-shrink-0 relative isolate`}
      style={{
        background: 'linear-gradient(180deg, #0d122b 0%, #141c43 45%, #192250 100%)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Subtle aurora glow at the top */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-48 pointer-events-none -z-10"
        style={{
          background: 'radial-gradient(circle at 30% 0%, rgba(238,39,112,0.18) 0%, transparent 55%), radial-gradient(circle at 80% 10%, rgba(174,184,232,0.12) 0%, transparent 50%)',
        }}
      />

      {/* Logo */}
      <div className={`flex items-center px-4 pt-5 pb-4 ${collapsed ? 'justify-center px-2' : ''}`}>
        {collapsed ? (
          <img src="/favicon.png" alt="Digital Leap" className="w-9 h-9 object-contain flex-shrink-0" />
        ) : (
          <img src="/logo.png" alt="Digital Leap Marketing Solutions" className="h-10 object-contain" style={{ maxWidth: '180px' }} />
        )}
      </div>

      {/* User card */}
      {user && !collapsed && (
        <div className="mx-3 mb-3 px-3 py-3 rounded-xl-2"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold"
              style={{ background: 'linear-gradient(135deg, #EE2770 0%, #c01660 100%)', boxShadow: '0 4px 14px rgba(238,39,112,0.35)' }}>
              {user.avatar || user.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate font-display tracking-tight leading-tight">{user.name?.split(' ')[0]}</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-white/45 truncate mt-0.5">{user.employee_id_ref || 'no id'}</p>
            </div>
          </div>
          <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide"
            style={{ background: rolePill.bg, color: rolePill.color }}>
            {rolePill.label}
          </span>
        </div>
      )}
      {user && collapsed && (
        <div className="mb-2 flex items-center justify-center">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold"
            style={{ background: 'linear-gradient(135deg, #EE2770 0%, #c01660 100%)' }}>
            {user.avatar || user.name?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-2 overflow-y-auto space-y-3" style={{ scrollbarWidth: 'thin' }}>
        {groups.map(group => (
          <SidebarGroup key={group.id} group={group} collapsed={collapsed} pathname={location.pathname} />
        ))}
      </nav>

      {/* Bottom: collapse + version */}
      <div className="px-2 pb-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-white/40 hover:text-white/70 hover:bg-white/5 transition-all w-full ${collapsed ? 'justify-center' : ''}`}>
          {collapsed ? <ChevronRight size={16} strokeWidth={1.75} /> : <><ChevronLeft size={16} strokeWidth={1.75} /><span>Collapse</span></>}
        </button>
        {!collapsed && (
          <p className="text-[10px] text-white/25 text-center mt-2 font-mono tracking-wider">DL · HRMS · v1.0</p>
        )}
      </div>
    </aside>
  );
}

function SidebarGroup({ group, collapsed, pathname }: { group: NavGroup; collapsed: boolean; pathname: string }) {
  // Track the active item index for the morphing pill background.
  // Pick the LONGEST prefix match so that on `/hours/approvals`, the
  // "Approvals" item wins over the parent "Hours grid" (/hours) — otherwise
  // findIndex would return the first match in array order and highlight
  // the wrong row. Exact (end:true) matches are still required to be exact.
  const containerRef = useRef<HTMLDivElement>(null);
  const activeIndex = (() => {
    let bestIdx = -1;
    let bestLen = -1;
    group.items.forEach((item, idx) => {
      const matches = item.end
        ? pathname === item.to
        : pathname === item.to || pathname.startsWith(item.to + '/');
      if (matches && item.to.length > bestLen) {
        bestIdx = idx;
        bestLen = item.to.length;
      }
    });
    return bestIdx;
  })();

  return (
    <div ref={containerRef}>
      {!collapsed && (
        <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35 font-display">
          {group.label}
        </p>
      )}
      <div className="space-y-0.5">
        {group.items.map((item, i) => {
          const Icon = item.icon;
          const active = i === activeIndex;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={`relative flex items-center gap-3 rounded-xl text-sm transition-all duration-200 group
                ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2'}
                ${active
                  ? 'text-white font-semibold'
                  : 'text-white/60 hover:text-white hover:bg-white/[0.04] font-medium'}`}
              style={active ? {
                background: 'linear-gradient(90deg, rgba(238,39,112,0.22) 0%, rgba(238,39,112,0.06) 100%)',
                boxShadow: 'inset 2px 0 0 #EE2770, 0 1px 0 rgba(255,255,255,0.04)',
              } : {}}
            >
              <Icon
                size={18}
                strokeWidth={active ? 2 : 1.75}
                className={`flex-shrink-0 transition-transform duration-200 ${active ? 'scale-110' : 'group-hover:scale-105'}`}
                style={{ color: active ? '#ff75b0' : undefined }}
              />
              {!collapsed && (
                <span className="font-display tracking-tight leading-none">
                  {item.label}
                </span>
              )}
              {active && !collapsed && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" style={{ background: '#EE2770', boxShadow: '0 0 8px #EE2770' }} />
              )}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
