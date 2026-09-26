import { Link } from 'react-router';
import { paths } from '../paths';

export function NotFound({ title = 'Такой страницы нет' }: { title?: string }) {
  return (
    <div className="screen">
      <h1 className="screen__title">{title}</h1>
      <Link className="btn btn--ghost screen__action" to={paths.shift}>
        На смену
      </Link>
    </div>
  );
}
