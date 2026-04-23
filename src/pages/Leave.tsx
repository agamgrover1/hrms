import { useState, useEffect } from 'react';
import { Plus, Check, X, Clock, Calendar, User, ChevronDown } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

function parseLocalDate(dateStr: string): Date {
  const s = (dateStr ?? '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const leaveTypes = [
  { key: 'full_day',    label: 'Full Day',    color: 'bg-blue-100 text-blue-700' },
  { key: 'half_day',   label: 'Half Day',    color: 'bg-purple-100 text-purple-600' },
  { key: 'short_leave',label: 'Short Leave', color: 'bg-amber-100 text-amber-700' },
  { key: 'unpaid',     label: 'Unpaid',      color: 'bg-rose-100 text-rose-600' },
  // legacy types kept for display of old records
  { key: 'casual',     label: 'Casual',      color: 'bg-blue-100 text-blue-700' },
  { key: 'sick',       label: 'Sick',        color: 'bg-red-100 text-red-600' },
  { key: 'earned',     label: 'Earned',      color: 'bg-green-100 text-green-700' },
];

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function LeaveStatusBadge({ req }: { req: any }) {
  if (req.status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-green-50 text-green-600 border-green-200">
        <Check size={11} /> Approved
      </span>
    );
  }
  if (req.status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-gray-100 text-gray-500 border-gray-200">
        <X size={11} /> Cancelled
      </span>
    );
  }
  if (req.status === 'rejected') {
    const byMgr = req.manager_status === 'rejected';
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-red-50 text-red-500 border-red-200">
        <X size={11} /> {byMgr ? 'Rejected by Manager' : 'Rejected by HR'}
      </span>
    );
  }
  if (req.manager_status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-blue-50 text-blue-600 border-blue-200">
        <Clock size={11} /> Pending HR ✓Mgr
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-amber-50 text-amber-600 border-amber-200">
      <Clock size={11} /> Awaiting Manager
    </span>
  );
}

function ActionTrail({ req }: { req: any }) {
  const lines: { label: string; name: string | null; at: string | null; reason?: string | null; color: string }[] = [];

  if (req.manager_status === 'approved' || req.manager_status === 'rejected') {
    lines.push({
      label: req.manager_status === 'approved' ? 'Mgr Approved' : 'Mgr Rejected',
      name: req.manager_name ?? null,
      at: req.manager_approved_at ?? null,
      reason: req.manager_rejection_reason ?? null,
      color: req.manager_status === 'approved' ? 'text-green-600' : 'text-red-500',
    });
  }
  if (req.hr_actioned_at) {
    lines.push({
      label: req.status === 'approved' ? 'HR Approved' : 'HR Rejected',
      name: req.hr_actioner_name ?? null,
      at: req.hr_actioned_at ?? null,
      reason: req.rejection_reason ?? null,
      color: req.status === 'approved' ? 'text-green-600' : 'text-red-500',
    });
  }
  if (req.cancelled_at) {
    lines.push({
      label: 'Cancelled',
      name: req.cancelled_by ?? null,
      at: req.cancelled_at ?? null,
      reason: req.cancellation_reason ?? null,
      color: 'text-gray-500',
    });
  }

  if (!lines.length) return null;
  return (
    <div className="space-y-1">
      {lines.map((l, i) => (
        <div key={i} className="text-xs leading-tight">
          <span className={`font-semibold ${l.color}`}>{l.label}</span>
          {l.name && <span className="text-gray-500"> · {l.name}</span>}
          {l.at && <span className="text-gray-400 block">{fmtDateTime(l.at)}</span>}
          {l.reason && <span className="text-red-400 italic block">"{l.reason}"</span>}
        </div>
      ))}
    </div>
  );
}

function RejectReasonModal({
  onClose, onConfirm,
  title = 'Reason for Rejection',
  placeholder = 'Enter reason (required)...',
  confirmLabel = 'Confirm Reject',
  confirmClass = 'bg-red-500 hover:bg-red-600',
}: {
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title?: string;
  placeholder?: string;
  confirmLabel?: string;
  confirmClass?: string;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose}><X size={16} className="text-gray-400" /></button>
        </div>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder={placeholder}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 resize-none mb-4"
          autoFocus
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => { if (reason.trim()) { onConfirm(reason.trim()); onClose(); } }}
            disabled={!reason.trim()}
            className={`flex-1 py-2.5 disabled:opacity-40 text-white rounded-lg text-sm font-medium ${confirmClass}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ApplyModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: any) => void }) {
  const [form, setForm] = useState({ type: 'full_day', from: '', to: '', reason: '' });
  const handleSubmit = () => {
    if (!form.from || !form.to || !form.reason) return;
    const isSingleDay = form.type === 'half_day' || form.type === 'short_leave';
    const days = isSingleDay ? 1 : Math.max(1, Math.ceil((new Date(form.to).getTime() - new Date(form.from).getTime()) / 86400000) + 1);
    onSubmit({ ...form, days, from_date: form.from, to_date: form.to });
    onClose();
  };
  const newTypes = leaveTypes.filter(t => !['casual', 'sick', 'earned'].includes(t.key));
  const isSingleDay = form.type === 'half_day' || form.type === 'short_leave';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-900">Apply for Leave</h3>
          <button onClick={onClose}><X size={16} className="text-gray-400" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Leave Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 bg-white">
              {newTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            {form.type === 'half_day' && <p className="text-xs text-purple-600 mt-1">Uses 1 half day (= 2 short leave credits)</p>}
            {form.type === 'short_leave' && <p className="text-xs text-amber-600 mt-1">Uses 1 short leave credit (2 allowed per month)</p>}
            {form.type === 'full_day' && <p className="text-xs text-blue-600 mt-1">Uses 1 full day credit — carries forward if unused</p>}
            {form.type === 'unpaid' && <p className="text-xs text-rose-600 mt-1">No credits deducted — attendance marked as Unpaid Leave</p>}
          </div>
          <div className={isSingleDay ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">{isSingleDay ? 'Date' : 'From'}</label>
              <input type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value, to: isSingleDay ? e.target.value : f.to }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200" />
            </div>
            {!isSingleDay && (
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">To</label>
                <input type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200" />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Reason</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              rows={3} placeholder="Brief reason for leave..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button onClick={handleSubmit} className="flex-1 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg text-sm font-medium">Submit</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmployeeLeaveBalance({ balance }: { balance: any }) {
  if (!balance) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {balance.on_probation ? (
        <>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Status</p>
            <p className="text-lg font-bold text-amber-700 mt-1">On Probation</p>
            {balance.probation_end_date && (
              <p className="text-xs text-amber-500 mt-0.5">
                Ends {new Date(balance.probation_end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            )}
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Probation Credits</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{balance.probation_short_remaining ?? 0}</p>
            <p className="text-xs text-amber-500 mt-0.5">remaining</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 opacity-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Full Day</p>
            <p className="text-2xl font-bold text-gray-400 mt-1">—</p>
            <p className="text-xs text-gray-400 mt-0.5">post-probation</p>
          </div>
        </>
      ) : (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Full Day</p>
            <p className="text-2xl font-bold text-blue-700 mt-1">{balance.full_day ?? 0}</p>
            <p className="text-xs text-blue-500 mt-0.5">days available</p>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">Short / Half Day</p>
            <p className="text-2xl font-bold text-purple-700 mt-1">{balance.short_leave ?? 0}</p>
            <p className="text-xs text-purple-500 mt-0.5">credits this month</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">Status</p>
            <p className="text-lg font-bold text-green-700 mt-1">Confirmed</p>
            <p className="text-xs text-green-500 mt-0.5">probation complete</p>
          </div>
        </>
      )}
    </div>
  );
}

export default function Leave() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'>('all');
  const [showApply, setShowApply] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Employee filter
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [empBalance, setEmpBalance] = useState<any>(null);
  const [loadingEmpBal, setLoadingEmpBal] = useState(false);

  const loadRequests = (empId?: string) =>
    api.getLeaveRequests(empId ? { employee_id: empId } : undefined).then(setRequests);

  useEffect(() => {
    Promise.all([
      api.getEmployees().then(emps => setEmployees(emps)),
      loadRequests(),
      api.getLeaveBalance('e5').then(setBalance).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  // When an employee is selected, reload leaves + balance for that employee
  useEffect(() => {
    if (!selectedEmpId) {
      setEmpBalance(null);
      loadRequests();
      return;
    }
    setLoadingEmpBal(true);
    Promise.all([
      loadRequests(selectedEmpId),
      api.getLeaveBalance(selectedEmpId).then(setEmpBalance).catch(() => setEmpBalance(null)),
    ]).finally(() => setLoadingEmpBal(false));
  }, [selectedEmpId]);

  const displayed = tab === 'all' ? requests : requests.filter(r => r.status === tab);

  const handleApprove = async (id: string) => {
    await api.updateLeaveStatus(id, 'approved', { actioner_name: user?.name });
    setRequests(prev => prev.map(r => r.id === id ? {
      ...r, status: 'approved', hr_actioner_name: user?.name, hr_actioned_at: new Date().toISOString()
    } : r));
  };

  const handleReject = async (id: string, rejection_reason: string) => {
    await api.updateLeaveStatus(id, 'rejected', { actioner_name: user?.name, rejection_reason });
    setRequests(prev => prev.map(r => r.id === id ? {
      ...r, status: 'rejected', hr_actioner_name: user?.name, hr_actioned_at: new Date().toISOString(), rejection_reason
    } : r));
  };

  const handleCancel = async (id: string, cancellation_reason: string) => {
    await api.cancelLeave(id, user?.name ?? 'Admin', cancellation_reason);
    setRequests(prev => prev.map(r => r.id === id ? {
      ...r, status: 'cancelled', cancelled_by: user?.name, cancelled_at: new Date().toISOString(), cancellation_reason
    } : r));
    // Refresh the selected employee's balance if viewing one
    if (selectedEmpId) {
      api.getLeaveBalance(selectedEmpId).then(setEmpBalance).catch(() => {});
    }
  };

  const handleApply = async (data: any) => {
    await api.applyLeave({
      ...data,
      employee_id: 'e5',
      employee_name: user?.name ?? 'HR Manager',
    });
    await loadRequests(selectedEmpId || undefined);
  };

  const selectedEmp = employees.find(e => e.id === selectedEmpId);

  return (
    <div className="space-y-5">
      {/* Leave Balance (own) */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-blue-500 to-blue-400 rounded-xl p-5 text-white">
          <p className="text-white/70 text-sm font-medium">Full Day Leave</p>
          <p className="text-4xl font-bold mt-2">{balance?.full_day ?? 0}</p>
          <p className="text-white/60 text-xs mt-1">days (carry forward)</p>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-400 rounded-xl p-5 text-white">
          <p className="text-white/70 text-sm font-medium">Short Leave / Half Day</p>
          <p className="text-4xl font-bold mt-2">{balance?.short_leave ?? 0}</p>
          <p className="text-white/60 text-xs mt-1">credits this month</p>
        </div>
        <div className={`rounded-xl p-5 text-white ${balance?.on_probation ? 'bg-gradient-to-br from-amber-500 to-amber-400' : 'bg-gradient-to-br from-green-500 to-green-400'}`}>
          <p className="text-white/70 text-sm font-medium">{balance?.on_probation ? 'Probation Status' : 'Probation'}</p>
          {balance?.on_probation ? (
            <>
              <p className="text-4xl font-bold mt-2">{balance.probation_short_remaining ?? 0}</p>
              <p className="text-white/60 text-xs mt-1">short leave credits left</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold mt-2">Confirmed</p>
              <p className="text-white/60 text-xs mt-1">past 90-day probation</p>
            </>
          )}
        </div>
      </div>

      {/* Employee filter + toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Employee selector */}
        <div className="relative">
          <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <select
            value={selectedEmpId}
            onChange={e => setSelectedEmpId(e.target.value)}
            className="pl-8 pr-8 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 text-gray-700 appearance-none min-w-[200px]"
          >
            <option value="">All Employees</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.name} ({e.employee_id})</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['all', 'pending', 'approved', 'rejected', 'cancelled'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-all ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t}
              {t !== 'all' && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  t === 'pending' ? 'bg-amber-100 text-amber-600' :
                  t === 'approved' ? 'bg-green-100 text-green-600' :
                  t === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                  'bg-red-100 text-red-500'
                }`}>
                  {requests.filter(r => r.status === t).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="ml-auto">
          <button onClick={() => setShowApply(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
            <Plus size={15} /> Apply Leave
          </button>
        </div>
      </div>

      {/* Selected employee balance card */}
      {selectedEmpId && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-bold">
              {selectedEmp?.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">{selectedEmp?.name}</p>
              <p className="text-xs text-gray-400">{selectedEmp?.designation} · {selectedEmp?.department}</p>
            </div>
            <span className="ml-auto text-xs text-gray-400">Leave Balance</span>
          </div>
          {loadingEmpBal ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
              <div className="w-4 h-4 border-2 border-gray-200 border-t-primary-400 rounded-full animate-spin" />
              Loading balance…
            </div>
          ) : (
            <EmployeeLeaveBalance balance={empBalance} />
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['Employee', 'Type', 'Duration', 'Days', 'Reason', 'Applied On', 'Status', 'Action Trail', 'Actions'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map(req => {
                  const typeConfig = leaveTypes.find(t => t.key === req.type);
                  return (
                    <tr key={req.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-semibold">
                            {req.employee_name.split(' ').map((n: string) => n[0]).join('')}
                          </div>
                          <span className="text-sm font-medium text-gray-800">{req.employee_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${typeConfig?.color}`}>{typeConfig?.label}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <Calendar size={12} className="text-gray-400" />
                          {parseLocalDate(req.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {req.from_date !== req.to_date && ` – ${parseLocalDate(req.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-700">{req.days}d</td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px] truncate">{req.reason}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-gray-400 mb-0.5">
                          <User size={10} />
                          <span className="text-gray-600 font-medium">{req.employee_name}</span>
                        </div>
                        {fmtDateTime(req.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <LeaveStatusBadge req={req} />
                      </td>
                      <td className="px-4 py-3 min-w-[180px]">
                        <ActionTrail req={req} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5 flex-wrap">
                          {req.status === 'pending' && (
                            <>
                              <button onClick={() => handleApprove(req.id)} className="px-2.5 py-1 text-xs bg-green-50 text-green-600 rounded-md hover:bg-green-100 font-medium">Approve</button>
                              <button onClick={() => setRejectTarget(req.id)} className="px-2.5 py-1 text-xs bg-red-50 text-red-500 rounded-md hover:bg-red-100 font-medium">Reject</button>
                            </>
                          )}
                          {req.status === 'approved' && (
                            <button onClick={() => setCancelTarget(req.id)} className="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 font-medium">Cancel Leave</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && displayed.length === 0 && (
          <div className="py-16 text-center text-gray-400 text-sm">
            {selectedEmpId ? `No ${tab === 'all' ? '' : tab + ' '}leave requests for ${selectedEmp?.name}.` : 'No leave requests found.'}
          </div>
        )}
      </div>

      {showApply && <ApplyModal onClose={() => setShowApply(false)} onSubmit={handleApply} />}
      {rejectTarget && (
        <RejectReasonModal
          onClose={() => setRejectTarget(null)}
          onConfirm={reason => handleReject(rejectTarget, reason)}
        />
      )}
      {cancelTarget && (
        <RejectReasonModal
          title="Reason for Cancellation"
          placeholder="Enter reason for cancelling this approved leave..."
          confirmLabel="Confirm Cancel"
          confirmClass="bg-gray-700 hover:bg-gray-800"
          onClose={() => setCancelTarget(null)}
          onConfirm={reason => handleCancel(cancelTarget, reason)}
        />
      )}
    </div>
  );
}
