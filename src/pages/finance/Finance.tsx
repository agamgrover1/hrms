import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LineChart, LayoutDashboard, IndianRupee, Users, Building2, SlidersHorizontal, FileText, Zap, Eye, EyeOff } from 'lucide-react';
import { MONTHS } from './format';
import DashboardTab from './DashboardTab';
import TrendsTab from './TrendsTab';
import RevenueTab from './RevenueTab';
import PeopleTab from './PeopleTab';
import OverheadTab from './OverheadTab';
import SettingsTab from './SettingsTab';
import InvoicesTab from './InvoicesTab';
import OptimizationTab from './OptimizationTab';
import { useAuth } from '../../context/AuthContext';

type TabId = 'dashboard' | 'trends' | 'invoices' | 'revenue' | 'people' | 'overhead' | 'settings' | 'optimize';

const ALL_TABS: { id: TabId; label: string; icon: typeof LineChart }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'trends', label: 'Trends', icon: LineChart },
  { id: 'optimize', label: 'Optimize', icon: Zap },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'revenue', label: 'Billing setup', icon: IndianRupee },
  { id: 'people', label: 'Classification', icon: Users },
  { id: 'overhead', label: 'Overhead', icon: Building2 },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

const now = new Date();
const YEARS = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 3 + i);

export default function Finance() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const location = useLocation();

  // Coordinator only sees Invoices. Admin sees everything.
  // Coordinator gets Invoices + Billing Setup (so they can record amounts
  // for Upwork / fixed-fee projects in their preferred currency). Admin gets
  // everything.
  const visibleTabs = useMemo(() =>
    isAdmin ? ALL_TABS : ALL_TABS.filter(t => t.id === 'invoices' || t.id === 'revenue'),
  [isAdmin]);
  const defaultTab: TabId = isAdmin ? 'dashboard' : 'invoices';

  const [tab, setTab] = useState<TabId>(defaultTab);

  // ?tab=invoices in the URL → jump to that tab (used by the sidebar link).
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const t = qs.get('tab') as TabId | null;
    if (t && visibleTabs.some(v => v.id === t)) setTab(t);
  }, [location.search, visibleTabs]);

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  // bump to force child tabs to refetch after a mutation in another tab
  const [rev, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);

  // Privacy mask — blurs every monetary / numeric value across the
  // Finance surface so the page is safe to leave open in a meeting
  // or screen-share. Default ON so a fresh login doesn't expose
  // anything until the admin chooses to. Persisted to localStorage
  // so the choice survives reloads but stays per-device.
  const [masked, setMasked] = useState<boolean>(() => {
    try { return localStorage.getItem('financeMasked') !== 'false'; }
    catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('financeMasked', String(masked)); } catch {/* private mode */}
  }, [masked]);

  const showPeriod = tab !== 'people' && tab !== 'settings';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
            {isAdmin ? 'Project Profitability' : 'Project Invoices'}
          </h1>
          <p className="text-sm text-on-surface-muted mt-0.5">
            {isAdmin
              ? 'Admin · true cost & profit per project, fully loaded with overhead.'
              : 'Raise invoices when work is delivered. Admin marks them cleared once payment lands.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showPeriod && (
            <>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-xl-2 border border-outline bg-surface px-3 py-2 text-sm text-on-surface focus:border-brand outline-none">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                className="rounded-xl-2 border border-outline bg-surface px-3 py-2 text-sm text-on-surface focus:border-brand outline-none">
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          )}
          {/* Privacy toggle. Eye = reveal, EyeOff = hide. Visible across
              every tab so admin can hide before someone glances at the
              screen. */}
          <button onClick={() => setMasked(m => !m)}
            title={masked ? 'Reveal financial numbers' : 'Hide financial numbers'}
            aria-label={masked ? 'Reveal financial numbers' : 'Hide financial numbers'}
            className="inline-flex items-center gap-1.5 rounded-xl-2 border border-outline bg-surface px-3 py-2 text-xs font-semibold text-on-surface-muted hover:text-on-surface hover:bg-surface-2 transition-colors">
            {masked ? <Eye size={14} /> : <EyeOff size={14} />}
            {masked ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>

      {/* Tabs — only render the ones the current role can see. */}
      {visibleTabs.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-outline">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
                  active ? 'border-brand text-brand' : 'border-transparent text-on-surface-muted hover:text-on-surface'
                }`}>
                <Icon size={16} strokeWidth={active ? 2.2 : 1.75} />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Body — gate each tab body too so a coordinator can't probe URLs.
          The mask wrapper blurs ONLY the dashboard KPI tiles at the top
          of each tab (tagged with data-mask-summary). Tables, drill-in
          cells, and per-row figures stay readable so admin can keep
          working on detail while the headline numbers are hidden. */}
      <div className={masked
        ? '[&_[data-mask-summary]_.num-mono]:blur-md [&_[data-mask-summary]_.num-mono]:select-none [&_[data-mask-summary]_.tabular-nums]:blur-md [&_[data-mask-summary]_.tabular-nums]:select-none [&_[data-mask-summary]]:transition-[filter]'
        : ''}>
        {tab === 'dashboard' && isAdmin && <DashboardTab month={month} year={year} rev={rev} />}
        {tab === 'trends' && isAdmin && <TrendsTab month={month} year={year} rev={rev} />}
        {tab === 'optimize' && isAdmin && <OptimizationTab month={month} year={year} rev={rev} />}
        {tab === 'invoices' && <InvoicesTab month={month} year={year} onChanged={refresh} />}
        {tab === 'revenue' && <RevenueTab month={month} year={year} onChanged={refresh} />}
        {tab === 'people' && isAdmin && <PeopleTab onChanged={refresh} />}
        {tab === 'overhead' && isAdmin && <OverheadTab month={month} year={year} onChanged={refresh} />}
        {tab === 'settings' && isAdmin && <SettingsTab onChanged={refresh} />}
      </div>
    </div>
  );
}
