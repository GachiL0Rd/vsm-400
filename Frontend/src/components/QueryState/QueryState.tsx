import type { ReactNode } from 'react';
import { ApiError } from '../../api/client';
import './QueryState.css';

interface QueryView {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: unknown;
  refetch: () => unknown;
}

function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Сервер не ответил. Попробуйте ещё раз.';
  if (error.status === 0) return 'Нет связи с сервером.';
  if (error.status >= 500) return 'Сервер не ответил. Попробуйте ещё раз.';
  return error.detail || error.title;
}

export function QueryState({ query, children }: { query: QueryView; children: ReactNode }) {
  if (query.isPending && query.data === undefined) {
    return <p className="query-state">Загрузка…</p>;
  }

  if (query.isError && query.data === undefined) {
    // 401 забирает гейт сессии. Здесь его не показываем.
    if (query.error instanceof ApiError && query.error.status === 401) return null;
    return (
      <div className="query-state">
        <p>{errorText(query.error)}</p>
        <button className="btn btn--ghost" type="button" onClick={() => query.refetch()}>
          Повторить
        </button>
      </div>
    );
  }

  return children;
}
