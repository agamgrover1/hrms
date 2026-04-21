import { useState, useEffect } from 'react';
import { Plus, Check, X, Clock, Calendar } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const leaveTypes = [
  { key: 'casual', label: 'Casual Leave', color: 'bg-blue-100 text-blue-700' },
  { key: 'sick', label: 'Sick Leave', color: 'bg-red-100 text-red-600' },
  { key: 'earned', label: 'Earned Leave', color: 'bg-green-100 text-green-700' },
  { key: 'maternity', label: 'Maternity', color: 'bg-pink-100 text-pink-600' },
  { key: 'paternity', label: 'Paternity', color: 'bg-purple-100 text-purple-600' },
];

const statusConfig = {
  pending: { label: 'Pending', icon: Clock, color: 'bg-amber-50 text-amber-600 border-amber-200' },
  approved: { label: 'Approved', icon: Check, color: 'bg-green-50 text-green-600 border-green-200' },
  rejected: { label: 'Rejected', icon: X, color: 'bg-red-50 text-red-500 border-red-200' },
};

function ApplyModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: any) => void }) {
  const [form, setForm] = useState({ type: 'casual', from: '', to: '', reason: '' });
  const handleSubmit = () => {
    if (!form.from || !form.to || !form.reason) return;
    const days = Math.max(1, Math.ceil((new Date(form.to).getTime() - new Date(form.from).getTime()) / 86400000) + 1);
    onSubmit({ ...form, days, from_date: form.from, to_date: form.to });
    onClose();
  };
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
              {leaveTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">From</label>
              <input type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">To</label>
              <input type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200" />
            </div>
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
  const [requests, setRequests] = useState<any[]>([]);
  const [balance, setBalance] = useState<any>({ casual: 0, sick: 0, earned: 0 });
  const [loading, setLoading] = useState(true);

  const loadRequests = () => api.getLeaveRequests().then(setRequests);

  useEffect(() => {
    Promise.all([
      loadRequests(),
      // Use the first employee's balance for the HR manager view
      api.getLeaveBalance('e5').then(setBalance).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const displayed = tab === 'all' ? requests : requests.filter(r => r.status === tab);

  const updateStatus = async (id: string, status: 'approved' | 'rejected') => {
    await api.updateLeaveStatus(id, status);
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
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
        {[
          { key: 'casual', label: 'Casual Leave', color: 'from-blue-500 to-blue-400' },
          { key: 'sick', label: 'Sick Leave', color: 'from-red-500 to-red-400' },
          { key: 'earned', label: 'Earned Leave', color: 'from-green-500 to-green-400' },
        ].map(({ key, label, color }) => (
          <div key={key} className={`bg-gradient-to-br ${color} rounded-xl p-5 text-white`}>
            <p className="text-white/70 text-sm font-medium">{label}</p>
            <p className="text-4xl font-bold mt-2">{balance[key] ?? 0}</p>
            <p className="text-white/60 text-xs mt-1">days remaining</p>
          </div>
        ))}
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
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Employee', 'Type', 'Duration', 'Days', 'Reason', 'Applied On', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map(req => {
                const cfg = statusConfig[req.status as keyof typeof statusConfig];
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
                    <td className="px-4 py-3 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <Calendar size={12} className="text-gray-400" />
                        {new Date(req.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        {req.from_date !== req.to_date && ` – ${new Date(req.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-700">{req.days}d</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{req.reason}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(req.applied_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium ${cfg?.color}`}>
                        <cfg.icon size={11} /> {cfg?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {req.status === 'pending' && (
                        <div className="flex gap-1.5">
                          <button onClick={() => updateStatus(req.id, 'approved')} className="px-2.5 py-1 text-xs bg-green-50 text-green-600 rounded-md hover:bg-green-100 font-medium">Approve</button>
                          <button onClick={() => updateStatus(req.id, 'rejected')} className="px-2.5 py-1 text-xs bg-red-50 text-red-500 rounded-md hover:bg-red-100 font-medium">Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loading && displayed.length === 0 && (
          <div className="py-16 text-center text-gray-400 text-sm">No leave requests found.</div>
        )}
      </div>

      {showApply && <ApplyModal onClose={() => setShowApply(false)} onSubmit={handleApply} />}
    </div>
  );
}
