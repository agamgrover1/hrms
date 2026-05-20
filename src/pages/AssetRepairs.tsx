import { useState, useEffect, useMemo } from 'react';
import {
  Wrench, Laptop, Building2, Plus, Trash2, Pencil, X, Check, AlertTriangle,
  Clock, CheckCircle, XCircle, DollarSign, Search, IndianRupee,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

type Tab = 'tickets' | 'assets' | 'vendor';

const APPROVAL_THRESHOLD = 10000;

const STATUS_CFG: Record<string, { label: string; bg: string; color: string; icon: any }> = {
  reported:           { label: 'Reported',          bg: '#fffbeb', color: '#b45309', icon: AlertTriangle },
  picked_up:          { label: 'Picked Up',         bg: '#eff6ff', color: '#2563eb', icon: Wrench },
  returned:           { label: 'Returned',          bg: '#f0fdf4', color: '#15803d', icon: CheckCircle },
  awaiting_approval:  { label: 'Awaiting Approval', bg: '#fef2f2', color: '#dc2626', icon: AlertTriangle },
  paid:               { label: 'Paid',              bg: '#f5f3ff', color: '#7c3aed', icon: DollarSign },
  cancelled:          { label: 'Cancelled',         bg: '#f3f4f6', color: '#6b7280', icon: XCircle },
};

const fmtINR = (n: any) => n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;
const fmtDate = (d: any) => {
  if (!d) return '—';
  const s = typeof d === 'string' ? d : String(d);
  const date = new Date(s);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
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
    const inRepair = tickets.filter(t => ['picked_up', 'returned'].includes(t.status)).length;
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
        <KpiCard label="In Repair"           value={stats.inRepair}                  icon={Wrench}        color="#2563eb"/>
        <KpiCard label="Awaiting Approval"   value={stats.awaiting}                  icon={AlertTriangle} color="#dc2626"/>
        <KpiCard label="Unpaid Total"        value={fmtINR(stats.unpaid)}            icon={IndianRupee}   color="#b45309"/>
        <KpiCard label="Paid This Month"     value={fmtINR(stats.thisMonthPaid)}     icon={DollarSign}    color="#15803d"/>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex bg-white rounded-xl p-1 border border-gray-100 shadow-sm w-fit">
        {[
          { k: 'tickets', label: 'Repair Tickets', icon: Wrench  },
          { k: 'assets',  label: 'Asset Registry', icon: Laptop  },
          { k: 'vendor',  label: 'Vendor',         icon: Building2 },
        ].map(({ k, label, icon: Icon }) => (
          <button key={k} onClick={() => setTab(k as Tab)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={tab === k ? { background: '#192250', color: '#fff' } : { color: '#6b7280' }}>
            <Icon size={14}/>{label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-7 h-7 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/>
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
function KpiCard({ label, value, icon: Icon, color }: any) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: color + '15' }}>
          <Icon size={16} style={{ color }}/>
        </div>
      </div>
      <p className="text-2xl font-black" style={{ color }}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
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
    awaiting_approval: tickets.filter((t: any) => t.status === 'awaiting_approval').length,
    paid: tickets.filter((t: any) => t.status === 'paid').length,
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-white rounded-lg p-1 border border-gray-100 shadow-sm overflow-x-auto max-w-full">
          {[
            { k: 'all', label: 'All' },
            { k: 'reported', label: 'Reported' },
            { k: 'picked_up', label: 'Picked Up' },
            { k: 'returned', label: 'Returned' },
            { k: 'awaiting_approval', label: 'Approval' },
            { k: 'paid', label: 'Paid' },
          ].map(({ k, label }) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-all ${filter === k ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {label}
              <span className="ml-1.5 text-[10px] opacity-70">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-200"/>
          </div>
          <button onClick={onCreate}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white rounded-lg"
            style={{ background: 'linear-gradient(135deg,#EE2770 0%,#d11f62 100%)' }}>
            <Plus size={14}/> New Ticket
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Wrench size={32} className="text-gray-200 mx-auto mb-3"/>
          <p className="text-sm text-gray-400">No repair tickets in this view</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f8f9fc' }}>
                  {['Employee', 'Laptop', 'Issue', 'Vendor', 'Cost', 'Status', 'Action'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
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
                    <tr key={t.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-800">{t.employee_name ?? '—'}</p>
                        <p className="text-[10px] text-gray-400">{fmtDate(t.reported_at)}</p>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {asset ? (
                          <>
                            <p className="font-semibold text-gray-700">{asset.asset_tag}</p>
                            <p className="text-gray-400">{asset.model}</p>
                          </>
                        ) : (
                          <p className="text-gray-500 max-w-[160px] truncate">{t.laptop_info || '—'}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate text-xs">{t.issue}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{vendor?.name ?? '—'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800 text-sm">
                        {fmtINR(cost)}
                        {Number(cost) > APPROVAL_THRESHOLD && t.status !== 'paid' && (
                          <p className="text-[9px] text-red-500 font-bold">⚠ Needs approval</p>
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
                            <button onClick={() => onAction(t, 'picked_up')} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100">Pick Up</button>
                          )}
                          {t.status === 'picked_up' && (
                            <button onClick={() => onAction(t, 'returned')} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100">Mark Returned</button>
                          )}
                          {t.status === 'returned' && (
                            <button onClick={() => onEdit(t)} className="text-[10px] font-bold px-2 py-1 rounded-lg text-white" style={{ background: '#7c3aed' }}>Pay</button>
                          )}
                          {t.status === 'awaiting_approval' && isAdmin && (
                            <>
                              <button onClick={() => onApprove(t)} className="text-[10px] font-bold px-2 py-1 rounded-lg text-white" style={{ background: '#15803d' }}>Approve</button>
                              <button onClick={() => onReject(t)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-50 text-red-700">Reject</button>
                            </>
                          )}
                          {!['paid', 'cancelled'].includes(t.status) && (
                            <button onClick={() => onAction(t, 'cancelled')} className="text-[10px] font-medium px-2 py-1 rounded-lg text-gray-500 hover:bg-gray-100">Cancel</button>
                          )}
                          <button onClick={() => onEdit(t)} className="text-gray-400 hover:text-gray-700 p-1"><Pencil size={11}/></button>
                          {isAdmin && (
                            <button onClick={() => onDelete(t)} className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={11}/></button>
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
function AssetsTab({ assets, employees, tickets, onCreate, onEdit, onDelete }: any) {
  const empById = (id: string) => employees.find((e: any) => e.id === id);
  const openTicketCount = (assetId: string) =>
    tickets.filter((t: any) => t.asset_id === assetId && !['paid', 'cancelled'].includes(t.status)).length;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={onCreate} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white rounded-lg" style={{ background: '#192250' }}>
          <Plus size={14}/> Add Asset
        </button>
      </div>
      {assets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Laptop size={32} className="text-gray-200 mx-auto mb-3"/>
          <p className="text-sm text-gray-400">No assets registered yet</p>
          <p className="text-xs text-gray-300 mt-1">Add laptops here to track them over time</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f8f9fc' }}>
                  {['Tag', 'Model', 'Serial', 'Assigned To', 'Status', 'Active Tickets', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assets.map((a: any) => {
                  const open = openTicketCount(a.id);
                  return (
                    <tr key={a.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                      <td className="px-4 py-3 font-mono font-semibold text-gray-800">{a.asset_tag}</td>
                      <td className="px-4 py-3 text-gray-700">{a.model ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono">{a.serial_no ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{a.assigned_to_name ?? empById(a.assigned_to_id)?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                          a.status === 'active'    ? 'bg-green-50 text-green-700' :
                          a.status === 'in_repair' ? 'bg-amber-50 text-amber-700' :
                                                     'bg-gray-100 text-gray-500'}`}>
                          {a.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {open > 0 ? <span className="text-xs font-bold text-red-600">{open}</span> : <span className="text-xs text-gray-400">0</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => onEdit(a)} className="text-gray-400 hover:text-gray-700 p-1"><Pencil size={12}/></button>
                          <button onClick={() => onDelete(a)} className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={12}/></button>
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
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Building2 size={32} className="text-gray-200 mx-auto mb-3"/>
          <p className="text-sm text-gray-400 mb-4">No vendor configured yet</p>
          <button onClick={onCreate} className="px-4 py-2 text-sm font-semibold text-white rounded-lg inline-flex items-center gap-2" style={{ background: '#192250' }}>
            <Plus size={14}/> Add Vendor
          </button>
        </div>
      ) : (
        <>
          {vendors.map((v: any) => (
            <div key={v.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">{v.name}</h3>
                  {v.contact_person && <p className="text-sm text-gray-500 mt-0.5">{v.contact_person}</p>}
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => onEdit(v)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1.5">
                    <Pencil size={11}/> Edit
                  </button>
                  {isAdmin && (
                    <button onClick={() => onDelete(v)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-100 text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5">
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
                    <p className="text-xs text-gray-400 font-medium">{l}</p>
                    <p className="text-sm text-gray-700 mt-0.5">{val}</p>
                  </div>
                ))}
              </div>
              {v.address && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-400 font-medium">Address</p>
                  <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">{v.address}</p>
                </div>
              )}
              {v.notes && (
                <div className="mt-3 p-3 rounded-lg bg-gray-50 text-xs text-gray-600 italic">{v.notes}</div>
              )}
            </div>
          ))}
          {/* Add another vendor — collapsed, since user said one vendor only */}
          {vendors.length < 5 && (
            <button onClick={onCreate} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-2xl text-sm font-semibold text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors">
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
      <label className="text-xs font-semibold text-gray-500 block mb-1">{label}</label>
      <input type={type} value={(form as any)[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} placeholder={placeholder}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"/>
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
          <label className="text-xs font-semibold text-gray-500 block mb-1">Address</label>
          <textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"/>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"/>
        </div>
        {initial && (
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })}/>
            Active vendor (uncheck to deactivate)
          </label>
        )}
        {error && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        <ModalActions onClose={onClose} onSave={handleSave} saving={saving}/>
      </div>
    </Modal>
  );
}

// ── Asset form modal ─────────────────────────────────────────────────────
function AssetFormModal({ initial, employees, onClose, onSaved }: any) {
  const [form, setForm] = useState({
    asset_tag: initial?.asset_tag ?? '',
    model: initial?.model ?? '',
    serial_no: initial?.serial_no ?? '',
    purchase_date: initial?.purchase_date?.split?.('T')[0] ?? '',
    assigned_to_id: initial?.assigned_to_id ?? '',
    status: initial?.status ?? 'active',
    notes: initial?.notes ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
            <label className="text-xs font-semibold text-gray-500 block mb-1">Asset Tag *</label>
            <input value={form.asset_tag} onChange={e => setForm({ ...form, asset_tag: e.target.value })} placeholder="DL-LP-001"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 font-mono"/>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Model</label>
            <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Dell XPS 15"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"/>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Serial No</label>
            <input value={form.serial_no} onChange={e => setForm({ ...form, serial_no: e.target.value })} placeholder="ABC123XYZ"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 font-mono"/>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Purchase Date</label>
            <input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"/>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Assigned To</label>
          <select value={form.assigned_to_id} onChange={e => setForm({ ...form, assigned_to_id: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 bg-white">
            <option value="">— Unassigned —</option>
            {employees.filter((e: any) => e.status === 'active').map((e: any) => (
              <option key={e.id} value={e.id}>{e.name} ({e.employee_id})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Status</label>
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 bg-white">
            <option value="active">Active</option>
            <option value="in_repair">In Repair</option>
            <option value="retired">Retired</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"/>
        </div>
        {error && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        <ModalActions onClose={onClose} onSave={handleSave} saving={saving}/>
      </div>
    </Modal>
  );
}

// ── Ticket form modal ─────────────────────────────────────────────────────
function TicketFormModal({ initial, employees, vendors, assets, currentUser, onClose, onSaved }: any) {
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
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const employeeAssets = useMemo(
    () => assets.filter((a: any) => a.assigned_to_id === form.employee_id),
    [form.employee_id, assets]
  );

  const handleSave = async () => {
    if (!form.employee_id) { setError('Select an employee'); return; }
    if (!form.issue.trim()) { setError('Issue description is required'); return; }
    if (form.quoted_cost && Number(form.quoted_cost) < 0) { setError('Quoted cost cannot be negative'); return; }
    if (form.final_cost && Number(form.final_cost) < 0)   { setError('Final cost cannot be negative');   return; }
    setSaving(true); setError('');
    try {
      const emp = employees.find((e: any) => e.id === form.employee_id);
      const payload: any = {
        employee_id: form.employee_id,
        employee_name: emp?.name,
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
        payload.updated_by_role = currentUser?.role;
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
    <Modal title={initial ? `Edit Ticket — ${initial.employee_name ?? ''}` : 'New Repair Ticket'} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Employee *</label>
          <select value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value, asset_id: '' })}
            disabled={!!initial}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 bg-white disabled:bg-gray-50 disabled:text-gray-500">
            <option value="">— Select employee —</option>
            {employees.filter((e: any) => e.status === 'active').map((e: any) => (
              <option key={e.id} value={e.id}>{e.name} ({e.employee_id})</option>
            ))}
          </select>
        </div>

        {form.employee_id && employeeAssets.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Laptop (from asset registry)</label>
            <select value={form.asset_id} onChange={e => setForm({ ...form, asset_id: e.target.value })}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 bg-white">
              <option value="">— Not from registry / type below —</option>
              {employeeAssets.map((a: any) => (
                <option key={a.id} value={a.id}>{a.asset_tag} — {a.model ?? 'Unknown model'}</option>
              ))}
            </select>
          </div>
        )}

        {!form.asset_id && (
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Laptop info (free text)</label>
            <input value={form.laptop_info} onChange={e => setForm({ ...form, laptop_info: e.target.value })}
              placeholder="e.g. Dell XPS, Serial: ABC123 — old laptop"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"/>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Vendor</label>
          <select value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 bg-white">
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
          <label className="text-xs font-semibold text-gray-500 block mb-1">Issue *</label>
          <textarea value={form.issue} onChange={e => setForm({ ...form, issue: e.target.value })} rows={3}
            placeholder="What's wrong with the laptop?"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"/>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Quoted Cost (₹)</label>
            <input type="number" min="0" value={form.quoted_cost} onChange={e => setForm({ ...form, quoted_cost: e.target.value })} placeholder="Initial estimate"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"/>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Final Cost (₹)</label>
            <input type="number" min="0" value={form.final_cost} onChange={e => setForm({ ...form, final_cost: e.target.value })} placeholder="After repair"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"/>
          </div>
        </div>

        {initial && initial.status === 'returned' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Payment Mode</label>
                <select value={form.payment_mode} onChange={e => setForm({ ...form, payment_mode: e.target.value })}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 bg-white">
                  <option value="">— Select —</option>
                  <option value="UPI">UPI</option>
                  <option value="Bank">Bank Transfer</option>
                  <option value="Cash">Cash</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Payment Date</label>
                <input type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200"/>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold p-3 rounded-lg cursor-pointer"
              style={{ background: needsApproval ? '#fef2f2' : '#f0fdf4', color: needsApproval ? '#dc2626' : '#15803d' }}>
              <input type="checkbox" checked={form.markPaid} onChange={e => setForm({ ...form, markPaid: e.target.checked })}/>
              Mark as paid {needsApproval && currentUser?.role !== 'admin' && <span className="text-xs font-medium">(will require admin approval — ₹{finalCostNum.toLocaleString('en-IN')} &gt; ₹{APPROVAL_THRESHOLD.toLocaleString('en-IN')})</span>}
            </label>
          </>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"/>
        </div>

        {error && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        <ModalActions onClose={onClose} onSave={handleSave} saving={saving}/>
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
        <div className="p-3 rounded-lg bg-gray-50 text-sm">
          <p className="font-semibold text-gray-700">{ticket.employee_name}</p>
          <p className="text-xs text-gray-500">{ticket.issue}</p>
          <p className="text-sm font-bold mt-1" style={{ color: '#dc2626' }}>{fmtINR(ticket.final_cost ?? ticket.quoted_cost)}</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Reason (optional)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
            placeholder="Why are you rejecting this payment?"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"/>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
          <button onClick={handleReject} disabled={saving} className="flex-1 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-60" style={{ background: '#dc2626' }}>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-base" style={{ color: '#192250' }}>{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500"/></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({ onClose, onSave, saving }: any) {
  return (
    <div className="flex gap-2 pt-2">
      <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
      <button onClick={onSave} disabled={saving} className="flex-1 py-2.5 text-sm font-semibold text-white rounded-lg disabled:opacity-60 inline-flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(135deg,#192250 0%,#141c43 100%)' }}>
        <Check size={14}/>{saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
