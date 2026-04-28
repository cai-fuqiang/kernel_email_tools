import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './components/Toast';
import { SkeletonCard } from './components/ui';

const SearchPage = lazy(() => import('./pages/SearchPage'));
const AskPage = lazy(() => import('./pages/AskPage'));
const TagsPage = lazy(() => import('./pages/TagsPage'));
const TranslationsPage = lazy(() => import('./pages/TranslationsPage'));
const AnnotationsPage = lazy(() => import('./pages/AnnotationsPage'));
const ManualSearchPage = lazy(() => import('./pages/ManualSearchPage'));
const ManualAskPage = lazy(() => import('./pages/ManualAskPage'));
const KernelCodePage = lazy(() => import('./pages/KernelCodePage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const KnowledgePage = lazy(() => import('./pages/KnowledgePage'));
const AnnotationReviewPage = lazy(() => import('./pages/AnnotationReviewPage'));

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
    return <Navigate to="/" replace />;
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
                <Route path="/" element={<SearchPage />} />
                <Route path="/ask" element={<AskPage />} />

                <Route path="/tags" element={<TagsPage />} />
                <Route path="/knowledge" element={<KnowledgePage />} />
                <Route path="/annotations" element={<AnnotationsPage />} />
                <Route path="/translations" element={<TranslationsPage />} />
                <Route path="/manual/search" element={<ManualSearchPage />} />
                <Route path="/manual/ask" element={<ManualAskPage />} />
                <Route path="/kernel-code" element={<KernelCodePage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/admin/annotation-review" element={<AnnotationReviewPage />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
