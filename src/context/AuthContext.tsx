import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';

export type Role = 'admin' | 'hr_manager' | 'employee';

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
const SESSION_KEY = 'hrflow_session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  });
  const [users, setUsers] = useState<AppUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

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
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Login failed' };
    }
  };

  const logout = () => {
    setUser(null);
    setUsers([]);
    localStorage.removeItem(SESSION_KEY);
  };

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
    <AuthContext.Provider value={{ user, users, usersLoading, login, logout, createUser, updateUser, deleteUser, toggleUserActive, refreshUsers }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
