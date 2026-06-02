import { useEffect, useMemo, useState } from 'react';
import { Plus, X, CheckCircle2, Clock, RotateCcw, Pencil, Trash2, MoreVertical, AlertTriangle, FileText, Ban } from 'lucide-react';
import { financeApi, type FinInvoice } from '../../services/financeApi';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { MONTHS, money } from './format';

type StatusFilter = 'all' | 'pending' | 'cleared';

const BLANK_NEW = {
  project_id: '',
  invoice_number: '',
  invoice_date: new Date().toISOString().slice(0, 10),
  amount_invoiced: '',
  notes: '',
};

export default function InvoicesTab({ month, year, onChanged }: { month: number; year: number; onChanged: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const userId = user?.id;

  const [invoices, setInvoices] = useState<FinInvoice[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; client_name: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [showAdd, setShowAdd] = useState(false);
  const [np, setNp] = useState({ ...BLANK_NEW });
  const [creating, setCreating] = useState(false);

  const [clearTarget, setClearTarget] = useState<FinInvoice | null>(null);
  const [editTarget, setEditTarget] = useState<FinInvoice | null>(null);

  const load = () => {
    setLoading(true); setErr('');
    Promise.all([
      financeApi.getInvoices({ month, year }),
      api.getProjects({ status: 'active' }) as Promise<Array<{ id: string; name: string; client_name: string | null }>>,
    ])
      .then(([inv, projs]) => {
        setInvoices(inv);
        setProjects(projs);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [month, year]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return invoices.filter(i => i.status !== 'cancelled');
    return invoices.filter(i => i.status === statusFilter);
  }, [invoices, statusFilter]);

  const totals = useMemo(() => {
    const active = invoices.filter(i => i.status !== 'cancelled');
    const invoiced = active.reduce((s, i) => s + Number(i.amount_invoiced || 0), 0);
    const received = active.filter(i => i.status === 'cleared').reduce((s, i) => s + Number(i.amount_received || 0), 0);
    const pending = active.filter(i => i.status === 'pending').reduce((s, i) => s + Number(i.amount_invoiced || 0), 0);
    const pendingCount = active.filter(i => i.status === 'pending').length;
    return { invoiced, received, pending, pendingCount };
  }, [invoices]);

  const create = async () => {
    if (!np.project_id) { setErr('Pick a project'); return; }
    const amt = Number(np.amount_invoiced);
    if (!(amt > 0)) { setErr('Enter an invoiced amount > 0'); return; }
    setCreating(true); setErr('');
    try {
      await financeApi.addInvoice({
        project_id: np.project_id,
        month, year,
        invoice_number: np.invoice_number.trim() || undefined,
        invoice_date: np.invoice_date || undefined,
        amount_invoiced: amt,
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

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-xl-2 p-1">
          {(['all', 'pending', 'cleared'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                statusFilter === s ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-3'
              }`}>
              {s === 'all' ? 'All active' : s}
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

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Invoiced" value={money(totals.invoiced)} sub="accrual · what we billed" tone="text-on-surface" />
        <Tile label="Received" value={money(totals.received)} sub="cash · what landed in bank" tone="text-success" />
        <Tile label="Pending" value={money(totals.pending)} sub={`${totals.pendingCount} invoice${totals.pendingCount === 1 ? '' : 's'} awaiting clearance`} tone={totals.pendingCount > 0 ? 'text-warning' : 'text-on-surface-subtle'} />
        <Tile label="Variance" value={money(totals.received - totals.invoiced)}
          sub={totals.received < totals.invoiced ? 'short on cleared' : totals.received > totals.invoiced ? 'extra on cleared' : 'on track'}
          tone={totals.received < totals.invoiced ? 'text-danger' : 'text-on-surface'} />
      </div>

      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      {/* Table */}
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
                  <th className="text-right font-semibold px-3 py-2.5">Received</th>
                  <th className="text-right font-semibold px-3 py-2.5">Δ</th>
                  <th className="text-left font-semibold px-3 py-2.5">Status</th>
                  <th className="text-left font-semibold px-3 py-2.5">Raised by</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {filtered.map(inv => {
                  const variance = (Number(inv.amount_received ?? 0)) - Number(inv.amount_invoiced);
                  const isCancelled = inv.status === 'cancelled';
                  const isCleared = inv.status === 'cleared';
                  const canEditAsCoord = !isAdmin && inv.status === 'pending' && inv.created_by === userId;
                  const canDeleteAsCoord = canEditAsCoord;
                  return (
                    <tr key={inv.id} className={`hover:bg-surface-2/50 ${isCancelled ? 'opacity-50 line-through' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-on-surface">{inv.project_name || '—'}</div>
                        {inv.project_client_name && <div className="text-xs text-on-surface-subtle">{inv.project_client_name}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-on-surface-muted num-mono text-xs">{inv.invoice_number || '—'}</td>
                      <td className="px-3 py-2.5 text-on-surface-muted text-xs">{formatDate(inv.invoice_date)}</td>
                      <td className="px-3 py-2.5 text-right num-mono text-on-surface">{money(Number(inv.amount_invoiced))}</td>
                      <td className="px-3 py-2.5 text-right num-mono">
                        {isCleared ? <span className="text-on-surface">{money(Number(inv.amount_received ?? 0))}</span> : <span className="text-on-surface-subtle">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right num-mono text-xs">
                        {isCleared ? (
                          <span className={variance === 0 ? 'text-on-surface-subtle' : variance < 0 ? 'text-danger' : 'text-success'}>
                            {variance > 0 ? '+' : ''}{money(variance)}
                          </span>
                        ) : <span className="text-on-surface-subtle">—</span>}
                      </td>
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
                          canEditAsCoord={canEditAsCoord}
                          canDeleteAsCoord={canDeleteAsCoord}
                          onClear={() => setClearTarget(inv)}
                          onEdit={() => setEditTarget(inv)}
                          onReopen={() => reopen(inv)}
                          onCancel={() => cancelInv(inv)}
                          onDelete={() => remove(inv)}
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

      {/* New invoice modal */}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} title="Raise new invoice">
          <div className="space-y-3">
            <Field label="Project" required>
              <select value={np.project_id} onChange={e => setNp({ ...np, project_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30">
                <option value="">— pick a project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.client_name ? ` · ${p.client_name}` : ''}</option>)}
              </select>
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
            <Field label="Amount invoiced (₹)" required>
              <input type="number" min="0" step="0.01" value={np.amount_invoiced}
                onChange={e => setNp({ ...np, amount_invoiced: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </Field>
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

function RowActions({ inv, isAdmin, canEditAsCoord, canDeleteAsCoord, onClear, onEdit, onReopen, onCancel, onDelete }: {
  inv: FinInvoice; isAdmin: boolean;
  canEditAsCoord: boolean; canDeleteAsCoord: boolean;
  onClear: () => void; onEdit: () => void; onReopen: () => void; onCancel: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isPending = inv.status === 'pending';
  const isCleared = inv.status === 'cleared';
  const showAnything = isAdmin || canEditAsCoord || canDeleteAsCoord;
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
          <div className="absolute right-0 mt-1 w-48 bg-surface border border-outline rounded-lg shadow-elev-3 py-1 z-20">
            {isAdmin && isPending && (
              <Item icon={CheckCircle2} label="Mark cleared" onClick={() => { setOpen(false); onClear(); }} tone="text-success" />
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
  const [amount, setAmount] = useState(String(inv.amount_invoiced));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(inv.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const variance = Number(amount) - Number(inv.amount_invoiced);

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
    <Modal onClose={onClose} title={`Mark cleared · ${inv.project_name}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-surface-2 border border-outline p-3 text-xs text-on-surface-muted">
          Invoiced amount: <b className="text-on-surface num-mono">{money(Number(inv.amount_invoiced))}</b>
          {inv.invoice_number && <span> · {inv.invoice_number}</span>}
        </div>
        <Field label="Amount received (₹)" required>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
          {variance !== 0 && (
            <p className={`text-xs mt-1 inline-flex items-center gap-1 ${variance < 0 ? 'text-danger' : 'text-success'}`}>
              <AlertTriangle size={11} />
              {variance < 0 ? `Short by ${money(Math.abs(variance))} — TDS, FX or partial payment?` : `Extra ${money(variance)} received over invoice.`}
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
            <CheckCircle2 size={14} /> {saving ? 'Saving…' : 'Mark cleared'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditModal({ inv, isAdmin, onClose, onSaved }: { inv: FinInvoice; isAdmin: boolean; onClose: () => void; onSaved: () => void }) {
  const [invoiceNumber, setInvoiceNumber] = useState(inv.invoice_number || '');
  const [invoiceDate, setInvoiceDate] = useState(inv.invoice_date ? inv.invoice_date.slice(0, 10) : '');
  const [amountInvoiced, setAmountInvoiced] = useState(String(inv.amount_invoiced));
  const [amountReceived, setAmountReceived] = useState(inv.amount_received != null ? String(inv.amount_received) : '');
  const [notes, setNotes] = useState(inv.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const ai = Number(amountInvoiced);
    if (!(ai > 0)) { setErr('Invoiced amount must be > 0'); return; }
    setSaving(true); setErr('');
    try {
      await financeApi.updateInvoice(inv.id, {
        invoice_number: invoiceNumber.trim() || undefined,
        invoice_date: invoiceDate || undefined,
        amount_invoiced: ai,
        amount_received: isAdmin && inv.status === 'cleared' ? Number(amountReceived) : undefined,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose} title={`Edit invoice · ${inv.project_name}`}>
      <div className="space-y-3">
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
        <Field label="Amount invoiced (₹)" required>
          <input type="number" min="0" step="0.01" value={amountInvoiced} onChange={e => setAmountInvoiced(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-outline text-sm text-on-surface num-mono focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </Field>
        {isAdmin && inv.status === 'cleared' && (
          <Field label="Amount received (₹)">
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
