import { href } from '../route';

export function NotFound({ title = 'Такой страницы нет' }: { title?: string }) {
  return (
    <div className="screen">
      <h1 className="screen__title">{title}</h1>
      <a className="btn btn--ghost screen__action" href={href.shift}>
        На смену
      </a>
    </div>
  );
}
