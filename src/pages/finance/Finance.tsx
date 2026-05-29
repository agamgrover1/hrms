import { useState } from 'react';
import { LineChart, LayoutDashboard, IndianRupee, Users, Building2, SlidersHorizontal } from 'lucide-react';
import { MONTHS } from './format';
import DashboardTab from './DashboardTab';
import TrendsTab from './TrendsTab';
import RevenueTab from './RevenueTab';
import PeopleTab from './PeopleTab';
import OverheadTab from './OverheadTab';
import SettingsTab from './SettingsTab';

type TabId = 'dashboard' | 'trends' | 'revenue' | 'people' | 'overhead' | 'settings';

const TABS: { id: TabId; label: string; icon: typeof LineChart }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'trends', label: 'Trends', icon: LineChart },
  { id: 'revenue', label: 'Revenue', icon: IndianRupee },
  { id: 'people', label: 'Classification', icon: Users },
  { id: 'overhead', label: 'Overhead', icon: Building2 },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

const now = new Date();
const YEARS = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 3 + i);

export default function Finance() {
  const [tab, setTab] = useState<TabId>('dashboard');
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
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">Project Profitability</h1>
          <p className="text-sm text-on-surface-muted mt-0.5">Admin-only · true cost & profit per project, fully loaded with overhead.</p>
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

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-outline">
        {TABS.map((t) => {
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

      {/* Body */}
      {tab === 'dashboard' && <DashboardTab month={month} year={year} rev={rev} />}
      {tab === 'trends' && <TrendsTab month={month} year={year} rev={rev} />}
      {tab === 'revenue' && <RevenueTab month={month} year={year} onChanged={refresh} />}
      {tab === 'people' && <PeopleTab onChanged={refresh} />}
      {tab === 'overhead' && <OverheadTab month={month} year={year} onChanged={refresh} />}
      {tab === 'settings' && <SettingsTab onChanged={refresh} />}
    </div>
  );
}
