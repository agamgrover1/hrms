import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clock, Calendar, DollarSign, Target,
  ChevronLeft, ChevronRight, Building2, UserCog, User
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
  { to: '/my', icon: User, label: 'My Portal', roles: ['employee'] },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const role = user?.role ?? 'employee';

  const navItems = allNavItems.filter(item => item.roles.includes(role));

  return (
    <div className={`${collapsed ? 'w-16' : 'w-60'} transition-all duration-300 flex flex-col bg-white border-r border-gray-100 shadow-sm min-h-screen flex-shrink-0`}>
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-gray-100 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center flex-shrink-0">
          <Building2 size={16} className="text-white" />
        </div>
        {!collapsed && <span className="font-bold text-lg text-gray-900 tracking-tight">Digital Leap HRMS</span>}
      </div>

      {!collapsed && (
        <div className="px-4 py-2 border-b border-gray-100">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize
            ${role === 'admin' ? 'bg-red-50 text-red-600' : role === 'hr_manager' ? 'bg-primary-50 text-primary-600' : 'bg-gray-100 text-gray-500'}
          `}>
            {role === 'hr_manager' ? 'HR Manager' : role.charAt(0).toUpperCase() + role.slice(1)}
          </span>
        </div>
      )}

      <nav className="flex-1 py-4 px-2 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group
              ${isActive ? 'bg-primary-50 text-primary-600' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'}
              ${collapsed ? 'justify-center' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} className={isActive ? 'text-primary-600' : 'text-gray-400 group-hover:text-gray-600'} />
                {!collapsed && <span>{label}</span>}
                {!collapsed && isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-500" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-2 pb-4 space-y-1 border-t border-gray-100 pt-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 transition-all w-full ${collapsed ? 'justify-center' : ''}`}
        >
          {collapsed ? <ChevronRight size={18} /> : <><ChevronLeft size={18} /><span>Collapse</span></>}
        </button>
      </div>
    </div>
  );
}
