import { href, type Route } from '../route';
import { Icon, type IconName } from './Icon';
import './Nav.css';

type Tab = 'shift' | 'rating' | 'profile' | 'feed';

const tabs: { id: Tab; title: string; icon: IconName }[] = [
  { id: 'shift', title: 'Смена', icon: 'shift' },
  { id: 'rating', title: 'Рейтинг', icon: 'rating' },
  { id: 'profile', title: 'Профиль', icon: 'profile' },
  { id: 'feed', title: 'Лента', icon: 'feed' },
];

// Разбор рейса открывается из «Смены», поэтому подсвечиваем её.
function activeTab(route: Route): Tab | null {
  if (route.name === 'run') return 'shift';
  if (route.name === 'missing') return null;
  return route.name;
}

interface NavProps {
  route: Route;
  unread: number;
  callsign: string;
  level: number;
}

export function Nav({ route, unread, callsign, level }: NavProps) {
  const active = activeTab(route);

  return (
    <nav className="nav" aria-label="Разделы">
      <a className="nav__brand" href={href.shift}>
        Перегон
      </a>
      <ul className="nav__list">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <a
              className={`nav__item${tab.id === active ? ' nav__item--active' : ''}`}
              href={href[tab.id]}
              aria-current={tab.id === active ? 'page' : undefined}
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
            </a>
          </li>
        ))}
      </ul>
      <a className="nav__me" href={href.profile}>
        <span className="avatar">{callsign.slice(0, 2)}</span>
        <span>
          <b>#{callsign}</b>
          <span className="nav__level">Уровень {level}</span>
        </span>
      </a>
    </nav>
  );
}
