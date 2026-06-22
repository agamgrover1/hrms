import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, ArrowRight, LayoutDashboard, Users, Clock3, CalendarDays, Wallet,
  Sparkles, UserCog, SlidersHorizontal, TrendingUp, Wrench, Briefcase,
  ClipboardCheck, Layers, User, KeyRound, LogOut, Sun, Moon, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../services/api';

interface Item {
  id: string;
  label: string;
  hint?: string;
  group: 'Pages' | 'Quick actions' | 'People' | 'Theme' | 'Account';
  icon: LucideIcon;
  action: () => void;
  /** Visibility filter — restrict to specific roles */
  roles?: string[];
}

export default function CommandPalette() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [employees, setEmployees] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Listen for ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Lazy-load employees the first time the palette opens (for People search)
  useEffect(() => {
    if (open && employees.length === 0) {
      api.getEmployees().then(setEmployees).catch(() => {});
    }
  }, [open, employees.length]);

  const role = user?.role ?? 'employee';

  const allItems: Item[] = useMemo(() => {
    const items: Item[] = [
      // Pages — admin / HR
      { id: 'p-dash', label: 'Dashboard', hint: 'Overview', group: 'Pages', icon: LayoutDashboard, action: () => navigate('/'), roles: ['admin', 'hr_manager'] },
      { id: 'p-emp',  label: 'Employees', hint: 'People directory', group: 'Pages', icon: Users, action: () => navigate('/employees'), roles: ['admin', 'hr_manager'] },
      { id: 'p-att',  label: 'Attendance', hint: 'Monthly + biometric', group: 'Pages', icon: Clock3, action: () => navigate('/attendance'), roles: ['admin', 'hr_manager'] },
      { id: 'p-lv',   label: 'Leave Management', hint: 'Approve requests', group: 'Pages', icon: CalendarDays, action: () => navigate('/leave'), roles: ['admin', 'hr_manager'] },
      { id: 'p-pay',  label: 'Payroll', group: 'Pages', icon: Wallet, action: () => navigate('/payroll'), roles: ['admin', 'hr_manager'] },
      { id: 'p-perf', label: 'Performance', group: 'Pages', icon: Sparkles, action: () => navigate('/performance'), roles: ['admin', 'hr_manager'] },
      { id: 'p-fin',  label: 'Finance', hint: 'Incentives + expenses', group: 'Pages', icon: TrendingUp, action: () => navigate('/incentives'), roles: ['admin', 'hr_manager'] },
      { id: 'p-rep',  label: 'IT & Repairs', group: 'Pages', icon: Wrench, action: () => navigate('/asset-repairs'), roles: ['admin', 'hr_manager'] },
      { id: 'p-usr',  label: 'User Management', group: 'Pages', icon: UserCog, action: () => navigate('/users'), roles: ['admin', 'hr_manager'] },
      { id: 'p-cfg',  label: 'Configuration', group: 'Pages', icon: SlidersHorizontal, action: () => navigate('/config'), roles: ['admin', 'hr_manager'] },

      // Project Mgmt
      { id: 'p-prj',  label: 'Projects', group: 'Pages', icon: Briefcase, action: () => navigate('/projects'), roles: ['admin', 'hr_manager', 'project_coordinator'] },
      { id: 'p-hrs',  label: 'Project Hours grid', group: 'Pages', icon: Layers, action: () => navigate('/hours'), roles: ['admin', 'hr_manager', 'project_coordinator'] },
      { id: 'p-apr',  label: 'Hour Approvals', group: 'Pages', icon: ClipboardCheck, action: () => navigate('/hours/approvals') },

      // Personal
      { id: 'p-my',   label: 'My Portal', group: 'Pages', icon: User, action: () => navigate('/my'), roles: ['employee', 'project_coordinator'] },
      { id: 'p-team', label: 'My Team', group: 'Pages', icon: Users, action: () => navigate('/my-team'), roles: ['employee', 'project_coordinator'] },

      // Quick actions
      { id: 'a-att',  label: 'Mark attendance', hint: 'Open attendance page', group: 'Quick actions', icon: Clock3, action: () => navigate('/attendance') },
      { id: 'a-lv',   label: 'Apply for leave', hint: 'Open My Portal · Leaves', group: 'Quick actions', icon: CalendarDays, action: () => navigate('/my?tab=leave'), roles: ['employee', 'project_coordinator'] },
      { id: 'a-hrs',  label: 'Log project hours', hint: 'Open My Hours tab', group: 'Quick actions', icon: Layers, action: () => navigate('/my?tab=my-hours'), roles: ['employee', 'project_coordinator'] },
      { id: 'a-emp',  label: 'Add new employee', group: 'Quick actions', icon: Users, action: () => navigate('/employees?new=1'), roles: ['admin', 'hr_manager'] },

      // Theme
      { id: 't-light', label: 'Switch to light theme', group: 'Theme', icon: Sun, action: () => setTheme('light') },
      { id: 't-dark',  label: 'Switch to dark theme', group: 'Theme', icon: Moon, action: () => setTheme('dark') },

      // Account
      { id: 'ac-pw',  label: 'Change password', group: 'Account', icon: KeyRound, action: () => { /* TopBar handles via UI; just hint here */ navigate(role === 'employee' || role === 'project_coordinator' ? '/my' : '/'); } },
      { id: 'ac-out', label: 'Sign out', group: 'Account', icon: LogOut, action: () => logout() },
    ];
    // Hide the "switch to X" entry that matches the current theme
    return items.filter(i => {
      if (i.id === 't-light' && theme === 'light') return false;
      if (i.id === 't-dark'  && theme === 'dark')  return false;
      if (i.roles && !i.roles.includes(role)) return false;
      return true;
    });
  }, [navigate, logout, setTheme, theme, role]);

  // People search results — only when there's a meaningful query
  const peopleResults: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return employees
      .filter((e: any) => (e.name?.toLowerCase().includes(q) || e.employee_id?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q)))
      .slice(0, 6)
      .map((e: any) => ({
        id: `emp-${e.id}`,
        label: e.name,
        hint: `${e.employee_id ?? ''}${e.department ? ' · ' + e.department : ''}`,
        group: 'People' as const,
        icon: User,
        // URL uses the human employee code (DL0076). Backend resolves either
        // form, so old e_XX bookmarks still work.
        action: () => navigate(`/employees/${e.employee_id || e.id}`),
      }));
  }, [query, employees, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? allItems.filter(i => i.label.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q))
      : allItems;
    // People only show up once the user typed something
    return [...list, ...peopleResults];
  }, [query, allItems, peopleResults]);

  // Group for rendering
  const grouped = useMemo(() => {
    const groups: Record<string, Item[]> = {};
    for (const item of filtered) {
      (groups[item.group] ||= []).push(item);
    }
    return groups;
  }, [filtered]);

  // Flatten back so we can index by selectedIdx
  const flat = useMemo(() => {
    const out: Item[] = [];
    Object.values(grouped).forEach(arr => out.push(...arr));
    return out;
  }, [grouped]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter')     {
      e.preventDefault();
      const chosen = flat[selectedIdx];
      if (chosen) { chosen.action(); setOpen(false); }
    }
  };

  return (
    <div className="cmdk-overlay flex items-start justify-center pt-[14vh]" onClick={() => setOpen(false)}>
      <div className="cmdk-panel" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-outline">
          <Search size={16} className="text-on-surface-muted flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to a page, person, or action…"
            className="cmdk-input flex-1 bg-transparent text-sm text-on-surface focus:outline-none font-display"
          />
          <kbd className="text-[10px] font-mono font-semibold text-on-surface-subtle bg-surface-2 border border-outline px-1.5 py-0.5 rounded">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2">
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-on-surface-muted">Nothing matches "{query}".</p>
              <p className="text-xs text-on-surface-subtle mt-1">Try a different keyword.</p>
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => {
              const startIdx = flat.indexOf(items[0]);
              return (
                <div key={group} className="px-2">
                  <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-muted">{group}</p>
                  {items.map((item, i) => {
                    const Icon = item.icon;
                    const idx = startIdx + i;
                    const active = idx === selectedIdx;
                    return (
                      <button
                        key={item.id}
                        data-idx={idx}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        onClick={() => { item.action(); setOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${active ? 'cmdk-item-active' : 'text-on-surface-muted hover:text-on-surface'}`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-accent text-on-accent' : 'bg-surface-2 text-on-surface-muted'}`}>
                          <Icon size={14} strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold leading-tight truncate ${active ? 'text-on-surface' : 'text-on-surface'}`}>{item.label}</p>
                          {item.hint && <p className="text-[11px] text-on-surface-subtle mt-0.5 truncate">{item.hint}</p>}
                        </div>
                        {active && <ArrowRight size={13} className="text-accent flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-t border-outline text-[10px] text-on-surface-subtle font-medium bg-surface-2/40">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-surface border border-outline px-1.5 py-0.5 rounded">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-surface border border-outline px-1.5 py-0.5 rounded">⏎</kbd> open
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="font-mono bg-surface border border-outline px-1.5 py-0.5 rounded">⌘K</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
