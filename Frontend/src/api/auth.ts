import {
  mutationOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ApiError, client, postLogout, unwrap } from './client';
import { keys } from './keys';
import type { components } from './schema';

export type AuthUser = components['schemas']['LoginResponseDto']['user'];
export type Session = components['schemas']['SessionResponseDto'];
type LoginBody = components['schemas']['LoginDto'];
type PasswordBody = components['schemas']['PasswordDto'];

export const sessionQuery = queryOptions<Session, ApiError>({
  queryKey: keys.session,
  queryFn: async () => unwrap(await client.GET('/api/v1/auth/session')),
});

/** mustChangePassword живёт только в кэше после login/password. */
export const authUserQuery = queryOptions<AuthUser, ApiError>({
  queryKey: keys.authUser,
  queryFn: () => {
    throw new ApiError(0, 'CACHE_ONLY', 'Нет данных', 'Профиль входа только из кэша.');
  },
  enabled: false,
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
});

export const loginMutation = mutationOptions({
  mutationFn: async (body: LoginBody) => unwrap(await client.POST('/api/v1/auth/login', { body })),
});

export const logoutMutation = mutationOptions({
  mutationFn: postLogout,
});

export const passwordMutation = mutationOptions({
  mutationFn: async (body: PasswordBody) =>
    unwrap(await client.POST('/api/v1/auth/password', { body })),
});

export function dropSession(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: keys.authUser });
  void queryClient.resetQueries({ queryKey: keys.session });
  queryClient.clear();
}

export function useSession() {
  return useQuery(sessionQuery);
}

export function useAuthUser() {
  return useQuery(authUserQuery);
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    ...loginMutation,
    onSuccess: (data) => {
      queryClient.setQueryData(keys.authUser, data.user);
      void queryClient.invalidateQueries({ queryKey: keys.session });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    ...logoutMutation,
    onSettled: () => {
      dropSession(queryClient);
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    ...passwordMutation,
    onSuccess: (data) => {
      queryClient.setQueryData(keys.authUser, data.user);
    },
  });
}
