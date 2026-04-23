import { useState, useEffect } from 'react';
import { Plus, Check, X, Clock, Calendar, User } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

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
  if (req.status === 'rejected') {
    const byMgr = req.manager_status === 'rejected';
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-red-50 text-red-500 border-red-200">
        <X size={11} /> {byMgr ? 'Rejected by Manager' : 'Rejected by HR'}
      </span>
    );
  }
  // status = pending
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

function RejectReasonModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Reason for Rejection</h3>
          <button onClick={onClose}><X size={16} className="text-gray-400" /></button>
        </div>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder="Enter reason (required)..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 resize-none mb-4"
          autoFocus
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => { if (reason.trim()) { onConfirm(reason.trim()); onClose(); } }}
            disabled={!reason.trim()}
            className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white rounded-lg text-sm font-medium">
            Confirm Reject
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

export default function Leave() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [showApply, setShowApply] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [balance, setBalance] = useState<any>({ casual: 0, sick: 0, earned: 0 });
  const [loading, setLoading] = useState(true);

  const loadRequests = () => api.getLeaveRequests().then(setRequests);

  useEffect(() => {
    Promise.all([
      loadRequests(),
      api.getLeaveBalance('e5').then(setBalance).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

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

  const handleApply = async (data: any) => {
    await api.applyLeave({
      ...data,
      employee_id: 'e5',
      employee_name: user?.name ?? 'HR Manager',
    });
    await loadRequests();
  };

  return (
    <div className="space-y-5">
      {/* Leave Balance */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-blue-500 to-blue-400 rounded-xl p-5 text-white">
          <p className="text-white/70 text-sm font-medium">Full Day Leave</p>
          <p className="text-4xl font-bold mt-2">{balance.full_day ?? 0}</p>
          <p className="text-white/60 text-xs mt-1">days (carry forward)</p>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-400 rounded-xl p-5 text-white">
          <p className="text-white/70 text-sm font-medium">Short Leave / Half Day</p>
          <p className="text-4xl font-bold mt-2">{balance.short_leave ?? 0}</p>
          <p className="text-white/60 text-xs mt-1">credits this month</p>
        </div>
        <div className={`rounded-xl p-5 text-white ${balance.on_probation ? 'bg-gradient-to-br from-amber-500 to-amber-400' : 'bg-gradient-to-br from-green-500 to-green-400'}`}>
          <p className="text-white/70 text-sm font-medium">{balance.on_probation ? 'Probation Status' : 'Probation'}</p>
          {balance.on_probation ? (
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

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['all', 'pending', 'approved', 'rejected'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-all ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t}
              {t !== 'all' && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold ${t === 'pending' ? 'bg-amber-100 text-amber-600' : t === 'approved' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
                  {requests.filter(r => r.status === t).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <button onClick={() => setShowApply(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
          <Plus size={15} /> Apply Leave
        </button>
      </div>

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
                          {new Date(req.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {req.from_date !== req.to_date && ` – ${new Date(req.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
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
                        {req.status === 'pending' && (
                          <div className="flex gap-1.5">
                            <button onClick={() => handleApprove(req.id)} className="px-2.5 py-1 text-xs bg-green-50 text-green-600 rounded-md hover:bg-green-100 font-medium">Approve</button>
                            <button onClick={() => setRejectTarget(req.id)} className="px-2.5 py-1 text-xs bg-red-50 text-red-500 rounded-md hover:bg-red-100 font-medium">Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && displayed.length === 0 && (
          <div className="py-16 text-center text-gray-400 text-sm">No leave requests found.</div>
        )}
      </div>

      {showApply && <ApplyModal onClose={() => setShowApply(false)} onSubmit={handleApply} />}
      {rejectTarget && (
        <RejectReasonModal
          onClose={() => setRejectTarget(null)}
          onConfirm={reason => handleReject(rejectTarget, reason)}
        />
      )}
    </div>
  );
}
