import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial system settings...');

  await prisma.systemSetting.upsert({
    where: { key: 'INITIALIZED' },
    update: {},
    create: {
      key: 'INITIALIZED',
      value: 'true',
      description: 'System initialization status flag',
    },
  });

  await prisma.systemSetting.upsert({
    where: { key: 'SYSTEM_VERSION' },
    update: { value: '1.0.0' },
    create: {
      key: 'SYSTEM_VERSION',
      value: '1.0.0',
      description: 'Current version of Personal Zalo Agent',
    },
  });

  console.log('Seed completed successfully. Note: Owner is NOT seeded automatically (must pair via /pair code).');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
