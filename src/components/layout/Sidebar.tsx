import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clock, Calendar, DollarSign, Target,
  ChevronLeft, ChevronRight, Building2, UserCog, User, Settings
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const allNavItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'hr_manager'] },
  { to: '/employees', icon: Users, label: 'Employees', roles: ['admin', 'hr_manager'] },
  { to: '/attendance', icon: Clock, label: 'Attendance', roles: ['admin', 'hr_manager'] },
  { to: '/leave', icon: Calendar, label: 'Leave', roles: ['admin', 'hr_manager'] },
  { to: '/payroll', icon: DollarSign, label: 'Payroll', roles: ['admin', 'hr_manager'] },
  { to: '/performance', icon: Target, label: 'Performance', roles: ['admin', 'hr_manager'] },
  { to: '/users', icon: UserCog, label: 'User Management', roles: ['admin', 'hr_manager'] },
  { to: '/config', icon: Settings, label: 'Configuration', roles: ['admin', 'hr_manager'] },
  { to: '/my', icon: User, label: 'My Portal', roles: ['employee'] },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const role = user?.role ?? 'employee';

  const navItems = allNavItems.filter(item => item.roles.includes(role));

  return (
    <div
      className={`${collapsed ? 'w-16' : 'w-60'} transition-all duration-300 flex flex-col min-h-screen flex-shrink-0`}
      style={{ background: 'linear-gradient(180deg, #192250 0%, #141c43 100%)' }}
    >
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 ${collapsed ? 'justify-center' : ''}`}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: '#EE2770' }}>
          <Building2 size={16} className="text-white" />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <p className="font-bold text-white text-sm tracking-wide">Digital Leap</p>
            <p className="text-xs font-semibold" style={{ color: '#EE2770' }}>HRMS</p>
          </div>
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
      <nav className="flex-1 py-4 px-2 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group relative
              ${collapsed ? 'justify-center' : ''}
              ${isActive ? 'text-white' : 'text-white/50 hover:text-white/80'}`
            }
            style={({ isActive }) => isActive ? {
              background: 'rgba(238,39,112,0.18)',
              boxShadow: 'inset 3px 0 0 #EE2770',
            } : {}}
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={18}
                  style={{ color: isActive ? '#EE2770' : undefined }}
                  className={isActive ? '' : 'group-hover:text-white/80 transition-colors'}
                />
                {!collapsed && <span>{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 pb-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/40 hover:text-white/70 hover:bg-white/5 transition-all w-full ${collapsed ? 'justify-center' : ''}`}
        >
          {collapsed ? <ChevronRight size={18} /> : <><ChevronLeft size={18} /><span>Collapse</span></>}
        </button>
      </div>
    </div>
  );
}
