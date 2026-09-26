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

export type RefreshOutcome =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'reuse'; userId: string }
  | { kind: 'ok'; refresh: string; user: SessionUser };

export async function rotateRefresh(
  tx: Prisma.TransactionClient,
  raw: string,
  meta: SessionMeta,
): Promise<RefreshOutcome> {
  const session = await tx.authSession.findUnique({
    where: { refreshHash: sha256(raw) },
    include: { user: userWithDepot },
  });
  if (!session) {
    return { kind: 'missing' };
  }
  if (session.replacedById) {
    await revokeLiveSessions(tx, session.userId);
    return { kind: 'reuse', userId: session.userId };
  }
  if (session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.user.disabledAt) {
    return { kind: 'invalid' };
  }
  const refresh = randomToken();
  const next = await tx.authSession.create({
    data: {
      userId: session.userId,
      refreshHash: sha256(refresh),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt: refreshExpiry(),
    },
  });
  const won = await tx.authSession.updateMany({
    where: { id: session.id, replacedById: null, revokedAt: null },
    data: { revokedAt: new Date(), replacedById: next.id },
  });
  if (won.count !== 1) {
    await tx.authSession.delete({ where: { id: next.id } });
    await revokeLiveSessions(tx, session.userId);
    return { kind: 'reuse', userId: session.userId };
  }
  return { kind: 'ok', refresh, user: session.user };
}

export async function revokeLiveSessions(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function refreshExpiry(): Date {
  return new Date(Date.now() + REFRESH_TTL_SEC * 1000);
}
