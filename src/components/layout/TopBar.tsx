import { Bell, ChevronDown, LogOut, CheckCircle, Calendar, TrendingUp, FileText, Target, XCircle, Award, Check, Trash2, AlertTriangle, ShieldAlert, KeyRound, Eye, EyeOff, Wrench, Clock as ClockIcon, Search, Megaphone, Sparkles, Menu } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import ThemeToggle from '../ThemeToggle';

// Map notification type + user role → destination route
export function getNotifRoute(type: string, role: string): string {
  const isHR  = role === 'admin' || role === 'hr_manager';
  const isMgr = role === 'employee'; // employees can be managers

  switch (type) {
    // ── Leave ──────────────────────────────────────────────────────────────────
    case 'leave_applied':
      // HR/Admin gets this → Leave Management page
      // Manager (employee role) gets this → My Team pending leaves
      return isHR ? '/leave' : '/my-team?tab=leaves';

    case 'leave_approved':
      // Employee gets this (their own leave was approved)
      return isHR ? '/leave' : '/my?tab=leave';

    case 'leave_rejected':
      // Employee gets this (their own leave was rejected)
      return isHR ? '/leave' : '/my?tab=leave';

    // ── WFH ────────────────────────────────────────────────────────────────────
    case 'wfh_applied':
      // HR/Admin gets this → Leave Management (WFH tab)
      // Manager gets this → My Team pending WFH
      return isHR ? '/leave' : '/my-team?tab=leaves';

    case 'wfh_approved':
      return isHR ? '/leave' : '/my?tab=wfh';

    case 'wfh_rejected':
      return isHR ? '/leave' : '/my?tab=wfh';

    // ── Attendance ─────────────────────────────────────────────────────────────
    case 'attendance_marked':
      return isHR ? '/attendance' : '/my?tab=attendance';

    // ── Performance ────────────────────────────────────────────────────────────
    case 'review_added':
    case 'review_update':
      // Employee receives → their performance tab
      // HR/Admin receives → Performance management page
      return isHR ? '/performance' : '/my?tab=performance';

    case 'appraisal_submitted':
      // HR/Admin receives when employee submits → Performance page
      return isHR ? '/performance' : '/my?tab=performance';

    case 'appraisal_reviewed':
      // Employee receives → their performance tab
      return '/my?tab=performance';

    case 'self_assessment_updated':
      // HR/Admin receives → Performance page
      // Manager receives → My Team performance
      return isHR ? '/performance' : '/my-team?tab=performance';

    // ── Warnings & PIP ─────────────────────────────────────────────────────────
    case 'warning_issued':
      // Employee → their performance tab (warnings shown there)
      // HR/Admin → Employees directory (to see the employee)
      // Manager → also gets this → Employees or My Team
      return isHR ? '/employees' : isMgr ? '/my-team?tab=performance' : '/my?tab=performance';

    case 'pip_assigned':
      return isHR ? '/employees' : '/my?tab=performance';

    // ── Upsell Incentives ──────────────────────────────────────────────────────
    case 'upsell_submitted':
      return isHR ? '/incentives' : '/my?tab=incentives';
    case 'upsell_approved':
    case 'upsell_rejected':
    case 'upsell_paid':
      return '/my?tab=incentives';
    case 'expense_submitted':
      return isHR ? '/incentives' : '/my?tab=expenses';
    case 'expense_approved':
    case 'expense_rejected':
    case 'expense_paid':
      return '/my?tab=expenses';

    // ── IT Repairs ─────────────────────────────────────────────────────────────
    case 'repair_ticket_created':
    case 'repair_approval_needed':
    case 'repair_rejected':
      return isHR ? '/asset-repairs' : '/my?tab=device';
    case 'repair_picked_up':
    case 'repair_returned':
    case 'repair_paid':
    case 'repair_cancelled':
    case 'repair_awaiting_approval':
      return isHR ? '/asset-repairs' : '/my?tab=device';

    // ── Project Hours ──────────────────────────────────────────────────────────
    case 'hours_assigned':
    case 'hours_updated':
    case 'hours_removed':
    case 'hours_approved':
    case 'hours_rejected':
    case 'hours_on_hold':
    case 'hours_comment':
    case 'hours_admin_edited':
      // Personal events → recipient's own My Hours tab.
      // HR/admin only get these as side-effects → master grid.
      // (project_coordinator IS an employee — they go to /my for their own hours.)
      return isHR ? '/hours' : '/my?tab=my-hours';
    case 'hours_logged':
      // Reviewer receives → Approvals queue
      return '/hours/approvals';

    // ── Allocation change requests ─────────────────────────────────────────────
    case 'allocation_request':
    case 'allocation_approved':
    case 'allocation_rejected':
      // Approver side AND requester side both land on the new tab inside
      // the approvals page where the cards live.
      return '/hours/approvals';
    case 'allocation_changed':
      // The affected employee — show them what they're now planned for.
      return isHR ? '/hours' : '/my?tab=my-hours';

    // ── Feature announcements ──────────────────────────────────────────────────
    case 'feature_draft':
      // Pending approval — admin/HR land on the Features management page.
      return '/features';
    case 'feature_published':
      // Everyone — for those who dismissed the popup, the bell click takes
      // them to the management page (admin/HR) or back to dashboard so the
      // popup logic picks it up again. We can revisit once a /whats-new
      // history page exists.
      return isHR ? '/features' : '/';

    // ── Invoices (finance) ─────────────────────────────────────────────────────
    case 'invoice_raised':
    case 'invoice_cleared':
    case 'invoice_adjusted':
    case 'invoice_reopened':
      // Both admin and coordinator land on the Invoices tab of /finance.
      return '/finance?tab=invoices';

    // ── Performance Pulse ──────────────────────────────────────────────────
    case 'pulse_weekly_digest':
      // Self digest — opens own breakdown drawer via Hub
      return '/my?tab=hub';
    case 'pulse_rating_prompt':
      // Manager Monday nudge — opens the Pulse tab on My Team
      return '/my-team?tab=pulse';
    case 'pulse_score_drop':
      // HR/Admin nudge when a report's score slips materially
      return isHR ? '/performance/pulse' : isMgr ? '/my-team?tab=pulse' : '/my?tab=hub';

    // ── General ────────────────────────────────────────────────────────────────
    case 'info':
      return isHR ? '/' : '/my';

    default:
      return isHR ? '/' : '/my';
  }
}

interface Props {
  title: string;
  onMenuClick?: () => void;
}

export const TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string }> = {
  // Leave
  leave_applied:           { icon: Calendar,       color: '#d97706', bg: '#fffbeb' },
  leave_approved:          { icon: CheckCircle,    color: '#15803d', bg: '#f0fdf4' },
  leave_rejected:          { icon: XCircle,        color: '#dc2626', bg: '#fef2f2' },
  // WFH
  wfh_applied:             { icon: Calendar,       color: '#192250', bg: 'rgba(25,34,80,0.06)' },
  wfh_approved:            { icon: CheckCircle,    color: '#15803d', bg: '#f0fdf4' },
  wfh_rejected:            { icon: XCircle,        color: '#dc2626', bg: '#fef2f2' },
  // Performance
  review_added:            { icon: TrendingUp,     color: '#2563eb', bg: '#eff6ff' },
  review_update:           { icon: TrendingUp,     color: '#2563eb', bg: '#eff6ff' },
  appraisal_submitted:     { icon: FileText,       color: '#7c3aed', bg: '#f5f3ff' },
  appraisal_reviewed:      { icon: Award,          color: '#EE2770', bg: '#fff0f5' },
  self_assessment_updated: { icon: Target,         color: '#0891b2', bg: '#f0f9ff' },
  // Warnings & PIP
  warning_issued:          { icon: AlertTriangle,  color: '#d97706', bg: '#fffbeb' },
  pip_assigned:            { icon: ShieldAlert,    color: '#dc2626', bg: '#fef2f2' },
  // Upsell Incentives
  upsell_submitted:        { icon: TrendingUp,     color: '#0d9488', bg: '#f0fdfa' },
  upsell_approved:         { icon: CheckCircle,    color: '#15803d', bg: '#f0fdf4' },
  upsell_rejected:         { icon: XCircle,        color: '#dc2626', bg: '#fef2f2' },
  upsell_paid:             { icon: Award,          color: '#d97706', bg: '#fffbeb' },
  expense_submitted:       { icon: FileText,       color: '#2563eb', bg: '#eff6ff' },
  expense_approved:        { icon: CheckCircle,    color: '#15803d', bg: '#f0fdf4' },
  // IT Repairs
  repair_ticket_created:   { icon: Wrench,         color: '#b45309', bg: '#fffbeb' },
  repair_picked_up:        { icon: Wrench,         color: '#2563eb', bg: '#eff6ff' },
  repair_returned:         { icon: CheckCircle,    color: '#15803d', bg: '#f0fdf4' },
  repair_awaiting_approval:{ icon: AlertTriangle,  color: '#dc2626', bg: '#fef2f2' },
  repair_approval_needed:  { icon: AlertTriangle,  color: '#dc2626', bg: '#fef2f2' },
  repair_paid:             { icon: Award,          color: '#7c3aed', bg: '#f5f3ff' },
  repair_rejected:         { icon: XCircle,        color: '#dc2626', bg: '#fef2f2' },
  repair_cancelled:        { icon: XCircle,        color: '#6b7280', bg: '#f3f4f6' },
  expense_rejected:        { icon: XCircle,        color: '#dc2626', bg: '#fef2f2' },
  expense_paid:            { icon: Award,          color: '#7c3aed', bg: '#f5f3ff' },
  // Project Hours
  hours_assigned:          { icon: ClockIcon,      color: '#2563eb', bg: '#eff6ff' },
  hours_updated:           { icon: ClockIcon,      color: '#0891b2', bg: '#f0f9ff' },
  hours_removed:           { icon: XCircle,        color: '#6b7280', bg: '#f3f4f6' },
  hours_logged:            { icon: FileText,       color: '#7c3aed', bg: '#f5f3ff' },
  hours_approved:          { icon: CheckCircle,    color: '#15803d', bg: '#f0fdf4' },
  hours_rejected:          { icon: XCircle,        color: '#dc2626', bg: '#fef2f2' },
  hours_on_hold:           { icon: ClockIcon,      color: '#7c3aed', bg: '#f5f3ff' },
  hours_comment:           { icon: FileText,       color: '#7c3aed', bg: '#f5f3ff' },
  hours_admin_edited:      { icon: AlertTriangle,  color: '#b45309', bg: '#fffbeb' },
  // Allocation change requests
  allocation_request:      { icon: ClockIcon,      color: '#b45309', bg: '#fffbeb' },
  allocation_approved:     { icon: CheckCircle,    color: '#15803d', bg: '#f0fdf4' },
  allocation_rejected:     { icon: XCircle,        color: '#dc2626', bg: '#fef2f2' },
  allocation_changed:      { icon: AlertTriangle,  color: '#7c3aed', bg: '#f5f3ff' },
  // Feature announcements
  feature_draft:           { icon: Megaphone,      color: '#b45309', bg: '#fffbeb' },
  feature_published:       { icon: Sparkles,       color: '#7c3aed', bg: '#f5f3ff' },
  // Invoices
  invoice_raised:          { icon: FileText,       color: '#2563eb', bg: '#eff6ff' },
  invoice_cleared:         { icon: CheckCircle,    color: '#15803d', bg: '#f0fdf4' },
  invoice_adjusted:        { icon: AlertTriangle,  color: '#d97706', bg: '#fffbeb' },
  invoice_reopened:        { icon: XCircle,        color: '#dc2626', bg: '#fef2f2' },
  // Performance Pulse
  pulse_weekly_digest:     { icon: TrendingUp,     color: '#3730a3', bg: '#eef2ff' },
  pulse_rating_prompt:     { icon: TrendingUp,     color: '#d97706', bg: '#fffbeb' },
  pulse_score_drop:        { icon: AlertTriangle,  color: '#dc2626', bg: '#fef2f2' },
  // General
  info:                    { icon: CheckCircle,    color: '#15803d', bg: '#f0fdf4' },
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

export default function TopBar({ title, onMenuClick }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifsRef = useRef<HTMLDivElement>(null);
  // Live toast queue — anything new since the last poll surfaces as a
  // dismissible card in the top-right. We track the highest notification id
  // ever seen by THIS user (persisted to localStorage so a refresh doesn't
  // re-toast the same items) and only push the delta to the queue.
  const [toasts, setToasts] = useState<any[]>([]);
  const lastSeenIdRef = useRef<number>(0);
  const seededRef = useRef(false);

  const unread = notifications.filter(n => !n.is_read).length;

  const fetchNotifications = () => {
    if (!user?.id) return;
    api.getNotifications(user.id)
      .then(rows => {
        setNotifications(rows);
        // First fetch after sign-in / refresh: just seed the high-water mark
        // so we don't blast a history of unread items as toasts. Subsequent
        // polls compare against this mark.
        const maxId = Math.max(0, ...rows.map((n: any) => Number(n.id) || 0));
        if (!seededRef.current) {
          // Restore the last-seen id from localStorage if present so a tab
          // refresh while signed in doesn't replay everything.
          const stored = Number(localStorage.getItem(`notif_seen_${user.id}`) || 0);
          lastSeenIdRef.current = Math.max(stored, maxId);
          seededRef.current = true;
          return;
        }
        const fresh = rows.filter((n: any) => Number(n.id) > lastSeenIdRef.current);
        if (fresh.length) {
          // Newest-first in the toast stack so the latest reads on top.
          setToasts(prev => [...fresh.reverse(), ...prev].slice(0, 4));
          lastSeenIdRef.current = maxId;
          try { localStorage.setItem(`notif_seen_${user.id}`, String(maxId)); } catch { /* quota */ }
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchNotifications();
    pollRef.current = setInterval(fetchNotifications, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user?.id]);

  // Per-toast dismiss + auto-dismiss after 7s. Click-to-navigate uses the
  // same link logic as the bell so it always opens the right place.
  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));
  useEffect(() => {
    if (toasts.length === 0) return;
    const id = toasts[0].id;
    const timer = setTimeout(() => dismissToast(id), 7000);
    return () => clearTimeout(timer);
  }, [toasts]);

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
    <>
    <header className="h-16 bg-surface border-b border-outline flex items-center px-3 sm:px-6 gap-2 sm:gap-4 sticky top-0 z-30 shadow-elev-1">
      {/* Mobile hamburger — flips the parent Layout's mobileSidebarOpen */}
      {onMenuClick && (
        <button onClick={onMenuClick}
          className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-surface-2 text-on-surface flex-shrink-0"
          aria-label="Open menu">
          <Menu size={20} />
        </button>
      )}
      <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-on-surface flex-shrink-0 truncate">{title}</h1>

      {/* Command palette trigger — synthesizes ⌘K so CommandPalette picks
          it up. Full pill on sm+, icon-only on phones to save space. */}
      <button
        onClick={() => {
          const key = navigator.platform.toLowerCase().includes('mac') ? { metaKey: true } : { ctrlKey: true };
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ...key, bubbles: true }));
        }}
        className="hidden sm:flex items-center gap-2 px-3 py-1.5 ml-2 rounded-full text-xs text-on-surface-muted bg-surface-2 hover:bg-surface-3 border border-outline transition-colors min-w-[200px] max-w-[280px]"
        title="Search (⌘K)"
      >
        <Search size={13} strokeWidth={2} />
        <span className="flex-1 text-left">Search anything…</span>
        <kbd className="font-mono text-[10px] font-semibold bg-surface border border-outline px-1.5 py-0.5 rounded">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {/* Theme toggle */}
        <ThemeToggle />

        {/* Bell */}
        <div className="relative" ref={notifsRef}>
          <button
            onClick={handleBellClick}
            className="relative p-2 rounded-full hover:bg-surface-2 transition-colors"
            title="Notifications"
          >
            <Bell size={18} className={unread ? 'text-on-surface' : 'text-on-surface-muted'} />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: '#EE2770' }}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-surface rounded-2xl shadow-elev-3 border border-outline z-30 overflow-hidden"
              style={{ maxHeight: '480px' }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-outline">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-sm text-on-surface">Notifications</p>
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
                        className="flex items-center gap-1 text-xs font-semibold text-on-surface-muted hover:text-on-surface transition-colors">
                        <Check size={11} /> Mark all read
                      </button>
                    )}
                    <button onClick={handleClearAll}
                      className="flex items-center gap-1 text-xs font-semibold text-danger hover:opacity-70 transition-opacity">
                      <Trash2 size={11} /> Clear all
                    </button>
                  </div>
                )}
              </div>

              {/* List */}
              <div className="overflow-y-auto" style={{ maxHeight: '380px' }}>
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2">
                    <Bell size={28} className="text-on-surface-subtle" />
                    <p className="text-sm text-on-surface-muted">You're all caught up!</p>
                  </div>
                ) : (
                  notifications.map(n => {
                    const cfg = TYPE_CONFIG[n.type] ?? { icon: Bell, color: '#6b7280', bg: '#f3f4f6' };
                    const Icon = cfg.icon;
                    return (
                      <div
                        key={n.id}
                        onClick={() => {
                          if (!n.is_read) handleMarkRead(n.id);
                          // Per-notification link wins when present (carries
                          // a specific entity id, e.g. hours_comment deep-
                          // linking to the right log + auto-opening the
                          // discussion modal). Falls back to the role-based
                          // type → route map otherwise.
                          const route = (n as any).link || getNotifRoute(n.type, user?.role ?? '');
                          setShowNotifs(false);
                          navigate(route);
                        }}
                        className="flex items-start gap-3 px-4 py-3 border-b border-outline cursor-pointer hover:bg-surface-2 transition-colors group"
                        style={!n.is_read ? { background: 'rgb(var(--accent) / 0.04)' } : {}}
                      >
                        {/* Icon bubble */}
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: cfg.bg }}>
                          <Icon size={16} style={{ color: cfg.color }} />
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm font-semibold leading-tight ${n.is_read ? 'text-on-surface-muted' : 'text-on-surface'}`}>
                              {n.title}
                            </p>
                            <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                              <ChevronDown size={11} className="text-on-surface-subtle -rotate-90 group-hover:text-on-surface-muted transition-colors" />
                              <button onClick={e => handleDelete(e, n.id)}
                                className="opacity-0 group-hover:opacity-100 text-on-surface-subtle hover:text-danger transition-all">
                                <XCircle size={13} />
                              </button>
                            </div>
                          </div>
                          {n.body && (
                            <p className="text-xs text-on-surface-muted mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>
                          )}
                          <p className="text-[10px] text-on-surface-subtle mt-1 font-medium">{timeAgo(n.created_at)}</p>
                        </div>
                        {/* Unread dot */}
                        {!n.is_read && (
                          <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2 bg-accent" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              {/* Footer: link to full notifications page */}
              <div className="border-t border-outline px-3 py-2 bg-surface-2/40">
                <button onClick={() => { setShowNotifs(false); navigate('/notifications'); }}
                  className="w-full text-center text-xs font-semibold text-accent hover:underline">
                  View all notifications →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Profile menu */}
        <div className="relative">
          <button
            onClick={() => { setShowMenu(!showMenu); setShowNotifs(false); }}
            className="flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-full hover:bg-surface-2 transition-colors border border-outline"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-on-brand text-xs font-bold bg-brand">
              {user?.avatar}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-semibold leading-tight text-on-surface">
                {user?.name.split(' ')[0]}
              </p>
              <p className="text-xs text-on-surface-muted">
                {user?.role === 'hr_manager' ? 'HR Manager'
                  : user?.role === 'admin' ? 'Admin'
                  : user?.role === 'project_coordinator' ? 'Project Coord.'
                  : 'Employee'}
              </p>
            </div>
            <ChevronDown size={14} className="text-on-surface-muted" />
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-2 bg-surface border border-outline rounded-2xl shadow-elev-3 py-2 w-52 z-20">
                <div className="px-4 py-2 border-b border-outline">
                  <p className="text-sm font-semibold text-on-surface">{user?.name}</p>
                  <p className="text-xs text-on-surface-muted truncate">{user?.email}</p>
                </div>
                <button
                  onClick={() => { setShowMenu(false); setPwForm({ current: '', next: '', confirm: '' }); setPwError(''); setPwSuccess(false); setShowChangePw(true); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-surface-2 transition-colors mt-1 text-on-surface"
                >
                  <KeyRound size={15} className="text-on-surface-muted" /> Change Password
                </button>
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent-container transition-colors text-accent"
                >
                  <LogOut size={15} /> Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>

    {/* ── Change Password Modal ─────────────────────────────────────────────── */}
    {showChangePw && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(25,34,80,0.08)' }}>
                <KeyRound size={15} style={{ color: '#192250' }} />
              </div>
              <p className="font-bold text-sm" style={{ color: '#192250' }}>Change Password</p>
            </div>
            <button onClick={() => setShowChangePw(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <XCircle size={16} className="text-gray-400" />
            </button>
          </div>

          {/* Form */}
          <div className="p-6 space-y-4">
            {pwSuccess ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                  <Check size={22} className="text-green-600" />
                </div>
                <p className="font-semibold text-gray-800">Password changed!</p>
                <p className="text-xs text-gray-400 text-center">Your password has been updated successfully.</p>
                <button onClick={() => setShowChangePw(false)}
                  className="mt-2 px-5 py-2 text-sm font-semibold text-white rounded-xl"
                  style={{ background: '#192250' }}>Done</button>
              </div>
            ) : (
              <>
                {(['current','next','confirm'] as const).map((field, idx) => {
                  const labels = { current: 'Current Password', next: 'New Password', confirm: 'Confirm New Password' };
                  return (
                    <div key={field}>
                      <label className="text-xs font-semibold text-gray-500 block mb-1.5">{labels[field]}</label>
                      <div className="relative">
                        <input
                          type={showPw[field] ? 'text' : 'password'}
                          value={pwForm[field]}
                          onChange={e => { setPwForm(f => ({ ...f, [field]: e.target.value })); setPwError(''); }}
                          placeholder={idx === 0 ? 'Enter current password' : idx === 1 ? 'Min. 6 characters' : 'Re-enter new password'}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-primary-200"
                        />
                        <button type="button"
                          onClick={() => setShowPw(p => ({ ...p, [field]: !p[field] }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showPw[field] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {pwError && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <AlertTriangle size={12} /> {pwError}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button onClick={() => setShowChangePw(false)}
                    className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button
                    disabled={savingPw || !pwForm.current || !pwForm.next || !pwForm.confirm}
                    onClick={async () => {
                      if (pwForm.next !== pwForm.confirm) { setPwError('New passwords do not match'); return; }
                      if (pwForm.next.length < 6) { setPwError('New password must be at least 6 characters'); return; }
                      if (pwForm.next === pwForm.current) { setPwError('New password must be different from current password'); return; }
                      setSavingPw(true); setPwError('');
                      try {
                        await api.changePassword(user!.id, pwForm.current, pwForm.next);
                        setPwSuccess(true);
                      } catch (err: any) {
                        setPwError(err.message ?? 'Failed to change password');
                      } finally { setSavingPw(false); }
                    }}
                    className="flex-1 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #192250 0%, #141c43 100%)' }}>
                    {savingPw ? 'Updating…' : 'Update Password'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Live notification toasts. Stack in the top-right beneath the bell.
        Click jumps to the same destination the bell would; auto-dismiss
        after 7s, or × to close immediately. Limited to 4 visible so a
        sudden burst doesn't fill the screen. */}
    {toasts.length > 0 && (
      <div className="fixed top-20 right-6 z-[70] flex flex-col gap-2 w-80 max-w-[calc(100vw-3rem)] pointer-events-none">
        {toasts.map(n => {
          const cfg = TYPE_CONFIG[n.type] ?? { icon: Bell, color: '#6b7280', bg: '#f3f4f6' };
          const TIcon = cfg.icon;
          const route = n.link || getNotifRoute(n.type, user?.role ?? '');
          return (
            <div key={n.id}
              onClick={() => {
                if (!n.is_read) handleMarkRead(n.id);
                dismissToast(n.id);
                navigate(route);
              }}
              className="pointer-events-auto bg-surface rounded-xl-2 border border-outline shadow-elev-3 p-3 flex items-start gap-3 cursor-pointer hover:shadow-elev-4 transition-shadow animate-fade-up">
              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: cfg.bg, color: cfg.color }}>
                <TIcon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-on-surface truncate">{n.title}</p>
                {n.body && <p className="text-xs text-on-surface-muted mt-0.5 line-clamp-2">{n.body}</p>}
              </div>
              <button onClick={(e) => { e.stopPropagation(); dismissToast(n.id); }}
                className="text-on-surface-subtle hover:text-on-surface p-0.5 flex-shrink-0" aria-label="Dismiss">
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    )}
    </>
  );
}
