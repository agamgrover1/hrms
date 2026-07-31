import { useState, useEffect } from 'react';
import { Download, Search, TrendingUp, DollarSign, Settings, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const monthlyTrend = [
  { month: 'Oct', total: 11.8 }, { month: 'Nov', total: 12.0 }, { month: 'Dec', total: 12.2 },
  { month: 'Jan', total: 12.1 }, { month: 'Feb', total: 12.3 }, { month: 'Mar', total: 12.4 },
];

// Shared chart styling — matches Dashboard
const CHART_AXIS = '#94a3b8';
const CHART_GRID = 'rgba(148, 163, 184, 0.18)';
const CHART_BRAND = '#7c5cff';
const CHART_ACCENT = '#EE2770';
const CHART_TOOLTIP_STYLE = {
  background: 'rgb(var(--surface-3))',
  borderRadius: 12,
  border: '1px solid rgb(var(--outline))',
  boxShadow: 'var(--elev-3)',
  color: 'rgb(var(--on-surface))',
  fontSize: 12,
} as const;

function SlipModal({ record, onClose }: { record: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-xl-2 shadow-elev-3 w-full max-w-md overflow-hidden border border-outline">
        <div className="px-6 py-5 text-white" style={{ background: 'rgb(var(--primary))' }}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display font-bold text-lg tracking-tight">Salary Slip</h3>
              <p className="text-white/70 text-sm">{record.month} {record.year}</p>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white text-2xl font-light leading-none">×</button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">{record.avatar}</div>
            <div>
              <p className="font-semibold">{record.name}</p>
              <p className="text-white/70 text-xs">{record.emp_id} · {record.designation}</p>
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-2.5">
            <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-2">Earnings</p>
            {[
              { label: 'Basic Pay', value: record.basic },
              { label: 'HRA', value: record.hra },
              { label: 'Special Allowance', value: record.special_allowance },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm border-b border-outline pb-2">
                <span className="text-on-surface-muted">{label}</span>
                <span className="num-mono font-medium text-on-surface">₹{Number(value).toLocaleString('en-IN')}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-semibold pt-1 pb-3 border-b border-dashed border-outline-strong">
              <span className="text-on-surface">Gross Pay</span>
              <span className="num-mono text-on-surface">₹{Number(record.gross_pay).toLocaleString('en-IN')}</span>
            </div>
            <p className="text-xs font-semibold text-on-surface-subtle uppercase tracking-wide mb-2 pt-1">Deductions</p>
            {[
              { label: 'Provident Fund', value: record.provident_fund },
              { label: 'Professional Tax', value: record.professional_tax },
              { label: 'Income Tax (TDS)', value: record.income_tax },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm border-b border-outline pb-2">
                <span className="text-on-surface-muted">{label}</span>
                <span className="num-mono font-medium text-danger">−₹{Number(value).toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 bg-brand-container rounded-xl-2 p-4 flex justify-between items-center">
            <span className="font-bold text-on-surface">Net Pay</span>
            <span className="num-mono text-xl font-bold text-on-brand-container">₹{Number(record.net_pay).toLocaleString('en-IN')}</span>
          </div>
          <button className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 border border-outline text-on-surface-muted rounded-lg text-sm font-medium hover:bg-surface-2 transition-colors">
            <Download size={14} /> Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}

const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function Payroll() {
  const now = new Date();
  const [payroll, setPayroll] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSlip, setSelectedSlip] = useState<any | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(MONTH_FULL[now.getMonth()]);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  useEffect(() => {
    setLoading(true);
    api.getPayroll({ month: selectedMonth, year: selectedYear })
      .then(setPayroll)
      .catch(() => setPayroll([]))
      .finally(() => setLoading(false));
  }, [selectedMonth, selectedYear]);

  const totalNetPay = payroll.reduce((s, r) => s + Number(r.net_pay), 0);
  const avgSalary = payroll.length ? Math.round(totalNetPay / payroll.length) : 0;

  const filtered = payroll.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Payroll Phase 1: org config for salary structure auto-split.
          Collapsed by default — HR opens it once when setting up. */}
      <PayrollConfigPanel />

      {/* Summary — bento KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Hero tile: Total Net Payroll */}
        <div className="group relative rounded-xl-2 p-5 text-white shadow-elev-2 hover:shadow-elev-3 transition-all duration-300 overflow-hidden animate-fade-up stagger-1"
             style={{ background: 'linear-gradient(135deg, rgb(var(--primary)), rgb(var(--primary) / 0.85))' }}>
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <DollarSign size={18} className="text-white/70 mb-2" />
            <p className="num-mono text-3xl font-bold">₹{(totalNetPay / 100000).toFixed(1)}L</p>
            <p className="text-white/70 text-sm mt-1">Total Net Payroll · {selectedMonth} {selectedYear}</p>
          </div>
        </div>

        <div className="group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up stagger-2">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <p className="text-sm text-on-surface-muted font-medium">Average Salary</p>
            <p className="num-mono text-2xl font-bold text-on-surface mt-1">₹{avgSalary.toLocaleString('en-IN')}</p>
            <p className="text-xs text-on-surface-subtle mt-0.5">Per employee / month (net)</p>
          </div>
        </div>

        <div className="group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up stagger-3">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-success/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={14} className="text-success" />
              <p className="text-sm text-on-surface-muted font-medium">MoM Growth</p>
            </div>
            <p className="num-mono text-2xl font-bold text-on-surface mt-1">+0.8%</p>
            <p className="text-xs text-success mt-0.5">vs {MONTH_FULL[(now.getMonth()-1+12)%12]} {now.getMonth()===0?now.getFullYear()-1:now.getFullYear()}</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 overflow-hidden group hover:shadow-elev-2 transition-shadow animate-fade-up stagger-4">
        <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
        <div className="relative">
          <h3 className="font-display text-xl font-bold tracking-tight text-on-surface mb-4">Monthly Payroll Trend (₹L)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyTrend} barSize={32}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: CHART_AXIS, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: CHART_AXIS, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} domain={[11, 13]} tickFormatter={v => `₹${v}L`} />
              <Tooltip formatter={v => [`₹${v}L`, 'Net Payroll']} contentStyle={CHART_TOOLTIP_STYLE} itemStyle={{ color: 'rgb(var(--on-surface))' }} labelStyle={{ color: 'rgb(var(--on-surface))' }} cursor={{ fill: CHART_GRID }} />
              <defs>
                <linearGradient id="payrollBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={CHART_BRAND} stopOpacity={0.8} />
                </linearGradient>
              </defs>
              <Bar dataKey="total" fill="url(#payrollBarGrad)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
        <div className="px-5 py-4 border-b border-outline flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Employee Payroll</h3>
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="text-sm bg-surface-2 border border-outline rounded-full px-3 py-1 text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/30">
              {MONTH_FULL.map(m => <option key={m}>{m}</option>)}
            </select>
            <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
              className="text-sm bg-surface-2 border border-outline rounded-full px-3 py-1 text-on-surface focus:outline-none focus:ring-2 focus:ring-brand/30">
              {[now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1].map(y => <option key={y}>{y}</option>)}
            </select>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="pl-8 pr-4 py-2 text-sm bg-surface-2 border border-outline rounded-lg text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-4 border-outline border-t-accent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-surface-2 border-b border-outline">
                {['Employee', 'Gross Pay', 'PF', 'TDS', 'Net Pay', 'Status', 'Slip'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-on-surface-muted px-4 py-3 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(record => (
                <tr key={record.employee_id} className="border-b border-outline hover:bg-surface-2/60 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-brand-container text-on-brand-container flex items-center justify-center text-xs font-semibold">{record.avatar}</div>
                      <div>
                        <p className="text-sm font-medium text-on-surface">{record.name}</p>
                        <p className="text-xs text-on-surface-subtle">{record.designation}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 num-mono text-sm text-on-surface-muted tabular-nums">₹{Number(record.gross_pay).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 num-mono text-sm text-on-surface-subtle tabular-nums">₹{Number(record.provident_fund).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 num-mono text-sm text-on-surface-subtle tabular-nums">₹{Number(record.income_tax).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 num-mono text-sm font-semibold text-on-surface tabular-nums">₹{Number(record.net_pay).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2.5 py-1 bg-success-container text-success rounded-full font-medium">Paid</span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelectedSlip(record)} className="text-xs text-on-brand-container hover:text-brand font-medium hover:underline">View Slip</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedSlip && <SlipModal record={selectedSlip} onClose={() => setSelectedSlip(null)} />}
    </div>
  );
}

// Payroll Phase 1 — org-wide config for the salary-structure auto-split.
// Admin-only edit (server-side gate is requireAdmin on PUT), HR can view.
// Collapsed by default so it doesn't push the reporting cards down; opens
// when HR needs to change the percentages a new employee should be
// pre-filled with.
function PayrollConfigPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<{
    basic_pct: number; hra_pct: number; special_allowance_pct: number; employer_pf_pct: number;
    working_days_convention: 'fixed_30' | 'actual_month';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    // Only load when the panel is expanded — a collapsed strip has no
    // reason to hit the endpoint on every page mount.
    if (!open || cfg) return;
    setLoading(true);
    api.getPayrollConfig()
      .then(c => setCfg({
        basic_pct: Number(c.basic_pct),
        hra_pct: Number(c.hra_pct),
        special_allowance_pct: Number(c.special_allowance_pct),
        employer_pf_pct: Number(c.employer_pf_pct),
        working_days_convention: c.working_days_convention,
      }))
      .catch(() => setMsg('Failed to load config'))
      .finally(() => setLoading(false));
  }, [open, cfg]);

  const grossSum = cfg ? cfg.basic_pct + cfg.hra_pct + cfg.special_allowance_pct : 0;
  const sumOk = Math.abs(grossSum - 100) <= 0.5;

  const save = async () => {
    if (!cfg) return;
    if (!sumOk) { setMsg(`Basic + HRA + Special must sum to 100% (currently ${grossSum}%).`); return; }
    setBusy(true); setMsg('');
    try {
      await api.updatePayrollConfig(cfg);
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2500);
    } catch (e: any) { setMsg(e?.message ?? 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-surface-2/40 transition-colors">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-on-surface">
          <Settings size={14} className="text-accent" /> Payroll settings
        </span>
        <span className="inline-flex items-center gap-2 text-[11px] text-on-surface-muted">
          Default salary split · working days convention
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-2 border-t border-outline bg-surface-2/30">
          {loading ? (
            <p className="text-sm text-on-surface-subtle py-4">Loading…</p>
          ) : !cfg ? (
            <p className="text-sm text-danger">Failed to load payroll config.</p>
          ) : (
            <>
              <p className="text-[11px] text-on-surface-muted mb-3">
                These percentages pre-fill a new salary structure when HR enters a CTC on an employee.
                Individual employees can still be edited component-by-component after — this only sets the starting point.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <PctField label="Basic %" value={cfg.basic_pct}
                  disabled={!isAdmin}
                  onChange={v => setCfg(c => c && ({ ...c, basic_pct: v }))} />
                <PctField label="HRA %" value={cfg.hra_pct}
                  disabled={!isAdmin}
                  onChange={v => setCfg(c => c && ({ ...c, hra_pct: v }))} />
                <PctField label="Special Allowance %" value={cfg.special_allowance_pct}
                  disabled={!isAdmin}
                  onChange={v => setCfg(c => c && ({ ...c, special_allowance_pct: v }))} />
                <PctField label="Employer PF %" value={cfg.employer_pf_pct}
                  disabled={!isAdmin}
                  onChange={v => setCfg(c => c && ({ ...c, employer_pf_pct: v }))} />
              </div>
              <p className={`text-[11px] mt-2 ${sumOk ? 'text-on-surface-subtle' : 'text-danger'}`}>
                Basic + HRA + Special = <span className="num-mono font-semibold">{grossSum}%</span>
                {sumOk ? ' · sums correctly.' : ' · must total 100%. Employer PF sits on top and doesn\'t count here.'}
              </p>
              <div className="mt-4">
                <label className="block">
                  <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">
                    Working-days convention (Phase 2)
                  </span>
                  <select value={cfg.working_days_convention}
                    disabled={!isAdmin}
                    onChange={e => setCfg(c => c && ({ ...c, working_days_convention: e.target.value as any }))}
                    className="bg-surface border border-outline rounded-lg px-3 py-1.5 text-sm text-on-surface disabled:opacity-60">
                    <option value="fixed_30">Fixed 30 days (per-day = monthly/30)</option>
                    <option value="actual_month">Actual month days (per-day = monthly/actual days)</option>
                  </select>
                  <span className="block text-[11px] text-on-surface-muted mt-1">
                    Decides how LOP deductions are computed when Phase 2's payslip run reads unpaid-leave days.
                  </span>
                </label>
              </div>
              {msg && (
                <p className={`text-xs mt-3 ${msg === 'Saved.' ? 'text-success' : 'text-danger'}`}>{msg}</p>
              )}
              {isAdmin && (
                <div className="mt-4 flex justify-end">
                  <button onClick={save} disabled={busy || !sumOk}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent hover:opacity-90 disabled:opacity-50">
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    Save settings
                  </button>
                </div>
              )}
              {!isAdmin && (
                <p className="text-[11px] text-on-surface-muted mt-3 italic">
                  You can view these settings. Admin edits.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PctField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">{label}</span>
      <div className="relative">
        <input type="number" step="0.5" min="0" max="100" value={value} disabled={disabled}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full num-mono pr-6 pl-3 py-1.5 rounded-lg bg-surface border border-outline text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60" />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-on-surface-subtle">%</span>
      </div>
    </label>
  );
}
