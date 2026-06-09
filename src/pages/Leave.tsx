import { useState, useEffect } from 'react';
import { Plus, Check, X, Clock, Calendar, User, ChevronDown, Edit3 } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  if (dateStr.includes('T')) {
    const d = new Date(dateStr);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const leaveTypes = [
  { key: 'full_day',    label: 'Full Day',    color: 'bg-brand-container text-on-brand-container' },
  { key: 'half_day',   label: 'Half Day',    color: 'bg-purple-100 text-purple-600' },
  { key: 'short_leave',label: 'Short Leave', color: 'bg-warning-container text-warning' },
  { key: 'unpaid',     label: 'Unpaid',      color: 'bg-danger-container text-danger' },
  { key: 'optional',   label: 'Optional',    color: 'bg-teal-100 text-teal-700' },
  // legacy types kept for display of old records
  { key: 'casual',     label: 'Casual',      color: 'bg-brand-container text-on-brand-container' },
  { key: 'sick',       label: 'Sick',        color: 'bg-danger-container text-danger' },
  { key: 'earned',     label: 'Earned',      color: 'bg-success-container text-success' },
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
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-success-container text-success border-success/20">
        <Check size={11} /> Approved
      </span>
    );
  }
  if (req.status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-surface-2 text-on-surface-muted border-outline">
        <X size={11} /> Cancelled
      </span>
    );
  }
  if (req.status === 'rejected') {
    const byMgr = req.manager_status === 'rejected';
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-danger-container text-danger border-danger/20">
        <X size={11} /> {byMgr ? 'Rejected by Manager' : 'Rejected by HR'}
      </span>
    );
  }
  if (req.manager_status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-brand-container text-on-brand-container border-brand/20">
        <Clock size={11} /> Pending HR ✓Mgr
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-warning-container text-warning border-warning/20">
      <Clock size={11} /> Pending Approval
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
      color: req.manager_status === 'approved' ? 'text-success' : 'text-danger',
    });
  }
  if (req.hr_actioned_at) {
    lines.push({
      label: req.status === 'approved' ? 'HR Approved' : 'HR Rejected',
      name: req.hr_actioner_name ?? null,
      at: req.hr_actioned_at ?? null,
      reason: req.rejection_reason ?? null,
      color: req.status === 'approved' ? 'text-success' : 'text-danger',
    });
  }
  if (req.cancelled_at) {
    lines.push({
      label: 'Cancelled',
      name: req.cancelled_by ?? null,
      at: req.cancelled_at ?? null,
      reason: req.cancellation_reason ?? null,
      color: 'text-on-surface-muted',
    });
  }

  if (!lines.length) return null;
  return (
    <div className="space-y-1">
      {lines.map((l, i) => (
        <div key={i} className="text-xs leading-tight">
          <span className={`font-semibold ${l.color}`}>{l.label}</span>
          {l.name && <span className="text-on-surface-muted"> · {l.name}</span>}
          {l.at && <span className="text-on-surface-subtle block">{fmtDateTime(l.at)}</span>}
          {l.reason && <span className="text-danger/70 italic block">"{l.reason}"</span>}
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
  confirmClass = 'bg-danger hover:opacity-90',
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
      <div className="bg-surface rounded-xl-2 shadow-elev-3 w-full max-w-sm p-6 border border-outline">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-base font-semibold tracking-tight text-on-surface">{title}</h3>
          <button onClick={onClose}><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder={placeholder}
          className="w-full border border-outline bg-surface rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/20 resize-none mb-4"
          autoFocus
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-outline text-on-surface-muted rounded-lg text-sm font-medium hover:bg-surface-2 transition-colors">Cancel</button>
          <button
            onClick={() => { if (reason.trim()) { onConfirm(reason.trim()); onClose(); } }}
            disabled={!reason.trim()}
            className={`flex-1 py-2.5 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-opacity ${confirmClass}`}>
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
    if (!form.from || !form.to || !form.reason?.trim()) return;
    const isSingleDay = form.type === 'half_day' || form.type === 'short_leave';
    const countWorkingDays = (from: string, to: string) => {
      let count = 0, cur = from;
      while (cur <= to) {
        const dow = new Date(cur + 'T12:00:00Z').getUTCDay();
        if (dow !== 0 && dow !== 6) count++;
        const d = new Date(cur + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
        cur = d.toISOString().slice(0, 10);
      }
      return Math.max(1, count);
    };
    const days = isSingleDay ? 1 : countWorkingDays(form.from, form.to);
    onSubmit({ ...form, days, from_date: form.from, to_date: form.to });
    onClose();
  };
  const newTypes = leaveTypes.filter(t => !['casual', 'sick', 'earned'].includes(t.key));
  const isSingleDay = form.type === 'half_day' || form.type === 'short_leave';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-xl-2 shadow-elev-3 w-full max-w-md p-6 border border-outline">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display text-lg font-semibold tracking-tight text-on-surface">Apply for Leave</h3>
          <button onClick={onClose}><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Leave Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/20 bg-surface">
              {newTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            {form.type === 'half_day' && <p className="text-xs text-purple-600 mt-1">Uses 1 half day (= 2 short leave credits)</p>}
            {form.type === 'short_leave' && <p className="text-xs text-warning mt-1">Uses 1 short leave credit (2 allowed per month)</p>}
            {form.type === 'full_day' && <p className="text-xs text-on-brand-container mt-1">Uses 1 full day credit — carries forward if unused</p>}
            {form.type === 'unpaid' && <p className="text-xs text-danger mt-1">No credits deducted — attendance marked as Unpaid Leave</p>}
          </div>
          <div className={isSingleDay ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">{isSingleDay ? 'Date' : 'From'}</label>
              <input type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value, to: isSingleDay ? e.target.value : f.to }))}
                className="w-full border border-outline bg-surface rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/20" />
            </div>
            {!isSingleDay && (
              <div>
                <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">To</label>
                <input type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                  className="w-full border border-outline bg-surface rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/20" />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Reason</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              rows={3} placeholder="Brief reason for leave..."
              className="w-full border border-outline bg-surface rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/20 resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 border border-outline text-on-surface-muted rounded-lg text-sm font-medium hover:bg-surface-2 transition-colors">Cancel</button>
            <button onClick={handleSubmit} className="flex-1 py-2.5 bg-brand hover:opacity-90 text-white rounded-lg text-sm font-medium transition-opacity shadow-elev-1">Submit</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmployeeLeaveBalance({ balance, employeeId, canEdit, onUpdated }: { balance: any; employeeId?: string; canEdit?: boolean; onUpdated?: () => void }) {
  const [editing, setEditing] = useState(false);
  if (!balance) return null;
  return (
    <div className="relative mb-4">
      {canEdit && employeeId && (
        <button onClick={() => setEditing(true)}
          className="absolute -top-1 right-0 text-xs font-semibold text-accent hover:underline inline-flex items-center gap-1">
          <Edit3 size={11} /> Edit balances
        </button>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {balance.on_probation ? (
          <>
            <div className="bg-warning-container border border-warning/20 rounded-xl-2 p-4">
              <p className="text-xs font-semibold text-warning uppercase tracking-wide">Status</p>
              <p className="font-display text-lg font-bold text-warning tracking-tight mt-1">On Probation</p>
              {balance.probation_end_date && (
                <p className="text-xs text-warning/80 mt-0.5">
                  Ends {new Date(balance.probation_end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
            <div className="bg-warning-container border border-warning/20 rounded-xl-2 p-4">
              <p className="text-xs font-semibold text-warning uppercase tracking-wide">Probation Credits</p>
              <p className="num-mono text-2xl font-bold text-warning mt-1">{balance.probation_short_remaining ?? 0}</p>
              <p className="text-xs text-warning/80 mt-0.5">remaining</p>
            </div>
            <div className="bg-surface-2 border border-outline rounded-xl-2 p-4 opacity-50">
              <p className="text-xs font-semibold text-on-surface-muted uppercase tracking-wide">Full Day</p>
              <p className="num-mono text-2xl font-bold text-on-surface-subtle mt-1">—</p>
              <p className="text-xs text-on-surface-subtle mt-0.5">post-probation</p>
            </div>
            <div className="bg-teal-50 border border-teal-200 rounded-xl-2 p-4">
              <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide">Optional</p>
              <p className="num-mono text-2xl font-bold text-teal-800 mt-1">{balance.optional_remaining ?? 0} / {balance.optional_cap ?? 2}</p>
              <p className="text-xs text-teal-600 mt-0.5">post-probation</p>
            </div>
          </>
        ) : (
          <>
            <div className="bg-brand-container border border-brand/20 rounded-xl-2 p-4">
              <p className="text-xs font-semibold text-on-brand-container uppercase tracking-wide">Full Day</p>
              <p className="num-mono text-2xl font-bold text-on-brand-container mt-1">{balance.full_day ?? 0}</p>
              <p className="text-xs text-on-brand-container/80 mt-0.5">days available</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-xl-2 p-4">
              <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">Short / Half Day</p>
              <p className="num-mono text-2xl font-bold text-purple-700 mt-1">{balance.short_leave ?? 0}</p>
              <p className="text-xs text-purple-500 mt-0.5">credits this month</p>
            </div>
            <div className="bg-teal-50 border border-teal-200 rounded-xl-2 p-4">
              <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide">Optional</p>
              <p className="num-mono text-2xl font-bold text-teal-800 mt-1">{balance.optional_remaining ?? 0} / {balance.optional_cap ?? 2}</p>
              <p className="text-xs text-teal-600 mt-0.5">used {balance.optional_used ?? 0} this year</p>
            </div>
            <div className="bg-success-container border border-success/20 rounded-xl-2 p-4">
              <p className="text-xs font-semibold text-success uppercase tracking-wide">Status</p>
              <p className="font-display text-lg font-bold text-success tracking-tight mt-1">Confirmed</p>
              <p className="text-xs text-success/80 mt-0.5">probation complete</p>
            </div>
          </>
        )}
      </div>

      {editing && employeeId && (
        <BalanceEditModal balance={balance} employeeId={employeeId}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onUpdated?.(); }} />
      )}
    </div>
  );
}

function BalanceEditModal({ balance, employeeId, onClose, onSaved }: { balance: any; employeeId: string; onClose: () => void; onSaved: () => void }) {
  const [fullDay, setFullDay] = useState(String(balance.full_day ?? 0));
  const [shortLeave, setShortLeave] = useState(String(balance.short_leave ?? 0));
  const [optExtra, setOptExtra] = useState(String(balance.optional_extra ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setError(''); setSaving(true);
    try {
      await api.updateLeaveBalance(employeeId, {
        full_day: Math.max(0, Number(fullDay) || 0),
        short_leave: Math.max(0, Number(shortLeave) || 0),
        optional_extra: Math.max(0, Number(optExtra) || 0),
      });
      onSaved();
    } catch (e: any) { setError(e?.message ?? 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <h2 className="font-bold text-base text-on-surface">Edit leave balances</h2>
          <button onClick={onClose}><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1 block">Full day (carry forward)</label>
            <input type="number" min="0" value={fullDay} onChange={e => setFullDay(e.target.value)}
              className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 num-mono focus:outline-none focus:ring-2 focus:ring-primary-200" />
          </div>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1 block">Short / half-day credits this month</label>
            <input type="number" min="0" value={shortLeave} onChange={e => setShortLeave(e.target.value)}
              className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 num-mono focus:outline-none focus:ring-2 focus:ring-primary-200" />
          </div>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1 block">
              Extra optional leaves <span className="text-on-surface-subtle font-normal">(on top of the default 2 / year)</span>
            </label>
            <input type="number" min="0" value={optExtra} onChange={e => setOptExtra(e.target.value)}
              className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 num-mono focus:outline-none focus:ring-2 focus:ring-primary-200" />
            <p className="text-xs text-on-surface-subtle mt-1">
              Effective cap: <strong className="num-mono">{2 + (Math.max(0, Number(optExtra) || 0))}</strong> optional leaves this year.
            </p>
          </div>
          {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 border border-outline rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 bg-accent text-on-accent rounded-lg text-sm font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : 'Save balances'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Leave() {
  const { user } = useAuth();
  const [pageView, setPageView] = useState<'leaves' | 'wfh'>('leaves');
  const [tab, setTab] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'>('all');
  const [showApply, setShowApply] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  // WFH
  const [wfhRequests, setWfhRequests] = useState<any[]>([]);
  const [wfhTab, setWfhTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [rejectWfhTarget, setRejectWfhTarget] = useState<string | null>(null);

  // Employee filter
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [empBalance, setEmpBalance] = useState<any>(null);
  const [loadingEmpBal, setLoadingEmpBal] = useState(false);
  // Current HR/admin user's own employee DB id (for applying their own leave)
  const [myEmpDbId, setMyEmpDbId] = useState('');

  const loadRequests = (empId?: string) =>
    api.getLeaveRequests(empId ? { employee_id: empId } : undefined).then(setRequests);

  useEffect(() => {
    Promise.all([
      api.getEmployees(),
      loadRequests(),
      api.getWfhRequests().catch(() => []),
    ]).then(([emps, , wfh]) => {
      setEmployees(emps);
      setWfhRequests(Array.isArray(wfh) ? wfh : []);
      // Find the logged-in user's own employee record for balance display
      const myEmp = (emps as any[]).find(e => e.employee_id === user?.employee_id_ref);
      if (myEmp?.id) {
        setMyEmpDbId(myEmp.id);
        api.getLeaveBalance(myEmp.id).then(setBalance).catch(() => {});
      }
    }).finally(() => setLoading(false));
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
    setActionError('');
    try {
      await api.updateLeaveStatus(id, 'approved', { actioner_name: user?.name });
      setRequests(prev => prev.map(r => r.id === id ? {
        ...r, status: 'approved', hr_actioner_name: user?.name, hr_actioned_at: new Date().toISOString(),
      } : r));
      // Refresh selected employee balance after approval (balance was deducted)
      if (selectedEmpId) api.getLeaveBalance(selectedEmpId).then(setEmpBalance).catch(() => {});
    } catch (e: any) { setActionError(e.message ?? 'Failed to approve leave'); }
  };

  const handleReject = async (id: string, rejection_reason: string) => {
    setActionError('');
    try {
      await api.updateLeaveStatus(id, 'rejected', { actioner_name: user?.name, rejection_reason });
      setRequests(prev => prev.map(r => r.id === id ? {
        ...r, status: 'rejected', hr_actioner_name: user?.name,
        hr_actioned_at: new Date().toISOString(), rejection_reason,
      } : r));
    } catch (e: any) { setActionError(e.message ?? 'Failed to reject leave'); }
  };

  const handleCancel = async (id: string, cancellation_reason: string) => {
    setActionError('');
    try {
      await api.cancelLeave(id, user?.name ?? 'Admin', cancellation_reason);
      setRequests(prev => prev.map(r => r.id === id ? {
        ...r, status: 'cancelled', cancelled_by: user?.name,
        cancelled_at: new Date().toISOString(), cancellation_reason,
      } : r));
      // Refresh balance after cancellation (balance was restored)
      if (selectedEmpId) api.getLeaveBalance(selectedEmpId).then(setEmpBalance).catch(() => {});
    } catch (e: any) { setActionError(e.message ?? 'Failed to cancel leave'); }
  };

  const handleApply = async (data: any) => {
    // Apply leave for the selected employee if viewing one, otherwise for the HR user's own leave
    const targetId = selectedEmpId || myEmpDbId;
    const targetName = selectedEmpId ? (selectedEmp?.name ?? '') : (user?.name ?? 'HR');
    if (!targetId) return;
    await api.applyLeave({ ...data, employee_id: targetId, employee_name: targetName });
    await loadRequests(selectedEmpId || undefined);
    // Refresh balance after applying leave
    if (selectedEmpId) {
      api.getLeaveBalance(selectedEmpId).then(setEmpBalance).catch(() => {});
    } else if (myEmpDbId) {
      api.getLeaveBalance(myEmpDbId).then(setBalance).catch(() => {});
    }
  };

  const selectedEmp = employees.find(e => e.id === selectedEmpId);

  return (
    <div className="space-y-5">
      {/* Page view switcher */}
      <div className="flex gap-1 bg-surface rounded-xl-2 p-1 border border-outline shadow-elev-1 w-fit">
        {([
          { key: 'leaves', label: 'Leave Management' },
          { key: 'wfh',    label: 'Work From Home'   },
        ] as const).map(v => (
          <button key={v.key} onClick={() => setPageView(v.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              pageView === v.key ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* ── WFH management view ─────────────────────────────────────────────── */}
      {pageView === 'wfh' && (
        <div className="space-y-4">
          <div className="flex gap-1 bg-surface-2 p-1 rounded-lg w-fit">
            {(['all','pending','approved','rejected'] as const).map(t => (
              <button key={t} onClick={() => setWfhTab(t)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-all ${wfhTab === t ? 'bg-accent text-on-accent shadow-elev-1' : 'text-on-surface-muted hover:text-on-surface'}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
            {(wfhTab === 'all' ? wfhRequests : wfhRequests.filter(w => w.status === wfhTab)).length === 0 ? (
              <p className="text-center text-on-surface-subtle text-sm py-16">No WFH requests</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2 border-b border-outline">
                      {['Employee','Date','Type','Reason','Applied On','Manager','Status','Action'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-on-surface-muted px-4 py-3 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(wfhTab === 'all' ? wfhRequests : wfhRequests.filter(w => w.status === wfhTab)).map(w => (
                      <tr key={w.id} className="border-b border-outline last:border-0 hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3 font-medium text-on-surface">{w.employee_name}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-on-surface-muted">
                          {parseLocalDate(w.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-container text-on-brand-container">
                            {w.type === 'half_day' ? 'Half Day' : 'Full Day'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-on-surface-muted max-w-[260px]" title={w.reason ?? ''}>
                          <div className="line-clamp-3 break-words whitespace-normal">{w.reason}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-on-surface-subtle whitespace-nowrap">
                          {new Date(w.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {w.manager_status === 'approved' && <span className="text-success font-semibold">✓ {w.manager_name}</span>}
                          {w.manager_status === 'rejected' && <span className="text-danger font-semibold">✕ Rejected</span>}
                          {w.manager_status === 'pending' && <span className="text-warning">Pending</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${
                            w.status === 'approved' ? 'bg-brand-container text-on-brand-container border-brand/20' :
                            w.status === 'rejected' ? 'bg-danger-container text-danger border-danger/20' :
                            w.status === 'cancelled' ? 'bg-surface-2 text-on-surface-muted border-outline' :
                            'bg-warning-container text-warning border-warning/20'}`}>
                            {w.status.charAt(0).toUpperCase() + w.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {w.status === 'pending' && w.manager_status === 'approved' && (
                            <div className="flex gap-1.5">
                              <button onClick={async () => {
                                await api.hrApproveWfh(w.id, { status: 'approved', actioner_name: user?.name });
                                setWfhRequests(prev => prev.map(x => x.id === w.id ? { ...x, status: 'approved', hr_actioner_name: user?.name } : x));
                              }} className="text-xs px-2.5 py-1 bg-success-container text-success hover:opacity-80 transition-opacity rounded-md font-semibold">Approve</button>
                              <button onClick={() => setRejectWfhTarget(w.id)}
                                className="text-xs px-2.5 py-1 bg-danger-container text-danger hover:opacity-80 transition-opacity rounded-md font-semibold">Reject</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {/* Reject WFH modal — RejectReasonModal has its own overlay, no wrapper needed */}
          {rejectWfhTarget && (
            <RejectReasonModal
              title="Reason for WFH Rejection"
              placeholder="Enter reason for rejecting this WFH request..."
              confirmLabel="Confirm Reject"
              onClose={() => setRejectWfhTarget(null)}
              onConfirm={async (reason) => {
                try {
                  await api.hrApproveWfh(rejectWfhTarget, { status: 'rejected', actioner_name: user?.name, rejection_reason: reason });
                  setWfhRequests(prev => prev.map(x => x.id === rejectWfhTarget ? { ...x, status: 'rejected' } : x));
                } catch { /* ignore */ }
                setRejectWfhTarget(null);
              }}
            />
          )}
        </div>
      )}

      {/* ── Leave management view ─────────────────────────────────────────────── */}
      {pageView === 'leaves' && <>
      {actionError && (
        <div className="bg-danger-container border border-danger/20 text-danger text-sm font-medium px-4 py-2.5 rounded-xl-2 flex items-center justify-between">
          {actionError}
          <button onClick={() => setActionError('')} className="text-danger/70 hover:text-danger ml-4">✕</button>
        </div>
      )}

      {/* Leave Balance (own) */}
      <div className="grid grid-cols-3 gap-4">
        <div className="group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up stagger-1">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <p className="text-on-surface-muted text-sm font-medium">Full Day Leave</p>
            <p className="num-mono text-4xl font-bold text-on-surface mt-2">{balance?.full_day ?? 0}</p>
            <p className="text-on-surface-subtle text-xs mt-1">days (carry forward)</p>
          </div>
        </div>
        <div className="group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up stagger-2">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-accent/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <p className="text-on-surface-muted text-sm font-medium">Short Leave / Half Day</p>
            <p className="num-mono text-4xl font-bold text-on-surface mt-2">{balance?.short_leave ?? 0}</p>
            <p className="text-on-surface-subtle text-xs mt-1">credits this month</p>
          </div>
        </div>
        <div className="group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up stagger-3">
          <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500 ${balance?.on_probation ? 'bg-warning/20' : 'bg-success/20'}`} />
          <div className="relative">
            <p className="text-on-surface-muted text-sm font-medium">{balance?.on_probation ? 'Probation Status' : 'Probation'}</p>
            {balance?.on_probation ? (
              <>
                <p className="num-mono text-4xl font-bold text-warning mt-2">{balance.probation_short_remaining ?? 0}</p>
                <p className="text-on-surface-subtle text-xs mt-1">short leave credits left</p>
              </>
            ) : (
              <>
                <p className="font-display text-2xl font-bold text-success tracking-tight mt-2">Confirmed</p>
                <p className="text-on-surface-subtle text-xs mt-1">past 90-day probation</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Employee filter + toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Employee selector */}
        <div className="relative">
          <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
          <select
            value={selectedEmpId}
            onChange={e => setSelectedEmpId(e.target.value)}
            className="pl-8 pr-8 py-2.5 text-sm border border-outline rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/20 text-on-surface-muted appearance-none min-w-[200px]"
          >
            <option value="">All Employees</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.name} ({e.employee_id})</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-subtle pointer-events-none" />
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 bg-surface-2 p-1 rounded-lg">
          {(['all', 'pending', 'approved', 'rejected', 'cancelled'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-all ${tab === t ? 'bg-accent text-on-accent shadow-elev-1' : 'text-on-surface-muted hover:text-on-surface'}`}>
              {t}
              {t !== 'all' && (
                <span className={`num-mono ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  t === 'pending' ? 'bg-warning-container text-warning' :
                  t === 'approved' ? 'bg-success-container text-success' :
                  t === 'cancelled' ? 'bg-surface-2 text-on-surface-muted' :
                  'bg-danger-container text-danger'
                }`}>
                  {requests.filter(r => r.status === t).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="ml-auto">
          <button onClick={() => setShowApply(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand hover:opacity-90 text-white text-sm font-medium rounded-lg transition-opacity shadow-elev-1">
            <Plus size={15} /> Apply Leave
          </button>
        </div>
      </div>

      {/* Selected employee balance card */}
      {selectedEmpId && (
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-brand-container flex items-center justify-center text-on-brand-container text-xs font-bold">
              {selectedEmp?.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
            </div>
            <div>
              <p className="text-sm font-semibold text-on-surface">{selectedEmp?.name}</p>
              <p className="text-xs text-on-surface-subtle">{selectedEmp?.designation} · {selectedEmp?.department}</p>
            </div>
            <span className="ml-auto text-xs text-on-surface-subtle">Leave Balance</span>
          </div>
          {loadingEmpBal ? (
            <div className="flex items-center gap-2 text-sm text-on-surface-subtle py-2">
              <div className="w-4 h-4 border-2 border-outline border-t-brand rounded-full animate-spin" />
              Loading balance…
            </div>
          ) : (
            <EmployeeLeaveBalance balance={empBalance} employeeId={selectedEmpId}
              canEdit={user?.role === 'admin' || user?.role === 'hr_manager'}
              onUpdated={() => api.getLeaveBalance(selectedEmpId).then(setEmpBalance).catch(() => {})}
            />
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-4 border-outline border-t-brand rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-2 border-b border-outline">
                  {['Employee', 'Type', 'Duration', 'Days', 'Reason', 'Applied On', 'Status', 'Action Trail', 'Actions'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-on-surface-muted px-4 py-3 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map(req => {
                  const typeConfig = leaveTypes.find(t => t.key === req.type);
                  return (
                    <tr key={req.id} className="border-b border-outline hover:bg-surface-2 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-container flex items-center justify-center text-on-brand-container text-xs font-bold">
                            {req.employee_name.split(' ').map((n: string) => n[0]).join('')}
                          </div>
                          <span className="text-sm font-medium text-on-surface">{req.employee_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${typeConfig?.color}`}>{typeConfig?.label}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-on-surface-muted whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <Calendar size={12} className="text-on-surface-subtle" />
                          <span className="num-mono">
                            {parseLocalDate(req.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            {req.from_date !== req.to_date && ` – ${parseLocalDate(req.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-on-surface-muted"><span className="num-mono">{req.days}</span>d</td>
                      <td className="px-4 py-3 text-sm text-on-surface-muted max-w-[260px]" title={req.reason ?? ''}>
                        <div className="line-clamp-3 break-words whitespace-normal">{req.reason}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-muted whitespace-nowrap">
                        <div className="flex items-center gap-1 text-on-surface-subtle mb-0.5">
                          <User size={10} />
                          <span className="text-on-surface-muted font-medium">{req.employee_name}</span>
                        </div>
                        <span className="num-mono">{fmtDateTime(req.created_at)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <LeaveStatusBadge req={req} />
                      </td>
                      <td className="px-4 py-3 min-w-[180px]">
                        <ActionTrail req={req} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5 flex-wrap">
                          {req.status === 'pending' && (() => {
                            // HR can approve/reject when manager has approved OR
                            // when the employee has no manager (manager_status stays pending but goes straight to HR)
                            const readyForHR = req.manager_status === 'approved';
                            const pendingManager = req.manager_status === 'pending';
                            return (
                              <>
                                {readyForHR && (
                                  <button onClick={() => handleApprove(req.id)} className="px-2.5 py-1 text-xs bg-success-container text-success hover:opacity-80 transition-opacity rounded-md font-semibold">Approve</button>
                                )}
                                {/* HR can always reject, even before manager acts */}
                                <button onClick={() => setRejectTarget(req.id)} className="px-2.5 py-1 text-xs bg-danger-container text-danger hover:opacity-80 transition-opacity rounded-md font-semibold">Reject</button>
                                {/* Override: allow HR to approve even if manager hasn't acted yet */}
                                {pendingManager && (
                                  <button onClick={() => handleApprove(req.id)} className="px-2.5 py-1 text-xs bg-brand-container text-on-brand-container hover:opacity-80 transition-opacity rounded-md font-semibold" title="Override: approve directly without manager">Override ✓</button>
                                )}
                              </>
                            );
                          })()}
                          {req.status === 'approved' && (
                            <button onClick={() => setCancelTarget(req.id)} className="px-2.5 py-1 text-xs bg-surface-2 text-on-surface-muted hover:opacity-80 transition-opacity rounded-md font-semibold border border-outline">Cancel Leave</button>
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
          <div className="py-16 text-center text-on-surface-subtle text-sm">
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
          confirmClass="bg-on-surface hover:opacity-90"
          onClose={() => setCancelTarget(null)}
          onConfirm={reason => handleCancel(cancelTarget, reason)}
        />
      )}
      </>}
    </div>
  );
}
