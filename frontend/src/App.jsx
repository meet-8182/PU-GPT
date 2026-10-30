import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Layout } from '@/components/layout/Layout';
import { LoginPage } from '@/pages/LoginPage';
import { AskPage } from '@/pages/AskPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { InsightsPage } from '@/pages/InsightsPage';
import { ImageStudio } from '@/pages/ImageStudio';
import { AdminDashboardPage } from '@/pages/AdminDashboardPage';
import { AdminDepartmentsPage } from '@/pages/AdminDepartmentsPage';
import { AdminUsersPage } from '@/pages/AdminUsersPage';
import { AdminStatusPage } from '@/pages/AdminStatusPage';
import { MemorySettingsPage } from '@/pages/MemorySettingsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-chalkboard">
      <Loader2 className="w-10 h-10 animate-spin text-amber-chalk" />
    </div>
  );
}

function ProtectedRoute({ children, allowedRoles }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/ask" replace />;
  }

  return children;
}

function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (isAuthenticated) return <Navigate to="/ask" replace />;

  return children;
}

function WithErrorBoundary({ children }) {
  return (
    <ErrorBoundary>
      {children}
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/ask" element={<ProtectedRoute allowedRoles={['student']}><WithErrorBoundary><AskPage /></WithErrorBoundary></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute allowedRoles={['student']}><WithErrorBoundary><HistoryPage /></WithErrorBoundary></ProtectedRoute>} />
        <Route path="/memory" element={<ProtectedRoute allowedRoles={['student']}><WithErrorBoundary><MemorySettingsPage /></WithErrorBoundary></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute allowedRoles={['student']}><WithErrorBoundary><SettingsPage /></WithErrorBoundary></ProtectedRoute>} />
        <Route path="/studio" element={<ProtectedRoute allowedRoles={['student', 'teacher', 'admin']}><WithErrorBoundary><ImageStudio /></WithErrorBoundary></ProtectedRoute>} />

        <Route path="/library" element={<ProtectedRoute allowedRoles={['teacher', 'admin']}><WithErrorBoundary><LibraryPage /></WithErrorBoundary></ProtectedRoute>} />
        <Route path="/insights" element={<ProtectedRoute allowedRoles={['teacher', 'admin']}><WithErrorBoundary><InsightsPage /></WithErrorBoundary></ProtectedRoute>} />

        <Route path="/admin/dashboard" element={<ProtectedRoute allowedRoles={['admin']}><WithErrorBoundary><AdminDashboardPage /></WithErrorBoundary></ProtectedRoute>} />
        <Route path="/admin/departments" element={<ProtectedRoute allowedRoles={['admin']}><WithErrorBoundary><AdminDepartmentsPage /></WithErrorBoundary></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute allowedRoles={['admin']}><WithErrorBoundary><AdminUsersPage /></WithErrorBoundary></ProtectedRoute>} />
        <Route path="/admin/status" element={<ProtectedRoute allowedRoles={['admin']}><WithErrorBoundary><AdminStatusPage /></WithErrorBoundary></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/ask" replace />} />
    </Routes>
  );
}