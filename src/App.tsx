import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
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
import MyPortal from './pages/employee/MyPortal';

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={user.role === 'employee' ? '/my' : '/'} replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={user.role === 'employee' ? '/my' : '/'} replace /> : <Login />} />

      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        {/* Admin & HR Manager routes */}
        <Route index element={<ProtectedRoute roles={['admin', 'hr_manager']}><Dashboard /></ProtectedRoute>} />
        <Route path="employees" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Employees /></ProtectedRoute>} />
        <Route path="attendance" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Attendance /></ProtectedRoute>} />
        <Route path="leave" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Leave /></ProtectedRoute>} />
        <Route path="payroll" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Payroll /></ProtectedRoute>} />
        <Route path="performance" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Performance /></ProtectedRoute>} />
        <Route path="users" element={<ProtectedRoute roles={['admin', 'hr_manager']}><UserManagement /></ProtectedRoute>} />
        <Route path="config" element={<ProtectedRoute roles={['admin', 'hr_manager']}><Config /></ProtectedRoute>} />

        {/* Employee route */}
        <Route path="my" element={<ProtectedRoute roles={['employee']}><MyPortal /></ProtectedRoute>} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to={user ? (user.role === 'employee' ? '/my' : '/') : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
