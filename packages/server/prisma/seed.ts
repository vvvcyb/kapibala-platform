import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[Seed] Seeding default users...');
  // SPEC 2.3: 预置两个用户：admin/admin（全部权限）、viewer/viewer（只读）
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { password: 'admin', role: 'admin' },
    create: {
      username: 'admin',
      password: 'admin',
      role: 'admin',
    },
  });

  await prisma.user.upsert({
    where: { username: 'viewer' },
    update: { password: 'viewer', role: 'viewer' },
    create: {
      username: 'viewer',
      password: 'viewer',
      role: 'viewer',
    },
  });
  console.log('[Seed] Users admin/admin and viewer/viewer created.');

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
