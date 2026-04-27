import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clock, Calendar, DollarSign, Target,
  ChevronLeft, ChevronRight, UserCog, User, Settings, ChevronDown,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';

const adminNavItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/employees', icon: Users, label: 'Employees' },
  { to: '/attendance', icon: Clock, label: 'Attendance' },
  { to: '/leave', icon: Calendar, label: 'Leave' },
  { to: '/payroll', icon: DollarSign, label: 'Payroll' },
  { to: '/performance', icon: Target, label: 'Performance' },
  { to: '/users', icon: UserCog, label: 'User Management' },
  { to: '/config', icon: Settings, label: 'Configuration' },
];

// My Team sub-items for managers (employee role)
const teamSubItems = [
  { to: '/my-team', label: 'Leaves', icon: Calendar, search: '?tab=leaves' },
  { to: '/my-team', label: 'Performance', icon: Target, search: '?tab=performance' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [teamOpen, setTeamOpen] = useState(true);
  const [isManager, setIsManager] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  const role = user?.role ?? 'employee';

  const isEmployee = role === 'employee';
  const isOnTeam = location.pathname === '/my-team';

  // Determine if this employee manages anyone (has direct reports)
  useEffect(() => {
    if (!isEmployee || !user?.employee_id_ref) return;
    api.getEmployees()
      .then(emps => {
        const emp = emps.find((e: any) => e.employee_id === user.employee_id_ref);
        if (!emp) return;
        api.getTeamMembers(emp.id)
          .then((members: any[]) => setIsManager(members.length > 0))
          .catch(() => {});
      })
      .catch(() => {});
  }, [user?.employee_id_ref, isEmployee]);

  const navLinkClass = (isActive: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group
    ${collapsed ? 'justify-center' : ''}
    ${isActive ? 'text-white' : 'text-white/50 hover:text-white/80'}`;

  const navLinkStyle = (isActive: boolean) => isActive ? {
    background: 'rgba(238,39,112,0.18)',
    boxShadow: 'inset 3px 0 0 #EE2770',
  } : {};

  return (
    <div
      className={`${collapsed ? 'w-16' : 'w-60'} transition-all duration-300 flex flex-col min-h-screen flex-shrink-0`}
      style={{ background: 'linear-gradient(180deg, #192250 0%, #141c43 100%)' }}
    >
      {/* Logo */}
      <div className={`flex items-center px-3 py-3 ${collapsed ? 'justify-center' : ''}`}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {collapsed ? (
          <img src="/favicon.png" alt="Digital Leap" className="w-9 h-9 object-contain flex-shrink-0" />
        ) : (
          <img src="/logo.png" alt="Digital Leap Marketing Solutions" className="h-10 object-contain" style={{ maxWidth: '180px' }} />
        )}
      </div>

      {/* Role badge */}
      {!collapsed && (
        <div className="px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{
              background: role === 'admin' ? 'rgba(238,39,112,0.2)' : 'rgba(255,255,255,0.1)',
              color: role === 'admin' ? '#ff75b0' : 'rgba(255,255,255,0.6)',
            }}>
            {role === 'hr_manager' ? 'HR Manager' : role.charAt(0).toUpperCase() + role.slice(1)}
          </span>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-0.5 overflow-y-auto">

        {/* Admin / HR routes */}
        {!isEmployee && adminNavItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) => navLinkClass(isActive)}
            style={({ isActive }) => navLinkStyle(isActive)}>
            {({ isActive }) => (
              <>
                <Icon size={18} style={{ color: isActive ? '#EE2770' : undefined }} />
                {!collapsed && <span>{label}</span>}
              </>
            )}
          </NavLink>
        ))}

        {/* Employee routes */}
        {isEmployee && (
          <>
            {/* My Portal */}
            <NavLink to="/my" end
              className={({ isActive }) => navLinkClass(isActive)}
              style={({ isActive }) => navLinkStyle(isActive)}>
              {({ isActive }) => (
                <>
                  <User size={18} style={{ color: isActive ? '#EE2770' : undefined }} />
                  {!collapsed && <span>My Portal</span>}
                </>
              )}
            </NavLink>

            {/* My Team — only shown if this employee manages others */}
            {isManager && <div>
              {/* Section header button */}
              <button
                onClick={() => !collapsed && setTeamOpen(v => !v)}
                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                  ${collapsed ? 'justify-center' : 'justify-between'}
                  ${isOnTeam ? 'text-white' : 'text-white/50 hover:text-white/80'}`}
                style={isOnTeam ? { background: 'rgba(238,39,112,0.12)' } : {}}>
                <div className="flex items-center gap-3">
                  <Users size={18} style={{ color: isOnTeam ? '#EE2770' : undefined }} />
                  {!collapsed && <span>My Team</span>}
                </div>
                {!collapsed && (
                  <ChevronDown size={14}
                    className={`transition-transform text-white/40 ${teamOpen ? 'rotate-180' : ''}`} />
                )}
              </button>

              {/* Sub-items */}
              {!collapsed && teamOpen && (
                <div className="mt-0.5 ml-3 pl-5 space-y-0.5"
                  style={{ borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
                  <NavLink to="/my-team?tab=leaves"
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all
                      ${location.search === '?tab=leaves' || (!location.search && isOnTeam)
                        ? 'text-white' : 'text-white/45 hover:text-white/75'}`}
                    style={location.search === '?tab=leaves' || (!location.search && isOnTeam)
                      ? { background: 'rgba(238,39,112,0.15)', color: '#ff75b0' } : {}}>
                    <Calendar size={13} /> Leaves
                  </NavLink>
                  <NavLink to="/my-team?tab=performance"
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all
                      ${location.search === '?tab=performance'
                        ? 'text-white' : 'text-white/45 hover:text-white/75'}`}
                    style={location.search === '?tab=performance'
                      ? { background: 'rgba(238,39,112,0.15)', color: '#ff75b0' } : {}}>
                    <Target size={13} /> Performance
                  </NavLink>
                </div>
              )}
            </div>}
          </>
        )}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 pb-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/40 hover:text-white/70 hover:bg-white/5 transition-all w-full ${collapsed ? 'justify-center' : ''}`}>
          {collapsed ? <ChevronRight size={18} /> : <><ChevronLeft size={18} /><span>Collapse</span></>}
        </button>
      </div>
    </div>
  );
}
