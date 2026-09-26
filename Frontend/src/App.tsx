import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { Nav } from './components/Nav';
import { NotFound } from './components/NotFound';
import { notices, profile } from './demo';
import { paths } from './paths';
import { FeedScreen } from './screens/FeedScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RatingScreen } from './screens/RatingScreen';
import { RunScreen } from './screens/RunScreen';
import { ShiftScreen } from './screens/ShiftScreen';
import './App.css';

function App() {
  const { pathname } = useLocation();
  const unread = notices.filter((notice) => notice.unread).length;

  // Смена пути, а не текста заголовка: рейс → рейс тоже начинается сверху.
  // pathname читается, иначе линтер снимет зависимость и прокрутка залипнет.
  useEffect(() => {
    void pathname;
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
