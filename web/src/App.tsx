import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import SearchPage from './pages/SearchPage';
import AskPage from './pages/AskPage';

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<SearchPage />} />
          <Route path="/ask" element={<AskPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
