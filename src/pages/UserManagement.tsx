import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, X, Eye, EyeOff, Shield, Users, UserCheck, Search, ToggleLeft, ToggleRight, Briefcase } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { AppUser, Role } from '../context/AuthContext';
import { departments } from '../data/mockData';
import { api } from '../services/api';

const roleConfig: Record<Role, { label: string; color: string; icon: typeof Shield }> = {
  admin: { label: 'Admin', color: 'bg-danger-container text-danger border-danger/20', icon: Shield },
  hr_manager: { label: 'HR Manager', color: 'bg-brand-container text-on-brand-container border-brand/20', icon: UserCheck },
  project_coordinator: { label: 'Project Coordinator', color: 'bg-brand-container text-on-brand-container border-brand/20', icon: Briefcase },
  employee: { label: 'Employee', color: 'bg-surface-2 text-on-surface-muted border-outline', icon: Users },
};

interface UserFormData {
  name: string;
  email: string;
  password: string;
  role: Role;
  department: string;
  designation: string;
  employeeId: string;
  avatar: string;
  reporting_manager_id: string;
}

const defaultForm: UserFormData = {
  name: '', email: '', password: '', role: 'employee',
  department: '', designation: '', employeeId: '', avatar: '',
  reporting_manager_id: '',
};

function UserModal({
  mode,
  existing,
  onClose,
  onSave,
}: {
  mode: 'create' | 'edit';
  existing?: AppUser;
  onClose: () => void;
  onSave: (data: UserFormData) => void;
}) {
  const [form, setForm] = useState<UserFormData>(
    existing
      ? { name: existing.name, email: existing.email, password: existing.password ?? '', role: existing.role, department: existing.department, designation: existing.designation, employeeId: existing.employee_id_ref ?? existing.employeeId ?? '', avatar: existing.avatar, reporting_manager_id: (existing as any).reporting_manager_id ?? '' }
      : defaultForm
  );
  const [employees, setEmployees] = useState<any[]>([]);

  useEffect(() => {
    api.getEmployees().then(setEmployees).catch(() => {});
  }, []);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof UserFormData, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.name || !form.email || !form.password || !form.role || !form.department || !form.designation || !form.employeeId) {
      setError('All fields are required.');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    const avatarStr = form.avatar || form.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    onSave({ ...form, avatar: avatarStr });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-xl-2 shadow-elev-3 w-full max-w-lg max-h-[90vh] overflow-y-auto border border-outline">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">{mode === 'create' ? 'Create New User' : 'Edit User'}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors"><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">Full Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Priya Sharma"
                className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">Email *</label>
              <input value={form.email} onChange={e => set('email', e.target.value)} type="email" placeholder="email@company.com"
                className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">Password *</label>
              <div className="relative">
                <input value={form.password} onChange={e => set('password', e.target.value)} type={showPass ? 'text' : 'password'} placeholder="Min. 6 characters"
                  className="w-full border border-outline rounded-lg px-3 py-2.5 pr-10 text-sm bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-subtle hover:text-on-surface transition-colors">
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">Employee ID *</label>
              <input value={form.employeeId} onChange={e => set('employeeId', e.target.value)} placeholder="EMP011"
                className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
            </div>
            <div>
              <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">Role *</label>
              <select value={form.role} onChange={e => set('role', e.target.value as Role)}
                className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand bg-surface text-on-surface">
                <option value="employee">Employee</option>
                <option value="hr_manager">HR Manager</option>
                <option value="project_coordinator">Project Coordinator</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">Department *</label>
              <select value={form.department} onChange={e => set('department', e.target.value)}
                className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand bg-surface text-on-surface">
                <option value="">Select department</option>
                {departments.map(d => <option key={d}>{d}</option>)}
                <option value="Administration">Administration</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">Designation *</label>
              <input value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="e.g. Software Engineer"
                className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-on-surface-subtle mb-1.5 block">Reporting Manager</label>
              <select value={form.reporting_manager_id} onChange={e => set('reporting_manager_id', e.target.value)}
                className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand bg-surface text-on-surface">
                <option value="">— No Manager —</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.designation})</option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-danger bg-danger-container px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 border border-outline text-on-surface-muted rounded-lg text-sm font-medium hover:bg-surface-2 transition-colors">Cancel</button>
            <button onClick={handleSave} className="flex-1 py-2.5 bg-accent text-on-accent hover:opacity-90 rounded-lg text-sm font-medium shadow-elev-1 hover:shadow-elev-2 transition-all">
              {mode === 'create' ? 'Create User' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UserManagement() {
  const { users, createUser, updateUser, deleteUser, toggleUserActive, user: currentUser } = useAuth();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; user?: AppUser } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const filtered = users.filter(u => {
    const term = search.toLowerCase();
    const matchSearch = u.name.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term) ||
      ((u as any).employee_code ?? '').toLowerCase().includes(term) ||
      (u.employee_id_ref ?? '').toLowerCase().includes(term);
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const handleSave = async (data: UserFormData & { avatar: string }) => {
    if (modal?.mode === 'create') {
      const result = await createUser({ ...data, active: true });
      if (!result.success) { alert(result.error); return; }
      showToast('User created successfully');
    } else if (modal?.user) {
      await updateUser(modal.user.id, data);
      showToast('User updated successfully');
    }
    setModal(null);
  };

  const handleDelete = async (id: string) => {
    if (id === currentUser?.id) { alert("You can't delete your own account."); return; }
    await deleteUser(id);
    setConfirmDelete(null);
    showToast('User deleted');
  };

  const handleToggleActive = async (u: AppUser) => {
    if (u.id === currentUser?.id) return;
    await toggleUserActive(u.id, !u.active);
    showToast(`User ${u.active ? 'deactivated' : 'activated'}`);
  };

  const counts = {
    total: users.length,
    admin: users.filter(u => u.role === 'admin').length,
    hr_manager: users.filter(u => u.role === 'hr_manager').length,
    project_coordinator: users.filter(u => u.role === 'project_coordinator').length,
    employee: users.filter(u => u.role === 'employee').length,
  };

  const summaryTiles: Array<{ label: string; value: number; valueColor: string; blobColor: string }> = [
    { label: 'Total Users',         value: counts.total,               valueColor: 'text-on-surface',          blobColor: 'bg-brand/15' },
    { label: 'Admins',              value: counts.admin,               valueColor: 'text-danger',              blobColor: 'bg-danger/15' },
    { label: 'HR Managers',         value: counts.hr_manager,          valueColor: 'text-on-brand-container',  blobColor: 'bg-brand/15' },
    { label: 'Project Coordinator', value: counts.project_coordinator, valueColor: 'text-on-brand-container',  blobColor: 'bg-brand/15' },
    { label: 'Employees',           value: counts.employee,            valueColor: 'text-on-surface-muted',    blobColor: 'bg-accent/15' },
  ];

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-surface-3 text-on-surface text-sm px-4 py-2.5 rounded-xl-2 shadow-elev-3 border border-outline animate-fade-in">
          ✓ {toast}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {summaryTiles.map(({ label, value, valueColor, blobColor }, i) => (
          <div
            key={label}
            className={`group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up stagger-${i + 1}`}
          >
            <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full ${blobColor} blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500`} />
            <div className="relative">
              <p className={`num-mono text-3xl font-semibold leading-none ${valueColor}`}>{value}</p>
              <p className="text-[10px] font-bold text-on-surface-muted mt-2.5 uppercase tracking-[0.16em]">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email or ID..."
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface border border-outline rounded-lg text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as Role | 'all')}
          className="text-sm border border-outline rounded-lg px-3 py-2.5 bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand text-on-surface-muted"
        >
          <option value="all">All Roles</option>
          <option value="admin">Admin</option>
          <option value="hr_manager">HR Manager</option>
          <option value="project_coordinator">Project Coordinator</option>
          <option value="employee">Employee</option>
        </select>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent text-on-accent hover:opacity-90 text-sm font-medium rounded-lg shadow-elev-1 hover:shadow-elev-2 transition-all"
        >
          <Plus size={15} /> Add User
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-2 border-b border-outline">
              {['User', 'Employee ID', 'Role', 'Department', 'Status', 'Actions'].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-on-surface-subtle px-4 py-3 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => {
              const cfg = roleConfig[u.role];
              const RoleIcon = cfg.icon;
              return (
                <tr key={u.id} className="border-b border-outline hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-container text-on-brand-container flex items-center justify-center text-xs font-bold">
                        {u.avatar}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-on-surface">{u.name}
                          {u.id === currentUser?.id && <span className="ml-1.5 text-xs text-on-brand-container">(you)</span>}
                        </p>
                        <p className="text-xs text-on-surface-subtle">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-on-surface-muted num-mono">{(u as any).employee_code ?? u.employeeId ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${cfg.color}`}>
                      <RoleIcon size={11} /> {cfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-on-surface-subtle">{u.department}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(u)}
                      disabled={u.id === currentUser?.id}
                      className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${u.id === currentUser?.id ? 'opacity-50 cursor-default' : 'cursor-pointer hover:opacity-80'} ${u.active ? 'text-success' : 'text-on-surface-subtle'}`}
                    >
                      {u.active ? <ToggleRight size={18} className="text-success" /> : <ToggleLeft size={18} className="text-on-surface-subtle" />}
                      {u.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModal({ mode: 'edit', user: u })}
                        className="p-1.5 text-on-surface-muted hover:text-on-surface hover:bg-surface-2 rounded-lg transition-colors"
                      >
                        <Edit2 size={14} />
                      </button>
                      {u.id !== currentUser?.id && (
                        <button
                          onClick={() => setConfirmDelete(u.id)}
                          className="p-1.5 text-on-surface-muted hover:text-danger hover:bg-surface-2 rounded-lg transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-16 text-center text-on-surface-subtle text-sm">No users found.</div>
        )}
      </div>

      {/* Modals */}
      {modal && (
        <UserModal
          mode={modal.mode}
          existing={modal.user}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-xl-2 shadow-elev-3 border border-outline w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-danger-container flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-danger" />
            </div>
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface mb-1">Delete user?</h3>
            <p className="text-sm text-on-surface-subtle mb-6">This will permanently remove the user and their login access.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 border border-outline rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2 transition-colors">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-2.5 bg-danger text-white rounded-lg text-sm font-medium hover:opacity-90 shadow-elev-1 hover:shadow-elev-2 transition-all">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
