import { useEffect, useMemo, useState } from 'react';
import { Plus, X, CheckCircle2, Clock, RotateCcw, Pencil, Trash2, MoreVertical, AlertTriangle, FileText, Ban, Briefcase } from 'lucide-react';
import { financeApi, type FinInvoice } from '../../services/financeApi';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { MONTHS, money } from './format';

type StatusFilter = 'all' | 'pending' | 'cleared' | 'activity';

const CURRENCIES = [
  { code: 'USD', label: '$ USD', symbol: '$' },
  { code: 'INR', label: '₹ INR', symbol: '₹' },
  { code: 'EUR', label: '€ EUR', symbol: '€' },
  { code: 'GBP', label: '£ GBP', symbol: '£' },
  { code: 'AUD', label: 'A$ AUD', symbol: 'A$' },
  { code: 'CAD', label: 'C$ CAD', symbol: 'C$' },
];
const symbolOf = (ccy: string) => CURRENCIES.find(c => c.code === ccy)?.symbol ?? ccy + ' ';
const fmtCcy = (n: number, ccy: string) => `${symbolOf(ccy)}${Math.round(n).toLocaleString('en-IN')}`;

const BLANK_NEW = {
  project_id: '',
  invoice_number: '',
  invoice_date: new Date().toISOString().slice(0, 10),
  amount_invoiced: '',
  currency: 'USD',  // most invoices are USD; coordinator can switch to INR for domestic
  notes: '',
};

interface ProjectLite {
  id: string;
  name: string;
  client_name: string | null;
  billing_source?: string | null;
}

export default function InvoicesTab({ month, year, onChanged }: { month: number; year: number; onChanged: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const userId = user?.id;

  const [invoices, setInvoices] = useState<FinInvoice[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [showAdd, setShowAdd] = useState(false);
  const [np, setNp] = useState({ ...BLANK_NEW });
  const [creating, setCreating] = useState(false);

  // Live FX rate for the new-invoice modal. Refetched when currency or
  // invoice_date changes so the "= ₹X" preview matches what'll be stored.
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [fxLoading, setFxLoading] = useState(false);

  const [clearTarget, setClearTarget] = useState<FinInvoice | null>(null);
  const [editTarget, setEditTarget] = useState<FinInvoice | null>(null);

  const load = () => {
    setLoading(true); setErr('');
    Promise.all([
      financeApi.getInvoices({ month, year }),
      api.getProjects({ status: 'active' }) as Promise<ProjectLite[]>,
    ])
      .then(([inv, projs]) => {
        setInvoices(inv);
        setProjects(projs);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [month, year]);

  // When the new-invoice modal is open, keep the FX rate in sync with the
  // chosen currency + date. INR has no conversion.
  useEffect(() => {
    if (!showAdd) return;
    if (np.currency === 'INR') { setFxRate(1); return; }
    setFxLoading(true);
    financeApi.getFxRate({ date: np.invoice_date, from: np.currency, to: 'INR' })
      .then(r => setFxRate(r.rate))
      .catch(() => setFxRate(null))
      .finally(() => setFxLoading(false));
  }, [showAdd, np.currency, np.invoice_date]);

  // When the user picks a project, if it's flagged as Upwork-billed and they
  // haven't manually changed the currency yet, default to USD.
  useEffect(() => {
    if (!showAdd || !np.project_id) return;
    const proj = projects.find(p => p.id === np.project_id);
    if (proj?.billing_source === 'upwork' && np.currency !== 'USD') {
      setNp(prev => ({ ...prev, currency: 'USD' }));
    }
  }, [np.project_id, showAdd, projects]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return invoices.filter(i => i.status !== 'cancelled');
    // 'pending' filter shows both fresh pending invoices AND coord-submitted
    // clearances still awaiting admin approval — they're both "open work"
    // from the workflow POV, just at different stages.
    if (statusFilter === 'pending') {
      return invoices.filter(i => i.status === 'pending' || i.status === 'cleared_pending');
    }
    return invoices.filter(i => i.status === statusFilter);
  }, [invoices, statusFilter]);

  const totals = useMemo(() => {
    // All tiles roll up in INR — the company's home currency. For invoices in
    // foreign currency, amount_invoiced_inr is the conversion-at-billing-time.
    const active = invoices.filter(i => i.status !== 'cancelled');
    const inrOf = (i: FinInvoice) => Number(i.amount_invoiced_inr ?? i.amount_invoiced ?? 0);
    const invoiced = active.reduce((s, i) => s + inrOf(i), 0);
    // 'received' only counts FINAL cleared invoices — admin-approved cash
    // in the bank. cleared_pending entries aren't real cash yet.
    const received = active.filter(i => i.status === 'cleared').reduce((s, i) => s + Number(i.amount_received || 0), 0);
    // 'pending' = unsettled work, includes both raw pending AND awaiting-
    // approval clearances. Count is the badge admin sees on the chip.
    const pendingRows = active.filter(i => i.status === 'pending' || i.status === 'cleared_pending');
    const pending = pendingRows.reduce((s, i) => s + inrOf(i), 0);
    const pendingCount = pendingRows.length;
    const awaitingApprovalCount = active.filter(i => i.status === 'cleared_pending').length;
    return { invoiced, received, pending, pendingCount, awaitingApprovalCount };
  }, [invoices]);

  const create = async () => {
    if (!np.project_id) { setErr('Pick a project'); return; }
    const amt = Number(np.amount_invoiced);
    if (!(amt > 0)) { setErr('Enter an invoiced amount > 0'); return; }
    setCreating(true); setErr('');
    try {
      // Derive period from the invoice date when provided (server does the
      // same — keeping client in sync so the optimistic refresh shows the
      // invoice under the right month immediately).
      let periodMonth = month;
      let periodYear = year;
      if (np.invoice_date) {
        const [yyyy, mm] = np.invoice_date.slice(0, 10).split('-').map(Number);
        if (yyyy && mm) { periodMonth = mm; periodYear = yyyy; }
      }
      await financeApi.addInvoice({
        project_id: np.project_id,
        month: periodMonth, year: periodYear,
        invoice_number: np.invoice_number.trim() || undefined,
        invoice_date: np.invoice_date || undefined,
        amount_invoiced: amt,
        currency: np.currency,
        // Pass the live rate the user saw so the stored INR matches their preview.
        fx_rate: np.currency === 'INR' ? 1 : (fxRate ?? undefined),
        notes: np.notes.trim() || undefined,
      });
      setNp({ ...BLANK_NEW });
      setShowAdd(false);
      load(); onChanged();
    } catch (e: any) { setErr(e.message); }
    finally { setCreating(false); }
  };

  const remove = async (inv: FinInvoice) => {
    if (!confirm(`Delete invoice${inv.invoice_number ? ` ${inv.invoice_number}` : ''}? This cannot be undone.`)) return;
    try { await financeApi.deleteInvoice(inv.id); load(); onChanged(); }
    catch (e: any) { setErr(e.message); }
  };

  const reopen = async (inv: FinInvoice) => {
    if (!confirm(`Reopen this invoice? Cleared amount will be cleared and status reverts to Pending.`)) return;
    try { await financeApi.reopenInvoice(inv.id); load(); onChanged(); }
    catch (e: any) { setErr(e.message); }
  };

  const cancelInv = async (inv: FinInvoice) => {
    if (!confirm(`Cancel this invoice? It will be excluded from all totals but the row stays for audit.`)) return;
    try { await financeApi.updateInvoice(inv.id, { status: 'cancelled' }); load(); onChanged(); }
    catch (e: any) { setErr(e.message); }
  };

  const approveClearance = async (inv: FinInvoice) => {
    if (!confirm(`Approve clearance for ${inv.project_name}${inv.invoice_number ? ` (${inv.invoice_number})` : ''}?`)) return;
    try { await financeApi.approveClearance(inv.id); load(); onChanged(); }
    catch (e: any) { setErr(e.message); }
  };
  const rejectClearance = async (inv: FinInvoice) => {
    const reason = window.prompt('Reason for rejecting this clearance (the coordinator sees this):');
    if (!reason?.trim()) return;
    try { await financeApi.rejectClearance(inv.id, reason.trim()); load(); onChanged(); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-xl-2 p-1">
          {(['all', 'pending', 'cleared', ...(isAdmin ? ['activity' as StatusFilter] : [])] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                statusFilter === s ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-3'
              }`}>
              {s === 'all' ? 'All active' : s === 'activity' ? 'Activity log' : s}
              {s === 'pending' && totals.pendingCount > 0 && (
                <span className={`ml-1.5 num-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full ${statusFilter === s ? 'bg-on-accent text-accent' : 'bg-warning text-on-accent'}`}>
                  {totals.pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent">
          <Plus size={15} /> New Invoice
        </button>
      </div>

      {/* KPI strip — hidden for project_coordinator since they shouldn't see
          aggregate totals. They only raise invoices; reconciliation totals are
          admin's view. Also hidden in the Activity view since those numbers
          describe the current invoice set, not the audit log. */}
      {isAdmin && statusFilter !== 'activity' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Invoiced" value={money(totals.invoiced)} sub="accrual · what we billed" tone="text-on-surface" />
          <Tile label="Received" value={money(totals.received)} sub="cash · what landed in bank" tone="text-success" />
          <Tile label="Pending" value={money(totals.pending)} sub={`${totals.pendingCount} invoice${totals.pendingCount === 1 ? '' : 's'} awaiting clearance`} tone={totals.pendingCount > 0 ? 'text-warning' : 'text-on-surface-subtle'} />
          <Tile label="Variance" value={money(totals.received - totals.invoiced)}
            sub={totals.received < totals.invoiced ? 'short on cleared' : totals.received > totals.invoiced ? 'extra on cleared' : 'on track'}
            tone={totals.received < totals.invoiced ? 'text-danger' : 'text-on-surface'} />
        </div>
      )}

      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      {/* Activity view replaces the invoice table when selected. Admin only —
          gated by the chip strip filter above. */}
      {statusFilter === 'activity' && isAdmin && (
        <InvoiceActivityLog month={month} year={year} />
      )}

      {/* Invoice table */}
      {statusFilter !== 'activity' && (
      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-outline flex items-center justify-between">
          <h3 className="text-sm font-semibold text-on-surface">Invoices · {MONTHS[month - 1]} {year}</h3>
          <span className="text-xs text-on-surface-muted">{filtered.length} {filtered.length === 1 ? 'invoice' : 'invoices'}</span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-sm text-on-surface-muted">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileText size={28} className="mx-auto text-on-surface-subtle mb-2" />
            <p className="text-sm text-on-surface-muted">No {statusFilter === 'all' ? '' : statusFilter} invoices for {MONTHS[month - 1]} {year}.</p>
            <p className="text-xs text-on-surface-subtle mt-1">Click <b>New Invoice</b> to raise one.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-on-surface-subtle border-b border-outline bg-surface-2">
                  <th className="text-left font-semibold px-4 py-2.5">Project</th>
                  <th className="text-left font-semibold px-3 py-2.5">Invoice #</th>
                  <th className="text-left font-semibold px-3 py-2.5">Date</th>
                  <th className="text-right font-semibold px-3 py-2.5">Invoiced</th>
                  {/* Coordinator doesn't see Received / variance — admin reconciliation territory */}
                  {isAdmin && <th className="text-right font-semibold px-3 py-2.5">Received</th>}
                  {isAdmin && <th className="text-right font-semibold px-3 py-2.5">Δ</th>}
                  <th className="text-left font-semibold px-3 py-2.5">Status</th>
                  <th className="text-left font-semibold px-3 py-2.5">Raised by</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {filtered.map(inv => {
                  const isCancelled = inv.status === 'cancelled';
                  const isCleared = inv.status === 'cleared';
                  // Coord may edit their own pending invoices. Once they've
                  // submitted a clearance (cleared_pending) the invoice is
                  // locked until admin approves or rejects — they can still
                  // see + cancel the request but not edit the amounts.
                  const canEditAsCoord = !isAdmin && inv.status === 'pending' && inv.created_by === userId;
                  const canDeleteAsCoord = canEditAsCoord;
                  // For variance: compare apples-to-apples in INR — amount_received
                  // is INR, amount_invoiced_inr is the INR equivalent at billing rate.
                  const invInr = Number(inv.amount_invoiced_inr ?? inv.amount_invoiced ?? 0);
                  const recvInr = Number(inv.amount_received ?? 0);
                  const inrVariance = recvInr - invInr;
                  const isForeign = inv.currency && inv.currency !== 'INR';
                  return (
                    <tr key={inv.id} className={`hover:bg-surface-2/50 ${isCancelled ? 'opacity-50 line-through' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-on-surface inline-flex items-center gap-1.5">
                          {inv.project_name || '—'}
                          {isForeign && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-container text-accent">{inv.currency}</span>
                          )}
                        </div>
                        {inv.project_client_name && <div className="text-xs text-on-surface-subtle">{inv.project_client_name}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-on-surface-muted num-mono text-xs">{inv.invoice_number || '—'}</td>
                      <td className="px-3 py-2.5 text-on-surface-muted text-xs">{formatDate(inv.invoice_date)}</td>
                      <td className="px-3 py-2.5 text-right num-mono">
                        <div className="text-on-surface">{fmtCcy(Number(inv.amount_invoiced), inv.currency || 'INR')}</div>
                        {isForeign && (
                          <div className="text-[10px] text-on-surface-subtle" title={`at 1 ${inv.currency} = ₹${Number(inv.fx_rate ?? 0).toFixed(4)}`}>
                            ≈ {money(invInr)}
                          </div>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2.5 text-right num-mono">
                          {isCleared ? <span className="text-on-surface">{money(recvInr)}</span> : <span className="text-on-surface-subtle">—</span>}
                        </td>
                      )}
                      {isAdmin && (
                        <td className="px-3 py-2.5 text-right num-mono text-xs">
                          {isCleared ? (
                            <span className={inrVariance === 0 ? 'text-on-surface-subtle' : inrVariance < 0 ? 'text-danger' : 'text-success'}
                              title={isForeign ? `Compared against ₹${Math.round(invInr).toLocaleString('en-IN')} (INR equivalent at billing rate)` : undefined}>
                              {inrVariance > 0 ? '+' : ''}{money(inrVariance)}
                            </span>
                          ) : <span className="text-on-surface-subtle">—</span>}
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <StatusPill status={inv.status} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-on-surface-muted">
                        {inv.created_by_name || '—'}
                        {inv.created_by_role && <span className="text-on-surface-subtle ml-1">· {inv.created_by_role === 'project_coordinator' ? 'coord' : inv.created_by_role}</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <RowActions
                          inv={inv}
                          isAdmin={isAdmin}
                          currentUserId={userId}
                          canEditAsCoord={canEditAsCoord}
                          canDeleteAsCoord={canDeleteAsCoord}
                          onClear={() => setClearTarget(inv)}
                          onEdit={() => setEditTarget(inv)}
                          onReopen={() => reopen(inv)}
                          onCancel={() => cancelInv(inv)}
                          onDelete={() => remove(inv)}
                          onApproveClearance={() => approveClearance(inv)}
                          onRejectClearance={() => rejectClearance(inv)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* New invoice modal */}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} title="Raise new invoice">
          <div className="space-y-3">
            <Field label="Project" required>
              <select value={np.project_id} onChange={e => setNp({ ...np, project_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
                <option value="">— pick a project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.billing_source === 'upwork' ? ' · Upwork' : ''}{p.client_name ? ` · ${p.client_name}` : ''}</option>)}
              </select>
              {(() => {
                const proj = projects.find(p => p.id === np.project_id);
                if (proj?.billing_source === 'upwork') {
                  return (
                    <p className="mt-1.5 text-[11px] text-on-surface-muted inline-flex items-center gap-1">
                      <Briefcase size={11} className="text-brand" />
                      Upwork project — defaults to USD. Earnings clear from Upwork wallet on withdrawal.
                    </p>
                  );
                }
                return null;
              })()}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice #">
                <input value={np.invoice_number} onChange={e => setNp({ ...np, invoice_number: e.target.value })}
                  placeholder="INV-2026-042"
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </Field>
              <Field label="Invoice date">
                <input type="date" value={np.invoice_date} onChange={e => setNp({ ...np, invoice_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Currency">
                <select value={np.currency} onChange={e => setNp({ ...np, currency: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </Field>
              <Field label={`Amount invoiced (${symbolOf(np.currency).trim()})`} required>
                <div className="col-span-2">
                  <input type="number" min="0" step="0.01" value={np.amount_invoiced}
                    onChange={e => setNp({ ...np, amount_invoiced: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
                </div>
              </Field>
              <Field label="≈ in INR">
                <div className="px-3 py-2 rounded-lg bg-surface-3 border border-outline text-sm text-on-surface-muted num-mono">
                  {np.currency === 'INR' ? '—' :
                    fxLoading ? '…' :
                    fxRate && Number(np.amount_invoiced) > 0
                      ? fmtCcy(Number(np.amount_invoiced) * fxRate, 'INR')
                      : '—'}
                </div>
              </Field>
            </div>
            {np.currency !== 'INR' && fxRate && (
              <p className="text-[11px] text-on-surface-subtle -mt-1">
                Rate: 1 {np.currency} = ₹{fxRate.toFixed(4)} ({np.invoice_date}). This locks at submit so the variance vs received amount is meaningful.
              </p>
            )}
            <Field label="Notes (optional)">
              <textarea value={np.notes} onChange={e => setNp({ ...np, notes: e.target.value })}
                rows={2} placeholder="e.g. Retainer Jun 2026"
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </Field>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="px-3 py-2 rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
              <button onClick={create} disabled={creating}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent disabled:opacity-50">
                {creating ? 'Saving…' : 'Raise invoice'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Mark cleared modal */}
      {clearTarget && (
        <ClearModal
          inv={clearTarget}
          onClose={() => setClearTarget(null)}
          onSaved={() => { setClearTarget(null); load(); onChanged(); }}
        />
      )}

      {/* Edit modal */}
      {editTarget && (
        <EditModal
          inv={editTarget}
          isAdmin={isAdmin}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); onChanged(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-on-surface-subtle">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums num-mono ${tone || 'text-on-surface'}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-on-surface-subtle">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: FinInvoice['status'] }) {
  if (status === 'cleared') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-success-container text-success">
        <CheckCircle2 size={11} strokeWidth={2.5} /> Cleared
      </span>
    );
  }
  if (status === 'cleared_pending') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent-container text-accent">
        <AlertTriangle size={11} strokeWidth={2.5} /> Awaiting approval
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface-3 text-on-surface-subtle">
        <Ban size={11} strokeWidth={2.5} /> Cancelled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-warning-container text-warning">
      <Clock size={11} strokeWidth={2.5} /> Pending
    </span>
  );
}

function RowActions({ inv, isAdmin, currentUserId, canEditAsCoord, canDeleteAsCoord, onClear, onEdit, onReopen, onCancel, onDelete, onApproveClearance, onRejectClearance }: {
  inv: FinInvoice; isAdmin: boolean; currentUserId?: string;
  canEditAsCoord: boolean; canDeleteAsCoord: boolean;
  onClear: () => void; onEdit: () => void; onReopen: () => void; onCancel: () => void; onDelete: () => void;
  onApproveClearance: () => void; onRejectClearance: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isPending = inv.status === 'pending';
  const isClearPending = inv.status === 'cleared_pending';
  const isCleared = inv.status === 'cleared';
  // Coordinator may submit a clearance request on their own pending
  // invoices (or any pending invoice if they have permission). Mirrors
  // the same write-gate the backend enforces.
  const canRequestClearAsCoord = !isAdmin && isPending;
  // Coord can withdraw their own pending clearance request (returns it
  // to plain pending so they can edit + resubmit).
  const isOwnClearRequest = !isAdmin && isClearPending && inv.cleared_by === currentUserId;
  const showAnything = isAdmin || canEditAsCoord || canDeleteAsCoord || canRequestClearAsCoord || isOwnClearRequest;
  if (!showAnything) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="p-1.5 rounded hover:bg-surface-2 text-on-surface-muted">
        <MoreVertical size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-52 bg-surface border border-outline rounded-lg shadow-elev-3 py-1 z-20">
            {/* Admin marks cleared directly. Coord submits for admin
                approval — same modal, different terminal status. */}
            {isPending && (isAdmin || canRequestClearAsCoord) && (
              <Item icon={CheckCircle2}
                label={isAdmin ? 'Mark cleared' : 'Request clearance'}
                onClick={() => { setOpen(false); onClear(); }}
                tone="text-success" />
            )}
            {/* Admin approving / rejecting a coord-submitted clearance. */}
            {isAdmin && isClearPending && (
              <>
                <Item icon={CheckCircle2} label="Approve clearance" onClick={() => { setOpen(false); onApproveClearance(); }} tone="text-success" />
                <Item icon={X} label="Reject clearance" onClick={() => { setOpen(false); onRejectClearance(); }} tone="text-danger" />
              </>
            )}
            {/* Coord can withdraw their own clearance request (uses
                reopen — same effect, returns to pending). */}
            {isOwnClearRequest && (
              <Item icon={RotateCcw} label="Withdraw request" onClick={() => { setOpen(false); onReopen(); }} tone="text-warning" />
            )}
            {(isAdmin || canEditAsCoord) && (
              <Item icon={Pencil} label="Edit" onClick={() => { setOpen(false); onEdit(); }} />
            )}
            {isAdmin && isCleared && (
              <Item icon={RotateCcw} label="Reopen" onClick={() => { setOpen(false); onReopen(); }} tone="text-warning" />
            )}
            {isAdmin && (
              <Item icon={Ban} label="Cancel" onClick={() => { setOpen(false); onCancel(); }} />
            )}
            {(isAdmin || canDeleteAsCoord) && (
              <Item icon={Trash2} label="Delete" onClick={() => { setOpen(false); onDelete(); }} tone="text-danger" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Item({ icon: Icon, label, onClick, tone = 'text-on-surface' }: { icon: any; label: string; onClick: () => void; tone?: string }) {
  return (
    <button onClick={onClick}
      className={`w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2 inline-flex items-center gap-2 ${tone}`}>
      <Icon size={13} /> {label}
    </button>
  );
}

function ClearModal({ inv, onClose, onSaved }: { inv: FinInvoice; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Received amount is ALWAYS in INR (the bank reality). For comparison we
  // use amount_invoiced_inr — the INR equivalent locked at billing time.
  const invInr = Number(inv.amount_invoiced_inr ?? inv.amount_invoiced);
  const isForeign = !!inv.currency && inv.currency !== 'INR';
  const [amount, setAmount] = useState(String(Math.round(invInr)));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(inv.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const variance = Number(amount) - invInr;

  const submit = async () => {
    const amt = Number(amount);
    if (!(amt >= 0)) { setErr('Received amount must be ≥ 0'); return; }
    setSaving(true); setErr('');
    try {
      await financeApi.clearInvoice(inv.id, {
        amount_received: amt,
        cleared_date: date || undefined,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose} title={`${isAdmin ? 'Mark cleared' : 'Request clearance'} · ${inv.project_name}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-surface-2 border border-outline p-3 text-xs text-on-surface-muted">
          {isForeign ? (
            <>
              Invoiced: <b className="text-on-surface num-mono">{fmtCcy(Number(inv.amount_invoiced), inv.currency)}</b>
              {' '}<span className="text-on-surface-subtle">≈</span> <b className="text-on-surface num-mono">{money(invInr)}</b>
              {' '}<span className="text-on-surface-subtle">@ 1 {inv.currency} = ₹{Number(inv.fx_rate ?? 0).toFixed(4)}</span>
            </>
          ) : (
            <>Invoiced amount: <b className="text-on-surface num-mono">{money(invInr)}</b></>
          )}
          {inv.invoice_number && <span> · {inv.invoice_number}</span>}
        </div>
        <Field label="Amount received (₹) — actual INR in your bank" required>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          {variance !== 0 && (
            <p className={`text-xs mt-1 inline-flex items-center gap-1 ${variance < 0 ? 'text-danger' : 'text-success'}`}>
              <AlertTriangle size={11} />
              {variance < 0 ? `Short by ${money(Math.abs(variance))} vs INR equivalent — ${isForeign ? 'Upwork/Payoneer fees + FX swing?' : 'TDS or partial payment?'}` : `Extra ${money(variance)} received over INR equivalent.`}
            </p>
          )}
        </Field>
        <Field label="Cleared date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="e.g. TDS ₹2,500 deducted"
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </Field>
        {err && <p className="text-xs text-danger">{err}</p>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-success text-on-accent disabled:opacity-50 inline-flex items-center gap-1.5">
            <CheckCircle2 size={14} /> {saving ? 'Saving…' : isAdmin ? 'Mark cleared' : 'Submit for approval'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditModal({ inv, isAdmin, onClose, onSaved }: { inv: FinInvoice; isAdmin: boolean; onClose: () => void; onSaved: () => void }) {
  const ccy = (inv.currency || 'INR').toUpperCase();
  const isForeign = ccy !== 'INR';
  const initialInr = Number(inv.amount_invoiced_inr ?? inv.amount_invoiced ?? 0);

  const [invoiceNumber, setInvoiceNumber] = useState(inv.invoice_number || '');
  const [invoiceDate, setInvoiceDate] = useState(inv.invoice_date ? inv.invoice_date.slice(0, 10) : '');
  // Native = the currency the invoice was raised in (USD for Upwork etc.).
  // Inr = the home-currency equivalent locked at billing time. For INR
  // invoices native === inr; for foreign invoices they differ and admin
  // can adjust EITHER side — the other recomputes via the fx_rate.
  const [amountNative, setAmountNative] = useState(String(inv.amount_invoiced));
  const [amountInr, setAmountInr] = useState(String(Math.round(initialInr * 100) / 100));
  const [amountReceived, setAmountReceived] = useState(inv.amount_received != null ? String(inv.amount_received) : '');
  const [notes, setNotes] = useState(inv.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // When native changes, recompute INR using the current fx_rate. When
  // INR changes, treat it as an override that implicitly changes the
  // rate (derived = inr / native) — we send that derived rate to the
  // server so the stored amount_invoiced_inr matches what admin sees.
  const onNativeChange = (v: string) => {
    setAmountNative(v);
    if (!isForeign) { setAmountInr(v); return; }
    const n = Number(v);
    const rate = Number(inv.fx_rate ?? 0);
    if (n > 0 && rate > 0) setAmountInr(String(Math.round(n * rate * 100) / 100));
  };
  const onInrChange = (v: string) => {
    setAmountInr(v);
    if (!isForeign) setAmountNative(v);
  };

  // Derived rate to submit. INR invoices always use 1; foreign invoices
  // use whatever the user's INR override implies. Falls back to the
  // existing fx_rate if either side is empty / zero.
  const derivedRate = (() => {
    if (!isForeign) return 1;
    const n = Number(amountNative), i = Number(amountInr);
    if (n > 0 && i > 0) return i / n;
    return Number(inv.fx_rate ?? 0) || 1;
  })();

  const submit = async () => {
    const ai = Number(amountNative);
    if (!(ai > 0)) { setErr('Invoiced amount must be > 0'); return; }
    if (isForeign) {
      const i = Number(amountInr);
      if (!(i > 0)) { setErr('INR equivalent must be > 0'); return; }
    }
    setSaving(true); setErr('');
    try {
      await financeApi.updateInvoice(inv.id, {
        invoice_number: invoiceNumber.trim() || undefined,
        invoice_date: invoiceDate || undefined,
        amount_invoiced: ai,
        // Pass the derived rate so the server's recomputed
        // amount_invoiced_inr matches the value admin saw at edit time.
        // Without this the server would re-fetch a live FX rate and the
        // dashboard could shift by a few % vs what was saved.
        fx_rate: derivedRate,
        amount_received: isAdmin && inv.status === 'cleared' ? Number(amountReceived) : undefined,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const nativeSymbol = symbolOf(ccy).trim() || ccy;

  return (
    <Modal onClose={onClose} title={`Edit invoice · ${inv.project_name}`}>
      <div className="space-y-3">
        {isForeign && (
          <div className="rounded-lg bg-surface-2 border border-outline px-3 py-2 text-[11px] text-on-surface-muted">
            Raised in <b className="text-on-surface">{ccy}</b> · locked at <b className="text-on-surface num-mono">1 {ccy} = ₹{Number(inv.fx_rate ?? 0).toFixed(4)}</b> on the invoice date.
            Edit either field below — the other recomputes from your override so the dashboard never drifts from what you typed.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice #">
            <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </Field>
          <Field label="Invoice date">
            <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </Field>
        </div>
        {isForeign ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Amount invoiced (${nativeSymbol})`} required>
              <input type="number" min="0" step="0.01" value={amountNative} onChange={e => onNativeChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </Field>
            <Field label="Amount invoiced (₹)" required>
              <input type="number" min="0" step="0.01" value={amountInr} onChange={e => onInrChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </Field>
            <div className="col-span-2 -mt-2 text-[11px] text-on-surface-subtle num-mono">
              Implied rate: 1 {ccy} = ₹{derivedRate.toFixed(4)}
            </div>
          </div>
        ) : (
          <Field label="Amount invoiced (₹)" required>
            <input type="number" min="0" step="0.01" value={amountNative} onChange={e => onNativeChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </Field>
        )}
        {isAdmin && inv.status === 'cleared' && (
          <Field label="Amount received (₹) — actual INR in your bank">
            <input type="number" min="0" step="0.01" value={amountReceived} onChange={e => setAmountReceived(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </Field>
        )}
        <Field label="Notes">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </Field>
        {err && <p className="text-xs text-danger">{err}</p>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
          <h3 className="text-base font-bold text-on-surface">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-on-surface-muted uppercase tracking-wide">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return d; }
}

// ── Activity log ──────────────────────────────────────────────────────────
// Surfaces every create / edit / clear / reopen / delete touching the
// invoice table for the visible month so admin can answer "who added
// this on what date" at a glance. Each row leads with the actor + role
// chip; per-action coloured chip on the right; amount-before/after
// diff only renders when it actually changed.
interface InvoiceAuditRow {
  id: number;
  invoice_id: number | null;
  action: 'created' | 'edited' | 'cleared' | 'reopened' | 'deleted' | 'clear_requested' | 'clear_rejected';
  invoice_number: string | null;
  invoice_date: string | null;
  project_id: string | null;
  project_name: string | null;
  month: number | null;
  year: number | null;
  currency: string | null;
  amount_invoiced_before: number | null;
  amount_invoiced_after: number | null;
  amount_received_before: number | null;
  amount_received_after: number | null;
  status_before: string | null;
  status_after: string | null;
  notes_before: string | null;
  notes_after: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  changed_at: string;
}

function timeAgo(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const ACTION_TONE: Record<string, string> = {
  created:         'bg-success-container text-success',
  edited:          'bg-warning-container text-warning',
  cleared:         'bg-accent-container text-accent',
  reopened:        'bg-surface-3 text-on-surface-muted',
  deleted:         'bg-danger-container text-danger',
  clear_requested: 'bg-accent/15 text-accent',
  clear_rejected:  'bg-danger-container text-danger',
};

function InvoiceActivityLog({ month, year }: { month: number; year: number }) {
  const [rows, setRows] = useState<InvoiceAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    financeApi.getInvoiceAudit({ month, year })
      .then((r: any) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [month, year]);

  const filtered = useMemo(() =>
    actionFilter === 'all' ? rows : rows.filter(r => r.action === actionFilter)
  , [rows, actionFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, created: 0, edited: 0, clear_requested: 0, cleared: 0, clear_rejected: 0, reopened: 0, deleted: 0 };
    for (const r of rows) c[r.action] = (c[r.action] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <div className="px-5 py-3 border-b border-outline flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-on-surface">Activity log · {MONTHS[month - 1]} {year}</h3>
          <span className="text-xs text-on-surface-muted">{filtered.length} of {rows.length}</span>
        </div>
        <div className="inline-flex items-center gap-1">
          {['all','created','edited','clear_requested','cleared','clear_rejected','reopened','deleted'].map(a => (
            <button key={a} onClick={() => setActionFilter(a)}
              className={`px-2 py-1 rounded text-[11px] font-semibold capitalize transition-colors ${
                actionFilter === a
                  ? 'bg-accent text-on-accent'
                  : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-2'
              }`}>
              {a} {counts[a] > 0 && <span className="num-mono opacity-75">({counts[a]})</span>}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="p-12 text-center text-sm text-on-surface-muted">Loading activity…</div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center">
          <Clock size={28} className="mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">No {actionFilter === 'all' ? '' : actionFilter} activity for {MONTHS[month - 1]} {year}.</p>
          <p className="text-xs text-on-surface-subtle mt-1">Audit logging started on deploy — events before then are not shown.</p>
        </div>
      ) : (
        <div className="divide-y divide-outline">
          {filtered.map(r => {
            const amtChanged = r.action === 'edited' && Number(r.amount_invoiced_before ?? 0) !== Number(r.amount_invoiced_after ?? 0);
            const recvChanged = r.action === 'edited' && Number(r.amount_received_before ?? 0) !== Number(r.amount_received_after ?? 0);
            const notesChanged = (r.notes_before ?? '') !== (r.notes_after ?? '') && r.action === 'edited';
            const showAmount = (r.action === 'created' || r.action === 'deleted' || r.action === 'cleared' || amtChanged);
            return (
              <div key={r.id} className="px-5 py-3 hover:bg-surface-2/40 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${ACTION_TONE[r.action] ?? 'bg-surface-3'}`}>
                        {r.action}
                      </span>
                      <span className="text-sm font-semibold text-on-surface truncate">
                        {r.project_name ?? '—'}
                      </span>
                      {r.invoice_number && (
                        <span className="text-xs text-on-surface-muted num-mono">{r.invoice_number}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-on-surface-subtle mt-1">
                      <span className="font-semibold text-on-surface">{r.actor_name ?? 'Unknown'}</span>
                      {r.actor_role && <span className="text-on-surface-subtle"> ({r.actor_role})</span>}
                      {' · '}
                      <span title={new Date(r.changed_at).toLocaleString('en-IN')}>
                        {new Date(r.changed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {' · '}<span className="num-mono">{timeAgo(r.changed_at)}</span>
                      {r.invoice_date && <> · <span className="text-on-surface-subtle">invoice dated {formatDate(r.invoice_date)}</span></>}
                    </p>
                    {showAmount && (
                      <div className="flex items-center gap-2 mt-1.5 text-xs flex-wrap">
                        {r.action === 'edited' && amtChanged && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-warning-container text-warning">
                            Invoiced
                            <span className="num-mono opacity-75 line-through">{fmtCcy(Number(r.amount_invoiced_before ?? 0), r.currency || 'INR')}</span>
                            <span>→</span>
                            <span className="num-mono font-semibold">{fmtCcy(Number(r.amount_invoiced_after ?? 0), r.currency || 'INR')}</span>
                          </span>
                        )}
                        {r.action !== 'edited' && (
                          <span className="text-on-surface-muted">
                            Amount: <span className="num-mono font-semibold text-on-surface">{fmtCcy(Number(r.amount_invoiced_after ?? r.amount_invoiced_before ?? 0), r.currency || 'INR')}</span>
                          </span>
                        )}
                        {recvChanged && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-success-container text-success">
                            Received
                            <span className="num-mono opacity-75 line-through">{r.amount_received_before == null ? '—' : money(Number(r.amount_received_before))}</span>
                            <span>→</span>
                            <span className="num-mono font-semibold">{r.amount_received_after == null ? '—' : money(Number(r.amount_received_after))}</span>
                          </span>
                        )}
                        {r.action === 'cleared' && r.amount_received_after != null && (
                          <span className="text-on-surface-muted">
                            Received: <span className="num-mono font-semibold text-success">{money(Number(r.amount_received_after))}</span>
                          </span>
                        )}
                      </div>
                    )}
                    {notesChanged && (
                      <p className="text-[11px] text-on-surface-subtle mt-1 italic">
                        Notes: <span className="line-through opacity-60">{r.notes_before || '∅'}</span>
                        {' → '}
                        <span className="text-on-surface-muted not-italic">{r.notes_after || '∅'}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

