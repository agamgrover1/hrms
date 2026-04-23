import { useState, useEffect } from 'react';
import { Search, Filter, Plus, Mail, Phone, MapPin, ChevronRight, X, User, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import { api } from '../services/api';
import { departments } from '../data/mockData';

const avatarColors = [
  'bg-primary-100 text-primary-600',
  'bg-green-100 text-green-700',
  'bg-blue-100 text-blue-700',
  'bg-amber-100 text-amber-700',
  'bg-pink-100 text-pink-700',
  'bg-teal-100 text-teal-700',
];

function EmployeeCard({ emp, index, onClick }: { emp: any; index: number; onClick: () => void }) {
  const colorClass = avatarColors[index % avatarColors.length];
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md hover:border-primary-200 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-full ${colorClass} flex items-center justify-center text-sm font-bold`}>
            {emp.avatar}
          </div>
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">{emp.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{emp.designation}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {emp.employee_id && (
            <span className="text-xs font-mono font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-md">
              {emp.employee_id}
            </span>
          )}
          <ChevronRight size={16} className="text-gray-300 group-hover:text-primary-400 transition-colors" />
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-gray-500"><Mail size={12} className="text-gray-400" /> {emp.email}</div>
        <div className="flex items-center gap-2 text-xs text-gray-500"><Phone size={12} className="text-gray-400" /> {emp.phone}</div>
        <div className="flex items-center gap-2 text-xs text-gray-500"><MapPin size={12} className="text-gray-400" /> {emp.location}</div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full font-medium">{emp.department}</span>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${emp.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
          {emp.status}
        </span>
      </div>
    </div>
  );
}

function EmployeeDetail({ emp, onClose, onEdit, onDelete }: { emp: any; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const defaultProbationEnd = emp.join_date
    ? (() => { const d = new Date(emp.join_date); d.setDate(d.getDate() + 90); return d.toISOString().split('T')[0]; })()
    : '';
  const [probationEnd, setProbationEnd] = useState<string>(emp.probation_end_date?.split('T')[0] ?? defaultProbationEnd);
  const [savingProbation, setSavingProbation] = useState(false);
  const [probationSaved, setProbationSaved] = useState(false);

  const [balAdj, setBalAdj] = useState({ full_day: 0, short_leave: 0 });
  const [balLoaded, setBalLoaded] = useState(false);
  const [savingBal, setSavingBal] = useState(false);
  const [balSaved, setBalSaved] = useState(false);
  const [probationError, setProbationError] = useState('');
  const [balError, setBalError] = useState('');

  useEffect(() => {
    api.getLeaveBalance(emp.id).then(bal => {
      setBalAdj({ full_day: bal.full_day ?? 0, short_leave: bal.short_leave ?? 0 });
      setBalLoaded(true);
    }).catch(() => setBalLoaded(true));
  }, [emp.id]);

  const effectiveEnd = probationEnd || defaultProbationEnd;
  const onProbation = effectiveEnd ? new Date() < new Date(effectiveEnd) : false;

  const handleSaveProbation = async () => {
    setSavingProbation(true);
    setProbationSaved(false);
    setProbationError('');
    try {
      await api.updateEmployeeProbation(emp.id, probationEnd || null);
      setProbationSaved(true);
      setTimeout(() => setProbationSaved(false), 2500);
    } catch (err: any) {
      setProbationError(err.message || 'Failed to save probation date');
    } finally {
      setSavingProbation(false);
    }
  };

  const handleSaveBalance = async () => {
    setSavingBal(true);
    setBalSaved(false);
    setBalError('');
    try {
      await api.adjustLeaveBalance(emp.id, balAdj);
      setBalSaved(true);
      setTimeout(() => setBalSaved(false), 2500);
    } catch (err: any) {
      setBalError(err.message || 'Failed to save balance');
    } finally {
      setSavingBal(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="relative h-28 bg-gradient-to-r from-primary-500 to-primary-400 rounded-t-2xl">
          <div className="absolute top-4 right-4 flex gap-2">
            <button onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-white text-xs font-medium">
              <Pencil size={13} /> Edit
            </button>
            <button onClick={onDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors text-white text-xs font-medium">
              <Trash2 size={13} /> Delete
            </button>
            <button onClick={onClose} className="p-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors">
              <X size={16} className="text-white" />
            </button>
          </div>
        </div>
        <div className="px-6 pb-6">
          <div className="-mt-10 mb-4">
            <div className="w-20 h-20 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center text-xl font-bold border-4 border-white shadow-md">
              {emp.avatar}
            </div>
          </div>
          <h2 className="text-xl font-bold text-gray-900">{emp.name}</h2>
          <p className="text-primary-600 font-medium text-sm">{emp.designation}</p>
          <p className="text-gray-400 text-xs mt-0.5">{emp.employee_id} · {emp.department}</p>
          <div className="mt-6 grid grid-cols-2 gap-4">
            {[
              { label: 'Email', value: emp.email },
              { label: 'Phone', value: emp.phone },
              { label: 'Location', value: emp.location },
              { label: 'Reporting Manager', value: emp.manager || '—' },
              { label: 'Join Date', value: emp.join_date ? new Date(emp.join_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
              { label: 'Status', value: emp.status?.charAt(0).toUpperCase() + emp.status?.slice(1) },
              { label: 'Biometric ID', value: emp.biometric_id || '— not set —' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-gray-400 font-medium">{label}</p>
                <p className="text-sm text-gray-800 mt-0.5">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 p-4 bg-gray-50 rounded-xl">
            <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Compensation</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-400">Monthly Gross</p>
                <p className="text-sm font-semibold text-gray-800 mt-0.5">₹{Number(emp.salary).toLocaleString('en-IN')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Annual CTC</p>
                <p className="text-sm font-semibold text-gray-800 mt-0.5">₹{(Number(emp.ctc) / 100000).toFixed(1)}L</p>
              </div>
            </div>
          </div>

          <div className="mt-4 p-4 border border-gray-100 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Probation / Confirmation</p>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${onProbation ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                {onProbation ? 'On Probation' : 'Confirmed'}
              </span>
            </div>
            <label className="block text-xs text-gray-500 mb-1.5">
              {onProbation ? 'Probation End Date' : 'Confirmation Date'}
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={probationEnd}
                onChange={e => { setProbationEnd(e.target.value); setProbationSaved(false); setProbationError(''); }}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
              <button
                onClick={handleSaveProbation}
                disabled={savingProbation}
                className="px-3 py-2 text-xs font-semibold text-white bg-primary-500 hover:bg-primary-600 rounded-lg disabled:opacity-60 whitespace-nowrap"
              >
                {savingProbation ? '…' : probationSaved ? '✓ Saved' : 'Save'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {onProbation
                ? 'Set an earlier date to confirm the employee sooner. The employee will be notified.'
                : 'Update the confirmation date if it needs correction. The employee will be notified.'}
            </p>
            {probationError && <p className="text-xs text-red-500 mt-1.5">{probationError}</p>}
          </div>

          <div className="mt-4 p-4 border border-gray-100 rounded-xl">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Leave Balance</p>
            {!balLoaded ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Full Day (carries forward)</label>
                    <input
                      type="number" min="0" max="365"
                      value={balAdj.full_day}
                      onChange={e => setBalAdj(b => ({ ...b, full_day: Number(e.target.value) }))}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Short Leave / Half Day credits</label>
                    <input
                      type="number" min="0" max="30"
                      value={balAdj.short_leave}
                      onChange={e => setBalAdj(b => ({ ...b, short_leave: Number(e.target.value) }))}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"
                    />
                  </div>
                </div>
                <button
                  onClick={handleSaveBalance}
                  disabled={savingBal}
                  className="w-full py-2 text-xs font-semibold text-white bg-primary-500 hover:bg-primary-600 rounded-lg disabled:opacity-60"
                >
                  {savingBal ? 'Saving…' : balSaved ? '✓ Balance Updated' : 'Save Balance'}
                </button>
                {balError && <p className="text-xs text-red-500">{balError}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const emptyForm = {
  employee_id: '',
  biometric_id: '',
  name: '',
  email: '',
  phone: '',
  department: 'Engineering',
  designation: '',
  join_date: new Date().toISOString().split('T')[0],
  location: '',
  manager: '',
  reporting_manager_id: '',
  status: 'active',
  salary: '',
  ctc: '',
  password: '',
  role: 'employee',
};

function AddEmployeeModal({ onClose, onSaved, existingEmployees }: {
  onClose: () => void;
  onSaved: (emp: any) => void;
  existingEmployees: any[];
}) {
  const nextCode = (() => {
    const nums = existingEmployees
      .map(e => parseInt((e.employee_id || '').replace(/^DL/i, '').replace(/\D/g, ''), 10))
      .filter(n => !isNaN(n));
    const max = nums.length ? Math.max(...nums) : 0;
    return `DL${String(max + 1).padStart(4, '0')}`;
  })();

  const [form, setForm] = useState({ ...emptyForm, employee_id: nextCode });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 bg-white';
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    if (!form.employee_id.trim()) return setError('Employee ID is required.');
    if (!form.name.trim()) return setError('Name is required.');
    if (!form.email.trim()) return setError('Email is required.');
    if (!form.designation.trim()) return setError('Designation is required.');
    if (!form.password.trim()) return setError('Password is required to create a portal login.');
    if (form.password.length < 6) return setError('Password must be at least 6 characters.');
    if (existingEmployees.some(e => e.employee_id === form.employee_id.trim().toUpperCase())) {
      return setError(`Employee ID ${form.employee_id.toUpperCase()} is already taken.`);
    }
    setSaving(true);
    try {
      const initials = form.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const payload = {
        id: `e_${Date.now()}`,
        ...form,
        employee_id: form.employee_id.trim().toUpperCase(),
        biometric_id: form.biometric_id.trim() || null,
        avatar: initials,
        salary: Number(form.salary) || 0,
        ctc: Number(form.ctc) || 0,
        reporting_manager_id: form.reporting_manager_id || null,
        password: form.password || null,
        role: form.role || 'employee',
      };
      const created = await api.createEmployee(payload);
      onSaved(created);
    } catch (err: any) {
      setError(err.message || 'Failed to save employee.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center">
              <User size={18} className="text-primary-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Add New Employee</h2>
              <p className="text-xs text-gray-400">Fill in details to onboard a new team member</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-primary-50 border border-primary-100 rounded-xl">
              <label className="block text-xs font-semibold text-primary-700 mb-1">
                Employee ID <span className="text-red-400">*</span>
                <span className="ml-2 font-normal text-primary-500">(auto-suggested)</span>
              </label>
              <input
                type="text"
                value={form.employee_id}
                onChange={e => set('employee_id', e.target.value.toUpperCase())}
                placeholder="e.g. DL0012"
                className="w-full text-sm font-mono font-semibold border border-primary-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 tracking-widest"
              />
            </div>
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl">
              <label className="block text-xs font-semibold text-amber-700 mb-1">
                Biometric ID
                <span className="ml-2 font-normal text-amber-500">(eTimeOffice Empcode, e.g. DL0007)</span>
              </label>
              <input
                type="text"
                value={form.biometric_id}
                onChange={e => set('biometric_id', e.target.value)}
                placeholder="Leave blank if same as Employee ID"
                className="w-full text-sm font-mono border border-amber-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400 tracking-widest"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Full Name <span className="text-red-400">*</span></label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Ravi Kumar" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email Address <span className="text-red-400">*</span></label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="ravi@company.com" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+91 98765 43210" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Location / City</label>
              <input type="text" value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Bangalore" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Designation / Job Title <span className="text-red-400">*</span></label>
              <input type="text" value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="e.g. Software Engineer" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Reporting Manager</label>
              <select
                value={form.reporting_manager_id}
                onChange={e => {
                  const mgr = existingEmployees.find(x => x.id === e.target.value);
                  set('reporting_manager_id', e.target.value);
                  set('manager', mgr?.name ?? '');
                }}
                className={inputCls}
              >
                <option value="">— No Manager —</option>
                {existingEmployees.map(x => (
                  <option key={x.id} value={x.id}>{x.name} ({x.designation})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Department <span className="text-red-400">*</span></label>
              <select value={form.department} onChange={e => set('department', e.target.value)} className={inputCls}>
                {departments.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Join Date</label>
              <input type="date" value={form.join_date} onChange={e => set('join_date', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Compensation</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Monthly Gross Salary (₹)</label>
                <input type="number" value={form.salary} onChange={e => set('salary', e.target.value)} placeholder="e.g. 80000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Annual CTC (₹)</label>
                <input type="number" value={form.ctc} onChange={e => set('ctc', e.target.value)} placeholder="e.g. 1200000" className={inputCls} />
              </div>
            </div>
          </div>

          {/* Login Credentials */}
          <div className="border border-primary-100 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-primary-50 border-b border-primary-100">
              <p className="text-xs font-semibold text-primary-700 uppercase tracking-wide">Login Credentials <span className="text-red-400">*</span></p>
              <p className="text-xs text-primary-500 mt-0.5">Required — the employee will use these to log in to the portal.</p>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Role</label>
                <select value={form.role} onChange={e => set('role', e.target.value)} className={inputCls}>
                  <option value="employee">Employee</option>
                  <option value="hr_manager">HR Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Password <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => set('password', e.target.value)}
                    placeholder="Min. 6 characters"
                    className={inputCls + ' pr-10'}
                  />
                  <button type="button" onClick={() => setShowPass(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
              {saving ? 'Saving…' : 'Add Employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditEmployeeModal({ emp, onClose, onSaved, allEmployees }: {
  emp: any;
  onClose: () => void;
  onSaved: (updated: any) => void;
  allEmployees: any[];
}) {
  const [form, setForm] = useState({
    name: emp.name || '',
    email: emp.email || '',
    phone: emp.phone || '',
    department: emp.department || 'Engineering',
    designation: emp.designation || '',
    join_date: emp.join_date ? emp.join_date.split('T')[0] : new Date().toISOString().split('T')[0],
    location: emp.location || '',
    manager: emp.manager || '',
    reporting_manager_id: emp.reporting_manager_id || '',
    status: emp.status || 'active',
    salary: String(emp.salary || ''),
    ctc: String(emp.ctc || ''),
    biometric_id: emp.biometric_id || '',
    next_appraisal_month: String(emp.next_appraisal_month || ''),
    next_appraisal_year: String(emp.next_appraisal_year || ''),
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 bg-white';
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Name is required.');
    if (!form.email.trim()) return setError('Email is required.');
    if (!form.designation.trim()) return setError('Designation is required.');
    setSaving(true);
    try {
      const updated = await api.updateEmployee(emp.id, {
        ...form,
        salary: Number(form.salary) || 0,
        ctc: Number(form.ctc) || 0,
        biometric_id: form.biometric_id.trim() || null,
        reporting_manager_id: form.reporting_manager_id || null,
        next_appraisal_month: form.next_appraisal_month ? Number(form.next_appraisal_month) : null,
        next_appraisal_year:  form.next_appraisal_year  ? Number(form.next_appraisal_year)  : null,
      });
      onSaved(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to update employee.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
              <Pencil size={17} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Edit Employee</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-mono font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded">{emp.employee_id}</span>
                <span className="text-xs text-gray-400">{emp.name}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Biometric ID */}
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl">
            <label className="block text-xs font-semibold text-amber-700 mb-1">
              Biometric ID (eTimeOffice Empcode)
            </label>
            <input
              type="text"
              value={form.biometric_id}
              onChange={e => set('biometric_id', e.target.value)}
              placeholder="e.g. DL0007 — leave blank if same as Employee ID"
              className="w-full text-sm font-mono border border-amber-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400 tracking-widest"
            />
            <p className="text-xs text-amber-600 mt-1.5">Used to match this employee's attendance data from the biometric device. Check eTimeOffice for the exact Empcode.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Full Name <span className="text-red-400">*</span></label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email Address <span className="text-red-400">*</span></label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Location / City</label>
              <input type="text" value={form.location} onChange={e => set('location', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Designation / Job Title <span className="text-red-400">*</span></label>
              <input type="text" value={form.designation} onChange={e => set('designation', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Reporting Manager</label>
              <select
                value={form.reporting_manager_id}
                onChange={e => {
                  const mgr = allEmployees.find(x => x.id === e.target.value);
                  set('reporting_manager_id', e.target.value);
                  set('manager', mgr?.name ?? '');
                }}
                className={inputCls}
              >
                <option value="">— No Manager —</option>
                {allEmployees.filter(x => x.id !== emp.id).map(x => (
                  <option key={x.id} value={x.id}>{x.name} ({x.designation})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Department <span className="text-red-400">*</span></label>
              <select value={form.department} onChange={e => set('department', e.target.value)} className={inputCls}>
                {departments.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Join Date</label>
              <input type="date" value={form.join_date} onChange={e => set('join_date', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Compensation</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Monthly Gross Salary (₹)</label>
                <input type="number" value={form.salary} onChange={e => set('salary', e.target.value)} placeholder="e.g. 80000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Annual CTC (₹)</label>
                <input type="number" value={form.ctc} onChange={e => set('ctc', e.target.value)} placeholder="e.g. 1200000" className={inputCls} />
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Next Appraisal Schedule</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Appraisal Month</label>
                <select value={form.next_appraisal_month} onChange={e => set('next_appraisal_month', e.target.value)} className={inputCls}>
                  <option value="">— Not scheduled —</option>
                  {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                    <option key={i + 1} value={String(i + 1)}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Appraisal Year</label>
                <select value={form.next_appraisal_year} onChange={e => set('next_appraisal_year', e.target.value)} className={inputCls}>
                  <option value="">— Not scheduled —</option>
                  {[0, 1, 2].map(offset => {
                    const y = new Date().getFullYear() + offset;
                    return <option key={y} value={String(y)}>{y}</option>;
                  })}
                </select>
              </div>
            </div>
            {form.next_appraisal_month && form.next_appraisal_year && (
              <p className="text-xs mt-2 font-medium" style={{ color: '#EE2770' }}>
                Appraisal form will open for this employee in{' '}
                {['January','February','March','April','May','June','July','August','September','October','November','December'][Number(form.next_appraisal_month) - 1]}{' '}
                {form.next_appraisal_year}
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #EE2770 0%, #d11f62 100%)' }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Employees() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selected, setSelected] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (emp: any) => {
    setDeleting(true);
    try {
      await api.deleteEmployee(emp.id);
      setEmployees(prev => prev.filter(e => e.id !== emp.id));
      setConfirmDelete(null);
    } catch (err: any) {
      alert(err.message || 'Failed to delete employee. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    api.getEmployees().then(setEmployees).finally(() => setLoading(false));
  }, []);

  const filtered = employees.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.email.toLowerCase().includes(search.toLowerCase()) ||
      e.designation.toLowerCase().includes(search.toLowerCase()) ||
      (e.employee_id || '').toLowerCase().includes(search.toLowerCase());
    const matchDept = deptFilter === 'All' || e.department === deptFilter;
    const matchStatus = statusFilter === 'All' || e.status === statusFilter;
    return matchSearch && matchDept && matchStatus;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email or employee ID…"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400" />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-400" />
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 text-gray-700">
            <option>All</option>
            {departments.map(d => <option key={d}>{d}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 text-gray-700">
            <option>All</option>
            <option>active</option>
            <option>inactive</option>
          </select>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
          <Plus size={15} /> Add Employee
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500">{filtered.length} employee{filtered.length !== 1 ? 's' : ''} found</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((emp, i) => (
              <EmployeeCard key={emp.id} emp={emp} index={i} onClick={() => setSelected(emp)} />
            ))}
          </div>
        </>
      )}

      {selected && (
        <EmployeeDetail
          emp={selected}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setSelected(null); }}
          onDelete={() => { setConfirmDelete(selected); setSelected(null); }}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-500" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-1">Delete {confirmDelete.name}?</h3>
            <p className="text-sm text-gray-500 mb-6">This will permanently remove the employee record. This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={deleting}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <EditEmployeeModal
          emp={editing}
          allEmployees={employees}
          onClose={() => setEditing(null)}
          onSaved={updated => {
            setEmployees(prev => prev.map(e => e.id === updated.id ? updated : e));
            setEditing(null);
          }}
        />
      )}

      {showAdd && (
        <AddEmployeeModal
          existingEmployees={employees}
          onClose={() => setShowAdd(false)}
          onSaved={emp => {
            setEmployees(prev => [...prev, emp]);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}
