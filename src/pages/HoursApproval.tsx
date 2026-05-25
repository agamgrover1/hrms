import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, X, Filter, ClipboardCheck } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface HourLog {
  id: string;
  project_id: string;
  employee_id: string;
  employee_name: string;
  month: number;
  year: number;
  week_num: number;
  hours_logged: number;
  work_description: string | null;
  status: string;
  rejection_reason: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  submitted_at: string;
  project_name?: string;
  project_client_name?: string | null;
  project_reporting_id?: string | null;
  project_reporting_name?: string | null;
  w1_hours?: number; w2_hours?: number; w3_hours?: number; w4_hours?: number; w5_hours?: number;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function weekAllocFor(log: HourLog): number {
  const k = `w${log.week_num}_hours` as 'w1_hours' | 'w2_hours' | 'w3_hours' | 'w4_hours' | 'w5_hours';
  return Number(log[k] ?? 0);
}

export default function HoursApproval() {
  const { user } = useAuth();
  const role = user?.role ?? 'employee';
  const isAdmin = role === 'admin' || role === 'hr_manager' || role === 'project_coordinator';

  // Map app_user → their employee.id (for project_reporting_id matching)
  const [reviewerEmpId, setReviewerEmpId] = useState<string | null>(null);
  const [logs, setLogs] = useState<HourLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [scope, setScope] = useState<'mine' | 'all'>(isAdmin ? 'all' : 'mine');
  const [rejecting, setRejecting] = useState<HourLog | null>(null);

  // Resolve current user's employee.id once
  useEffect(() => {
    if (!user?.employee_id_ref) return;
    api.getEmployees()
      .then(emps => {
        const me = emps.find((e: any) => e.employee_id === user.employee_id_ref);
        if (me) setReviewerEmpId(me.id);
      })
      .catch(() => {});
  }, [user?.employee_id_ref]);

  const load = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (filterStatus !== 'all') params.status = filterStatus;
    if (scope === 'mine' && reviewerEmpId) params.reviewer_id = reviewerEmpId;
    api.getHourLogs(params)
      .then(d => setLogs(d as HourLog[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterStatus, scope, reviewerEmpId]);

  useEffect(() => {
    if (scope === 'mine' && !reviewerEmpId) return; // wait until we know who I am
    load();
  }, [load, scope, reviewerEmpId]);

  const approve = async (log: HourLog) => {
    await api.approveHourLog(log.id, {
      reviewer_id: reviewerEmpId ?? user?.id,
      reviewer_name: user?.name,
    }).catch((err: any) => alert(err.message ?? 'Approve failed.'));
    load();
  };

  const reject = async (log: HourLog, reason: string) => {
    await api.rejectHourLog(log.id, {
      reviewer_id: reviewerEmpId ?? user?.id,
      reviewer_name: user?.name,
      rejection_reason: reason,
    }).catch((err: any) => alert(err.message ?? 'Reject failed.'));
    setRejecting(null);
    load();
  };

  // Group by project + week_num for cleaner UI
  const grouped: Record<string, HourLog[]> = {};
  logs.forEach(l => {
    const key = `${l.project_name ?? l.project_id}__${l.year}-${String(l.month).padStart(2, '0')}-W${l.week_num}`;
    (grouped[key] ||= []).push(l);
  });

  const counts = {
    pending:  logs.filter(l => l.status === 'pending').length,
    approved: logs.filter(l => l.status === 'approved').length,
    rejected: logs.filter(l => l.status === 'rejected').length,
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden animate-fade-up stagger-1">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-warning-container blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-warning">{counts.pending}</p>
            <p className="text-xs text-on-surface-muted mt-0.5">Pending</p>
          </div>
        </div>
        <div className="group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden animate-fade-up stagger-2">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-success-container blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-success">{counts.approved}</p>
            <p className="text-xs text-on-surface-muted mt-0.5">Approved</p>
          </div>
        </div>
        <div className="group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden animate-fade-up stagger-3">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-danger-container blur-2xl opacity-50" />
          <div className="relative">
            <p className="num-mono text-2xl font-bold text-danger">{counts.rejected}</p>
            <p className="text-xs text-on-surface-muted mt-0.5">Rejected</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5 bg-surface rounded-lg border border-outline p-1">
          {(['pending','approved','rejected','all'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize ${filterStatus === s ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
              {s}
            </button>
          ))}
        </div>
        {isAdmin && (
          <div className="inline-flex items-center gap-1.5 bg-surface rounded-lg border border-outline p-1">
            <button onClick={() => setScope('mine')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${scope === 'mine' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
              <Filter size={11} className="inline mr-1" />My Reviews
            </button>
            <button onClick={() => setScope('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${scope === 'all' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
              All Projects
            </button>
          </div>
        )}
      </div>

      {/* Groups */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-surface rounded-xl-2 p-12 border border-outline text-center text-on-surface-subtle">Loading logs…</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="bg-surface rounded-xl-2 p-12 border border-outline text-center">
            <ClipboardCheck size={32} className="mx-auto text-on-surface-subtle mb-2" />
            <p className="text-sm text-on-surface-muted">Nothing to review here.</p>
          </div>
        ) : Object.entries(grouped).map(([key, group]) => {
          const sample = group[0];
          return (
            <div key={key} className="relative bg-surface rounded-xl-3 border border-outline shadow-elev-2 overflow-hidden group hover:shadow-elev-3 transition-shadow">
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-0 group-hover:opacity-50 transition-opacity duration-500" />
              <div className="relative px-4 py-3 bg-gradient-to-r from-brand-container/50 to-surface border-b border-outline flex items-center justify-between">
                <div>
                  <p className="font-display text-xl font-bold tracking-tight text-on-surface">{sample.project_name}{sample.project_client_name ? ` · ${sample.project_client_name}` : ''}</p>
                  <p className="text-xs text-on-surface-muted">{MONTHS[sample.month-1]} {sample.year} · Week {sample.week_num}</p>
                </div>
                <p className="text-xs text-on-surface-subtle">{group.length} {group.length === 1 ? 'entry' : 'entries'}</p>
              </div>
              <table className="relative w-full text-sm">
                <thead className="bg-surface-2 border-b border-outline text-left text-xs font-semibold text-on-surface-muted uppercase">
                  <tr>
                    <th className="px-4 py-2">Employee</th>
                    <th className="px-4 py-2 text-right">Allocated</th>
                    <th className="px-4 py-2 text-right">Logged</th>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline">
                  {group.map(log => {
                    const alloc = weekAllocFor(log);
                    const delta = Number(log.hours_logged) - alloc;
                    const overAlloc = delta > 0;
                    return (
                      <tr key={log.id} className="hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3 font-medium text-on-surface">{log.employee_name}</td>
                        <td className="px-4 py-3 text-right text-on-surface-muted num-mono">{alloc}h</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`num-mono inline-flex items-center gap-1 font-semibold ${overAlloc ? 'text-danger' : 'text-on-surface'}`}>
                            {log.hours_logged}h
                            {delta !== 0 && (
                              <span className="text-[10px] font-normal text-on-surface-subtle">
                                {overAlloc && <AlertTriangle size={10} className="inline text-danger mr-0.5" />}
                                {overAlloc ? '+' : ''}{delta}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-on-surface-muted text-xs max-w-md">
                          {log.work_description || <span className="text-on-surface-subtle italic">—</span>}
                          {log.status === 'rejected' && log.rejection_reason && (
                            <p className="text-danger mt-1 flex items-center gap-1">
                              <XCircle size={11} /> {log.rejection_reason}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={log.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {log.status === 'pending' ? (
                            <div className="inline-flex items-center gap-1">
                              <button onClick={() => approve(log)}
                                className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-white bg-success hover:bg-success/90 transition-colors">
                                <CheckCircle size={12} className="inline mr-1" />Approve
                              </button>
                              <button onClick={() => setRejecting(log)}
                                className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-danger border border-danger/30 hover:bg-danger-container transition-colors">
                                <XCircle size={12} className="inline mr-1" />Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-on-surface-subtle">{log.reviewed_by_name || '—'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {rejecting && (
        <RejectModal
          log={rejecting}
          onClose={() => setRejecting(null)}
          onConfirm={reason => reject(rejecting, reason)}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cfg = status === 'approved'
    ? { label: 'Approved', className: 'bg-success-container text-success' }
    : status === 'rejected'
    ? { label: 'Rejected', className: 'bg-danger-container text-danger' }
    : { label: 'Pending', className: 'bg-warning-container text-warning' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function RejectModal({ log, onClose, onConfirm }: { log: HourLog; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <h3 className="font-display text-lg font-semibold text-on-surface">Reject hour log</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-sm text-on-surface-muted">
            Rejecting <span className="num-mono font-medium text-on-surface">{log.hours_logged}h</span> from{' '}
            <span className="font-medium text-on-surface">{log.employee_name}</span> on{' '}
            <span className="font-medium text-on-surface">{log.project_name}</span> (W{log.week_num}).
          </p>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Reason *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={4}
              placeholder="Explain what's wrong so the employee can resubmit."
              className="w-full bg-surface border border-outline rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-danger/30 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg transition-colors">Cancel</button>
          <button onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={!reason.trim()}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 bg-danger hover:bg-danger/90 transition-colors">
            Confirm Reject
          </button>
        </div>
      </div>
    </div>
  );
}
