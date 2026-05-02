import { useState, useEffect } from 'react';
import { TrendingUp, CheckCircle, XCircle, Clock, DollarSign, X, Check } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

function parseLocalDate(d: string): Date {
  if (!d) return new Date(NaN);
  if (d.includes('T')) { const dt = new Date(d); return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); }
  const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd);
}

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending:  { label: 'Pending Review', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  approved: { label: 'Approved',       color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  rejected: { label: 'Not Approved',   color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  paid:     { label: 'Paid',           color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
};

export default function Incentives() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [tab, setTab] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'paid'>('all');
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState<any | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'pay' | null>(null);
  const [approvedAmt, setApprovedAmt] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [payNote, setPayNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getUpsellRequests().then(setRequests).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const displayed = tab === 'all' ? requests : requests.filter(r => r.status === tab);

  const handleAction = async () => {
    if (!actionTarget || !actionType) return;
    setSaving(true);
    try {
      const data: any = { status: actionType === 'approve' ? 'approved' : actionType === 'pay' ? 'paid' : 'rejected', reviewed_by: user?.name };
      if (actionType === 'approve' && approvedAmt) data.approved_amount = Number(approvedAmt);
      if (actionType === 'reject') data.rejection_reason = rejectReason;
      if (actionType === 'pay') data.payment_note = payNote;
      const updated = await api.reviewUpsell(actionTarget.id, data);
      setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
      setActionTarget(null); setActionType(null); setApprovedAmt(''); setRejectReason(''); setPayNote('');
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const fmtAmt = (n: any) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Requests',  value: requests.length,                              color: '#192250', bg: 'rgba(25,34,80,0.07)',    icon: TrendingUp },
          { label: 'Pending',         value: requests.filter(r=>r.status==='pending').length, color: '#d97706', bg: 'rgba(217,119,6,0.08)',  icon: Clock },
          { label: 'Approved',        value: requests.filter(r=>r.status==='approved').length,color: '#15803d', bg: 'rgba(22,163,74,0.08)',  icon: CheckCircle },
          { label: 'Total Paid',      value: fmtAmt(requests.filter(r=>r.status==='paid').reduce((s,r)=>s+Number(r.approved_amount??r.requested_amount),0) || null), color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', icon: DollarSign },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: bg }}>
              <Icon size={18} style={{ color }} />
            </div>
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
            <p className="text-xs text-gray-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {(['all','pending','approved','rejected','paid'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-all ${tab===t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'all' ? 'All' : STATUS_CFG[t]?.label ?? t}
            {t !== 'all' && (
              <span className="ml-1.5 text-xs font-bold">{requests.filter(r=>r.status===t).length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <TrendingUp size={32} className="text-gray-200" />
            <p className="text-gray-400 font-medium">No incentive requests</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f8f9fc' }}>
                  {['Employee','Client','Service','Deal Value','Requested','Approved','Submitted','Status','Action'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map(r => {
                  const cfg = STATUS_CFG[r.status] ?? STATUS_CFG.pending;
                  return (
                    <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3.5 font-medium text-gray-800">{r.employee_name ?? '—'}</td>
                      <td className="px-4 py-3.5 text-gray-700 font-medium">{r.client_name}</td>
                      <td className="px-4 py-3.5 text-gray-500 max-w-[160px] truncate">{r.service_description}</td>
                      <td className="px-4 py-3.5 text-gray-600">{fmtAmt(r.deal_value)}</td>
                      <td className="px-4 py-3.5 font-semibold" style={{ color: '#192250' }}>{fmtAmt(r.requested_amount)}</td>
                      <td className="px-4 py-3.5 font-semibold text-green-700">{fmtAmt(r.approved_amount)}</td>
                      <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-xs px-2.5 py-1 rounded-full font-semibold border"
                          style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                          {cfg.label}
                        </span>
                        {r.rejection_reason && <p className="text-xs text-red-400 mt-0.5 max-w-[120px] truncate italic">"{r.rejection_reason}"</p>}
                        {r.payment_note && <p className="text-xs text-purple-500 mt-0.5 max-w-[120px] truncate">{r.payment_note}</p>}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex gap-1.5 flex-wrap">
                          {r.status === 'pending' && (
                            <>
                              <button onClick={() => { setActionTarget(r); setActionType('approve'); setApprovedAmt(String(r.requested_amount)); }}
                                className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white" style={{ background: '#15803d' }}>
                                Approve
                              </button>
                              <button onClick={() => { setActionTarget(r); setActionType('reject'); }}
                                className="text-xs px-2.5 py-1 rounded-lg font-semibold" style={{ background: '#fee2e2', color: '#dc2626' }}>
                                Reject
                              </button>
                            </>
                          )}
                          {r.status === 'approved' && (
                            <button onClick={() => { setActionTarget(r); setActionType('pay'); }}
                              className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white" style={{ background: '#7c3aed' }}>
                              Mark Paid
                            </button>
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
      </div>

      {/* Action modal */}
      {actionTarget && actionType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold" style={{ color: '#192250' }}>
                {actionType === 'approve' ? 'Approve Incentive' : actionType === 'reject' ? 'Reject Request' : 'Mark as Paid'}
              </h3>
              <button onClick={() => { setActionTarget(null); setActionType(null); }}><X size={16} className="text-gray-400" /></button>
            </div>

            <div className="space-y-1 mb-4 p-3 rounded-xl" style={{ background: 'rgba(25,34,80,0.04)' }}>
              <p className="text-sm font-semibold text-gray-800">{actionTarget.employee_name} → {actionTarget.client_name}</p>
              <p className="text-xs text-gray-500">{actionTarget.service_description}</p>
              <p className="text-sm font-bold mt-1" style={{ color: '#192250' }}>Requested: {fmtAmt(actionTarget.requested_amount)}</p>
            </div>

            <div className="space-y-3">
              {actionType === 'approve' && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">Approved Amount (₹)</label>
                  <input type="number" value={approvedAmt} onChange={e => setApprovedAmt(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-200" />
                  <p className="text-xs text-gray-400 mt-1">You can adjust the amount before approving.</p>
                </div>
              )}
              {actionType === 'reject' && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">Reason (optional)</label>
                  <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
                    placeholder="Explain why this request isn't approved…"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none resize-none" />
                </div>
              )}
              {actionType === 'pay' && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">Payment Note (optional)</label>
                  <input value={payNote} onChange={e => setPayNote(e.target.value)}
                    placeholder="e.g. Paid via April payroll"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none" />
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setActionTarget(null); setActionType(null); }}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={handleAction} disabled={saving}
                  className="flex-1 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ background: actionType === 'reject' ? '#dc2626' : actionType === 'pay' ? '#7c3aed' : '#15803d' }}>
                  {saving ? 'Saving…' : actionType === 'approve' ? <><Check size={14} /> Approve</> : actionType === 'pay' ? '💰 Mark Paid' : <><XCircle size={14} /> Reject</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
