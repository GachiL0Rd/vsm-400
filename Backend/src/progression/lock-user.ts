import { Prisma } from '../generated/prisma/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} не UUID`);
  }
}

/** Сериализует прогрессию одного человека: два run.completed не пишут два Run. */
export async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
  assertUuid(userId, 'Пользователь');
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "user" WHERE id = CAST(${userId} AS uuid) FOR UPDATE`,
  );
  return rows.length > 0;
}
