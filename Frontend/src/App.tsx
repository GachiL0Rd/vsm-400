import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { Nav } from './components/Nav';
import { NotFound } from './components/NotFound';
import { findRun, notices, profile } from './demo';
import { paths, runId } from './paths';
import { FeedScreen } from './screens/FeedScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RatingScreen } from './screens/RatingScreen';
import { RunScreen } from './screens/RunScreen';
import { ShiftScreen } from './screens/ShiftScreen';
import './App.css';

function titleFor(pathname: string): string {
  if (pathname === paths.shift) return 'Смена';
  if (pathname === paths.profile) return 'Профиль';
  if (pathname === paths.rating) return 'Рейтинг';
  if (pathname === paths.feed) return 'Лента';
  const id = runId(pathname);
  if (id !== null) return findRun(id)?.outcomeNote ?? 'Рейс не найден';
  return 'Нет страницы';
}

function App() {
  const { pathname } = useLocation();
  const unread = notices.filter((notice) => notice.unread).length;

  // Смена пути, а не текста заголовка: рейс → рейс тоже начинается сверху.
  useEffect(() => {
    document.title = titleFor(pathname);
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app">
      <Nav unread={unread} callsign={profile.callsign} level={profile.level} />
      <main className="app__main">
        <Routes>
          <Route path={paths.shift} element={<ShiftScreen />} />
          <Route path={paths.profile} element={<ProfileScreen />} />
          <Route path={paths.rating} element={<RatingScreen />} />
          <Route path={paths.feed} element={<FeedScreen unread={unread} />} />
          <Route path={paths.runPattern} element={<RunScreen />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
