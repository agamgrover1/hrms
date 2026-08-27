import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/layout/Layout';
import VersionCheck from './components/VersionCheck';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Attendance from './pages/Attendance';
import Leave from './pages/Leave';
import Payroll from './pages/Payroll';
import Performance from './pages/Performance';
import PerformancePulse from './pages/PerformancePulse';
import PulseHelp from './pages/PulseHelp';
import UserManagement from './pages/UserManagement';
import Config from './pages/Config';
import Incentives from './pages/Incentives';
import EmployeeProfile from './pages/EmployeeProfile';
import AssetRepairs from './pages/AssetRepairs';
import MyPortal from './pages/employee/MyPortal';
import MyTeam from './pages/employee/MyTeam';
import Projects from './pages/Projects';
import ProjectDashboard from './pages/ProjectDashboard';
import Tasks from './pages/Tasks';
import TaskAnalytics from './pages/TaskAnalytics';
import Meetings from './pages/Meetings';
import Workload from './pages/Workload';
import Goals from './pages/Goals';
import Reports from './pages/Reports';
import Mail from './pages/Mail';
import ProjectHours from './pages/ProjectHours';
import HoursApproval from './pages/HoursApproval';
import HoursCompliance from './pages/HoursCompliance';
import HoursUtilization from './pages/HoursUtilization';
import HoursAllocation from './pages/HoursAllocation';
import TemplatesHub from './pages/TemplatesHub';
import Notifications from './pages/Notifications';
import CalendarPage from './pages/Calendar';
import Features from './pages/Features';
import HowItWorks from './pages/HowItWorks';
import Finance from './pages/finance/Finance';
import Lifecycle from './pages/Lifecycle';
import HRDocumentsRegister from './pages/HRDocumentsRegister';
import Hiring from './pages/Hiring';
import HiringAnalytics from './pages/HiringAnalytics';
import CandidateProfile from './pages/CandidateProfile';

function landingFor(_role: string): string {
  // Everyone lands on the unified dashboard. The page renders role-aware
  // content — admin/HR see org KPIs, employees see personal info + quick
  // actions. Both groups see Company Announcements + Coming up. My Portal
  // (/my) remains the deeper personal area accessible from the sidebar.
  return '/';
}

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={landingFor(user.role)} replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={landingFor(user.role)} replace /> : <Login />} />

      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        {/* Unified dashboard — landing page for every signed-in user.
            Dashboard.tsx renders role-aware content internally. */}
        <Route index element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        {/* hr_intern: gets read access to employees (no salary), attendance,
            and leaves. Blocked from payroll, performance, user mgmt, config,
            incentives. Backend strips salary fields and gates writes. */}
        <Route path="employees" element={<ProtectedRoute roles={['admin', 'hr_manager', 'hr_intern']}><Employees /></ProtectedRoute>} />
        <Route path="employees/:id" element={<ProtectedRoute roles={['admin', 'hr_manager', 'hr_intern']}><EmployeeProfile /></ProtectedRoute>} />
        <Route path="attendance" element={<ProtectedRoute roles={['admin', 'hr_manager', 'hr_intern']}><Attendance /></ProtectedRoute>} />
        <Route path="leave" element={<ProtectedRoute roles={['admin', 'hr_manager', 'hr_intern']}><Leave /></ProtectedRoute>} />
        <Route path="payroll" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Payroll /></ProtectedRoute>} />
        <Route path="performance" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Performance /></ProtectedRoute>} />
        <Route path="performance/pulse" element={<ProtectedRoute roles={['admin', 'hr_manager', 'project_coordinator']}><PerformancePulse /></ProtectedRoute>} />
        {/* Open to anyone signed in — employees, coords, managers, HR/admin */}
        <Route path="help/pulse" element={<ProtectedRoute><PulseHelp /></ProtectedRoute>} />
        <Route path="help/how-it-works" element={<ProtectedRoute><HowItWorks /></ProtectedRoute>} />
        <Route path="users" element={<ProtectedRoute roles={['admin', 'hr_manager']}><UserManagement /></ProtectedRoute>} />
        <Route path="config" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Config /></ProtectedRoute>} />
        <Route path="incentives" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Incentives /></ProtectedRoute>} />
        <Route path="asset-repairs" element={<ProtectedRoute roles={['admin', 'hr_manager', 'hr_intern']}><AssetRepairs /></ProtectedRoute>} />
        {/* Lifecycle — onboarding + offboarding checklists across the org. HR intern included per plan. */}
        <Route path="lifecycle" element={<ProtectedRoute roles={['admin', 'hr_manager', 'hr_intern']}><Lifecycle /></ProtectedRoute>} />

        {/* HR document register — numbered letters across the org. */}
        <Route path="hr/documents" element={<ProtectedRoute roles={['admin', 'hr_manager', 'hr_intern']}><HRDocumentsRegister /></ProtectedRoute>} />

        {/* Hiring — 10-stage candidate pipeline.
            /hiring (list): HR-only (admin / hr_manager / hr_intern).
            /hiring/:id (single candidate): open to any authenticated user
            because tech reviewers + interviewers land here via notification
            links. The API enforces per-candidate access — non-HR viewers
            only pass the gate for candidates they're assigned to, and the
            profile hides irrelevant tabs based on the returned viewer_role. */}
        <Route path="hiring" element={<ProtectedRoute roles={['admin', 'hr_manager', 'hr_intern']}><Hiring /></ProtectedRoute>} />
        <Route path="hiring/analytics" element={<ProtectedRoute roles={['admin', 'hr_manager', 'hr_intern']}><HiringAnalytics /></ProtectedRoute>} />
        <Route path="hiring/:id" element={<ProtectedRoute><CandidateProfile /></ProtectedRoute>} />

        {/* Finance / CFO — admin sees everything; project_coordinator only sees the Invoices tab. */}
        <Route path="finance" element={<ProtectedRoute roles={['admin', 'project_coordinator']}><Finance /></ProtectedRoute>} />

        {/* Project Mgmt routes */}
        <Route path="projects" element={<ProtectedRoute roles={['admin', 'hr_manager', 'project_coordinator']}><Projects /></ProtectedRoute>} />
        <Route path="projects/:id" element={<ProtectedRoute><ProjectDashboard /></ProtectedRoute>} />
        {/* Tasks — ClickUp-style boards. Open to anyone signed in: everyone
            has work assigned to them, and the API decides what they may
            change (only admin / HR manager / coordinator create boards). */}
        <Route path="tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
        <Route path="tasks/analytics" element={<ProtectedRoute><TaskAnalytics /></ProtectedRoute>} />
        <Route path="meetings" element={<ProtectedRoute><Meetings /></ProtectedRoute>} />
        {/* Workload — open to anyone: employees with reports see their team,
            admin/HR/coord see the whole org via the scope toggle. The API
            enforces scope=all vs scope=team based on role. */}
        <Route path="workload" element={<ProtectedRoute><Workload /></ProtectedRoute>} />
        {/* Goals — anyone can view; the API enforces edit/delete permissions
            (owner or admin/HR/coord). */}
        <Route path="goals" element={<ProtectedRoute><Goals /></ProtectedRoute>} />
        {/* Reports — admin / HR / project_coordinator only (API also gates). */}
        <Route path="reports" element={<ProtectedRoute roles={['admin', 'hr_manager', 'project_coordinator']}><Reports /></ProtectedRoute>} />
        {/* Mail — anyone signed in can connect a mailbox. Backend
            mints per-user JWT; VPS mail service enforces per-user
            scoping. */}
        <Route path="mail" element={<ProtectedRoute><Mail /></ProtectedRoute>} />
        {/* /hours: open to anyone. The page itself decides which tabs are visible
            based on role + whether the viewer leads/reviews any projects. Team
            leads (role=employee) need this to see all projects they lead. */}
        <Route path="hours" element={<ProtectedRoute><ProjectHours /></ProtectedRoute>} />
        <Route path="hours/approvals" element={<ProtectedRoute><HoursApproval /></ProtectedRoute>} />
        {/* Legacy singular spelling — bookmarks / typos shouldn't dead-end. */}
        <Route path="hours/approval" element={<Navigate to="/hours/approvals" replace />} />
        <Route path="hours/compliance" element={<ProtectedRoute><HoursCompliance /></ProtectedRoute>} />
        {/* Utilization: server enforces role-based scoping + cost stripping */}
        <Route path="hours/utilization" element={<ProtectedRoute><HoursUtilization /></ProtectedRoute>} />
        {/* Weekly billing planner — coord/admin edit, everyone else read-only (see page). */}
        <Route path="hours/allocation" element={<ProtectedRoute roles={['admin', 'hr_manager', 'project_coordinator']}><HoursAllocation /></ProtectedRoute>} />
        <Route path="notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
        <Route path="calendar" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
        {/* Template Hub — HR / admin only for now. */}
        <Route path="templates" element={<ProtectedRoute roles={['admin', 'hr_manager']}><TemplatesHub /></ProtectedRoute>} />
        <Route path="features" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Features /></ProtectedRoute>} />

        {/* Employee routes — project_coordinator + hr_intern are also employees */}
        <Route path="my" element={<ProtectedRoute roles={['employee', 'project_coordinator', 'hr_intern', 'hr_manager', 'admin']}><MyPortal /></ProtectedRoute>} />
        <Route path="my-team" element={<ProtectedRoute roles={['employee', 'project_coordinator', 'hr_intern', 'hr_manager', 'admin']}><MyTeam /></ProtectedRoute>} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to={user ? landingFor(user.role) : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <VersionCheck />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
