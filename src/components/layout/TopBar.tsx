import { Bell, ChevronDown, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface Props {
  title: string;
}

export default function TopBar({ title }: Props) {
  const { user, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center px-6 gap-4 sticky top-0 z-10 shadow-sm">
      <h1 className="text-lg font-bold flex-shrink-0" style={{ color: '#192250' }}>{title}</h1>

      <div className="ml-auto flex items-center gap-3">
        <button className="relative p-2 rounded-lg hover:bg-gray-50 transition-colors">
          <Bell size={18} className="text-gray-400" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ background: '#EE2770' }} />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ background: '#192250' }}>
              {user?.avatar}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-semibold leading-tight" style={{ color: '#192250' }}>
                {user?.name.split(' ')[0]}
              </p>
              <p className="text-xs text-gray-400">
                {user?.role === 'hr_manager' ? 'HR Manager' : user?.role === 'admin' ? 'Admin' : 'Employee'}
              </p>
            </div>
            <ChevronDown size={14} className="text-gray-400" />
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-2 bg-white border border-gray-100 rounded-xl shadow-lg py-2 w-48 z-20">
                <div className="px-4 py-2 border-b border-gray-50">
                  <p className="text-sm font-semibold" style={{ color: '#192250' }}>{user?.name}</p>
                  <p className="text-xs text-gray-400">{user?.email}</p>
                </div>
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-red-50 transition-colors mt-1"
                  style={{ color: '#EE2770' }}
                >
                  <LogOut size={15} /> Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
