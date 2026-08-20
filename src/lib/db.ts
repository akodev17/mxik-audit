// Single Prisma client. Next dev reloads modules, so cache it on globalThis to
// avoid exhausting Postgres connections across hot reloads.
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
