import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import CommandPalette from '../CommandPalette';
import ShiftEndReminder from '../ShiftEndReminder';

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

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <ShiftEndReminder />
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
