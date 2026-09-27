import { useEffect, useRef } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { useMe, useNotifications } from './api/cabinet';
import { AuthGate } from './components/AuthGate/AuthGate';
import { Nav } from './components/Nav/Nav';
import { NotFound } from './components/NotFound/NotFound';
import { useNotificationStream } from './hooks/useNotificationStream';
import { paths } from './paths';
import { FeedScreen } from './screens/FeedScreen/FeedScreen';
import { ProfileScreen } from './screens/ProfileScreen/ProfileScreen';
import { RatingScreen } from './screens/RatingScreen/RatingScreen';
import { RunScreen } from './screens/RunScreen/RunScreen';
import { ShiftScreen } from './screens/ShiftScreen/ShiftScreen';
import './App.css';

function App() {
  return (
    <AuthGate>
      <Cabinet />
    </AuthGate>
  );
}

function Cabinet() {
  useNotificationStream();
  const me = useMe();
  const feed = useNotifications();
  const unread = feed.data?.pages[0]?.unreadCount ?? 0;
  const { key } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const lastKey = useRef(key);

  // Каждый переход, включая рейс → рейс, начинается сверху, а фокус уходит на
  // заголовок нового экрана. При первой загрузке ключ совпадает — фокус не трогаем;
  // при клике по меню фокус остаётся в меню.
  useEffect(() => {
    window.scrollTo(0, 0);
    if (lastKey.current === key) return;
    lastKey.current = key;
    if (document.activeElement?.closest('nav')) return;
    const heading = mainRef.current?.querySelector('h1');
    if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
  }, [key]);

  return (
    <div className="app">
      <Nav unread={unread} callsign={me.data?.callsign ?? ''} level={me.data?.level ?? null} />
      <main className="app__main" ref={mainRef}>
        <Routes>
          <Route path={paths.shift} element={<ShiftScreen />} />
          <Route path={paths.profile} element={<ProfileScreen />} />
          <Route path={paths.rating} element={<RatingScreen />} />
          <Route path={paths.feed} element={<FeedScreen />} />
          <Route path={paths.runPattern} element={<RunScreen />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
