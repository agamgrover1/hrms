import { Bell, ChevronDown, LogOut, CheckCircle, Calendar, TrendingUp, FileText, Target, XCircle, Award, Check, Trash2 } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';

interface Props {
  title: string;
}

const TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string }> = {
  leave_applied:          { icon: Calendar,    color: '#d97706', bg: '#fffbeb' },
  leave_approved:         { icon: CheckCircle, color: '#15803d', bg: '#f0fdf4' },
  leave_rejected:         { icon: XCircle,     color: '#dc2626', bg: '#fef2f2' },
  review_added:           { icon: TrendingUp,  color: '#2563eb', bg: '#eff6ff' },
  appraisal_submitted:    { icon: FileText,    color: '#7c3aed', bg: '#f5f3ff' },
  appraisal_reviewed:     { icon: Award,       color: '#EE2770', bg: '#fff0f5' },
  self_assessment_updated:{ icon: Target,      color: '#0891b2', bg: '#f0f9ff' },
  info:                   { icon: CheckCircle, color: '#15803d', bg: '#f0fdf4' },
  review_update:          { icon: TrendingUp,  color: '#2563eb', bg: '#eff6ff' },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function TopBar({ title }: Props) {
  const { user, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifsRef = useRef<HTMLDivElement>(null);

  const unread = notifications.filter(n => !n.is_read).length;

  const fetchNotifications = () => {
    if (!user?.id) return;
    api.getNotifications(user.id)
      .then(setNotifications)
      .catch(() => {});
  };

  useEffect(() => {
    fetchNotifications();
    pollRef.current = setInterval(fetchNotifications, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user?.id]);

  // Close on outside click
  useEffect(() => {
    if (!showNotifs) return;
    const handler = (e: MouseEvent) => {
      if (notifsRef.current && !notifsRef.current.contains(e.target as Node)) {
        setShowNotifs(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNotifs]);

  const handleMarkRead = async (id: number) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    await api.markNotificationRead(id).catch(() => {});
  };

  const handleMarkAll = async () => {
    if (!user?.id) return;
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    await api.markAllNotificationsRead(user.id).catch(() => {});
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
    await api.deleteNotification(id).catch(() => {});
  };

  const handleClearAll = async () => {
    if (!user?.id) return;
    setNotifications([]);
    await api.clearAllNotifications(user.id).catch(() => {});
  };

  const handleBellClick = () => {
    setShowNotifs(v => !v);
    setShowMenu(false);
  };

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center px-6 gap-4 sticky top-0 z-10 shadow-sm">
      <h1 className="text-lg font-bold flex-shrink-0" style={{ color: '#192250' }}>{title}</h1>

      <div className="ml-auto flex items-center gap-3">
        {/* Bell */}
        <div className="relative" ref={notifsRef}>
          <button
            onClick={handleBellClick}
            className="relative p-2 rounded-lg hover:bg-gray-50 transition-colors"
            title="Notifications"
          >
            <Bell size={18} className={unread ? 'text-gray-700' : 'text-gray-400'} />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: '#EE2770' }}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-30 overflow-hidden"
              style={{ maxHeight: '480px' }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-sm" style={{ color: '#192250' }}>Notifications</p>
                  {unread > 0 && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: '#EE2770' }}>
                      {unread}
                    </span>
                  )}
                </div>
                {notifications.length > 0 && (
                  <div className="flex items-center gap-2">
                    {unread > 0 && (
                      <button onClick={handleMarkAll}
                        className="flex items-center gap-1 text-xs font-semibold hover:opacity-70 transition-opacity"
                        style={{ color: '#192250' }}>
                        <Check size={11} /> Mark all read
                      </button>
                    )}
                    <button onClick={handleClearAll}
                      className="flex items-center gap-1 text-xs font-semibold hover:opacity-70 transition-opacity"
                      style={{ color: '#dc2626' }}>
                      <Trash2 size={11} /> Clear all
                    </button>
                  </div>
                )}
              </div>

              {/* List */}
              <div className="overflow-y-auto" style={{ maxHeight: '380px' }}>
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2">
                    <Bell size={28} className="text-gray-200" />
                    <p className="text-sm text-gray-400">You're all caught up!</p>
                  </div>
                ) : (
                  notifications.map(n => {
                    const cfg = TYPE_CONFIG[n.type] ?? { icon: Bell, color: '#6b7280', bg: '#f3f4f6' };
                    const Icon = cfg.icon;
                    return (
                      <div
                        key={n.id}
                        onClick={() => !n.is_read && handleMarkRead(n.id)}
                        className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50/70 transition-colors group"
                        style={!n.is_read ? { background: 'rgba(238,39,112,0.03)' } : {}}
                      >
                        {/* Icon bubble */}
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: cfg.bg }}>
                          <Icon size={16} style={{ color: cfg.color }} />
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold leading-tight"
                              style={{ color: n.is_read ? '#6b7280' : '#192250' }}>
                              {n.title}
                            </p>
                            <button
                              onClick={e => handleDelete(e, n.id)}
                              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0 mt-0.5"
                            >
                              <XCircle size={13} />
                            </button>
                          </div>
                          {n.body && (
                            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>
                          )}
                          <p className="text-[10px] text-gray-300 mt-1 font-medium">{timeAgo(n.created_at)}</p>
                        </div>
                        {/* Unread dot */}
                        {!n.is_read && (
                          <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{ background: '#EE2770' }} />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile menu */}
        <div className="relative">
          <button
            onClick={() => { setShowMenu(!showMenu); setShowNotifs(false); }}
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
