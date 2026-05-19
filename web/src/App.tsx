import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './components/Toast';
import { SkeletonCard } from './components/ui';

const SearchPage = lazy(() => import('./pages/SearchPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TagsPage = lazy(() => import('./pages/TagsPage'));
const AnnotationsPage = lazy(() => import('./pages/AnnotationsPage'));
const ManualSearchPage = lazy(() => import('./pages/ManualSearchPage'));
const KernelCodePage = lazy(() => import('./pages/KernelCodePage'));
const KernelSymbolPreviewPage = lazy(() => import('./pages/KernelSymbolPreviewPage'));
const KernelAnnotationPreviewPage = lazy(() => import('./pages/KernelAnnotationPreviewPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const KnowledgePage = lazy(() => import('./pages/KnowledgePage'));

function RouteFallback() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading session...</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

function PublicOnlyRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading session...</div>;
  }
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter basename="/app">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
            </Route>
            <Route element={<ProtectedRoute />}>
              <Route element={<MainLayout />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/workspace" element={<Navigate to="/search" replace />} />

                <Route path="/tags" element={<TagsPage />} />
                <Route path="/knowledge" element={<KnowledgePage />} />
                <Route path="/annotations" element={<AnnotationsPage />} />
                <Route path="/manual/search" element={<ManualSearchPage />} />
                <Route path="/manual/search/:documentId" element={<ManualSearchPage />} />
                <Route path="/kernel-code" element={<KernelCodePage />} />
                <Route path="/kernel-code/preview" element={<KernelSymbolPreviewPage />} />
                <Route path="/kernel-code/annotation-preview" element={<KernelAnnotationPreviewPage />} />
                <Route path="/users" element={<UsersPage />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
