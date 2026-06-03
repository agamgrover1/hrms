import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';

// Inactivity policy. The session auto-logs-out after this many ms of no
// keyboard/mouse/touch activity. Activity in any tab resets the clock for
// every tab (via the `storage` event).
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;   // 30 minutes
const ACTIVITY_KEY = 'digitalleap_hrms_last_activity';
const CHECK_INTERVAL_MS = 30 * 1000;          // poll every 30s — fine granularity isn't needed

export type Role = 'admin' | 'hr_manager' | 'project_coordinator' | 'employee';

export interface AppUser {
  id: string;
  employee_id_ref: string | null;
  name: string;
  email: string;
  role: Role;
  department: string;
  designation: string;
  avatar: string;
  active: boolean;
  // kept for backward compat with UserManagement
  employeeId?: string;
  password?: string;
}

interface AuthContextType {
  user: AppUser | null;
  users: AppUser[];
  usersLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  createUser: (data: any) => Promise<{ success: boolean; error?: string }>;
  updateUser: (id: string, data: any) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  toggleUserActive: (id: string, active: boolean) => Promise<void>;
  refreshUsers: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);
const SESSION_KEY = 'digitalleap_hrms_session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    // If the tab was closed past the inactivity window, don't restore — force a
    // fresh login. Catches "left tab open overnight, came back to it" too.
    const lastActive = Number(localStorage.getItem(ACTIVITY_KEY) || 0);
    if (lastActive && Date.now() - lastActive > INACTIVITY_LIMIT_MS) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(ACTIVITY_KEY);
      return null;
    }
    return JSON.parse(stored);
  });
  const [users, setUsers] = useState<AppUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const lastActivityRef = useRef<number>(Number(localStorage.getItem(ACTIVITY_KEY) || Date.now()));

  const refreshUsers = async () => {
    setUsersLoading(true);
    try {
      const data = await api.getUsers();
      // Normalize field names for backward compat
      setUsers(data.map((u: any) => ({ ...u, employeeId: u.employee_id_ref })));
    } catch {
      // Server not available yet — silently ignore
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (user) refreshUsers();
  }, [!!user]);

  const login = async (email: string, password: string) => {
    try {
      const { user: u } = await api.login(email, password);
      const appUser: AppUser = { ...u, employeeId: u.employee_id_ref };
      setUser(appUser);
      localStorage.setItem(SESSION_KEY, JSON.stringify(appUser));
      // Seed activity timestamp so the timeout clock starts now.
      const now = Date.now();
      lastActivityRef.current = now;
      localStorage.setItem(ACTIVITY_KEY, String(now));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Login failed' };
    }
  };

  const logout = () => {
    setUser(null);
    setUsers([]);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
  };

  // ── Inactivity tracking ────────────────────────────────────────────────
  // Listen for any keyboard/mouse/touch input and bump the activity clock.
  // A periodic check forces logout once the gap exceeds the limit. The
  // timestamp is mirrored to localStorage so activity in one tab keeps
  // sibling tabs alive, and a logout in one tab logs out the others.
  useEffect(() => {
    if (!user) return;
    const bump = () => {
      const now = Date.now();
      // Throttle: only write to localStorage once every 10s — pen-strokes and
      // mouse-moves would otherwise hammer it.
      if (now - lastActivityRef.current > 10_000) {
        lastActivityRef.current = now;
        try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch { /* quota — ignore */ }
      } else {
        lastActivityRef.current = now;
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_KEY && e.newValue) {
        lastActivityRef.current = Number(e.newValue);
      }
      if (e.key === SESSION_KEY && !e.newValue) {
        // Another tab logged out — mirror it here.
        setUser(null);
        setUsers([]);
      }
    };
    const tick = () => {
      const last = Math.max(lastActivityRef.current, Number(localStorage.getItem(ACTIVITY_KEY) || 0));
      if (Date.now() - last > INACTIVITY_LIMIT_MS) {
        logout();
      }
    };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(ev => window.addEventListener(ev, bump, { passive: true }));
    window.addEventListener('storage', onStorage);
    const interval = window.setInterval(tick, CHECK_INTERVAL_MS);
    // Also tick when the tab regains focus — covers "came back after lunch".
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      events.forEach(ev => window.removeEventListener(ev, bump));
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.clearInterval(interval);
    };
  }, [user]);

  const createUser = async (data: any) => {
    try {
      const newUser = await api.createUser(data);
      setUsers(prev => [...prev, { ...newUser, employeeId: newUser.employee_id_ref }]);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const updateUser = async (id: string, data: any) => {
    const updated = await api.updateUser(id, data);
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updated, employeeId: updated.employee_id_ref } : u));
    if (user?.id === id) {
      const updatedUser = { ...user, ...updated };
      setUser(updatedUser);
      localStorage.setItem(SESSION_KEY, JSON.stringify(updatedUser));
    }
  };

  const deleteUser = async (id: string) => {
    await api.deleteUser(id);
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  const toggleUserActive = async (id: string, active: boolean) => {
    await api.toggleUserActive(id, active);
    setUsers(prev => prev.map(u => u.id === id ? { ...u, active } : u));
  };

  return (
    <AuthContext.Provider value={{
      user, users, usersLoading, login, logout,
      createUser, updateUser, deleteUser, toggleUserActive, refreshUsers,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
