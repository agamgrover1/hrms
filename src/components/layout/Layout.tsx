import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import CommandPalette from '../CommandPalette';
import ShiftEndReminder from '../ShiftEndReminder';
import FeaturePopup from '../FeaturePopup';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/employees': 'Employees',
  '/attendance': 'Attendance',
  '/leave': 'Leave Management',
  '/payroll': 'Payroll',
  '/performance': 'Performance',
  '/users': 'User Management',
  '/config': 'Configuration',
  '/incentives': 'Finance',
  '/asset-repairs': 'IT Assets & Repairs',
  '/finance': 'Project Profitability',
  '/projects': 'Projects',
  '/hours': 'Project Hours',
  '/hours/approvals': 'Hour Approvals',
  '/hours/compliance': 'Daily Log Compliance',
  '/hours/utilization': 'Staff Utilization',
  '/notifications': 'Notifications',
  '/features': 'Features',
  '/my': 'My Portal',
  '/my-team': 'My Team',
};

function getTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (/^\/employees\/.+/.test(pathname)) return 'Employee Profile';
  return 'Digital Leap HRMS';
}

export default function Layout() {
  const location = useLocation();
  const title = getTitle(location.pathname);
  // Mobile sidebar drawer state. TopBar's hamburger flips this; Sidebar reads
  // it and slides in/out. Route changes auto-close so navigating from the
  // drawer doesn't leave it open over the next page.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  useEffect(() => { setMobileSidebarOpen(false); }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} onMenuClick={() => setMobileSidebarOpen(true)} />
        <ShiftEndReminder />
        {/* Lighter horizontal padding on phones — 6 (24px) eats too much of
            an iPhone width when content has its own card padding inside. */}
        <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <FeaturePopup />
    </div>
  );
}
