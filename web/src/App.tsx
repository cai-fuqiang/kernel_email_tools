import { BrowserRouter, Navigate, Outlet, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import SearchPage from './pages/SearchPage';
import AskPage from './pages/AskPage';
import TagsPage from './pages/TagsPage';
import TranslationsPage from './pages/TranslationsPage';
import AnnotationsPage from './pages/AnnotationsPage';
import ManualSearchPage from './pages/ManualSearchPage';
import ManualAskPage from './pages/ManualAskPage';
import KernelCodePage from './pages/KernelCodePage';
import UsersPage from './pages/UsersPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import KnowledgePage from './pages/KnowledgePage';
import { AuthProvider, useAuth } from './auth';

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
      <BrowserRouter basename="/app">
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
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
