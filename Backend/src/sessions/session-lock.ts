import { Prisma } from '../generated/prisma/client';

/** Одна открытая смена на человека: второй POST ждёт, пока первый зафиксирует строку. */
export function lockUserSessions(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  return tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`);
}

/** Два показа одного живого узла не должны закрепить разные варианты. */
export async function lockSession(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "game_session" WHERE id = CAST(${sessionId} AS uuid) FOR UPDATE`,
  );
}
