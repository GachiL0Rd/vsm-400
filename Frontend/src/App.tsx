import { useEffect } from 'react';
import { Nav } from './components/Nav';
import { NotFound } from './components/NotFound';
import { notices, profile } from './demo';
import { type Route, useRoute } from './route';
import { FeedScreen } from './screens/FeedScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RatingScreen } from './screens/RatingScreen';
import { ShiftScreen } from './screens/ShiftScreen';
import './App.css';

const titles: Record<Route['name'], string> = {
  shift: 'Смена',
  profile: 'Профиль',
  rating: 'Рейтинг',
  feed: 'Лента',
  run: 'Разбор рейса',
  missing: 'Нет страницы',
};

function App() {
  const route = useRoute();
  const title = titles[route.name];
  const unread = notices.filter((n) => n.unread).length;

  // Новый экран — новый заголовок вкладки и прокрутка к началу.
  useEffect(() => {
    document.title = title;
    window.scrollTo(0, 0);
  }, [title]);

  return (
    <div className="app">
      <Nav route={route} unread={unread} callsign={profile.callsign} level={profile.level} />
      <main className="app__main">
        {route.name === 'shift' && <ShiftScreen />}
        {route.name === 'profile' && <ProfileScreen />}
        {route.name === 'rating' && <RatingScreen />}
        {route.name === 'feed' && <FeedScreen />}
        {route.name === 'missing' && <NotFound />}
      </main>
    </div>
  );
}

export default App;
