import { Prisma } from '../generated/prisma/client';

/** Одна открытая смена на человека: второй POST ждёт, пока первый зафиксирует строку. */
export function lockUserSessions(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  return tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`);
}
