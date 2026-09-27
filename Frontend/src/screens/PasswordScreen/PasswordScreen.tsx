import { type FormEvent, useState } from 'react';
import { useChangePassword } from '../../api/auth';
import { ApiError } from '../../api/client';
import { usePageTitle } from '../../hooks/usePageTitle';
import './PasswordScreen.css';

const MIN_PASSWORD = 10;

function passwordMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Не удалось сменить пароль. Попробуйте ещё раз.';
  if (err.status === 0) return 'Нет связи с сервером.';
  if (err.status === 401) return 'Неверный текущий пароль.';
  if (err.status === 422 || err.status === 400) {
    return 'Новый пароль не принят. Минимум 10 символов.';
  }
  if (err.status === 429) return 'Слишком много попыток. Подождите минуту.';
  return 'Не удалось сменить пароль. Попробуйте ещё раз.';
}

export function PasswordScreen() {
  usePageTitle('Смена пароля');
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (change.isPending) return;
    if (next.length < MIN_PASSWORD) {
      setFormError('Новый пароль — не короче 10 символов.');
      return;
    }
    if (next !== repeat) {
      setFormError('Новый пароль и повтор не совпадают.');
      return;
    }
    setFormError(null);
    change.mutate({ current, next });
  }

  const pending = change.isPending;
  const error = formError ?? (change.isError ? passwordMessage(change.error) : null);

  return (
    <div className="password">
      <form className="password__form" onSubmit={onSubmit}>
        <h1 className="password__title">Смена пароля</h1>
        <p className="password__lead">Перед работой задайте новый пароль.</p>
        <label className="field">
          <span className="label">Текущий пароль</span>
          <input
            className={`field__input${error ? ' field__input--error' : ''}`}
            type="password"
            name="current"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="label">Новый пароль</span>
          <input
            className={`field__input${error ? ' field__input--error' : ''}`}
            type="password"
            name="next"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="label">Повторите новый пароль</span>
          <input
            className={`field__input${error ? ' field__input--error' : ''}`}
            type="password"
            name="repeat"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            required
          />
        </label>
        <button className="btn" type="submit" disabled={pending}>
          Сменить пароль
        </button>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
