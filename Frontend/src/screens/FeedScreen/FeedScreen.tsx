import { Link } from 'react-router';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { Tag } from '../../components/Tag/Tag';
import { notices } from '../../demo';
import { formatAgo } from '../../format';
import { usePageTitle } from '../../hooks/usePageTitle';
import type { Notice, NoticeKind } from '../../model';
import './FeedScreen.css';

const KINDS: Record<NoticeKind, { icon: IconName; title: string }> = {
  expiring: { icon: 'hourglass', title: 'Баллы' },
  advice: { icon: 'bulb', title: 'Рекомендация' },
  scenario: { icon: 'plus', title: 'Новые ситуации' },
  challenge: { icon: 'rating', title: 'Соревнование бригад' },
  overtaken: { icon: 'arrowDown', title: 'Рейтинг' },
  achievement: { icon: 'medal', title: 'Знак отличия' },
};

export function FeedScreen({ unread }: { unread: number }) {
  usePageTitle('Лента');

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title" tabIndex={-1}>
          Лента
        </h1>
        <p className="screen__sub">{unread > 0 ? `Непрочитанных: ${unread}` : 'Всё прочитано'}</p>
      </header>

      <ul className="feed">
        {notices.map((notice) => (
          <li key={notice.id}>
            <NoticeEntry notice={notice} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoticeEntry({ notice }: { notice: Notice }) {
  const kind = KINDS[notice.kind];
  const body = (
    <>
      <span className="notice__icon">
        <Icon name={kind.icon} size={28} />
      </span>
      <span className="notice__body">
        <span className="notice__meta">
          <span className="notice__kind">
            {notice.unread && <Tag tone="new">Новое</Tag>}
            <span className="label">{kind.title}</span>
          </span>
          <span className="label">{formatAgo(notice.at)}</span>
        </span>
        <b className="notice__title">{notice.title}</b>
        <span className="notice__text">{notice.text}</span>
      </span>
    </>
  );
  const className = `notice${notice.unread ? ' notice--unread' : ''}`;

  return notice.link ? (
    <Link className={`${className} notice--link`} to={notice.link}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
