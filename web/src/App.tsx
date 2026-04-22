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
import CodeAnnotationsPage from './pages/CodeAnnotationsPage';

export default function App() {
  return (
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
          <Route path="/kernel-code/annotations" element={<CodeAnnotationsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}