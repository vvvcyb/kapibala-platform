import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[Seed] Seeding default users...');
  // 1. Preset users: admin and viewer
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: 'admin123',
      role: 'admin',
    },
  });

  await prisma.user.upsert({
    where: { username: 'viewer' },
    update: {},
    create: {
      username: 'viewer',
      password: 'viewer123',
      role: 'viewer',
    },
  });
  console.log('[Seed] Users admin (admin123) and viewer (viewer123) created.');

  // 2. Preset accounts: account_1 ~ account_4
  console.log('[Seed] Seeding initial service accounts...');
  for (let i = 1; i <= 4; i++) {
    const accountId = `account_${i}`;
    await prisma.account.upsert({
      where: { id: accountId },
      update: {},
      create: {
        id: accountId,
        status: 'idle',
        platformUserId: null,
        rateLimitedUntil: null,
        version: 0,
      },
    });
  }
  console.log('[Seed] Accounts account_1 ~ account_4 created.');
}

main()
  .catch((e) => {
    console.error('[Seed] Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
