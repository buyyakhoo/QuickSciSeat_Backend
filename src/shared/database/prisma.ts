import { PrismaClient } from '../../generated/prisma/index.js';

export const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

process.on('beforeExit', async () => {
  await prisma.$disconnect();
  console.log('Prisma disconnected');
});

console.log('Prisma Client initialized');