const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const tablesToClear = [
  'calendar_blocks',
  'inventory_items',
  'product_variants',
  'products',
];

async function printCounts(label) {
  console.log(`\n${label}`);
  for (const table of tablesToClear) {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM ${table}`);
    console.log(`${table}: ${rows[0].count}`);
  }
}

async function main() {
  await printCounts('Before inventory cleanup');

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `TRUNCATE TABLE ${tablesToClear.join(', ')} RESTART IDENTITY CASCADE`,
    );
  });

  await printCounts('After inventory cleanup');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
