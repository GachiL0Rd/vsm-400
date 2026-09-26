import { PrismaPg } from '@prisma/adapter-pg';
import { loadConfig } from '../src/config/env';
import { PrismaClient } from '../src/generated/prisma/client';

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  await prisma.$connect();
  const users = await prisma.user.count();
  console.log(`База доступна, пользователей: ${users}.`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
