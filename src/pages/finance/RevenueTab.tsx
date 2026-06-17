import { useEffect, useMemo, useState } from 'react';
import { Copy, Plus, X, CheckCircle, RotateCcw } from 'lucide-react';
import { financeApi } from '../../services/financeApi';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { MONTHS, money } from './format';

// Billing Setup is Upwork-only. The flow mirrors Invoices:
//   coordinator enters amount in the project's currency (USD by default)
//     → status='pending', counts as revenue (invoiced)
//   admin marks cleared with actual received amount
//     → status='cleared', counts toward profit (received)
// Direct/retainer projects use the Invoices tab instead.

const BLANK_NEW = { name: '', client_name: '', billing_type: 'fixed', fixed_amount: '', hourly_rate: '', billable_hours: '' };

const CURRENCIES = [
  { code: 'INR', label: '₹ INR', symbol: '₹' },
  { code: 'USD', label: '$ USD', symbol: '$' },
  { code: 'EUR', label: '€ EUR', symbol: '€' },
  { code: 'GBP', label: '£ GBP', symbol: '£' },
  { code: 'AUD', label: 'A$ AUD', symbol: 'A$' },
  { code: 'CAD', label: 'C$ CAD', symbol: 'C$' },
];
const symbolOf = (ccy: string) => CURRENCIES.find(c => c.code === ccy)?.symbol ?? `${ccy} `;
const fmtCcy = (n: number, ccy: string) => `${symbolOf(ccy)}${Math.round(n).toLocaleString('en-IN')}`;

type Row = {
  id: string; name: string; client_name: string | null;
  billing_source?: string | null;
  billing_type: 'fixed' | 'hourly'; fixed_amount: number; hourly_rate: number; billable_hours: number;
  currency: string; fx_rate: number | null;
  status: 'pending' | 'cleared_pending' | 'cleared';
  amount_received: number | null; received_inr: number | null; received_fx_rate: number | null;
  cleared_at: string | null; cleared_by: string | null; cleared_by_name: string | null; clearance_note: string | null;
};

export default function RevenueTab({ month, year, onChanged }: { month: number; year: number; onChanged: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // Top-level view inside this tab — table (default) vs activity log.
  // Mirrors the chip on the Invoices tab so admin lands on a familiar
  // pattern. Coord sees only the table view.
  const [view, setView] = useState<'rows' | 'activity'>('rows');
  const [creating, setCreating] = useState(false);
  const [np, setNp] = useState({ ...BLANK_NEW });
  // Clearance dialog state — admin marks "we got the payment"
  const [clearing, setClearing] = useState<Row | null>(null);
  const [clearForm, setClearForm] = useState<{ amount_received: string; clearance_note: string }>({ amount_received: '', clearance_note: '' });
  const [clearFxRate, setClearFxRate] = useState<number | null>(null);
  const [clearingBusy, setClearingBusy] = useState(false);
  // One-shot cleanup of legacy direct-project rows (after Upwork-only migration).
  const [legacyCount, setLegacyCount] = useState<number | null>(null);
  const [cleaningLegacy, setCleaningLegacy] = useState(false);

  const load = () => {
    setLoading(true); setErr('');
    financeApi.getRevenue(month, year)
      .then((rev) => {
        setRows((rev as any[]).map((r) => ({
          id: r.id, name: r.name, client_name: r.client_name,
          billing_source: r.billing_source,
          billing_type: (r.billing_type as any) || 'fixed',
          fixed_amount: Number(r.fixed_amount || 0), hourly_rate: Number(r.hourly_rate || 0), billable_hours: Number(r.billable_hours || 0),
          currency: r.currency || 'USD',  // Upwork tab defaults to USD
          fx_rate: r.fx_rate != null ? Number(r.fx_rate) : null,
          status: (r.status as any) || 'pending',
          amount_received: r.amount_received != null ? Number(r.amount_received) : null,
          received_inr: r.received_inr != null ? Number(r.received_inr) : null,
          received_fx_rate: r.received_fx_rate != null ? Number(r.received_fx_rate) : null,
          cleared_at: r.cleared_at ?? null,
          cleared_by: r.cleared_by ?? null,
          cleared_by_name: r.cleared_by_name ?? null,
          clearance_note: r.clearance_note ?? null,
        })));
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [month, year]);

  // Show a banner to admin if there are still legacy direct-project rows in
  // fin_project_revenue. They no longer have a UI to be edited, but they'd
  // still drive revenue in revenueOf() until cleaned up.
  useEffect(() => {
    if (!isAdmin) return;
    financeApi.cleanupDirectRevenue(true)
      .then(r => setLegacyCount(r.would_delete ?? 0))
      .catch(() => setLegacyCount(null));
  }, [isAdmin]);

  const runCleanup = async () => {
    if (!confirm(`Delete ${legacyCount} direct-project billing rows? These are legacy entries — direct projects use Invoices going forward. This cannot be undone.`)) return;
    setCleaningLegacy(true);
    try {
      const r = await financeApi.cleanupDirectRevenue(false);
      setLegacyCount(0);
      onChanged();
      alert(`Cleaned up ${r.deleted} rows.`);
    } catch (e: any) { setErr(e.message); }
    finally { setCleaningLegacy(false); }
  };

  // Only show Upwork projects on this tab — direct projects belong on Invoices.
  const upworkRows = useMemo(() => rows.filter(r => r.billing_source === 'upwork'), [rows]);

  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = async (r: Row) => {
    setSaving(r.id);
    try {
      let rate = r.fx_rate;
      if (r.currency !== 'INR' && (rate == null || rate <= 0)) {
        try {
          const fx = await financeApi.getFxRate({ from: r.currency, to: 'INR' });
          rate = fx.rate;
          set(r.id, { fx_rate: rate });
        } catch { /* server will look up if missing */ }
      }
      await financeApi.saveRevenue({
        project_id: r.id, month, year,
        billing_type: r.billing_type,
        fixed_amount: r.fixed_amount, hourly_rate: r.hourly_rate, billable_hours: r.billable_hours,
        currency: r.currency, fx_rate: r.currency === 'INR' ? 1 : (rate ?? undefined),
      });
      onChanged();
    } catch (e: any) { setErr(e.message); } finally { setSaving(null); }
  };

  // ── Clearance dialog ────────────────────────────────────────────────────
  const openClear = async (r: Row) => {
    const invoicedNative = r.billing_type === 'hourly' ? r.hourly_rate * r.billable_hours : r.fixed_amount;
    setClearing(r);
    setClearForm({ amount_received: String(invoicedNative), clearance_note: '' });
    if (r.currency === 'INR') setClearFxRate(1);
    else {
      try {
        const fx = await financeApi.getFxRate({ from: r.currency, to: 'INR' });
        setClearFxRate(fx.rate);
      } catch { setClearFxRate(r.fx_rate); }
    }
  };
  const confirmClear = async () => {
    if (!clearing) return;
    setClearingBusy(true);
    try {
      await financeApi.clearRevenue(clearing.id, month, year, {
        amount_received: Number(clearForm.amount_received),
        clearance_note: clearForm.clearance_note.trim() || undefined,
        fx_rate: clearing.currency === 'INR' ? 1 : (clearFxRate ?? undefined),
      });
      setClearing(null);
      load(); onChanged();
    } catch (e: any) { setErr(e.message); }
    finally { setClearingBusy(false); }
  };
  const reopen = async (r: Row) => {
    const isAdmin = user?.role === 'admin';
    const isOwn = r.status === 'cleared_pending' && r.cleared_by === user?.id;
    const prompt = !isAdmin && isOwn
      ? `Withdraw your clearance request for ${r.name}? You can edit and resubmit.`
      : `Reopen ${r.name}? This clears the received amount and flips it back to pending.`;
    if (!confirm(prompt)) return;
    try {
      await financeApi.reopenRevenue(r.id, month, year);
      load(); onChanged();
    } catch (e: any) { setErr(e.message); }
  };
  const approveClearance = async (r: Row) => {
    if (!confirm(`Approve clearance for ${r.name}?`)) return;
    try {
      await financeApi.approveRevenueClearance(r.id, month, year);
      load(); onChanged();
    } catch (e: any) { setErr(e.message); }
  };
  const rejectClearance = async (r: Row) => {
    const reason = window.prompt('Reason for rejecting this clearance (the coordinator sees this):');
    if (!reason?.trim()) return;
    try {
      await financeApi.rejectRevenueClearance(r.id, month, year, reason.trim());
      load(); onChanged();
    } catch (e: any) { setErr(e.message); }
  };

  const createProject = async () => {
    if (!np.name.trim()) { setErr('Project name is required'); return; }
    setCreating(true); setErr('');
    try {
      // Create as Upwork project. Use the financeApi createProject + then
      // mark it as Upwork via the Projects PUT? Simpler: include flag in payload
      // and let backend pass it through. For now we patch the project after create.
      const created = await financeApi.createProject({
        name: np.name.trim(), client_name: np.client_name.trim(), month, year,
        billing_type: np.billing_type, fixed_amount: Number(np.fixed_amount) || 0,
        hourly_rate: Number(np.hourly_rate) || 0, billable_hours: Number(np.billable_hours) || 0,
        created_by: user?.name,
      });
      // Tag as Upwork so it shows up on this tab going forward.
      try { await api.updateProject((created as any).id, { billing_source: 'upwork' }); } catch {}
      setNp({ ...BLANK_NEW }); setShowAdd(false);
      load(); onChanged();
    } catch (e: any) { setErr(e.message); } finally { setCreating(false); }
  };

  const copyPrev = async () => {
    const idx = year * 12 + (month - 1) - 1;
    const pm = (idx % 12) + 1, py = Math.floor(idx / 12);
    if (!confirm(`Copy project billing from ${MONTHS[pm - 1]} ${py} into ${MONTHS[month - 1]} ${year}? Existing rows are kept.`)) return;
    try { await financeApi.copyMonth(pm, py, month, year); load(); onChanged(); } catch (e: any) { setErr(e.message); }
  };

  if (loading) return <div className="h-64 rounded-xl-2 bg-surface-2 animate-pulse" />;

  // Totals (Upwork only, INR). Invoiced rolls up everything not finally
  // cleared (so cleared_pending still appears as outstanding work).
  // Received counts ONLY rows admin has approved — cleared_pending isn't
  // cash in the bank yet, even though the coord submitted an amount.
  const invoicedTotal = upworkRows.reduce((s, r) => {
    const v = r.fx_rate ? (r.billing_type === 'hourly' ? r.hourly_rate * r.billable_hours : r.fixed_amount) * r.fx_rate : 0;
    return s + (r.status === 'cleared' ? 0 : v);
  }, 0);
  const receivedTotal = upworkRows.reduce((s, r) => s + (r.status === 'cleared' ? (r.received_inr ?? 0) : 0), 0);

  return (
    <div className="space-y-4">
      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      <div className="rounded-xl-2 border border-outline bg-surface-2/60 p-4 text-xs text-on-surface-muted">
        <p className="text-on-surface font-semibold text-sm mb-1">Billing setup · Upwork projects</p>
        <p>
          For Upwork projects, coordinator enters the contract amount here (USD by default). Once admin marks it <b className="text-on-surface">Cleared</b> with the actual amount that landed in the bank, the variance (Upwork fee, FX) flows through to net profit — same way <b className="text-on-surface">Invoices</b> work for direct clients.
        </p>
      </div>

      {isAdmin && legacyCount != null && legacyCount > 0 && (
        <div className="rounded-xl-2 border border-warning/40 bg-warning-container/30 p-4 flex items-center justify-between gap-4">
          <div className="text-xs text-on-surface-muted">
            <p className="text-on-surface font-semibold text-sm mb-0.5">{legacyCount} legacy direct-project billing row{legacyCount === 1 ? '' : 's'} found</p>
            <p>These pre-date the Upwork-only switch and still feed revenue when no invoice exists. Direct projects should use Invoices instead. Click to remove them.</p>
          </div>
          <button onClick={runCleanup} disabled={cleaningLegacy}
            className="rounded-xl-2 bg-warning px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap">
            {cleaningLegacy ? 'Clearing…' : `Clear ${legacyCount}`}
          </button>
        </div>
      )}

      {/* KPI strip — only meaningful for admins; coords don't see cost breakdowns anywhere else either */}
      {isAdmin && (
        <div data-mask-summary className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-xl-2 border border-outline bg-surface p-4">
            <p className="text-[10px] uppercase tracking-wide text-on-surface-subtle font-semibold">Pending (invoiced)</p>
            <p className="num-mono text-2xl font-bold text-warning mt-1">{money(invoicedTotal)}</p>
          </div>
          <div className="rounded-xl-2 border border-outline bg-surface p-4">
            <p className="text-[10px] uppercase tracking-wide text-on-surface-subtle font-semibold">Cleared (received)</p>
            <p className="num-mono text-2xl font-bold text-success mt-1">{money(receivedTotal)}</p>
          </div>
          <div className="rounded-xl-2 border border-outline bg-surface p-4">
            <p className="text-[10px] uppercase tracking-wide text-on-surface-subtle font-semibold">Upwork projects</p>
            <p className="num-mono text-2xl font-bold text-on-surface mt-1">{upworkRows.length}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-on-surface-muted">
            Upwork billing for <b className="text-on-surface">{MONTHS[month - 1]} {year}</b>
          </p>
          {isAdmin && (
            <div className="inline-flex items-center gap-1 bg-surface-2 border border-outline rounded-xl-2 p-1">
              <button onClick={() => setView('rows')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  view === 'rows' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-3'
                }`}>
                Billing rows
              </button>
              <button onClick={() => setView('activity')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  view === 'activity' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-3'
                }`}>
                Activity log
              </button>
            </div>
          )}
        </div>
        {view === 'rows' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-1.5 rounded-xl-2 bg-brand px-3 py-2 text-xs font-medium text-on-brand hover:opacity-90">
              {showAdd ? <X size={14} /> : <Plus size={14} />} {showAdd ? 'Cancel' : 'New Upwork project'}
            </button>
            <button onClick={copyPrev} className="flex items-center gap-1.5 rounded-xl-2 border border-outline bg-surface px-3 py-2 text-xs font-medium text-on-surface hover:bg-surface-2">
              <Copy size={14} /> Copy last month
            </button>
          </div>
        )}
      </div>

      {/* Activity log replaces the table when selected. Admin only —
          gated by the chip toggle above. */}
      {view === 'activity' && isAdmin && (
        <RevenueActivityLog month={month} year={year} />
      )}

      {view === 'rows' && showAdd && (
        <div className="rounded-xl-2 border border-brand/30 bg-brand-container/20 p-4">
          <h4 className="text-sm font-semibold text-on-surface mb-3">New Upwork project <span className="font-normal text-on-surface-muted">· also appears in Project Mgmt</span></h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs text-on-surface-muted mb-1">Project name *</label>
              <input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} placeholder="e.g. Upwork — Acme dashboard"
                className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-sm text-on-surface outline-none focus:border-brand" />
            </div>
            <div>
              <label className="block text-xs text-on-surface-muted mb-1">Client</label>
              <input value={np.client_name} onChange={(e) => setNp({ ...np, client_name: e.target.value })} placeholder="Client name"
                className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-sm text-on-surface outline-none focus:border-brand" />
            </div>
            <div>
              <label className="block text-xs text-on-surface-muted mb-1">Billing</label>
              <select value={np.billing_type} onChange={(e) => setNp({ ...np, billing_type: e.target.value })}
                className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-sm text-on-surface outline-none focus:border-brand">
                <option value="fixed">Fixed monthly</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>
            {np.billing_type === 'fixed' ? (
              <div>
                <label className="block text-xs text-on-surface-muted mb-1">Fixed amount /mo (USD)</label>
                <input type="number" value={np.fixed_amount} onChange={(e) => setNp({ ...np, fixed_amount: e.target.value })} placeholder="0"
                  className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-right text-sm text-on-surface outline-none focus:border-brand" />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-on-surface-muted mb-1">Hourly rate (USD)</label>
                  <input type="number" value={np.hourly_rate} onChange={(e) => setNp({ ...np, hourly_rate: e.target.value })} placeholder="0"
                    className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-right text-sm text-on-surface outline-none focus:border-brand" />
                </div>
                <div>
                  <label className="block text-xs text-on-surface-muted mb-1">Billable hours /mo</label>
                  <input type="number" value={np.billable_hours} onChange={(e) => setNp({ ...np, billable_hours: e.target.value })} placeholder="0"
                    className="w-full rounded-lg border border-outline bg-surface px-2.5 py-2 text-right text-sm text-on-surface outline-none focus:border-brand" />
                </div>
              </>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={createProject} disabled={creating} className="rounded-xl-2 bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:opacity-90 disabled:opacity-50">
              {creating ? 'Creating…' : 'Create Upwork project'}
            </button>
            <span className="text-xs text-on-surface-subtle">Will be tagged Upwork automatically.</span>
          </div>
        </div>
      )}

      {view === 'rows' && (
      <div className="rounded-xl-2 border border-outline bg-surface overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-on-surface-subtle border-b border-outline bg-surface-2">
              <th className="text-left font-semibold px-4 py-2.5">Project</th>
              <th className="text-left font-semibold px-3 py-2.5">Billing</th>
              <th className="text-left font-semibold px-3 py-2.5">Currency</th>
              <th className="text-right font-semibold px-3 py-2.5">Fixed /mo</th>
              <th className="text-right font-semibold px-3 py-2.5">Rate/h</th>
              <th className="text-right font-semibold px-3 py-2.5">Hours</th>
              <th className="text-right font-semibold px-3 py-2.5">Invoiced</th>
              <th className="text-right font-semibold px-3 py-2.5">Received</th>
              <th className="text-center font-semibold px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline">
            {upworkRows.map((r) => {
              const invoicedNative = r.billing_type === 'hourly' ? r.hourly_rate * r.billable_hours : r.fixed_amount;
              const invoicedInr = r.fx_rate ? invoicedNative * r.fx_rate : invoicedNative;
              const isCleared = r.status === 'cleared';
              const isClearPending = r.status === 'cleared_pending';
              // Coordinator can edit invoiced fields only when status is
              // 'pending'. As soon as they request clearance the row is
              // locked until admin decides; once admin clears, the row
              // is fully read-only.
              const readOnly = isCleared || isClearPending;
              const variance = (isCleared || isClearPending) && r.received_inr != null ? r.received_inr - invoicedInr : null;
              const isOwnClearRequest = isClearPending && r.cleared_by === user?.id;
              return (
                <tr key={r.id} className={`hover:bg-surface-2/50 ${isCleared ? 'bg-success-container/15' : isClearPending ? 'bg-accent/5' : ''}`}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-on-surface">{r.name}</span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-container text-accent">Upwork</span>
                    </div>
                    <div className="text-xs text-on-surface-subtle">{r.client_name || '—'}</div>
                    {isCleared && r.cleared_at && (
                      <div className="text-[10px] text-on-surface-subtle mt-0.5">
                        Cleared {new Date(r.cleared_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{r.cleared_by_name && ` by ${r.cleared_by_name}`}
                      </div>
                    )}
                    {isClearPending && (
                      <div className="text-[10px] text-accent mt-0.5">
                        Awaiting admin approval{r.cleared_by_name && ` · submitted by ${r.cleared_by_name}`}
                      </div>
                    )}
                    {r.clearance_note && (
                      <div className="text-[10px] text-on-surface-muted mt-0.5 italic">"{r.clearance_note}"</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select value={r.billing_type} onChange={(e) => set(r.id, { billing_type: e.target.value as any })}
                      disabled={readOnly}
                      className="rounded-lg border border-outline bg-surface px-2 py-1.5 text-sm text-on-surface outline-none focus:border-brand disabled:opacity-40">
                      <option value="fixed">Fixed</option>
                      <option value="hourly">Hourly</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select value={r.currency} onChange={(e) => set(r.id, { currency: e.target.value, fx_rate: null })}
                      disabled={readOnly}
                      className="rounded-lg border border-outline bg-surface px-2 py-1.5 text-sm text-on-surface outline-none focus:border-brand disabled:opacity-40">
                      {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={r.fixed_amount} disabled={r.billing_type !== 'fixed' || readOnly}
                      onChange={(e) => set(r.id, { fixed_amount: Number(e.target.value) })}
                      className="w-28 rounded-lg border border-outline bg-surface px-2 py-1.5 text-right text-sm text-on-surface outline-none focus:border-brand disabled:opacity-40" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={r.hourly_rate} disabled={r.billing_type !== 'hourly' || readOnly}
                      onChange={(e) => set(r.id, { hourly_rate: Number(e.target.value) })}
                      className="w-24 rounded-lg border border-outline bg-surface px-2 py-1.5 text-right text-sm text-on-surface outline-none focus:border-brand disabled:opacity-40" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={r.billable_hours} disabled={r.billing_type !== 'hourly' || readOnly}
                      onChange={(e) => set(r.id, { billable_hours: Number(e.target.value) })}
                      className="w-24 rounded-lg border border-outline bg-surface px-2 py-1.5 text-right text-sm text-on-surface outline-none focus:border-brand disabled:opacity-40" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface">
                    <div>{fmtCcy(invoicedNative, r.currency)}</div>
                    {r.currency !== 'INR' && invoicedNative > 0 && r.fx_rate && (
                      <div className="text-[10px] text-on-surface-subtle font-normal">
                        ≈ {money(invoicedInr)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(isCleared || isClearPending) && r.amount_received != null ? (
                      <>
                        <div className={`font-semibold ${isCleared ? 'text-success' : 'text-accent'}`}>{fmtCcy(r.amount_received, r.currency)}</div>
                        {r.currency !== 'INR' && r.received_inr != null && (
                          <div className="text-[10px] text-on-surface-subtle font-normal">≈ {money(r.received_inr)}</div>
                        )}
                        {variance != null && Math.abs(variance) >= 1 && (
                          <div className={`text-[10px] font-semibold ${variance < 0 ? 'text-danger' : 'text-success'}`}>
                            Δ {variance < 0 ? '-' : '+'}{money(Math.abs(variance))}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-on-surface-subtle">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      isCleared ? 'bg-success-container text-success'
                        : isClearPending ? 'bg-accent-container text-accent'
                        : 'bg-warning-container text-warning'
                    }`}>
                      {isCleared ? '✓ Cleared' : isClearPending ? '⚠ Awaiting approval' : '⏳ Pending'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!isCleared && !isClearPending && (
                      <button onClick={() => save(r)} disabled={saving === r.id}
                        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-on-brand hover:opacity-90 disabled:opacity-40 mr-1.5">
                        {saving === r.id ? '…' : 'Save'}
                      </button>
                    )}
                    {/* Pending → action depends on role. Admin clears
                        directly; coord submits for approval. */}
                    {!isCleared && !isClearPending && invoicedNative > 0 && (
                      <button onClick={() => openClear(r)}
                        className="inline-flex items-center gap-1 rounded-lg bg-success px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90">
                        <CheckCircle size={12} /> {isAdmin ? 'Clear' : 'Request clearance'}
                      </button>
                    )}
                    {/* cleared_pending → admin approves/rejects; coord
                        who submitted can withdraw. */}
                    {isAdmin && isClearPending && (
                      <>
                        <button onClick={() => approveClearance(r)}
                          className="inline-flex items-center gap-1 rounded-lg bg-success px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 mr-1.5">
                          <CheckCircle size={12} /> Approve
                        </button>
                        <button onClick={() => rejectClearance(r)}
                          className="inline-flex items-center gap-1 rounded-lg border border-danger/40 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger-container/40">
                          <X size={12} /> Reject
                        </button>
                      </>
                    )}
                    {!isAdmin && isOwnClearRequest && (
                      <button onClick={() => reopen(r)}
                        className="inline-flex items-center gap-1 rounded-lg border border-outline px-2.5 py-1.5 text-xs font-medium text-on-surface-muted hover:bg-surface-2">
                        <RotateCcw size={12} /> Withdraw
                      </button>
                    )}
                    {isAdmin && isCleared && (
                      <button onClick={() => reopen(r)}
                        className="inline-flex items-center gap-1 rounded-lg border border-outline px-2.5 py-1.5 text-xs font-medium text-on-surface-muted hover:bg-surface-2">
                        <RotateCcw size={12} /> Reopen
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {upworkRows.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-on-surface-muted">
                No Upwork projects. Use the <b className="text-on-surface">Invoices</b> tab for direct/retainer clients, or add a new Upwork project above.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* Clearance dialog */}
      {clearing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setClearing(null)}>
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
              <div>
                <h2 className="font-bold text-base text-on-surface">{isAdmin ? 'Mark Upwork billing cleared' : 'Request clearance approval'}</h2>
                <p className="text-xs text-on-surface-subtle mt-0.5">{clearing.name} · {MONTHS[month - 1]} {year}</p>
                {!isAdmin && (
                  <p className="text-[11px] text-accent mt-1">Admin approval is required before this counts as received.</p>
                )}
              </div>
              <button onClick={() => setClearing(null)}><X size={16} className="text-on-surface-subtle" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-on-surface-muted mb-1 block">Amount actually received ({clearing.currency}) <span className="text-danger">*</span></label>
                <input type="number" min="0" step="0.01" value={clearForm.amount_received}
                  onChange={e => setClearForm(f => ({ ...f, amount_received: e.target.value }))}
                  className="w-full text-sm border border-outline rounded-lg px-3 py-2.5 num-mono focus:outline-none focus:ring-2 focus:ring-primary-200" />
                {clearing.currency !== 'INR' && clearFxRate && clearForm.amount_received && Number(clearForm.amount_received) > 0 && (
                  <p className="text-xs text-on-surface-muted mt-1 num-mono">
                    ≈ ₹{Math.round(Number(clearForm.amount_received) * clearFxRate).toLocaleString('en-IN')}
                    {' '}<span className="text-on-surface-subtle">(1 {clearing.currency} = ₹{clearFxRate.toFixed(4)})</span>
                  </p>
                )}
                <p className="text-xs text-on-surface-subtle mt-1">
                  Lower than invoiced is fine — Upwork fee, FX swing, or short pay. The variance flows through to net profit.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-on-surface-muted mb-1 block">Note (optional)</label>
                <textarea value={clearForm.clearance_note}
                  onChange={e => setClearForm(f => ({ ...f, clearance_note: e.target.value }))}
                  rows={2}
                  placeholder="e.g. Upwork fee 10%, paid 5 Jun"
                  className="w-full border border-outline rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setClearing(null)}
                  className="flex-1 py-2.5 border border-outline rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
                <button onClick={confirmClear} disabled={clearingBusy || !clearForm.amount_received || Number(clearForm.amount_received) < 0}
                  className="flex-1 py-2.5 bg-success text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                  {clearingBusy ? 'Saving…' : isAdmin ? 'Mark Cleared' : 'Submit for approval'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Activity log ──────────────────────────────────────────────────────────
// Same pattern as InvoiceActivityLog on the Invoices tab. Lists every
// saved / clear_requested / cleared / clear_rejected / reopened row for
// the visible month so admin can trace any clearance dispute or recover
// an "I swear it was 500 not 1500" moment.
interface RevenueAuditRow {
  id: number;
  project_id: string;
  project_name: string | null;
  month: number;
  year: number;
  action: 'saved' | 'clear_requested' | 'cleared' | 'clear_rejected' | 'reopened';
  currency: string | null;
  billing_type_before: string | null;
  billing_type_after: string | null;
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

const REV_ACTION_TONE: Record<string, string> = {
  saved:           'bg-warning-container text-warning',
  clear_requested: 'bg-accent/15 text-accent',
  cleared:         'bg-success-container text-success',
  clear_rejected:  'bg-danger-container text-danger',
  reopened:        'bg-surface-3 text-on-surface-muted',
};

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

function fmtCcyAmount(amount: number, ccy: string | null): string {
  const v = Math.round(amount).toLocaleString('en-IN');
  if (!ccy || ccy === 'INR') return `₹${v}`;
  if (ccy === 'USD') return `$${v}`;
  return `${ccy} ${v}`;
}

function RevenueActivityLog({ month, year }: { month: number; year: number }) {
  const [rows, setRows] = useState<RevenueAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    financeApi.getRevenueAudit({ month, year })
      .then((r: any) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [month, year]);

  const filtered = useMemo(() =>
    actionFilter === 'all' ? rows : rows.filter(r => r.action === actionFilter)
  , [rows, actionFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, saved: 0, clear_requested: 0, cleared: 0, clear_rejected: 0, reopened: 0 };
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
        <div className="inline-flex items-center gap-1 flex-wrap">
          {['all','saved','clear_requested','cleared','clear_rejected','reopened'].map(a => (
            <button key={a} onClick={() => setActionFilter(a)}
              className={`px-2 py-1 rounded text-[11px] font-semibold capitalize transition-colors ${
                actionFilter === a
                  ? 'bg-accent text-on-accent'
                  : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-2'
              }`}>
              {a.replace('_', ' ')} {counts[a] > 0 && <span className="num-mono opacity-75">({counts[a]})</span>}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="p-12 text-center text-sm text-on-surface-muted">Loading activity…</div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center text-sm text-on-surface-muted">
          No {actionFilter === 'all' ? '' : actionFilter.replace('_', ' ')} activity for {MONTHS[month - 1]} {year}.
          <p className="text-xs text-on-surface-subtle mt-1">Audit logging started on deploy — events before then are not shown.</p>
        </div>
      ) : (
        <div className="divide-y divide-outline">
          {filtered.map(r => {
            const amtChanged = Number(r.amount_invoiced_before ?? 0) !== Number(r.amount_invoiced_after ?? 0);
            const recvChanged = Number(r.amount_received_before ?? 0) !== Number(r.amount_received_after ?? 0);
            const notesChanged = (r.notes_before ?? '') !== (r.notes_after ?? '');
            return (
              <div key={r.id} className="px-5 py-3 hover:bg-surface-2/40 transition-colors">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${REV_ACTION_TONE[r.action] ?? 'bg-surface-3'}`}>
                    {r.action.replace('_', ' ')}
                  </span>
                  <span className="text-sm font-semibold text-on-surface truncate">{r.project_name ?? '—'}</span>
                  {r.currency && <span className="text-[10px] text-on-surface-subtle font-bold">{r.currency}</span>}
                </div>
                <p className="text-[11px] text-on-surface-subtle">
                  <span className="font-semibold text-on-surface">{r.actor_name ?? 'Unknown'}</span>
                  {r.actor_role && <span className="text-on-surface-subtle"> ({r.actor_role})</span>}
                  {' · '}
                  <span title={new Date(r.changed_at).toLocaleString('en-IN')}>
                    {new Date(r.changed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {' · '}<span className="num-mono">{timeAgo(r.changed_at)}</span>
                </p>
                {(amtChanged || recvChanged) && (
                  <div className="flex items-center gap-2 mt-1.5 text-xs flex-wrap">
                    {amtChanged && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-warning-container text-warning">
                        Invoiced
                        <span className="num-mono opacity-75 line-through">{fmtCcyAmount(Number(r.amount_invoiced_before ?? 0), r.currency)}</span>
                        <span>→</span>
                        <span className="num-mono font-semibold">{fmtCcyAmount(Number(r.amount_invoiced_after ?? 0), r.currency)}</span>
                      </span>
                    )}
                    {recvChanged && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-success-container text-success">
                        Received
                        <span className="num-mono opacity-75 line-through">{r.amount_received_before == null ? '—' : fmtCcyAmount(Number(r.amount_received_before), r.currency)}</span>
                        <span>→</span>
                        <span className="num-mono font-semibold">{r.amount_received_after == null ? '—' : fmtCcyAmount(Number(r.amount_received_after), r.currency)}</span>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
