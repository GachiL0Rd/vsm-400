import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { authUserQuery, dropSession, sessionQuery } from '../../api/auth';
import { setOnSessionLost } from '../../api/client';
import { LoginScreen } from '../../screens/LoginScreen/LoginScreen';
import { PasswordScreen } from '../../screens/PasswordScreen/PasswordScreen';
import './AuthGate.css';

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery);
  const user = useQuery(authUserQuery);

  useEffect(() => {
    setOnSessionLost(() => {
      dropSession(queryClient);
    });
    return () => setOnSessionLost(null);
  }, [queryClient]);

  if (session.isPending) {
    return (
      <div className="auth-gate">
        <p>Загрузка…</p>
      </div>
    );
  }

  // Сеть или сервер упали — это не «не вошёл»: форма входа тут не поможет.
  if (session.isError && session.error.status !== 401 && !user.data) {
    return (
      <div className="auth-gate">
        <p>{session.error.status === 0 ? 'Нет связи с сервером.' : 'Сервер не ответил.'}</p>
        <button className="btn btn--ghost" type="button" onClick={() => session.refetch()}>
          Повторить
        </button>
      </div>
    );
  }

  if (!session.isSuccess && !user.data) {
    return <LoginScreen />;
  }

  if (user.data?.mustChangePassword) {
    return <PasswordScreen />;
  }

  return children;
}
