import { Link } from 'react-router';
import { paths } from '../paths';
import { usePageTitle } from '../usePageTitle';

const TAB_TITLES: Record<string, string> = {
  'Такой страницы нет': 'Нет страницы',
};

export function NotFound({ title = 'Такой страницы нет' }: { title?: string }) {
  usePageTitle(TAB_TITLES[title] ?? title);

  return (
    <div className="screen">
      <h1 className="screen__title">{title}</h1>
      <Link className="btn btn--ghost screen__action" to={paths.shift}>
        На смену
      </Link>
    </div>
  );
}
