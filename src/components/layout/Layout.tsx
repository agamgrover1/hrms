import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import CommandPalette from '../CommandPalette';
import FeaturePopup from '../FeaturePopup';
import GlobalQuickActionsFab from '../GlobalQuickActionsFab';
import Toaster from '../Toaster';
import GlobalMailStream from '../GlobalMailStream';
import TimerStopPrompt from '../hours/TimerStopPrompt';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/employees': 'Employees',
  '/attendance': 'Attendance',
  '/leave': 'Leave Management',
  '/payroll': 'Payroll',
  '/performance': 'Performance',
  '/performance/pulse': 'Performance Pulse',
  '/users': 'User Management',
  '/config': 'Configuration',
  '/incentives': 'Finance',
  '/asset-repairs': 'IT Assets & Repairs',
  '/finance': 'Project Profitability',
  '/projects': 'Projects',
  '/hours': 'Project Hours',
  '/hours/allocation': 'Hour Allocation',
  '/hours/approvals': 'Hour Approvals',
  '/hours/compliance': 'Daily Log Compliance',
  '/hours/utilization': 'Staff Utilization',
  '/notifications': 'Notifications',
  '/features': 'Features',
  '/my': 'My Portal',
  '/my-team': 'My Team',
  '/tasks': 'Tasks',
  '/tasks/analytics': 'Task Analytics',
  '/meetings': 'Meetings',
  '/calendar': 'Calendar',
  '/goals': 'Goals',
  '/hiring': 'Hiring',
  '/hiring/analytics': 'Hiring Analytics',
  '/lifecycle': 'Lifecycle',
  '/hr/documents': 'HR Documents',
  '/mail': 'Mail',
  '/workload': 'Workload',
  '/reports': 'Reports',
  '/templates': 'Templates',
  '/help/how-it-works': 'How It Works',
  '/help/pulse': 'Pulse Rubric',
};

function getTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (/^\/employees\/.+/.test(pathname))   return 'Employee Profile';
  if (/^\/projects\/.+/.test(pathname))    return 'Project Dashboard';
  if (/^\/hiring\/.+/.test(pathname))      return 'Candidate';
  return 'Digital Leap HRMS';
}

export default function Layout() {
  const location = useLocation();
  const title = getTitle(location.pathname);
  // Reflect the current page in the browser tab title so pinned tabs
  // + task-switcher previews + PWA window chrome show what you're
  // actually looking at. Empty title falls back to the app name.
  useEffect(() => {
    document.title = title === 'Digital Leap HRMS' ? 'Digital Leap HRMS' : `${title} · Digital Leap HRMS`;
  }, [title]);
  // Mobile sidebar drawer state. TopBar's hamburger flips this; Sidebar reads
  // it and slides in/out. Route changes auto-close so navigating from the
  // drawer doesn't leave it open over the next page.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  useEffect(() => { setMobileSidebarOpen(false); }, [location.pathname]);

  // Scroll-to-top on route change. Because <main> is the scroll container
  // (overflow-auto — needed so the sidebar stays fixed while page content
  // scrolls independently), the browser never resets its scrollTop between
  // routes on its own. Without this, navigating from a scrolled-down page
  // (long employee directory) to another route landed mid-page — and any
  // autoFocus input on the new route yanked the container further as the
  // browser scrolled the focused input into view. Two scroll targets:
  //   - <main> for the primary scroll container
  //   - window for pages that ever grew past its overflow (safety net)
  // Guarded on pathname alone so a query-param change (e.g. ?tab=…) that
  // reuses the same page doesn't blow away the user's mid-page position.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    // h-screen + overflow-hidden pin the whole app to viewport height so
    // only <main> scrolls internally. Previously we used min-h-screen
    // (a MINIMUM height) which let tall pages push the body past 100vh
    // — the whole document then scrolled, sidebar and all, and users
    // saw blank space below the sidebar once they scrolled a long list
    // like /employees or the Overview widgets past the fold.
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} onMenuClick={() => setMobileSidebarOpen(true)} />
        {/* Lighter horizontal padding on phones — 6 (24px) eats too much of
            an iPhone width when content has its own card padding inside. */}
        <main ref={mainRef} className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <FeaturePopup />
      <GlobalQuickActionsFab />
      <GlobalMailStream />
      <TimerStopPrompt />
      <Toaster />
    </div>
  );
}
