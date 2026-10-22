// Single Prisma client. Next dev reloads modules, so cache it on globalThis to
// avoid exhausting Postgres connections across hot reloads.
import { PrismaClient } from '@prisma/client';
import { findingTypeFallback } from './finding-type-extension.js';

/**
 * Reads survive a finding type the generated client does not know
 * (finding-type-extension.ts). That extension only hooks queries and changes no
 * signature, so the client keeps the plain PrismaClient type, which is what
 * Prisma.TransactionClient parameters across the code expect.
 */
function createClient(): PrismaClient {
  return new PrismaClient().$extends(findingTypeFallback) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
