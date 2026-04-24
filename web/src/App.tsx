import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
import { AuthProvider } from './auth';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/app">
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<SearchPage />} />
            <Route path="/ask" element={<AskPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/annotations" element={<AnnotationsPage />} />
            <Route path="/translations" element={<TranslationsPage />} />
            <Route path="/manual/search" element={<ManualSearchPage />} />
            <Route path="/manual/ask" element={<ManualAskPage />} />
            <Route path="/kernel-code" element={<KernelCodePage />} />
            <Route path="/users" element={<UsersPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
