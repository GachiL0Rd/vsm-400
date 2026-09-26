import { Link } from 'react-router';
import { paths } from '../paths';
import { usePageTitle } from '../usePageTitle';

export function NotFound({ title = 'Такой страницы нет' }: { title?: string }) {
  usePageTitle(title);

  return (
    <div className="screen">
      <h1 className="screen__title" tabIndex={-1}>
        {title}
      </h1>
      <Link className="btn btn--ghost screen__action" to={paths.shift}>
        На смену
      </Link>
    </div>
  );
}
