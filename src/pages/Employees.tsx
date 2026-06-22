import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Plus, Mail, Phone, MapPin, ChevronRight, X, User, Pencil, Trash2, Eye, EyeOff, AlertTriangle, Shield } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
// departments now loaded from API (Config → Departments)

const avatarColors = [
  'bg-brand-container text-on-brand-container',
  'bg-success-container text-success',
  'bg-brand-container text-on-brand-container',
  'bg-warning-container text-warning',
  'bg-accent-container text-on-accent-container',
  'bg-success-container text-success',
];

function EmployeeCard({ emp, index, onClick, warningCount = 0, onPip = false }: { emp: any; index: number; onClick: () => void; warningCount?: number; onPip?: boolean }) {
  const colorClass = avatarColors[index % avatarColors.length];
  return (
    <div
      onClick={onClick}
      className="bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 hover:border-accent/30 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-full ${colorClass} flex items-center justify-center text-sm font-bold`}>
            {emp.avatar}
          </div>
          <div>
            <p className="font-semibold text-on-surface group-hover:text-accent transition-colors">{emp.name}</p>
            <p className="text-xs text-on-surface-subtle mt-0.5">{emp.designation}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {emp.employee_id && (
            <span className="num-mono text-xs font-semibold text-on-brand-container bg-brand-container px-2 py-0.5 rounded-md">
              {emp.employee_id}
            </span>
          )}
          <div className="flex items-center gap-1">
            {onPip && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-danger-container text-danger">PIP</span>}
            {warningCount > 0 && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full num-mono ${warningCount >= 3 ? 'bg-danger-container text-danger' : warningCount === 2 ? 'bg-warning-container text-warning' : 'bg-warning-container text-warning'}`}>⚠ {warningCount}</span>}
            <ChevronRight size={16} className="text-on-surface-subtle group-hover:text-accent transition-colors" />
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-on-surface-subtle"><Mail size={12} className="text-on-surface-subtle" /> {emp.email}</div>
        <div className="flex items-center gap-2 text-xs text-on-surface-subtle"><Phone size={12} className="text-on-surface-subtle" /> {emp.phone}</div>
        <div className="flex items-center gap-2 text-xs text-on-surface-subtle"><MapPin size={12} className="text-on-surface-subtle" /> {emp.location}</div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs px-2.5 py-1 bg-surface-2 text-on-surface-muted rounded-full font-medium">{emp.department}</span>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${emp.status === 'active' ? 'bg-success-container text-success' : 'bg-danger-container text-danger'}`}>
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

  // Warnings & PIP
  const { user: currentUser } = useAuth();
  const [warnings, setWarnings] = useState<any[]>([]);
  const [pip, setPip] = useState<any | null>(null);
  const [showWarnForm, setShowWarnForm] = useState(false);
  const [warnReason, setWarnReason] = useState('');
  const [warnSeverity, setWarnSeverity] = useState('warning');
  const [issuingWarn, setIssuingWarn] = useState(false);

  useEffect(() => {
    api.getLeaveBalance(emp.id).then(bal => {
      setBalAdj({ full_day: bal.full_day ?? 0, short_leave: bal.short_leave ?? 0 });
      setBalLoaded(true);
    }).catch(() => setBalLoaded(true));
    api.getWarnings(emp.id).then(setWarnings).catch(() => {});
    api.getPips(emp.id).then(pips => setPip(pips.find((p: any) => p.status === 'active') ?? null)).catch(() => {});
  }, [emp.id]);

  const handleIssueWarning = async () => {
    if (!warnReason.trim()) return;
    setIssuingWarn(true);
    try {
      const w = await api.issueWarning({
        employee_id: emp.id, employee_name: emp.name,
        reason: warnReason.trim(), severity: warnSeverity,
        issued_by: currentUser?.name, issued_by_role: currentUser?.role,
      });
      const newWarnings = [...warnings, w];
      setWarnings(newWarnings);
      if (newWarnings.length >= 3) {
        // Refresh PIP
        api.getPips(emp.id).then(pips => setPip(pips.find((p: any) => p.status === 'active') ?? null)).catch(() => {});
      }
      setWarnReason(''); setShowWarnForm(false);
    } catch { /* ignore */ }
    finally { setIssuingWarn(false); }
  };

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="relative h-28 bg-gradient-to-r from-brand to-accent rounded-t-2xl">
          <div className="absolute top-4 right-4 flex gap-2">
            <button onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-white text-xs font-medium">
              <Pencil size={13} /> Edit
            </button>
            <button onClick={onDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-danger/80 hover:bg-danger rounded-lg transition-colors text-white text-xs font-medium">
              <Trash2 size={13} /> Delete
            </button>
            <button onClick={onClose} className="p-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors">
              <X size={16} className="text-white" />
            </button>
          </div>
        </div>
        <div className="px-6 pb-6">
          <div className="-mt-10 mb-4">
            <div className="w-20 h-20 rounded-2xl bg-brand-container text-on-brand-container flex items-center justify-center text-xl font-bold border-4 border-surface shadow-elev-2">
              {emp.avatar}
            </div>
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-on-surface">{emp.name}</h2>
          <p className="text-on-brand-container font-medium text-sm">{emp.designation}</p>
          <p className="text-on-surface-subtle text-xs mt-0.5"><span className="num-mono">{emp.employee_id}</span> · {emp.department}</p>
          <div className="mt-6 grid grid-cols-2 gap-4">
            {[
              { label: 'Email', value: emp.email },
              { label: 'Phone', value: emp.phone },
              { label: 'Location', value: emp.location },
              { label: 'Reporting Manager', value: emp.manager || '—' },
              { label: 'Join Date', value: emp.join_date ? new Date(emp.join_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
              { label: 'Status', value: emp.status?.charAt(0).toUpperCase() + emp.status?.slice(1) },
              { label: 'Shift', value: emp.shift === 'night' ? '🌙 Night Shift (6:30 PM – 3:30 AM)' : '☀️ Day Shift (9:00 AM – 6:00 PM)' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-on-surface-subtle font-medium">{label}</p>
                <p className="text-sm text-on-surface mt-0.5">{value}</p>
              </div>
            ))}
          </div>
          {currentUser?.role !== 'hr_intern' && (
            <div className="mt-6 p-4 bg-surface-2 rounded-xl-2">
              <p className="text-xs font-semibold text-on-surface-subtle mb-3 uppercase tracking-wide">Compensation</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-on-surface-subtle">Monthly Gross</p>
                  <p className="num-mono text-sm font-semibold text-on-surface mt-0.5">₹{Number(emp.salary).toLocaleString('en-IN')}</p>
                </div>
                <div>
                  <p className="text-xs text-on-surface-subtle">Annual CTC</p>
                  <p className="num-mono text-sm font-semibold text-on-surface mt-0.5">₹{(Number(emp.ctc) / 100000).toFixed(1)}L</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 p-4 border border-outline rounded-xl-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Probation / Confirmation</p>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${onProbation ? 'bg-warning-container text-warning' : 'bg-success-container text-success'}`}>
                {onProbation ? 'On Probation' : 'Confirmed'}
              </span>
            </div>
            <label className="block text-xs text-on-surface-subtle mb-1.5">
              {onProbation ? 'Probation End Date' : 'Confirmation Date'}
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={probationEnd}
                onChange={e => { setProbationEnd(e.target.value); setProbationSaved(false); setProbationError(''); }}
                className="flex-1 text-sm bg-surface border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <button
                onClick={handleSaveProbation}
                disabled={savingProbation}
                className="px-3 py-2 text-xs font-semibold text-on-accent bg-accent hover:opacity-90 rounded-lg disabled:opacity-60 whitespace-nowrap transition-all"
              >
                {savingProbation ? '…' : probationSaved ? '✓ Saved' : 'Save'}
              </button>
            </div>
            <p className="text-xs text-on-surface-subtle mt-1.5">
              {onProbation
                ? 'Set an earlier date to confirm the employee sooner. The employee will be notified.'
                : 'Update the confirmation date if it needs correction. The employee will be notified.'}
            </p>
            {probationError && <p className="text-xs text-danger mt-1.5">{probationError}</p>}
          </div>

          <div className="mt-4 p-4 border border-outline rounded-xl-2">
            <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-3">Leave Balance</p>
            {!balLoaded ? (
              <p className="text-xs text-on-surface-subtle">Loading…</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-on-surface-subtle mb-1">Full Day (carries forward)</label>
                    <input
                      type="number" min="0" max="365"
                      value={balAdj.full_day}
                      onChange={e => setBalAdj(b => ({ ...b, full_day: Number(e.target.value) }))}
                      className="num-mono w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-on-surface-subtle mb-1">Short Leave / Half Day credits</label>
                    <input
                      type="number" min="0" max="30"
                      value={balAdj.short_leave}
                      onChange={e => setBalAdj(b => ({ ...b, short_leave: Number(e.target.value) }))}
                      className="num-mono w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                </div>
                <button
                  onClick={handleSaveBalance}
                  disabled={savingBal}
                  className="w-full py-2 text-xs font-semibold text-on-accent bg-accent hover:opacity-90 rounded-lg disabled:opacity-60 transition-all"
                >
                  {savingBal ? 'Saving…' : balSaved ? '✓ Balance Updated' : 'Save Balance'}
                </button>
                {balError && <p className="text-xs text-danger">{balError}</p>}
              </div>
            )}
          </div>

          {/* ── Warnings & PIP ── */}
          <div className="mt-4 p-4 border border-outline rounded-xl-2">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">Warnings</p>
                {warnings.length > 0 && (
                  <span className={`num-mono text-xs font-bold px-2 py-0.5 rounded-full ${warnings.length >= 3 ? 'bg-danger-container text-danger' : warnings.length === 2 ? 'bg-warning-container text-warning' : 'bg-warning-container text-warning'}`}>
                    {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
                  </span>
                )}
              </div>
              <button onClick={() => setShowWarnForm(v => !v)}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-outline bg-warning-container text-warning hover:opacity-90 flex items-center gap-1 transition-opacity">
                <AlertTriangle size={11} /> Issue Warning
              </button>
            </div>

            {/* PIP banner */}
            {pip && (
              <div className="mb-3 p-3 rounded-xl-2 border border-outline bg-danger-container flex items-start gap-2">
                <Shield size={14} className="text-danger mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-danger">On Performance Improvement Plan (PIP)</p>
                  <p className="text-xs text-danger mt-0.5">
                    {new Date(pip.start_date + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {' → '}
                    {new Date(pip.end_date + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  {pip.goals && <p className="text-xs text-danger mt-1 italic">"{pip.goals}"</p>}
                </div>
                <select value={pip.status}
                  onChange={async e => { const updated = await api.updatePip(pip.id, { status: e.target.value }); setPip(updated.status === 'active' ? updated : null); }}
                  className="text-xs border border-outline rounded-lg px-1.5 py-1 bg-surface text-danger focus:outline-none flex-shrink-0">
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="dismissed">Dismissed</option>
                </select>
              </div>
            )}

            {/* Issue warning form */}
            {showWarnForm && (
              <div className="mb-3 p-3 rounded-xl-2 border border-outline bg-warning-container space-y-2.5">
                <div className="flex gap-2">
                  {(['warning','serious','final'] as const).map(s => (
                    <button key={s} onClick={() => setWarnSeverity(s)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border capitalize transition-all ${warnSeverity === s
                        ? s === 'final' ? 'bg-danger text-white border-danger' : s === 'serious' ? 'bg-warning text-white border-warning' : 'bg-warning text-white border-warning'
                        : 'bg-surface text-on-surface-muted border-outline hover:border-outline-strong'}`}>
                      {s}
                    </button>
                  ))}
                </div>
                <textarea value={warnReason} onChange={e => setWarnReason(e.target.value)} rows={2}
                  placeholder="Describe the reason for this warning…"
                  className="w-full text-xs bg-surface border border-outline rounded-lg px-2.5 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => setShowWarnForm(false)} className="flex-1 py-1.5 border border-outline rounded-lg text-xs font-medium text-on-surface-muted hover:bg-surface transition-colors">Cancel</button>
                  <button onClick={handleIssueWarning} disabled={issuingWarn || !warnReason.trim()}
                    className="flex-1 py-1.5 text-white rounded-lg text-xs font-semibold disabled:opacity-50 bg-warning hover:opacity-90 transition-opacity">
                    {issuingWarn ? 'Issuing…' : 'Issue Warning'}
                  </button>
                </div>
              </div>
            )}

            {/* Warning list */}
            {warnings.length === 0 ? (
              <p className="text-xs text-on-surface-subtle">No warnings on record.</p>
            ) : (
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <div key={w.id} className={`flex items-start gap-2.5 p-2.5 rounded-xl-2 border border-outline ${w.severity === 'final' ? 'bg-danger-container' : w.severity === 'serious' ? 'bg-warning-container' : 'bg-warning-container'}`}>
                    <div className={`num-mono w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${w.severity === 'final' ? 'bg-danger text-white' : w.severity === 'serious' ? 'bg-warning text-white' : 'bg-warning text-white'}`}>{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-on-surface-muted leading-snug">{w.reason}</p>
                      <p className="text-[10px] text-on-surface-subtle mt-0.5">
                        {w.issued_by ? `By ${w.issued_by} · ` : ''}{new Date(w.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <button onClick={async () => { await api.deleteWarning(w.id); setWarnings(prev => prev.filter(x => x.id !== w.id)); }}
                      className="text-on-surface-subtle hover:text-danger transition-colors flex-shrink-0 mt-0.5">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {warnings.length === 2 && !pip && (
              <p className="text-xs text-warning font-semibold mt-2 flex items-center gap-1">
                <AlertTriangle size={11} /> 1 more warning will trigger a PIP.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const SHIFT_OPTIONS = [
  { value: 'day',   label: 'Day Shift',   time: '9:00 AM – 6:00 PM' },
  { value: 'night', label: 'Night Shift', time: '6:30 PM – 3:30 AM' },
];

const emptyForm = {
  employee_id: '',
  shift: 'day',
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
  exit_date: '',
  exit_salary_override: '',
  salary: '',
  ctc: '',
  password: '',
  role: 'employee',
};

function AddEmployeeModal({ onClose, onSaved, existingEmployees, departments = [], designations = [] }: {
  onClose: () => void;
  onSaved: (emp: any) => void;
  existingEmployees: any[];
  departments?: string[];
  designations?: string[];
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

  const inputCls = 'w-full text-sm border border-outline rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent bg-surface text-on-surface';
  const labelCls = 'block text-xs font-medium text-on-surface-muted mb-1';

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
        shift: form.shift || 'day',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-container flex items-center justify-center">
              <User size={18} className="text-on-brand-container" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold tracking-tight text-on-surface">Add New Employee</h2>
              <p className="text-xs text-on-surface-subtle">Fill in details to onboard a new team member</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors">
            <X size={18} className="text-on-surface-subtle" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="p-4 bg-brand-container border border-outline rounded-xl-2">
            <label className="block text-xs font-semibold text-on-brand-container mb-1">
              Employee ID <span className="text-danger">*</span>
              <span className="ml-2 font-normal text-on-brand-container/70">(auto-suggested — you can change it)</span>
            </label>
            <input
              type="text"
              value={form.employee_id}
              onChange={e => set('employee_id', e.target.value.toUpperCase())}
              placeholder="e.g. DL0012"
              className="num-mono w-full text-sm font-semibold border border-outline rounded-lg px-3 py-2.5 bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent tracking-widest"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Full Name <span className="text-danger">*</span></label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Ravi Kumar" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email Address <span className="text-danger">*</span></label>
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
              <label className={labelCls}>Designation / Job Title <span className="text-danger">*</span></label>
              <input type="text" list="desig-list" value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="e.g. Software Engineer" className={inputCls} />
              {designations.length > 0 && <datalist id="desig-list">{designations.map(d => <option key={d} value={d} />)}</datalist>}
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
              <label className={labelCls}>Department <span className="text-danger">*</span></label>
              <select value={form.department} onChange={e => set('department', e.target.value)} className={inputCls}>
                {departments.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Join Date</label>
              <input type="date" value={form.join_date} onChange={e => set('join_date', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Date of Birth <span className="text-on-surface-subtle font-normal text-[10px]">(enables birthday optional leave)</span></label>
              <input type="date" value={(form as any).date_of_birth ?? ''} onChange={e => set('date_of_birth', e.target.value)} max={new Date().toISOString().split('T')[0]} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Shift</label>
              <select value={form.shift} onChange={e => set('shift', e.target.value)} className={inputCls}>
                {SHIFT_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label} ({s.time})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Exit Date <span className="text-on-surface-subtle font-normal">(if separated)</span></label>
              <input type="date" value={form.exit_date ?? ''} onChange={e => set('exit_date', e.target.value)} className={inputCls} />
            </div>
          </div>
          {form.exit_date && (
            <ExitSalarySection
              exitDate={form.exit_date}
              salary={Number(form.salary) || 0}
              override={form.exit_salary_override ?? ''}
              onOverrideChange={v => set('exit_salary_override', v)}
              inputCls={inputCls}
              labelCls={labelCls}
            />
          )}

          <div>
            <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-3">Compensation</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Monthly Gross Salary (₹)</label>
                <input type="number" value={form.salary} onChange={e => set('salary', e.target.value)} placeholder="e.g. 80000" className={inputCls + ' num-mono'} />
              </div>
              <div>
                <label className={labelCls}>Annual CTC (₹)</label>
                <input type="number" value={form.ctc} onChange={e => set('ctc', e.target.value)} placeholder="e.g. 1200000" className={inputCls + ' num-mono'} />
              </div>
            </div>
          </div>

          {/* Login Credentials */}
          <div className="border border-outline rounded-xl-2 overflow-hidden">
            <div className="px-4 py-3 bg-brand-container border-b border-outline">
              <p className="text-xs font-semibold text-on-brand-container uppercase tracking-wide">Login Credentials <span className="text-danger">*</span></p>
              <p className="text-xs text-on-brand-container/70 mt-0.5">Required — the employee will use these to log in to the portal.</p>
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
                <label className={labelCls}>Password <span className="text-danger">*</span></label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => set('password', e.target.value)}
                    placeholder="Min. 6 characters"
                    className={inputCls + ' pr-10'}
                  />
                  <button type="button" onClick={() => setShowPass(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-subtle hover:text-on-surface-muted">
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-danger bg-danger-container border border-outline rounded-lg px-4 py-2.5">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-on-surface-muted bg-surface-2 hover:bg-surface-3 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-on-accent bg-accent hover:opacity-90 shadow-elev-1 hover:shadow-elev-2 rounded-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {saving ? 'Saving…' : 'Add Employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EditEmployeeModal({ emp, onClose, onSaved, allEmployees, departments = [], designations = [] }: {
  emp: any;
  onClose: () => void;
  onSaved: (updated: any) => void;
  allEmployees: any[];
  departments?: string[];
  designations?: string[];
}) {
  const toDateStr = (v: any) => {
    if (!v) return '';
    const s = typeof v === 'string' ? v : String(v);
    if (s.includes('T')) { const d = new Date(s); d.setMinutes(d.getMinutes()+330); return d.toISOString().slice(0,10); }
    return s.slice(0,10);
  };
  const [form, setForm] = useState({
    name: emp.name || '',
    email: emp.email || '',
    phone: emp.phone || '',
    department: emp.department || 'Engineering',
    designation: emp.designation || '',
    join_date: toDateStr(emp.join_date) || new Date().toISOString().split('T')[0],
    date_of_birth: toDateStr(emp.date_of_birth) || '',
    // Exit date (last working day). When set, salary in the exit month
    // is prorated automatically by finComputeMonth, and from the
    // following month the employee disappears from the salary roll-up
    // without admin having to flip fin_employee_meta.active.
    exit_date: toDateStr(emp.exit_date) || '',
    // Manual override for the exit-month salary. Empty string = let the
    // working-day proration math decide; a number replaces it verbatim
    // (used for leave encashment, bonuses, deductions etc.).
    exit_salary_override: emp.exit_salary_override != null ? String(emp.exit_salary_override) : '',
    location: emp.location || '',
    manager: emp.manager || '',
    reporting_manager_id: emp.reporting_manager_id || '',
    status: emp.status || 'active',
    shift: emp.shift || 'day',
    salary: String(emp.salary || ''),
    ctc: String(emp.ctc || ''),
    next_appraisal_month: String(emp.next_appraisal_month || ''),
    next_appraisal_year: String(emp.next_appraisal_year || ''),
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const inputCls = 'w-full text-sm border border-outline rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent bg-surface text-on-surface';
  const labelCls = 'block text-xs font-medium text-on-surface-muted mb-1';

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
        reporting_manager_id: form.reporting_manager_id || null,
        date_of_birth: (form as any).date_of_birth || null,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-warning-container flex items-center justify-center">
              <Pencil size={17} className="text-warning" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold tracking-tight text-on-surface">Edit Employee</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="num-mono text-xs font-semibold text-on-brand-container bg-brand-container px-2 py-0.5 rounded">{emp.employee_id}</span>
                <span className="text-xs text-on-surface-subtle">{emp.name}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors">
            <X size={18} className="text-on-surface-subtle" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Full Name <span className="text-danger">*</span></label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email Address <span className="text-danger">*</span></label>
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
              <label className={labelCls}>Designation / Job Title <span className="text-danger">*</span></label>
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
              <label className={labelCls}>Department <span className="text-danger">*</span></label>
              <select value={form.department} onChange={e => set('department', e.target.value)} className={inputCls}>
                {departments.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Join Date</label>
              <input type="date" value={form.join_date} onChange={e => set('join_date', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Date of Birth <span className="text-on-surface-subtle font-normal text-[10px]">(enables birthday optional leave)</span></label>
              <input type="date" value={(form as any).date_of_birth ?? ''} onChange={e => set('date_of_birth', e.target.value)} max={new Date().toISOString().split('T')[0]} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Shift</label>
              <select value={form.shift} onChange={e => set('shift', e.target.value)} className={inputCls}>
                {SHIFT_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label} ({s.time})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Exit Date <span className="text-on-surface-subtle font-normal">(if separated)</span></label>
              <input type="date" value={form.exit_date ?? ''} onChange={e => set('exit_date', e.target.value)} className={inputCls} />
            </div>
          </div>
          {form.exit_date && (
            <ExitSalarySection
              exitDate={form.exit_date}
              salary={Number(form.salary) || 0}
              override={form.exit_salary_override ?? ''}
              onOverrideChange={v => set('exit_salary_override', v)}
              inputCls={inputCls}
              labelCls={labelCls}
            />
          )}

          <div>
            <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-3">Compensation</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Monthly Gross Salary (₹)</label>
                <input type="number" value={form.salary} onChange={e => set('salary', e.target.value)} placeholder="e.g. 80000" className={inputCls + ' num-mono'} />
              </div>
              <div>
                <label className={labelCls}>Annual CTC (₹)</label>
                <input type="number" value={form.ctc} onChange={e => set('ctc', e.target.value)} placeholder="e.g. 1200000" className={inputCls + ' num-mono'} />
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-3">Next Appraisal Schedule</p>
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
              <p className="text-xs mt-2 font-medium text-accent">
                Appraisal form will open for this employee in{' '}
                {['January','February','March','April','May','June','July','August','September','October','November','December'][Number(form.next_appraisal_month) - 1]}{' '}
                {form.next_appraisal_year}
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-danger bg-danger-container border border-outline rounded-lg px-4 py-2.5">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-on-surface-muted bg-surface-2 hover:bg-surface-3 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-on-accent bg-accent hover:opacity-90 shadow-elev-1 hover:shadow-elev-2 rounded-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Employees() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [designations, setDesignations] = useState<string[]>([]);
  const [warningCounts, setWarningCounts] = useState<Record<string, number>>({});
  const [pipEmployees, setPipEmployees] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
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
    api.getConfigDepartments().then(d => setDepartments(d.map((x: any) => x.name))).catch(() => {});
    api.getConfigDesignations().then(d => setDesignations(d.map((x: any) => x.name))).catch(() => {});
    api.getWarnings().then(ws => {
      const counts: Record<string, number> = {};
      (ws as any[]).forEach(w => { counts[w.employee_id] = (counts[w.employee_id] ?? 0) + 1; });
      setWarningCounts(counts);
    }).catch(() => {});
    api.getPips().then(pips => {
      setPipEmployees(new Set((pips as any[]).filter(p => p.status === 'active').map(p => p.employee_id)));
    }).catch(() => {});
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
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email or employee ID…"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface border border-outline rounded-lg text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent" />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-on-surface-subtle" />
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="text-sm border border-outline rounded-lg px-3 py-2.5 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent text-on-surface-muted">
            <option>All</option>
            {departments.map(d => <option key={d}>{d}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-outline rounded-lg px-3 py-2.5 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent text-on-surface-muted">
            <option>All</option>
            <option>active</option>
            <option>inactive</option>
          </select>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2.5 bg-accent hover:opacity-90 text-on-accent text-sm font-medium rounded-lg transition-all shadow-elev-1 hover:shadow-elev-2">
          <Plus size={15} /> Add Employee
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-outline border-t-accent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <p className="text-sm text-on-surface-subtle"><span className="num-mono">{filtered.length}</span> employee{filtered.length !== 1 ? 's' : ''} found</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((emp, i) => (
              <EmployeeCard key={emp.id} emp={emp} index={i} onClick={() => navigate(`/employees/${emp.employee_id || emp.id}`)}
                warningCount={warningCounts[emp.id] ?? 0} onPip={pipEmployees.has(emp.id)} />
            ))}
          </div>
        </>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-danger-container flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-danger" />
            </div>
            <h3 className="font-display font-semibold tracking-tight text-on-surface mb-1">Delete {confirmDelete.name}?</h3>
            <p className="text-sm text-on-surface-subtle mb-6">This will permanently remove the employee record. This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting}
                className="flex-1 py-2.5 border border-outline rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={deleting}
                className="flex-1 py-2.5 bg-danger hover:opacity-90 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-60">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <AddEmployeeModal
          existingEmployees={employees}
          departments={departments}
          designations={designations}
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

// Shared exit-month salary widget: shows live working-day proration
// based on the entered exit date + monthly salary, with an optional
// manual override input. Working days = Mon-Fri minus org holidays in
// that month (fetched via api.getHolidays). Matches the same math
// finComputeMonth runs server-side, so what the admin sees here is
// what'll land in the books.
function ExitSalarySection({ exitDate, salary, override, onOverrideChange, inputCls, labelCls }: {
  exitDate: string;
  salary: number;
  override: string;
  onOverrideChange: (v: string) => void;
  inputCls: string;
  labelCls: string;
}) {
  const parsed = useMemo(() => {
    const [y, m, d] = exitDate.split('-').map(Number);
    if (!y || !m || !d) return null;
    return { y, m, d };
  }, [exitDate]);
  const [holidaySet, setHolidaySet] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!parsed) return;
    api.getHolidays(parsed.y)
      .then(rows => {
        const s = new Set<string>();
        for (const r of rows) {
          const iso = String(r.date).slice(0, 10);
          if (Number(iso.slice(5, 7)) === parsed.m) s.add(iso);
        }
        setHolidaySet(s);
      })
      .catch(() => setHolidaySet(new Set()));
  }, [parsed?.y, parsed?.m]);

  const computed = useMemo(() => {
    if (!parsed) return null;
    const firstDay = new Date(Date.UTC(parsed.y, parsed.m - 1, 1));
    const lastDay = new Date(Date.UTC(parsed.y, parsed.m, 0));
    const exit = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    const cappedExit = exit < firstDay ? firstDay : exit > lastDay ? lastDay : exit;
    const countWorkingDays = (from: Date, to: Date) => {
      let n = 0;
      for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        const day = d.getUTCDay();
        if (day === 0 || day === 6) continue;
        const iso = d.toISOString().slice(0, 10);
        if (holidaySet.has(iso)) continue;
        n++;
      }
      return n;
    };
    const totalWorkingDays = countWorkingDays(firstDay, lastDay);
    const workedDays = countWorkingDays(firstDay, cappedExit);
    const factor = totalWorkingDays > 0 ? workedDays / totalWorkingDays : 0;
    const autoAmount = Math.round(salary * factor);
    const monthLabel = exit.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return { totalWorkingDays, workedDays, autoAmount, monthLabel };
  }, [parsed, holidaySet, salary]);

  const overrideNum = override.trim() === '' ? null : Number(override);
  const willCount = overrideNum != null && !Number.isNaN(overrideNum) ? Math.max(0, overrideNum) : (computed?.autoAmount ?? 0);

  return (
    <div className="rounded-xl-2 border border-danger/30 bg-danger-container/20 p-4 space-y-3 mt-4">
      <p className="text-xs font-semibold text-on-surface uppercase tracking-wide">Final-month salary · {computed?.monthLabel ?? '—'}</p>
      {computed && (
        <p className="text-xs text-on-surface-muted leading-snug">
          Auto-computed at <b className="text-on-surface num-mono">₹{computed.autoAmount.toLocaleString('en-IN')}</b>
          {' '}— <b className="text-on-surface num-mono">{computed.workedDays} of {computed.totalWorkingDays}</b> working days
          {salary > 0 && (
            <> ({(computed.workedDays / Math.max(1, computed.totalWorkingDays) * 100).toFixed(0)}% of <span className="num-mono">₹{salary.toLocaleString('en-IN')}</span>)</>
          )}.
          From the next month they're auto-excluded from the cost roll-up.
        </p>
      )}
      <div>
        <label className={labelCls}>Override (₹) <span className="text-on-surface-subtle font-normal">— optional, includes leave encashment, bonuses, deductions</span></label>
        <input type="number" min="0" step="0.01" value={override} onChange={e => onOverrideChange(e.target.value)}
          placeholder={computed ? String(computed.autoAmount) : 'Auto'}
          className={inputCls + ' num-mono'} />
        {overrideNum != null && !Number.isNaN(overrideNum) && computed && (
          <p className="mt-1 text-[11px] text-on-surface-muted">
            Will count <b className="text-on-surface num-mono">₹{Math.max(0, overrideNum).toLocaleString('en-IN')}</b> in {computed.monthLabel}
            {' '}{overrideNum > computed.autoAmount
              ? <>(<span className="text-success">+₹{Math.round(overrideNum - computed.autoAmount).toLocaleString('en-IN')}</span> over auto)</>
              : overrideNum < computed.autoAmount
                ? <>(<span className="text-danger">-₹{Math.round(computed.autoAmount - overrideNum).toLocaleString('en-IN')}</span> under auto)</>
                : '(matches auto)'}.
          </p>
        )}
        {(overrideNum == null || Number.isNaN(overrideNum)) && computed && (
          <p className="mt-1 text-[11px] text-on-surface-subtle">
            Leave blank to use the auto-computed <span className="num-mono">₹{willCount.toLocaleString('en-IN')}</span>.
          </p>
        )}
      </div>
    </div>
  );
}
