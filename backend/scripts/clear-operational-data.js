const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const tablesToClear = [
  'dispute_evidence',
  'disputes',
  'receipts',
  'payment_transactions',
  'payments',
  'return_inspections',
  'handover_records',
  'rentals',
  'booking_items',
  'lead_items',
  'rental_order_items',
  'bookings',
  'leads',
  'rental_orders',
  'appointments',
  'preview_requests',
  'audit_logs',
  'daily_reports',
  'notifications',
  'calendar_blocks',
  'customers',
];

async function printCounts(label) {
  console.log(`\n${label}`);
  for (const table of tablesToClear) {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM ${table}`);
    console.log(`${table}: ${rows[0].count}`);
  }
}

async function printAvailabilityStatus() {
  const inventory = await prisma.inventoryItem.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const products = await prisma.product.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  console.log('\nInventory item status counts:');
  for (const row of inventory) {
    console.log(`${row.status}: ${row._count._all}`);
  }

  console.log('\nProduct status counts:');
  for (const row of products) {
    console.log(`${row.status}: ${row._count._all}`);
  }
}

async function main() {
  await printCounts('Before cleanup');

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `TRUNCATE TABLE ${tablesToClear.join(', ')} RESTART IDENTITY CASCADE`,
    );

    await tx.inventoryItem.updateMany({
      where: {
        status: {
          in: ['RESERVED', 'RENTED'],
        },
      },
      data: {
        status: 'AVAILABLE',
      },
    });

    await tx.product.updateMany({
      where: {
        status: {
          in: ['RESERVED', 'RENTED'],
        },
      },
      data: {
        status: 'AVAILABLE',
      },
    });
  });

  await printCounts('After cleanup');
  await printAvailabilityStatus();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
