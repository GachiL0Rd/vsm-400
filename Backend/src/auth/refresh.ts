import type { Prisma } from '../generated/prisma/client';
import { REFRESH_TTL_SEC } from './cookies';
import { randomToken, sha256 } from './token';

const userWithDepot = {
  include: { brigade: { select: { depotId: true } } },
} as const;

export type SessionUser = Prisma.UserGetPayload<typeof userWithDepot>;

export type SessionMeta = {
  ip: string | null;
  userAgent: string | null;
};

/**
 * Две вкладки или ретрай шлют один refresh почти вместе.
 * Победитель уже записал cookie. 10 с покрывают повтор сети,
 * украденный токен старше окна по-прежнему гасит все сессии.
 */
export const REFRESH_RACE_WINDOW_MS = 10_000;

export type RefreshOutcome =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'reuse'; userId: string }
  | { kind: 'race'; userId: string }
  | { kind: 'password' }
  | { kind: 'ok'; refresh: string; user: SessionUser; sessionId: string };

export async function rotateRefresh(
  tx: Prisma.TransactionClient,
  raw: string,
  meta: SessionMeta,
  now: Date,
): Promise<RefreshOutcome> {
  const session = await tx.authSession.findUnique({
    where: { refreshHash: sha256(raw) },
    include: { user: userWithDepot },
  });
  if (!session) {
    return { kind: 'missing' };
  }
  if (session.replacedById) {
    return replacedOutcome(tx, session.userId, session.revokedAt, now);
  }
  if (
    session.revokedAt ||
    session.expiresAt.getTime() <= now.getTime() ||
    session.user.disabledAt
  ) {
    return { kind: 'invalid' };
  }
  if (session.user.mustChangePassword) {
    return { kind: 'password' };
  }
  const refresh = randomToken();
  const next = await tx.authSession.create({
    data: {
      userId: session.userId,
      refreshHash: sha256(refresh),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt: refreshExpiry(now),
    },
  });
  const won = await tx.authSession.updateMany({
    where: { id: session.id, replacedById: null, revokedAt: null },
    data: { revokedAt: now, replacedById: next.id },
  });
  if (won.count !== 1) {
    await tx.authSession.delete({ where: { id: next.id } });
    const current = await tx.authSession.findUnique({
      where: { id: session.id },
      select: { replacedById: true, revokedAt: true },
    });
    if (current?.replacedById) {
      return replacedOutcome(tx, session.userId, current.revokedAt, now);
    }
    await revokeLiveSessions(tx, session.userId, now);
    return { kind: 'reuse', userId: session.userId };
  }
  return { kind: 'ok', refresh, user: session.user, sessionId: next.id };
}

/** Время замены — revokedAt, его ставит ротация вместе с replacedById. */
async function replacedOutcome(
  tx: Prisma.TransactionClient,
  userId: string,
  revokedAt: Date | null,
  now: Date,
): Promise<RefreshOutcome> {
  if (replacedRecently(revokedAt, now)) {
    return { kind: 'race', userId };
  }
  await revokeLiveSessions(tx, userId, now);
  return { kind: 'reuse', userId };
}

function replacedRecently(revokedAt: Date | null, now: Date): boolean {
  if (!revokedAt) {
    return false;
  }
  return now.getTime() - revokedAt.getTime() < REFRESH_RACE_WINDOW_MS;
}

export async function revokeLiveSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<void> {
  await tx.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export function refreshExpiry(now: Date): Date {
  return new Date(now.getTime() + REFRESH_TTL_SEC * 1000);
}
