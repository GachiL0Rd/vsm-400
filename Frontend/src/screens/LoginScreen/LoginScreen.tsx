import { type FormEvent, useState } from 'react';
import { useLogin } from '../../api/auth';
import { ApiError } from '../../api/client';
import { Brand } from '../../components/Brand/Brand';
import { usePageTitle } from '../../hooks/usePageTitle';
import './LoginScreen.css';

function loginMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Не удалось войти. Попробуйте ещё раз.';
  if (err.status === 0) return 'Нет связи с сервером.';
  if (err.status === 401) return 'Неверный логин или пароль.';
  if (err.status === 429) return 'Слишком много попыток. Подождите минуту.';
  return 'Не удалось войти. Попробуйте ещё раз.';
}

export function LoginScreen() {
  usePageTitle('Вход');
  const signIn = useLogin();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signIn.isPending) return;
    signIn.mutate({ login: name, password });
  }

  const pending = signIn.isPending;
  const error = signIn.isError ? loginMessage(signIn.error) : null;

  return (
    <div className="login">
      <div className="login__card">
        <Brand />
        <form className="login__form" onSubmit={onSubmit}>
          <h1 className="login__title">Вход в кабинет</h1>
          <label className="field">
            <span className="label">Логин</span>
            <input
              className={`field__input${error ? ' field__input--error' : ''}`}
              name="login"
              autoComplete="username"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="label">Пароль</span>
            <input
              className={`field__input${error ? ' field__input--error' : ''}`}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="btn" type="submit" disabled={pending}>
            Войти
          </button>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <p className="login__note">Учётную запись выдаёт администратор депо.</p>
        </form>
      </div>
    </div>
  );
}
