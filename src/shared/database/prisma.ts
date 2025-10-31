import { PrismaClient } from '../../generated/prisma/index.js';
// import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

process.on('beforeExit', async () => {
  await prisma.$disconnect();
  console.log('Prisma disconnected');
});

console.log('Prisma Client initialized');