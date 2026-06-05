import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LineChart, LayoutDashboard, IndianRupee, Users, Building2, SlidersHorizontal, FileText } from 'lucide-react';
import { MONTHS } from './format';
import DashboardTab from './DashboardTab';
import TrendsTab from './TrendsTab';
import RevenueTab from './RevenueTab';
import PeopleTab from './PeopleTab';
import OverheadTab from './OverheadTab';
import SettingsTab from './SettingsTab';
import InvoicesTab from './InvoicesTab';
import { useAuth } from '../../context/AuthContext';

type TabId = 'dashboard' | 'trends' | 'invoices' | 'revenue' | 'people' | 'overhead' | 'settings';

const ALL_TABS: { id: TabId; label: string; icon: typeof LineChart }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'trends', label: 'Trends', icon: LineChart },
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
        {showPeriod && (
          <div className="flex items-center gap-2">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
              className="rounded-xl-2 border border-outline bg-surface px-3 py-2 text-sm text-on-surface focus:border-brand outline-none">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-xl-2 border border-outline bg-surface px-3 py-2 text-sm text-on-surface focus:border-brand outline-none">
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
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

      {/* Body — gate each tab body too so a coordinator can't probe URLs. */}
      {tab === 'dashboard' && isAdmin && <DashboardTab month={month} year={year} rev={rev} />}
      {tab === 'trends' && isAdmin && <TrendsTab month={month} year={year} rev={rev} />}
      {tab === 'invoices' && <InvoicesTab month={month} year={year} onChanged={refresh} />}
      {tab === 'revenue' && <RevenueTab month={month} year={year} onChanged={refresh} />}
      {tab === 'people' && isAdmin && <PeopleTab onChanged={refresh} />}
      {tab === 'overhead' && isAdmin && <OverheadTab month={month} year={year} onChanged={refresh} />}
      {tab === 'settings' && isAdmin && <SettingsTab onChanged={refresh} />}
    </div>
  );
}
