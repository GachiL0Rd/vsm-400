import { Link } from 'react-router';
import { useMarkAllNoticesRead, useMarkNoticeRead, useNotifications } from '../../api/cabinet';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { QueryState } from '../../components/QueryState/QueryState';
import { Tag } from '../../components/Tag/Tag';
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
  promotion: { icon: 'rating', title: 'Повышение' },
  assignment: { icon: 'flag', title: 'Назначение' },
};

const UNKNOWN_KIND = { icon: 'feed', title: 'Уведомление' } as const;

function kindMeta(kind: string): { icon: IconName; title: string } {
  if (!Object.hasOwn(KINDS, kind)) return UNKNOWN_KIND;
  return KINDS[kind as NoticeKind];
}

function appPath(link: string | undefined): string | null {
  // Двойной слэш — чужой хост, не маршрут кабинета.
  if (!link?.startsWith('/')) return null;
  if (link.startsWith('//')) return null;
  return link;
}

export function FeedScreen() {
  usePageTitle('Лента');
  const feed = useNotifications();
  const readOne = useMarkNoticeRead();
  const readAll = useMarkAllNoticesRead();
  const pages = feed.data?.pages ?? [];
  const unread = pages[0]?.unreadCount ?? 0;
  const count = pages.reduce((sum, page) => sum + page.items.length, 0);

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title" tabIndex={-1}>
          Лента
        </h1>
        {feed.isSuccess && count > 0 && (
          <p className="screen__sub">{unread > 0 ? `Непрочитанных: ${unread}` : 'Всё прочитано'}</p>
        )}
        {feed.isSuccess && unread > 0 && (
          <button
            className="btn btn--ghost feed__read-all"
            type="button"
            onClick={() => readAll.mutate()}
            disabled={readAll.isPending}
          >
            Отметить все прочитанными
          </button>
        )}
      </header>

      <QueryState query={feed}>
        {feed.data && (
          <div className="feed-block">
            {count === 0 ? (
              <p className="query-state">Уведомлений пока нет.</p>
            ) : (
              <ul className="feed">
                {pages.flatMap((page) =>
                  page.items.map((notice) => (
                    <li key={notice.id}>
                      <NoticeEntry
                        notice={notice}
                        onOpen={() => {
                          if (notice.unread) readOne.mutate(notice.id);
                        }}
                      />
                    </li>
                  )),
                )}
              </ul>
            )}
            {feed.hasNextPage && (
              <button
                className="btn btn--ghost feed__more"
                type="button"
                onClick={() => feed.fetchNextPage()}
                disabled={feed.isFetchingNextPage}
              >
                Показать ещё
              </button>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function NoticeEntry({ notice, onOpen }: { notice: Notice; onOpen: () => void }) {
  const kind = kindMeta(notice.kind);
  const body = (
    <>
      <span className="notice__icon">
        <Icon name={kind.icon} size={22} />
      </span>
      <span className="notice__body">
        <span className="notice__meta">
          <span className="notice__kind">
            {notice.unread && <Tag tone="new">Новое</Tag>}
            <span className="label">{kind.title}</span>
          </span>
          <span className="notice__when">
            {!notice.unread && (
              <span className="notice__read">
                <Icon name="read" size={18} />
                <span className="visually-hidden">Прочитано, </span>
              </span>
            )}
            <span className="label">{formatAgo(notice.at)}</span>
          </span>
        </span>
        <b className="notice__title">{notice.title}</b>
        <span className="notice__text">{notice.text}</span>
      </span>
    </>
  );
  const className = `notice${notice.unread ? ' notice--unread' : ''}`;
  const href = appPath(notice.link);

  if (href) {
    return (
      <Link className={`${className} notice--link`} to={href} onClick={onOpen}>
        {body}
      </Link>
    );
  }

  if (notice.unread) {
    return (
      <button className={`${className} notice--button`} type="button" onClick={onOpen}>
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}
