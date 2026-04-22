import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import SearchPage from './pages/SearchPage';
import AskPage from './pages/AskPage';
import TagsPage from './pages/TagsPage';
import TranslationsPage from './pages/TranslationsPage';
import ManualSearchPage from './pages/ManualSearchPage';
import ManualAskPage from './pages/ManualAskPage';

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<SearchPage />} />
          <Route path="/ask" element={<AskPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/translations" element={<TranslationsPage />} />
          <Route path="/manual/search" element={<ManualSearchPage />} />
          <Route path="/manual/ask" element={<ManualAskPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
