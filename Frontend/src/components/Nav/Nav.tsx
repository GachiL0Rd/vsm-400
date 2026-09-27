import { Link, useLocation } from 'react-router';
import { paths, runId } from '../../paths';
import { Avatar } from '../Avatar/Avatar';
import { Icon, type IconName } from '../Icon/Icon';
import './Nav.css';

type Tab = 'shift' | 'rating' | 'profile' | 'feed';

const tabs: { id: Tab; title: string; icon: IconName }[] = [
  { id: 'shift', title: 'Смена', icon: 'shift' },
  { id: 'rating', title: 'Рейтинг', icon: 'rating' },
  { id: 'profile', title: 'Профиль', icon: 'profile' },
  { id: 'feed', title: 'Лента', icon: 'feed' },
];

// Разбор рейса — раздел «Смена», но не её страница.
function tabState(
  id: Tab,
  pathname: string,
  onRun: boolean,
): { active: boolean; current: 'page' | 'true' | undefined } {
  const onPage = pathname === paths[id];
  const active = id === 'shift' ? onPage || onRun : onPage;
  const current = onPage ? 'page' : id === 'shift' && onRun ? 'true' : undefined;
  return { active, current };
}

interface NavProps {
  unread: number;
  callsign: string;
  level: number;
}

export function Nav({ unread, callsign, level }: NavProps) {
  const { pathname } = useLocation();
  const onRun = runId(pathname) !== null;

  return (
    <nav className="nav" aria-label="Разделы">
      <Link className="nav__brand" to={paths.shift}>
        <span className="nav__word">Перегон</span>
        {/* Ступенька из трёх квадратов — только в марке. */}
        <svg className="nav__stairs" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect x="0" y="14" width="6" height="6" />
          <rect x="7" y="7" width="6" height="6" />
          <rect x="14" y="0" width="6" height="6" />
        </svg>
      </Link>
      <ul className="nav__list">
        {tabs.map((tab) => {
          const { active, current } = tabState(tab.id, pathname, onRun);
          return (
            <li key={tab.id}>
              <Link
                className={`nav__item${active ? ' nav__item--active' : ''}`}
                to={paths[tab.id]}
                aria-current={current}
              >
                <span className="nav__icon">
                  <Icon name={tab.icon} />
                  {tab.id === 'feed' && unread > 0 && (
                    <span className="nav__count">
                      {unread}
                      <span className="visually-hidden"> непрочитанных</span>
                    </span>
                  )}
                </span>
                <span className="nav__title">{tab.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        className="nav__me"
        to={paths.profile}
        aria-current={pathname === paths.profile ? 'page' : undefined}
      >
        <Avatar callsign={callsign} />
        <span>
          <b>#{callsign}</b>
          <span className="nav__level">Уровень {level}</span>
        </span>
      </Link>
    </nav>
  );
}
