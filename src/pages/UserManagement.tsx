import { useState } from 'react';
import { Plus, Edit2, Trash2, X, Eye, EyeOff, Shield, Users, UserCheck, Search, ToggleLeft, ToggleRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { AppUser, Role } from '../context/AuthContext';
import { departments } from '../data/mockData';

const roleConfig: Record<Role, { label: string; color: string; icon: typeof Shield }> = {
  admin: { label: 'Admin', color: 'bg-red-50 text-red-600 border-red-200', icon: Shield },
  hr_manager: { label: 'HR Manager', color: 'bg-primary-50 text-primary-600 border-primary-200', icon: UserCheck },
  employee: { label: 'Employee', color: 'bg-gray-50 text-gray-600 border-gray-200', icon: Users },
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
}

const defaultForm: UserFormData = {
  name: '', email: '', password: '', role: 'employee',
  department: '', designation: '', employeeId: '', avatar: '',
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
      ? { name: existing.name, email: existing.email, password: existing.password ?? '', role: existing.role, department: existing.department, designation: existing.designation, employeeId: existing.employee_id_ref ?? existing.employeeId ?? '', avatar: existing.avatar }
      : defaultForm
  );
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">{mode === 'create' ? 'Create New User' : 'Edit User'}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Full Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Priya Sharma"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Email *</label>
              <input value={form.email} onChange={e => set('email', e.target.value)} type="email" placeholder="email@company.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Password *</label>
              <div className="relative">
                <input value={form.password} onChange={e => set('password', e.target.value)} type={showPass ? 'text' : 'password'} placeholder="Min. 6 characters"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Employee ID *</label>
              <input value={form.employeeId} onChange={e => set('employeeId', e.target.value)} placeholder="EMP011"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Role *</label>
              <select value={form.role} onChange={e => set('role', e.target.value as Role)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 bg-white">
                <option value="employee">Employee</option>
                <option value="hr_manager">HR Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Department *</label>
              <select value={form.department} onChange={e => set('department', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 bg-white">
                <option value="">Select department</option>
                {departments.map(d => <option key={d}>{d}</option>)}
                <option value="Administration">Administration</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Designation *</label>
              <input value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="e.g. Software Engineer"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400" />
            </div>
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={handleSave} className="flex-1 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg text-sm font-medium transition-colors">
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
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.employee_id_ref ?? '').toLowerCase().includes(search.toLowerCase());
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
    employee: users.filter(u => u.role === 'employee').length,
  };

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg animate-fade-in">
          ✓ {toast}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Users', value: counts.total, color: 'text-gray-900' },
          { label: 'Admins', value: counts.admin, color: 'text-red-600' },
          { label: 'HR Managers', value: counts.hr_manager, color: 'text-primary-600' },
          { label: 'Employees', value: counts.employee, color: 'text-gray-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email or ID..."
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as Role | 'all')}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 text-gray-700"
        >
          <option value="all">All Roles</option>
          <option value="admin">Admin</option>
          <option value="hr_manager">HR Manager</option>
          <option value="employee">Employee</option>
        </select>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
        >
          <Plus size={15} /> Add User
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {['User', 'Employee ID', 'Role', 'Department', 'Status', 'Actions'].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => {
              const cfg = roleConfig[u.role];
              const RoleIcon = cfg.icon;
              return (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-xs font-bold">
                        {u.avatar}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{u.name}
                          {u.id === currentUser?.id && <span className="ml-1.5 text-xs text-primary-400">(you)</span>}
                        </p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{u.employee_id_ref ?? u.employeeId ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${cfg.color}`}>
                      <RoleIcon size={11} /> {cfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{u.department}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(u)}
                      disabled={u.id === currentUser?.id}
                      className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${u.id === currentUser?.id ? 'opacity-50 cursor-default' : 'cursor-pointer hover:opacity-80'} ${u.active ? 'text-green-600' : 'text-gray-400'}`}
                    >
                      {u.active ? <ToggleRight size={18} className="text-green-500" /> : <ToggleLeft size={18} className="text-gray-400" />}
                      {u.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModal({ mode: 'edit', user: u })}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                      >
                        <Edit2 size={14} />
                      </button>
                      {u.id !== currentUser?.id && (
                        <button
                          onClick={() => setConfirmDelete(u.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
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
          <div className="py-16 text-center text-gray-400 text-sm">No users found.</div>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-500" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-1">Delete user?</h3>
            <p className="text-sm text-gray-500 mb-6">This will permanently remove the user and their login access.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
