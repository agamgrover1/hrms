import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Attendance from './pages/Attendance';
import Leave from './pages/Leave';
import Payroll from './pages/Payroll';
import Performance from './pages/Performance';
import UserManagement from './pages/UserManagement';
import Config from './pages/Config';
import Incentives from './pages/Incentives';
import EmployeeProfile from './pages/EmployeeProfile';
import AssetRepairs from './pages/AssetRepairs';
import MyPortal from './pages/employee/MyPortal';
import MyTeam from './pages/employee/MyTeam';
import Projects from './pages/Projects';
import ProjectHours from './pages/ProjectHours';
import HoursApproval from './pages/HoursApproval';
import HoursCompliance from './pages/HoursCompliance';
import Finance from './pages/finance/Finance';

function landingFor(role: string): string {
  if (role === 'employee' || role === 'project_coordinator') return '/my';
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
        {/* Admin & HR Manager routes */}
        <Route index element={<ProtectedRoute roles={['admin', 'hr_manager']}><Dashboard /></ProtectedRoute>} />
        <Route path="employees" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Employees /></ProtectedRoute>} />
        <Route path="employees/:id" element={<ProtectedRoute roles={['admin', 'hr_manager']}><EmployeeProfile /></ProtectedRoute>} />
        <Route path="attendance" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Attendance /></ProtectedRoute>} />
        <Route path="leave" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Leave /></ProtectedRoute>} />
        <Route path="payroll" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Payroll /></ProtectedRoute>} />
        <Route path="performance" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Performance /></ProtectedRoute>} />
        <Route path="users" element={<ProtectedRoute roles={['admin', 'hr_manager']}><UserManagement /></ProtectedRoute>} />
        <Route path="config" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Config /></ProtectedRoute>} />
        <Route path="incentives" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Incentives /></ProtectedRoute>} />
        <Route path="asset-repairs" element={<ProtectedRoute roles={['admin', 'hr_manager']}><AssetRepairs /></ProtectedRoute>} />

        {/* Finance / CFO — admin sees everything; project_coordinator only sees the Invoices tab. */}
        <Route path="finance" element={<ProtectedRoute roles={['admin', 'project_coordinator']}><Finance /></ProtectedRoute>} />

        {/* Project Mgmt routes */}
        <Route path="projects" element={<ProtectedRoute roles={['admin', 'hr_manager', 'project_coordinator']}><Projects /></ProtectedRoute>} />
        {/* /hours: open to anyone. The page itself decides which tabs are visible
            based on role + whether the viewer leads/reviews any projects. Team
            leads (role=employee) need this to see all projects they lead. */}
        <Route path="hours" element={<ProtectedRoute><ProjectHours /></ProtectedRoute>} />
        <Route path="hours/approvals" element={<ProtectedRoute><HoursApproval /></ProtectedRoute>} />
        <Route path="hours/compliance" element={<ProtectedRoute><HoursCompliance /></ProtectedRoute>} />

        {/* Employee routes — project_coordinator is also an employee */}
        <Route path="my" element={<ProtectedRoute roles={['employee', 'project_coordinator']}><MyPortal /></ProtectedRoute>} />
        <Route path="my-team" element={<ProtectedRoute roles={['employee', 'project_coordinator']}><MyTeam /></ProtectedRoute>} />
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
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
