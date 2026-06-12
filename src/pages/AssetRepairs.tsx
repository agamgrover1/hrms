import { useState, useEffect, useMemo } from 'react';
import {
  Wrench, Laptop, Building2, Plus, Trash2, Pencil, X, Check, AlertTriangle,
  Clock, CheckCircle, XCircle, DollarSign, Search, IndianRupee, History,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

type Tab = 'tickets' | 'assets' | 'vendor';

const APPROVAL_THRESHOLD = 10000;

const STATUS_CFG: Record<string, { label: string; bg: string; color: string; icon: any }> = {
  reported:           { label: 'Needs action',       bg: 'rgb(var(--warning-container))', color: 'rgb(var(--warning))',            icon: AlertTriangle },
  picked_up:          { label: 'Picked Up',         bg: 'rgb(var(--brand-container))',   color: 'rgb(var(--on-brand-container))', icon: Wrench },
  returned:           { label: 'Returned',          bg: 'rgb(var(--success-container))', color: 'rgb(var(--success))',            icon: CheckCircle },
  // New step between Returned and Awaiting Approval. "Returned" means the
  // device physically came back from the vendor; "Repair Done" means the
  // person logging the ticket verified with the employee that the device
  // actually works. Gives HR a paper trail before cost approval.
  repair_done:        { label: 'Repair Done',       bg: 'rgb(var(--accent) / 0.12)',     color: 'rgb(var(--accent))',             icon: CheckCircle },
  awaiting_approval:  { label: 'Awaiting Approval', bg: 'rgb(var(--danger-container))',  color: 'rgb(var(--danger))',             icon: AlertTriangle },
  paid:               { label: 'Paid',              bg: 'rgb(var(--brand-container))',   color: 'rgb(var(--on-brand-container))', icon: DollarSign },
  cancelled:          { label: 'Cancelled',         bg: 'rgb(var(--surface-3))',         color: 'rgb(var(--on-surface-muted))',   icon: XCircle },
};

const fmtINR = (n: any) => n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;
const fmtDate = (d: any) => {
  if (!d) return '—';
  const s = typeof d === 'string' ? d : String(d);
  const date = new Date(s);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
// Relative time for fresh tickets ("2h ago", "3d ago") — gives HR a sense
// of urgency at a glance without forcing them to compute the gap.
const fmtRelative = (d: any) => {
  if (!d) return null;
  const date = new Date(typeof d === 'string' ? d : String(d));
  if (isNaN(date.getTime())) return null;
  const seconds = (Date.now() - date.getTime()) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return null; // older than a week — fall back to the absolute date
};
const fmtDateTime = (d: any) => {
  if (!d) return '—';
  const date = new Date(typeof d === 'string' ? d : String(d));
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function AssetRepairs() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<Tab>('tickets');

  // ── Shared data ─────────────────────────────────────────────────────────
  const [employees, setEmployees] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Modals ──────────────────────────────────────────────────────────────
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendor, setEditingVendor] = useState<any | null>(null);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any | null>(null);
  const [historyAsset, setHistoryAsset] = useState<any | null>(null);
  const [showAddPastRepair, setShowAddPastRepair] = useState<any | null>(null); // asset
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [editingTicket, setEditingTicket] = useState<any | null>(null);
  const [rejectingTicket, setRejectingTicket] = useState<any | null>(null);

  useEffect(() => {
    Promise.all([
      api.getEmployees().then(setEmployees).catch(() => {}),
      api.getVendors().then(setVendors).catch(() => {}),
      api.getAssets().then(setAssets).catch(() => {}),
      api.getRepairTickets().then(setTickets).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const refetchTickets = () => api.getRepairTickets().then(setTickets).catch(() => {});
  const refetchAssets  = () => api.getAssets().then(setAssets).catch(() => {});
  const refetchVendors = () => api.getVendors().then(setVendors).catch(() => {});

  // ── Stats ───────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const inRepair = tickets.filter(t => ['picked_up', 'returned', 'repair_done'].includes(t.status)).length;
    const unpaid   = tickets.filter(t => t.status !== 'paid' && t.status !== 'cancelled')
      .reduce((s, t) => s + Number(t.final_cost ?? t.quoted_cost ?? 0), 0);
    const awaiting = tickets.filter(t => t.status === 'awaiting_approval').length;
    const thisMonthPaid = tickets.filter(t => {
      if (t.status !== 'paid' || !t.paid_at) return false;
      const d = new Date(t.paid_at);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((s, t) => s + Number(t.final_cost ?? 0), 0);
    return { inRepair, unpaid, awaiting, thisMonthPaid };
  }, [tickets]);

  const vendorById = (id: string) => vendors.find(v => v.id === id);
  const assetById  = (id: string) => assets.find(a => a.id === id);
  const empById    = (id: string) => employees.find(e => e.id === id);

  return (
    <div className="space-y-5">
      {/* ── KPI cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="In Repair"           value={stats.inRepair}                  icon={Wrench}        tone="brand"   stagger={1}/>
        <KpiCard label="Awaiting Approval"   value={stats.awaiting}                  icon={AlertTriangle} tone="danger"  stagger={2}/>
        <KpiCard label="Unpaid Total"        value={fmtINR(stats.unpaid)}            icon={IndianRupee}   tone="warning" stagger={3}/>
        <KpiCard label="Paid This Month"     value={fmtINR(stats.thisMonthPaid)}     icon={DollarSign}    tone="success" stagger={4}/>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex bg-surface rounded-xl-2 p-1 border border-outline shadow-elev-1 w-fit">
        {[
          { k: 'tickets', label: 'Repair Tickets', icon: Wrench  },
          { k: 'assets',  label: 'Asset Registry', icon: Laptop  },
          { k: 'vendor',  label: 'Vendor',         icon: Building2 },
        ].map(({ k, label, icon: Icon }) => (
          <button key={k} onClick={() => setTab(k as Tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === k ? 'bg-accent text-on-accent shadow-elev-1' : 'text-on-surface-muted hover:bg-surface-2'}`}>
            <Icon size={14}/>{label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-7 h-7 border-4 border-outline border-t-accent rounded-full animate-spin"/>
        </div>
      ) : (
        <>
          {tab === 'tickets' && (
            <TicketsTab
              tickets={tickets} vendors={vendors} assets={assets} employees={employees}
              vendorById={vendorById} assetById={assetById}
              isAdmin={isAdmin}
              onCreate={() => { setEditingTicket(null); setShowTicketForm(true); }}
              onEdit={(t) => { setEditingTicket(t); setShowTicketForm(true); }}
              onReject={(t) => setRejectingTicket(t)}
              onApprove={async (t) => {
                await api.approveRepairTicket(t.id, user?.name);
                refetchTickets(); refetchAssets();
              }}
              onDelete={async (t) => {
                if (!confirm('Delete this repair ticket? This cannot be undone.')) return;
                await api.deleteRepairTicket(t.id);
                refetchTickets(); refetchAssets();
              }}
              onAction={async (t, status) => {
                await api.updateRepairTicket(t.id, { status, updated_by_role: user?.role });
                refetchTickets(); refetchAssets();
              }}
            />
          )}

          {tab === 'assets' && (
            <AssetsTab
              assets={assets} employees={employees} tickets={tickets}
              onCreate={() => { setEditingAsset(null); setShowAssetForm(true); }}
              onEdit={(a) => { setEditingAsset(a); setShowAssetForm(true); }}
              onHistory={(a: any) => setHistoryAsset(a)}
              onDelete={async (a) => {
                if (!confirm(`Delete asset ${a.asset_tag}?`)) return;
                await api.deleteAsset(a.id);
                refetchAssets();
              }}
            />
          )}

          {tab === 'vendor' && (
            <VendorTab
              vendors={vendors}
              isAdmin={isAdmin}
              onCreate={() => { setEditingVendor(null); setShowVendorForm(true); }}
              onEdit={(v) => { setEditingVendor(v); setShowVendorForm(true); }}
              onDelete={async (v) => {
                if (!confirm(`Delete vendor ${v.name}? Repair tickets will keep the vendor reference but it'll show as removed.`)) return;
                await api.deleteVendor(v.id);
                refetchVendors();
              }}
            />
          )}
        </>
      )}

      {showVendorForm && (
        <VendorFormModal
          initial={editingVendor}
          onClose={() => setShowVendorForm(false)}
          onSaved={() => { setShowVendorForm(false); refetchVendors(); }}
        />
      )}
      {showAssetForm && (
        <AssetFormModal
          initial={editingAsset}
          employees={employees}
          onClose={() => setShowAssetForm(false)}
          onSaved={() => { setShowAssetForm(false); refetchAssets(); }}
        />
      )}
      {historyAsset && (
        <AssetHistoryModal
          asset={historyAsset}
          vendors={vendors}
          onClose={() => setHistoryAsset(null)}
          onAddPast={() => setShowAddPastRepair(historyAsset)}
        />
      )}
      {showAddPastRepair && (
        <PastRepairModal
          asset={showAddPastRepair}
          employees={employees}
          vendors={vendors}
          currentUser={user}
          onClose={() => setShowAddPastRepair(null)}
          onSaved={() => {
            setShowAddPastRepair(null);
            refetchTickets();
            // History modal will refetch automatically on next open; if open
            // now, force a refresh by re-setting the asset state.
            if (historyAsset) setHistoryAsset({ ...historyAsset });
          }}
        />
      )}
      {showTicketForm && (
        <TicketFormModal
          initial={editingTicket}
          employees={employees}
          vendors={vendors}
          assets={assets}
          currentUser={user}
          onClose={() => setShowTicketForm(false)}
          onSaved={() => { setShowTicketForm(false); refetchTickets(); refetchAssets(); }}
        />
      )}
      {rejectingTicket && (
        <RejectModal
          ticket={rejectingTicket}
          currentUser={user}
          onClose={() => setRejectingTicket(null)}
          onRejected={() => { setRejectingTicket(null); refetchTickets(); }}
        />
      )}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon, tone = 'brand', stagger = 1 }: any) {
  const toneMap: Record<string, { iconBg: string; iconColor: string; blob: string }> = {
    brand:   { iconBg: 'bg-brand-container',   iconColor: 'text-on-brand-container', blob: 'bg-brand/15' },
    danger:  { iconBg: 'bg-danger-container',  iconColor: 'text-danger',             blob: 'bg-danger/15' },
    warning: { iconBg: 'bg-warning-container', iconColor: 'text-warning',            blob: 'bg-warning/20' },
    success: { iconBg: 'bg-success-container', iconColor: 'text-success',            blob: 'bg-success/15' },
  };
  const t = toneMap[tone] ?? toneMap.brand;
  return (
    <div className={`group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden p-4 animate-fade-up stagger-${stagger}`}>
      <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full ${t.blob} blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500`} />
      <div className="relative flex items-center justify-between mb-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${t.iconBg}`}>
          <Icon size={16} className={t.iconColor}/>
        </div>
      </div>
      <p className={`num-mono text-2xl font-bold text-on-surface relative`}>{value}</p>
      <p className="text-xs text-on-surface-subtle mt-0.5 relative">{label}</p>
    </div>
  );
}

// ── Tickets Tab ───────────────────────────────────────────────────────────
function TicketsTab({ tickets, vendors, assets, employees, vendorById, assetById, isAdmin, onCreate, onEdit, onReject, onApprove, onDelete, onAction }: any) {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const filtered = tickets.filter((t: any) => {
    if (filter !== 'all' && t.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (t.employee_name ?? '').toLowerCase().includes(q)
        || (t.issue ?? '').toLowerCase().includes(q)
        || (t.laptop_info ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const counts: Record<string, number> = {
    all: tickets.length,
    reported: tickets.filter((t: any) => t.status === 'reported').length,
    picked_up: tickets.filter((t: any) => t.status === 'picked_up').length,
    returned: tickets.filter((t: any) => t.status === 'returned').length,
    repair_done: tickets.filter((t: any) => t.status === 'repair_done').length,
    awaiting_approval: tickets.filter((t: any) => t.status === 'awaiting_approval').length,
    paid: tickets.filter((t: any) => t.status === 'paid').length,
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-surface rounded-lg p-1 border border-outline shadow-elev-1 overflow-x-auto max-w-full">
          {[
            { k: 'all', label: 'All' },
            { k: 'reported', label: 'Reported' },
            { k: 'picked_up', label: 'Picked Up' },
            { k: 'returned', label: 'Returned' },
            { k: 'repair_done', label: 'Repair Done' },
            { k: 'awaiting_approval', label: 'Approval' },
            { k: 'paid', label: 'Paid' },
          ].map(({ k, label }) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-all ${filter === k ? 'bg-accent text-on-accent shadow-elev-1' : 'text-on-surface-muted hover:bg-surface-2'}`}>
              {label}
              <span className="num-mono ml-1.5 text-[10px] opacity-70">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-subtle"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              className="pl-8 pr-3 py-2 text-sm border border-outline rounded-lg bg-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-on-surface placeholder:text-on-surface-subtle"/>
          </div>
          <button onClick={onCreate}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg shadow-elev-1 hover:shadow-elev-2 hover:opacity-90 transition-all">
            <Plus size={14}/> New Ticket
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-12 text-center">
          <Wrench size={32} className="text-on-surface-subtle mx-auto mb-3"/>
          <p className="text-sm text-on-surface-subtle">No repair tickets in this view</p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2">
                  {['Employee', 'Laptop', 'Issue', 'Vendor', 'Cost', 'Status', 'Action'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t: any) => {
                  const cfg = STATUS_CFG[t.status] ?? STATUS_CFG.reported;
                  const asset = t.asset_id ? assetById(t.asset_id) : null;
                  const vendor = t.vendor_id ? vendorById(t.vendor_id) : null;
                  const cost = t.final_cost ?? t.quoted_cost;
                  return (
                    <tr key={t.id} className="border-t border-outline hover:bg-surface-2/60 align-top">
                      <td className="px-4 py-3">
                        {t.employee_name ? (
                          <p className="text-sm font-medium text-on-surface">{t.employee_name}</p>
                        ) : t.asset_id ? (
                          // Asset-only ticket — no employee. Use the asset's
                          // identity as the row label so the table doesn't
                          // read as an orphan "—".
                          <p className="text-sm font-medium text-on-surface inline-flex items-center gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-surface-2 text-on-surface-muted border border-outline">📦 Asset</span>
                            {asset?.asset_tag ?? 'Unassigned'}
                          </p>
                        ) : (
                          <p className="text-sm font-medium text-on-surface">—</p>
                        )}
                        {(() => {
                          const rel = fmtRelative(t.reported_at);
                          return (
                            <p className="text-[10px] text-on-surface-subtle" title={fmtDateTime(t.reported_at)}>
                              {rel ?? fmtDate(t.reported_at)}
                              {rel && t.status === 'reported' && <span className="ml-1 text-warning font-bold">·new</span>}
                            </p>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {asset ? (
                          <>
                            <p className="font-semibold text-on-surface-muted">{asset.asset_tag}</p>
                            <p className="text-on-surface-subtle">{asset.model}</p>
                          </>
                        ) : (
                          <p className="text-on-surface-subtle max-w-[160px] truncate">{t.laptop_info || '—'}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[280px]">
                        <p className="font-medium text-on-surface" title={t.issue}>{t.issue}</p>
                        {t.notes && (
                          <p className="text-on-surface-subtle mt-0.5 leading-snug line-clamp-3 whitespace-pre-line" title={t.notes}>{t.notes}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-muted">{vendor?.name ?? '—'}</td>
                      <td className="px-4 py-3 font-semibold text-on-surface text-sm">
                        <span className="num-mono">{fmtINR(cost)}</span>
                        {Number(cost) > APPROVAL_THRESHOLD && t.status !== 'paid' && (
                          <p className="text-[9px] text-danger font-bold">⚠ Needs approval</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full inline-flex items-center gap-1"
                          style={{ background: cfg.bg, color: cfg.color }}>
                          <cfg.icon size={9}/>{cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          {t.status === 'reported' && (
                            <button onClick={() => onAction(t, 'picked_up')} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-brand-container text-on-brand-container hover:opacity-80 transition-opacity">Pick Up</button>
                          )}
                          {t.status === 'picked_up' && (
                            <button onClick={() => onAction(t, 'returned')} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-success-container text-success hover:opacity-80 transition-opacity">Mark Returned</button>
                          )}
                          {t.status === 'returned' && (
                            <button onClick={() => onAction(t, 'repair_done')} className="text-[10px] font-bold px-2 py-1 rounded-lg" style={{ background: 'rgb(var(--accent) / 0.12)', color: 'rgb(var(--accent))' }}>Mark Repair Done</button>
                          )}
                          {t.status === 'repair_done' && (
                            <button onClick={() => onEdit(t)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-accent text-on-accent hover:opacity-90 transition-opacity">Pay</button>
                          )}
                          {t.status === 'awaiting_approval' && isAdmin && (
                            <>
                              <button onClick={() => onApprove(t)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-success text-white hover:bg-success/90 transition-colors">Approve</button>
                              <button onClick={() => onReject(t)} className="text-[10px] font-bold px-2 py-1 rounded-lg text-danger border border-danger/30 hover:bg-danger-container transition-colors">Reject</button>
                            </>
                          )}
                          {!['paid', 'cancelled'].includes(t.status) && (
                            <button onClick={() => onAction(t, 'cancelled')} className="text-[10px] font-medium px-2 py-1 rounded-lg text-on-surface-subtle hover:bg-surface-2 transition-colors">Cancel</button>
                          )}
                          <button onClick={() => onEdit(t)} className="text-on-surface-subtle hover:text-on-surface p-1 transition-colors"><Pencil size={11}/></button>
                          {isAdmin && (
                            <button onClick={() => onDelete(t)} className="text-on-surface-subtle hover:text-danger p-1 transition-colors"><Trash2 size={11}/></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Assets Tab ────────────────────────────────────────────────────────────
function AssetsTab({ assets, employees, tickets, onCreate, onEdit, onDelete, onHistory }: any) {
  const empById = (id: string) => employees.find((e: any) => e.id === id);
  const openTicketCount = (assetId: string) =>
    tickets.filter((t: any) => t.asset_id === assetId && !['paid', 'cancelled'].includes(t.status)).length;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={onCreate} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg shadow-elev-1 hover:shadow-elev-2 hover:opacity-90 transition-all">
          <Plus size={14}/> Add Asset
        </button>
      </div>
      {assets.length === 0 ? (
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-12 text-center">
          <Laptop size={32} className="text-on-surface-subtle mx-auto mb-3"/>
          <p className="text-sm text-on-surface-subtle">No assets registered yet</p>
          <p className="text-xs text-on-surface-subtle mt-1">Add laptops here to track them over time</p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2">
                  {['Tag', 'Category', 'Model', 'Serial', 'Assigned To', 'Status', 'Active', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assets.map((a: any) => {
                  const open = openTicketCount(a.id);
                  return (
                    <tr key={a.id} className="border-t border-outline hover:bg-surface-2/60">
                      <td className="px-4 py-3 num-mono font-semibold text-on-surface">{a.asset_tag}</td>
                      <td className="px-4 py-3 text-xs">
                        {a.category_name
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-brand-container/60 text-brand font-semibold text-[10px]">{a.category_name}</span>
                          : <span className="text-on-surface-subtle">—</span>}
                      </td>
                      <td className="px-4 py-3 text-on-surface-muted">
                        <div>{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</div>
                        {(a.processor || a.ram || a.storage) && (
                          <div className="text-[10px] text-on-surface-subtle font-normal">
                            {[a.processor, a.ram, a.storage].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-subtle num-mono">{a.serial_no ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-on-surface-muted">{a.assigned_to_name ?? empById(a.assigned_to_id)?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                          a.status === 'active'    ? 'bg-success-container text-success' :
                          a.status === 'in_repair' ? 'bg-warning-container text-warning' :
                                                     'bg-surface-2 text-on-surface-muted'}`}>
                          {a.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {open > 0 ? <span className="num-mono text-xs font-bold text-danger">{open}</span> : <span className="num-mono text-xs text-on-surface-subtle">0</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => onHistory(a)} title="Repair history" className="text-on-surface-subtle hover:text-accent p-1 transition-colors"><History size={12}/></button>
                          <button onClick={() => onEdit(a)} title="Edit" className="text-on-surface-subtle hover:text-on-surface p-1 transition-colors"><Pencil size={12}/></button>
                          <button onClick={() => onDelete(a)} title="Delete" className="text-on-surface-subtle hover:text-danger p-1 transition-colors"><Trash2 size={12}/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Vendor Tab ────────────────────────────────────────────────────────────
function VendorTab({ vendors, isAdmin, onCreate, onEdit, onDelete }: any) {
  return (
    <div className="space-y-4 max-w-3xl">
      {vendors.length === 0 ? (
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-12 text-center">
          <Building2 size={32} className="text-on-surface-subtle mx-auto mb-3"/>
          <p className="text-sm text-on-surface-subtle mb-4">No vendor configured yet</p>
          <button onClick={onCreate} className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg shadow-elev-1 hover:shadow-elev-2 hover:opacity-90 transition-all inline-flex items-center gap-2">
            <Plus size={14}/> Add Vendor
          </button>
        </div>
      ) : (
        <>
          {vendors.map((v: any) => (
            <div key={v.id} className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-shadow p-6">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">{v.name}</h3>
                  {v.contact_person && <p className="text-sm text-on-surface-subtle mt-0.5">{v.contact_person}</p>}
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => onEdit(v)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-outline text-on-surface-muted hover:bg-surface-2 inline-flex items-center gap-1.5 transition-colors">
                    <Pencil size={11}/> Edit
                  </button>
                  {isAdmin && (
                    <button onClick={() => onDelete(v)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-danger/30 text-danger hover:bg-danger-container inline-flex items-center gap-1.5 transition-colors">
                      <Trash2 size={11}/>
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {[
                  { l: 'Phone', v: v.phone },
                  { l: 'Email', v: v.email },
                  { l: 'GST No', v: v.gst_no },
                  { l: 'Status', v: v.active ? '✓ Active' : '✕ Inactive' },
                ].map(({ l, v: val }) => val && (
                  <div key={l}>
                    <p className="text-xs text-on-surface-subtle font-medium">{l}</p>
                    <p className="text-sm text-on-surface-muted mt-0.5">{val}</p>
                  </div>
                ))}
              </div>
              {v.address && (
                <div className="mt-4 pt-4 border-t border-outline">
                  <p className="text-xs text-on-surface-subtle font-medium">Address</p>
                  <p className="text-sm text-on-surface-muted mt-0.5 whitespace-pre-wrap">{v.address}</p>
                </div>
              )}
              {v.notes && (
                <div className="mt-3 p-3 rounded-lg bg-surface-2 text-xs text-on-surface-muted italic">{v.notes}</div>
              )}
            </div>
          ))}
          {/* Add another vendor — collapsed, since user said one vendor only */}
          {vendors.length < 5 && (
            <button onClick={onCreate} className="w-full py-3 border-2 border-dashed border-outline rounded-xl-2 text-sm font-semibold text-on-surface-subtle hover:border-accent/50 hover:text-accent transition-colors">
              <Plus size={14} className="inline mr-1.5"/> Add another vendor
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Vendor form modal ─────────────────────────────────────────────────────
function VendorFormModal({ initial, onClose, onSaved }: any) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    contact_person: initial?.contact_person ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    gst_no: initial?.gst_no ?? '',
    address: initial?.address ?? '',
    notes: initial?.notes ?? '',
    active: initial?.active ?? true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Vendor name is required'); return; }
    setSaving(true); setError('');
    try {
      if (initial) await api.updateVendor(initial.id, form);
      else await api.createVendor(form);
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const f = (k: string, label: string, placeholder?: string, type = 'text') => (
    <div>
      <label className="text-xs font-semibold text-on-surface-subtle block mb-1">{label}</label>
      <input type={type} value={(form as any)[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} placeholder={placeholder}
        className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
    </div>
  );

  return (
    <Modal title={initial ? 'Edit Vendor' : 'Add Vendor'} onClose={onClose}>
      <div className="space-y-3">
        {f('name', 'Vendor Name *', 'e.g. TechRepair Solutions')}
        <div className="grid grid-cols-2 gap-3">
          {f('contact_person', 'Contact Person', 'e.g. Rajesh Kumar')}
          {f('phone', 'Phone', '+91 9876543210', 'tel')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {f('email', 'Email', 'support@vendor.com', 'email')}
          {f('gst_no', 'GST No', '27AAAAA0000A1Z5')}
        </div>
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Address</label>
          <textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none"/>
        </div>
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none"/>
        </div>
        {initial && (
          <label className="flex items-center gap-2 text-xs text-on-surface-muted">
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })}/>
            Active vendor (uncheck to deactivate)
          </label>
        )}
        {error && <p className="text-xs text-danger bg-danger-container border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        <ModalActions onClose={onClose} onSave={handleSave} saving={saving}/>
      </div>
    </Modal>
  );
}

// ── Asset form modal ─────────────────────────────────────────────────────
function AssetFormModal({ initial, employees, onClose, onSaved }: any) {
  const [form, setForm] = useState({
    asset_tag: initial?.asset_tag ?? '',
    category_id: initial?.category_id ?? '',
    model: initial?.model ?? '',
    serial_no: initial?.serial_no ?? '',
    purchase_date: initial?.purchase_date?.split?.('T')[0] ?? '',
    assigned_to_id: initial?.assigned_to_id ?? '',
    status: initial?.status ?? 'active',
    notes: initial?.notes ?? '',
    // Laptop spec block — show only when category=Laptop. Stored unconditionally.
    brand: initial?.brand ?? '',
    os: initial?.os ?? '',
    processor: initial?.processor ?? '',
    ram: initial?.ram ?? '',
    storage: initial?.storage ?? '',
    admin_password: initial?.admin_password ?? '',
  });
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => { api.getAssetCategories().then(setCategories).catch(() => {}); }, []);

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      const c = await api.createAssetCategory(newCategoryName.trim());
      setCategories(prev => {
        const exists = prev.some(x => x.id === c.id);
        return exists ? prev : [...prev, c].sort((a, b) => a.name.localeCompare(b.name));
      });
      setForm({ ...form, category_id: c.id });
      setNewCategoryName('');
      setCreatingCategory(false);
    } catch (e: any) { setError(e.message); }
  };

  const handleSave = async () => {
    if (!form.asset_tag.trim()) { setError('Asset tag is required'); return; }
    setSaving(true); setError('');
    try {
      const emp = employees.find((e: any) => e.id === form.assigned_to_id);
      const payload = { ...form, assigned_to_name: emp?.name ?? null };
      if (initial) await api.updateAsset(initial.id, payload);
      else await api.createAsset(payload);
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={initial ? 'Edit Asset' : 'Add Asset'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Asset Tag *</label>
            <input value={form.asset_tag} onChange={e => setForm({ ...form, asset_tag: e.target.value })} placeholder="DL-LP-001"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 num-mono"/>
          </div>
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Model</label>
            <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Dell XPS 15"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
          </div>
        </div>

        {/* Category picker — pre-seeded with laptop / mouse / monitor etc.
            "+ Add new" inlines a small input so HR doesn't have to leave the
            modal to register a new asset type. */}
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Category</label>
          {!creatingCategory ? (
            <div className="flex gap-2">
              <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}
                className="flex-1 text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20">
                <option value="">— pick a category —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" onClick={() => setCreatingCategory(true)}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-outline bg-surface-2 text-on-surface hover:bg-surface-3 transition-colors whitespace-nowrap">
                + Add new
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input autoFocus value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); } if (e.key === 'Escape') { setCreatingCategory(false); setNewCategoryName(''); } }}
                placeholder="e.g. Tablet, Webcam, Dongle"
                className="flex-1 text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
              <button type="button" onClick={handleAddCategory}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-accent text-on-accent hover:opacity-90">
                Add
              </button>
              <button type="button" onClick={() => { setCreatingCategory(false); setNewCategoryName(''); }}
                className="px-2 py-2 text-xs font-semibold rounded-lg border border-outline bg-surface-2 text-on-surface-muted hover:bg-surface-3">
                Cancel
              </button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Serial No</label>
            <input value={form.serial_no} onChange={e => setForm({ ...form, serial_no: e.target.value })} placeholder="ABC123XYZ"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 num-mono"/>
          </div>
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Purchase Date</label>
            <input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })}
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
          </div>
        </div>

        {/* Laptop spec block — appears when the picked category is named "Laptop"
            (case-insensitive). For other categories the fields aren't relevant
            so we hide them to avoid clutter. */}
        {(() => {
          const catName = categories.find(c => c.id === form.category_id)?.name?.toLowerCase() ?? '';
          if (!catName.includes('laptop')) return null;
          return (
            <div className="space-y-3 rounded-xl border border-outline bg-surface-2/30 p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-subtle">Laptop specs</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Brand</label>
                  <input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="Dell / HP / Apple / Lenovo"
                    className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
                </div>
                <div>
                  <label className="text-xs font-semibold text-on-surface-subtle block mb-1">OS / Windows</label>
                  <input value={form.os} onChange={e => setForm({ ...form, os: e.target.value })} placeholder="Windows 11 Pro / macOS Sonoma"
                    className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Processor</label>
                  <input value={form.processor} onChange={e => setForm({ ...form, processor: e.target.value })} placeholder="Intel i7-12700H / Apple M2 Pro"
                    className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
                </div>
                <div>
                  <label className="text-xs font-semibold text-on-surface-subtle block mb-1">RAM</label>
                  <input value={form.ram} onChange={e => setForm({ ...form, ram: e.target.value })} placeholder="16 GB DDR5"
                    className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
                </div>
                <div>
                  <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Storage</label>
                  <input value={form.storage} onChange={e => setForm({ ...form, storage: e.target.value })} placeholder="512 GB SSD"
                    className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-on-surface-subtle block mb-1 flex items-center gap-1.5">
                    Admin password
                    <span className="text-[10px] font-normal text-on-surface-subtle">(visible to admin/HR only)</span>
                  </label>
                  <div className="flex gap-2">
                    <input type={showPassword ? 'text' : 'password'} value={form.admin_password}
                      onChange={e => setForm({ ...form, admin_password: e.target.value })}
                      placeholder="Leave blank if not set"
                      className="flex-1 text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 num-mono"/>
                    <button type="button" onClick={() => setShowPassword(s => !s)}
                      className="px-3 py-2 text-xs font-semibold rounded-lg border border-outline bg-surface-2 text-on-surface-muted hover:bg-surface-3 whitespace-nowrap">
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <p className="text-[10px] text-on-surface-subtle mt-1">
                    Used by IT for recovery. Not shown to the employee on My Device.
                  </p>
                </div>
              </div>
            </div>
          );
        })()}
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Assigned To</label>
          <select value={form.assigned_to_id} onChange={e => setForm({ ...form, assigned_to_id: e.target.value })}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 bg-surface text-on-surface">
            <option value="">— Unassigned —</option>
            {employees.filter((e: any) => e.status === 'active').map((e: any) => (
              <option key={e.id} value={e.id}>{e.name} ({e.employee_id})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Status</label>
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 bg-surface text-on-surface">
            <option value="active">Active</option>
            <option value="in_repair">In Repair</option>
            <option value="retired">Retired</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none"/>
        </div>
        {error && <p className="text-xs text-danger bg-danger-container border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        <ModalActions onClose={onClose} onSave={handleSave} saving={saving}/>
      </div>
    </Modal>
  );
}

// ── Ticket form modal ─────────────────────────────────────────────────────
function TicketFormModal({ initial, employees, vendors, assets, currentUser, onClose, onSaved }: any) {
  // Subject of repair. 'employee' = an employee's currently assigned asset
  // (existing flow). 'asset' = an unassigned asset — sitting in inventory,
  // returned by someone who left, spare laptop in storage, etc. — that
  // needs repair without a person being involved. When editing, derive
  // from the row: if there's an asset but no employee, it's an asset ticket.
  const initialSubject: 'employee' | 'asset' = initial
    ? (initial.employee_id ? 'employee' : 'asset')
    : 'employee';
  const [subject, setSubject] = useState<'employee' | 'asset'>(initialSubject);
  const [form, setForm] = useState({
    employee_id: initial?.employee_id ?? '',
    asset_id:    initial?.asset_id ?? '',
    laptop_info: initial?.laptop_info ?? '',
    vendor_id:   initial?.vendor_id ?? (vendors[0]?.id ?? ''),
    issue:       initial?.issue ?? '',
    quoted_cost: initial?.quoted_cost ?? '',
    final_cost:  initial?.final_cost ?? '',
    payment_mode: initial?.payment_mode ?? '',
    payment_date: initial?.payment_date?.split?.('T')[0] ?? '',
    notes:       initial?.notes ?? '',
    markPaid:    false,
    force_status: '' as string,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Service log (admin/HR/coord only). Loads when editing an existing ticket.
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'hr_manager' || currentUser?.role === 'project_coordinator';
  const [activity, setActivity] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const loadActivity = async () => {
    if (!initial?.id) return;
    setActivityLoading(true);
    try { setActivity(await api.getRepairTicketActivity(initial.id)); }
    catch { setActivity([]); }
    finally { setActivityLoading(false); }
  };
  useEffect(() => { if (initial?.id && isAdmin) loadActivity(); /* eslint-disable-next-line */ }, [initial?.id]);
  const submitNote = async () => {
    const note = noteDraft.trim();
    if (!note || !initial?.id) return;
    setSavingNote(true);
    try {
      await api.addRepairTicketNote(initial.id, { note, actor_id: currentUser?.id, actor_name: currentUser?.name, actor_role: currentUser?.role });
      setNoteDraft('');
      loadActivity();
    } catch (e: any) { setError(e.message ?? 'Failed to add note'); }
    finally { setSavingNote(false); }
  };

  const employeeAssets = useMemo(
    () => assets.filter((a: any) => a.assigned_to_id === form.employee_id),
    [form.employee_id, assets]
  );

  // Assets that aren't currently assigned to anyone. The "Unassigned asset"
  // mode picks from this list — these are inventory / spare units / assets
  // returned by people who left.
  const unassignedAssets = useMemo(
    () => assets.filter((a: any) => !a.assigned_to_id),
    [assets]
  );

  const handleSave = async () => {
    if (subject === 'employee' && !form.employee_id) { setError('Select an employee'); return; }
    if (subject === 'asset' && !form.asset_id) { setError('Select an asset'); return; }
    if (!form.issue.trim()) { setError('Issue description is required'); return; }
    if (form.quoted_cost && Number(form.quoted_cost) < 0) { setError('Quoted cost cannot be negative'); return; }
    if (form.final_cost && Number(form.final_cost) < 0)   { setError('Final cost cannot be negative');   return; }
    setSaving(true); setError('');
    try {
      const emp = subject === 'employee' ? employees.find((e: any) => e.id === form.employee_id) : null;
      const payload: any = {
        // Asset-mode tickets have no employee — server already accepts null
        // here (employee_id is nullable on repair_tickets). We pass an empty
        // string explicitly so the backend's null coalescing kicks in.
        employee_id: subject === 'employee' ? form.employee_id : null,
        employee_name: emp?.name ?? null,
        asset_id: form.asset_id || null,
        laptop_info: form.laptop_info || null,
        vendor_id: form.vendor_id || null,
        issue: form.issue.trim(),
        quoted_cost: form.quoted_cost ? Number(form.quoted_cost) : null,
        final_cost: form.final_cost ? Number(form.final_cost) : null,
        payment_mode: form.payment_mode || null,
        payment_date: form.payment_date || null,
        notes: form.notes || null,
      };
      if (initial) {
        if (form.markPaid) payload.status = 'paid';
        if (form.force_status) payload.status = form.force_status;
        payload.updated_by_role = currentUser?.role;
        payload.actor_id = currentUser?.id;
        payload.actor_name = currentUser?.name;
        await api.updateRepairTicket(initial.id, payload);
      } else {
        payload.created_by = currentUser?.name;
        await api.createRepairTicket(payload);
      }
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const finalCostNum = Number(form.final_cost || form.quoted_cost || 0);
  const needsApproval = finalCostNum > APPROVAL_THRESHOLD;

  return (
    <Modal title={initial ? `Edit Ticket — ${initial.employee_name ?? (initial.asset_id ? 'Unassigned asset' : '')}` : 'New Repair Ticket'} onClose={onClose}>
      <div className="space-y-3">
        {/* Subject of repair toggle. Disabled when editing — switching mode
            on an existing ticket would silently change what it's about. */}
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1.5">Subject of repair</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setSubject('employee'); setForm(f => ({ ...f, asset_id: '' })); }}
              disabled={!!initial}
              className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                subject === 'employee'
                  ? 'bg-accent text-on-accent border-accent'
                  : 'bg-surface text-on-surface-muted border-outline hover:bg-surface-2'
              } disabled:opacity-50 disabled:cursor-not-allowed`}>
              👤 Employee's asset
            </button>
            <button type="button" onClick={() => { setSubject('asset'); setForm(f => ({ ...f, employee_id: '', asset_id: '' })); }}
              disabled={!!initial}
              className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                subject === 'asset'
                  ? 'bg-accent text-on-accent border-accent'
                  : 'bg-surface text-on-surface-muted border-outline hover:bg-surface-2'
              } disabled:opacity-50 disabled:cursor-not-allowed`}>
              📦 Unassigned asset
            </button>
          </div>
          <p className="text-[10px] text-on-surface-subtle mt-1.5">
            {subject === 'employee'
              ? 'A device an employee is currently using — laptop, mouse, keyboard, etc.'
              : 'A device sitting in inventory, returned by a former employee, or a spare unit that needs repair.'}
          </p>
        </div>

        {subject === 'employee' && (
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Employee *</label>
            <select value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value, asset_id: '' })}
              disabled={!!initial}
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 bg-surface text-on-surface disabled:bg-surface-2 disabled:text-on-surface-subtle">
              <option value="">— Select employee —</option>
              {employees.filter((e: any) => e.status === 'active').map((e: any) => (
                <option key={e.id} value={e.id}>{e.name} ({e.employee_id})</option>
              ))}
            </select>
          </div>
        )}

        {subject === 'asset' && (
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Asset *</label>
            <select value={form.asset_id} onChange={e => setForm({ ...form, asset_id: e.target.value })}
              disabled={!!initial}
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 bg-surface text-on-surface disabled:bg-surface-2 disabled:text-on-surface-subtle">
              <option value="">— Select an unassigned asset —</option>
              {unassignedAssets.map((a: any) => (
                <option key={a.id} value={a.id}>{a.asset_tag} — {a.model ?? 'Unknown model'}</option>
              ))}
            </select>
            {unassignedAssets.length === 0 && (
              <p className="text-[10px] text-warning mt-1.5">
                No unassigned assets in the registry. Add one in the Asset Registry tab first, or leave its "Assigned to" field empty.
              </p>
            )}
          </div>
        )}

        {subject === 'employee' && form.employee_id && employeeAssets.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Laptop (from asset registry)</label>
            <select value={form.asset_id} onChange={e => setForm({ ...form, asset_id: e.target.value })}
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 bg-surface text-on-surface">
              <option value="">— Not from registry / type below —</option>
              {employeeAssets.map((a: any) => (
                <option key={a.id} value={a.id}>{a.asset_tag} — {a.model ?? 'Unknown model'}</option>
              ))}
            </select>
          </div>
        )}

        {!form.asset_id && (
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Laptop info (free text)</label>
            <input value={form.laptop_info} onChange={e => setForm({ ...form, laptop_info: e.target.value })}
              placeholder="e.g. Dell XPS, Serial: ABC123 — old laptop"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Vendor</label>
          <select value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 bg-surface text-on-surface">
            <option value="">— No vendor assigned yet —</option>
            {/* Include inactive vendors so existing tickets referencing them can still be edited */}
            {vendors
              .filter((v: any) => v.active || v.id === form.vendor_id)
              .map((v: any) => (
                <option key={v.id} value={v.id}>
                  {v.name}{!v.active ? ' (inactive)' : ''}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Issue *</label>
          <textarea value={form.issue} onChange={e => setForm({ ...form, issue: e.target.value })} rows={3}
            placeholder="What's wrong with the laptop?"
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none"/>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Quoted Cost (₹)</label>
            <input type="number" min="0" value={form.quoted_cost} onChange={e => setForm({ ...form, quoted_cost: e.target.value })} placeholder="Initial estimate"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 num-mono"/>
          </div>
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Final Cost (₹)</label>
            <input type="number" min="0" value={form.final_cost} onChange={e => setForm({ ...form, final_cost: e.target.value })} placeholder="After repair"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 num-mono"/>
          </div>
        </div>

        {initial && (initial.status === 'returned' || initial.status === 'repair_done') && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Payment Mode</label>
                <select value={form.payment_mode} onChange={e => setForm({ ...form, payment_mode: e.target.value })}
                  className="w-full text-sm border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 bg-surface text-on-surface">
                  <option value="">— Select —</option>
                  <option value="UPI">UPI</option>
                  <option value="Bank">Bank Transfer</option>
                  <option value="Cash">Cash</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Payment Date</label>
                <input type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })}
                  className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"/>
              </div>
            </div>
            <label className={`flex items-center gap-2 text-sm font-semibold p-3 rounded-lg cursor-pointer ${needsApproval ? 'bg-danger-container text-danger' : 'bg-success-container text-success'}`}>
              <input type="checkbox" checked={form.markPaid} onChange={e => setForm({ ...form, markPaid: e.target.checked })}/>
              Mark as paid {needsApproval && currentUser?.role !== 'admin' && <span className="text-xs font-medium num-mono">(will require admin approval — ₹{finalCostNum.toLocaleString('en-IN')} &gt; ₹{APPROVAL_THRESHOLD.toLocaleString('en-IN')})</span>}
            </label>
          </>
        )}

        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none"/>
        </div>

        {/* Admin force-status dropdown — lets admin/HR jump to ANY state at any time */}
        {initial && isAdmin && (
          <div className="rounded-lg border border-outline bg-surface-2/40 p-3">
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">
              Force status (admin override)
            </label>
            <select value={form.force_status} onChange={e => setForm({ ...form, force_status: e.target.value })}
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20">
              <option value="">— Keep current ({initial.status}) —</option>
              <option value="reported">Reported</option>
              <option value="picked_up">Picked up</option>
              <option value="returned">Returned</option>
              <option value="repair_done">Repair done</option>
              <option value="awaiting_approval">Awaiting approval</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <p className="text-[10px] text-on-surface-subtle mt-1">
              Use to fix a wrongly-set status or reopen a closed ticket. Logged in the service trail.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-danger bg-danger-container border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        <ModalActions onClose={onClose} onSave={handleSave} saving={saving}/>

        {/* Service log — admin/HR/coord only. Shown after Save row so it doesn't
            interrupt the editing flow but is always reachable on an existing ticket. */}
        {initial && isAdmin && (
          <div className="rounded-xl-2 border border-outline overflow-hidden mt-4">
            <div className="px-3 py-2 bg-surface-2 border-b border-outline flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-muted">
                Service log · admin only
              </p>
              <p className="text-[10px] text-on-surface-subtle">{activity.length} {activity.length === 1 ? 'entry' : 'entries'}</p>
            </div>

            {/* Add-note row */}
            <div className="px-3 py-2 border-b border-outline bg-surface flex gap-2">
              <input
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNote(); } }}
                placeholder="Add a log note (e.g. 'spoke with vendor about delay')…"
                className="flex-1 text-xs bg-surface border border-outline rounded-lg px-2.5 py-1.5 placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <button onClick={submitNote} disabled={savingNote || !noteDraft.trim()}
                className="px-3 py-1.5 text-xs font-semibold bg-accent text-on-accent rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
                {savingNote ? '…' : 'Add'}
              </button>
            </div>

            {/* Timeline */}
            {activityLoading ? (
              <div className="px-3 py-4 text-center text-xs text-on-surface-subtle">Loading…</div>
            ) : activity.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-on-surface-subtle">No activity recorded yet.</div>
            ) : (
              <ul className="divide-y divide-outline max-h-72 overflow-y-auto">
                {activity.map(a => {
                  const ACTION_CFG: Record<string, { label: string; cls: string }> = {
                    created:        { label: 'Created',        cls: 'bg-brand-container text-on-brand-container' },
                    status_change:  { label: 'Status',         cls: 'bg-surface-3 text-on-surface' },
                    cost_update:    { label: 'Cost',           cls: 'bg-warning-container text-warning' },
                    vendor_change:  { label: 'Vendor',         cls: 'bg-surface-3 text-on-surface' },
                    payment_update: { label: 'Payment',        cls: 'bg-warning-container text-warning' },
                    notes_update:   { label: 'Notes',          cls: 'bg-surface-3 text-on-surface' },
                    approved:       { label: 'Approved',       cls: 'bg-success-container text-success' },
                    rejected:       { label: 'Rejected',       cls: 'bg-danger-container text-danger' },
                    note:           { label: 'Note',           cls: 'bg-accent-container text-on-accent-container' },
                  };
                  const cfg = ACTION_CFG[a.action] ?? { label: a.action, cls: 'bg-surface-3 text-on-surface' };
                  const d = new Date(a.created_at);
                  return (
                    <li key={a.id} className="px-3 py-2.5 flex gap-2.5 items-start">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider flex-shrink-0 mt-0.5 ${cfg.cls}`}>
                        {cfg.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-on-surface leading-snug">{a.description ?? '—'}</p>
                        <p className="text-[10px] text-on-surface-subtle mt-0.5">
                          {a.actor_name ?? 'system'}
                          {a.actor_role ? <span className="ml-1 px-1 py-0 rounded bg-surface-3 text-on-surface-muted">{a.actor_role.replace('_',' ')}</span> : null}
                          <span className="mx-1.5">·</span>
                          <span className="font-mono">{d.toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Reject modal ─────────────────────────────────────────────────────────
function RejectModal({ ticket, currentUser, onClose, onRejected }: any) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleReject = async () => {
    setSaving(true);
    try {
      await api.rejectRepairTicket(ticket.id, currentUser?.name, reason);
      onRejected();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Reject Repair Payment" onClose={onClose}>
      <div className="space-y-3">
        <div className="p-3 rounded-lg bg-surface-2 text-sm">
          <p className="font-semibold text-on-surface-muted">{ticket.employee_name}</p>
          <p className="text-xs text-on-surface-subtle">{ticket.issue}</p>
          <p className="num-mono text-sm font-bold mt-1 text-danger">{fmtINR(ticket.final_cost ?? ticket.quoted_cost)}</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Reason (optional)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
            placeholder="Why are you rejecting this payment?"
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none"/>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm font-medium text-on-surface-muted border border-outline rounded-lg hover:bg-surface-2 transition-colors">Cancel</button>
          <button onClick={handleReject} disabled={saving} className="flex-1 py-2 text-sm font-semibold text-white bg-danger rounded-lg hover:bg-danger/90 disabled:opacity-60 transition-colors">
            {saving ? '…' : 'Reject Payment'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal shell + actions ────────────────────────────────────────────────
function Modal({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-surface-2 rounded-lg transition-colors"><X size={18} className="text-on-surface-subtle"/></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({ onClose, onSave, saving }: any) {
  return (
    <div className="flex gap-2 pt-2">
      <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-on-surface-muted border border-outline rounded-lg hover:bg-surface-2 transition-colors">Cancel</button>
      <button onClick={onSave} disabled={saving} className="flex-1 py-2.5 text-sm font-semibold bg-accent text-on-accent rounded-lg shadow-elev-1 hover:shadow-elev-2 hover:opacity-90 disabled:opacity-60 transition-all inline-flex items-center justify-center gap-2">
        <Check size={14}/>{saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// ── Per-asset repair history modal ────────────────────────────────────────
// Shows running total spent on this asset plus every repair ticket (current
// + historic) in reverse-chronological order. Admin can add a past repair
// inline so legacy data ("we fixed this in March, ₹4,500") gets backfilled.
function AssetHistoryModal({ asset, vendors, onClose, onAddPast }: any) {
  const [data, setData] = useState<{ tickets: any[]; ticket_count: number; total_spend: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true); setErr('');
    api.getAssetRepairHistory(asset.id)
      .then((d) => setData({ tickets: d.tickets, ticket_count: d.ticket_count, total_spend: d.total_spend }))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [asset.id, asset]);

  const fmtINR = (n: any) => n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;
  const fmtDate = (d: any) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return '—'; }
  };
  const vendorName = (id?: string) => vendors?.find?.((v: any) => v.id === id)?.name ?? '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-brand-container/40 to-surface flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">{asset.asset_tag}</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              {asset.category_name && <><span>{asset.category_name}</span> · </>}
              {asset.model || 'Unknown model'} · repair history
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2"><X size={18} className="text-on-surface-muted" /></button>
        </div>

        {/* Total-spend strip */}
        <div className="px-5 py-3 border-b border-outline grid grid-cols-2 gap-3 bg-surface-2/30">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Total spent on repairs</p>
            <p className="num-mono text-2xl font-bold text-on-surface mt-0.5">{fmtINR(data?.total_spend ?? 0)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-on-surface-subtle">Tickets</p>
            <p className="num-mono text-2xl font-bold text-on-surface mt-0.5">{data?.ticket_count ?? 0}</p>
          </div>
        </div>

        {err && <div className="mx-5 mt-3 rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading ? (
            <div className="py-10 text-center text-sm text-on-surface-subtle">Loading…</div>
          ) : !data || data.tickets.length === 0 ? (
            <div className="py-10 text-center">
              <Wrench size={28} className="mx-auto text-on-surface-subtle mb-2" />
              <p className="text-sm text-on-surface-muted">No repairs recorded for this asset.</p>
              <p className="text-xs text-on-surface-subtle mt-1">Add a past repair below to backfill legacy data.</p>
            </div>
          ) : (
            data.tickets.map((t: any) => {
              const cost = t.final_cost ?? t.quoted_cost;
              const isHistoric = t.status === 'paid' || t.status === 'cancelled';
              return (
                <div key={t.id} className="rounded-xl-2 border border-outline p-3 hover:bg-surface-2/40 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-on-surface">{t.issue}</p>
                      <p className="text-[11px] text-on-surface-muted mt-0.5">
                        {fmtDate(t.reported_at)}
                        {t.paid_at && t.paid_at !== t.reported_at && <> · settled {fmtDate(t.paid_at)}</>}
                        {t.vendor_id && <> · {t.vendor_name || vendorName(t.vendor_id)}</>}
                      </p>
                      {t.notes && <p className="text-xs text-on-surface-muted mt-1 italic">{t.notes}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`num-mono font-bold ${cost ? 'text-on-surface' : 'text-on-surface-subtle'}`}>{fmtINR(cost)}</p>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-1 inline-block ${
                        isHistoric ? 'bg-success-container text-success' :
                        t.status === 'reported' ? 'bg-warning-container text-warning' :
                        'bg-accent-container text-accent'
                      }`}>{(t.status as string).replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-outline bg-surface-2/30 flex items-center justify-between gap-3">
          <p className="text-[11px] text-on-surface-subtle">
            All historic + active repairs for this asset. Each new repair you log against this tag will appear here automatically.
          </p>
          <button onClick={onAddPast}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-accent text-on-accent rounded-lg hover:opacity-90">
            <Plus size={13} /> Add past repair
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add a historic repair (backdated entry) ──────────────────────────────
// Lets admin record repairs that happened before the system tracked them —
// minimal form: date, issue, cost, optional vendor + notes. Saved as
// status='paid' so it doesn't block creating new active tickets for the
// same asset.
function PastRepairModal({ asset, employees, vendors, currentUser, onClose, onSaved }: any) {
  const [form, setForm] = useState({
    reported_at: '',          // YYYY-MM-DD — required
    issue: '',                // free text — required
    final_cost: '',           // number — required
    vendor_id: '',
    notes: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.reported_at) { setError('Repair date is required'); return; }
    if (!form.issue.trim()) { setError('Issue description is required'); return; }
    if (form.final_cost === '' || Number(form.final_cost) < 0) { setError('Cost must be a non-negative number'); return; }
    setSaving(true); setError('');
    try {
      const empForAsset = employees.find((e: any) => e.id === asset.assigned_to_id);
      // Fall back to the current user as the "employee" recorded against the
      // ticket if the asset isn't assigned to anyone — the schema requires
      // employee_id to be set.
      const employeeId = empForAsset?.id ?? currentUser?.employee_id_ref;
      if (!employeeId) { setError('No employee to associate with this repair — assign the asset to someone first.'); setSaving(false); return; }
      await api.createRepairTicket({
        asset_id: asset.id,
        laptop_info: asset.model || asset.asset_tag,
        employee_id: employeeId,
        employee_name: empForAsset?.name ?? null,
        vendor_id: form.vendor_id || null,
        issue: form.issue.trim(),
        final_cost: Number(form.final_cost),
        notes: form.notes.trim() || null,
        created_by: currentUser?.name ?? null,
        status: 'paid',                            // historic = already completed
        payment_status: 'paid',
        reported_at: form.reported_at,             // back-dated
        payment_date: form.reported_at,
      });
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Add past repair · ${asset.asset_tag}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-lg bg-surface-2 border border-outline p-3 text-xs text-on-surface-muted">
          Use this to backfill a repair that already happened. Saved as <b className="text-on-surface">completed</b> so it doesn't block new active tickets for this asset.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Repair date *</label>
            <input type="date" value={form.reported_at} max={new Date().toISOString().slice(0, 10)}
              onChange={e => setForm({ ...form, reported_at: e.target.value })}
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 num-mono" />
          </div>
          <div>
            <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Cost (₹) *</label>
            <input type="number" min="0" step="0.01" value={form.final_cost}
              onChange={e => setForm({ ...form, final_cost: e.target.value })}
              placeholder="4500"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 num-mono" />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Issue / what was done *</label>
          <input value={form.issue} onChange={e => setForm({ ...form, issue: e.target.value })}
            placeholder="e.g. Keyboard replacement, battery service"
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
        </div>
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Vendor</label>
          <select value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20">
            <option value="">— Optional —</option>
            {vendors?.map?.((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-on-surface-subtle block mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
            placeholder="Anything worth remembering about this repair"
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-on-surface focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none" />
        </div>
        {error && <p className="text-xs text-danger bg-danger-container border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        <ModalActions onClose={onClose} onSave={save} saving={saving} />
      </div>
    </Modal>
  );
}

