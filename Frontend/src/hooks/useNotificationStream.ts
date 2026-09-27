import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { acceptStreamNotice } from '../api/cabinet';
import { apiBaseUrl } from '../api/client';
import { keys } from '../api/keys';

const RETRY_MIN = 2_000;
const RETRY_MAX = 30_000;

/**
 * EventSource сам переподключается сразу. Закрываем и ждём: иначе 401
 * долбит refresh. Сначала сессия — её 401 проходит через клиент и обновляет cookie.
 */
export function useNotificationStream(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let source: EventSource | null = null;
    let timer = 0;
    let delay = RETRY_MIN;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const current = new EventSource(`${apiBaseUrl}/api/v1/notifications/stream`, {
        withCredentials: true,
      });
      source = current;

      current.onopen = () => {
        delay = RETRY_MIN;
      };

      current.addEventListener('heartbeat', () => {
        delay = RETRY_MIN;
      });

      current.addEventListener('new-notification', (event) => {
        delay = RETRY_MIN;
        if (event instanceof MessageEvent && typeof event.data === 'string') {
          acceptStreamNotice(queryClient, event.data);
          return;
        }
        void queryClient.invalidateQueries({ queryKey: keys.notifications });
      });

      current.onerror = () => {
        if (stopped || source !== current) return;
        source = null;
        current.close();
        const wait = delay;
        delay = Math.min(delay * 2, RETRY_MAX);
        void queryClient.refetchQueries({ queryKey: keys.session }).finally(() => {
          if (stopped) return;
          timer = window.setTimeout(connect, wait);
        });
      };
    };

    connect();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      source?.close();
      source = null;
    };
  }, [queryClient]);
}
