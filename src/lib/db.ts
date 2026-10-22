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

/** Short stable fingerprint of a query's arguments, so the log shows a repeated statement as one. */
function fingerprint(args: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(args, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) ?? '';
  } catch {
    return '?';
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * PRISMA_LOG=1 (performance work only): prints `[prisma] <ms>ms <model.operation> #<args fingerprint>`
 * for every query, timed from the call to the result (pool wait included). scripts/perf-nav.ts reads
 * these lines per request. Off, the plain client is used and nothing is wrapped.
 */
function withQueryLog(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const start = performance.now();
        try {
          const result: unknown = await query(args);
          return result;
        } finally {
          console.log(`[prisma] ${(performance.now() - start).toFixed(1)}ms ${model ? `${model}.${operation}` : operation} #${fingerprint(args)}`);
        }
      },
    },
  }) as unknown as PrismaClient;
}

/** The fallback-extended client, wrapped in the query log only when PRISMA_LOG=1. */
const create = (): PrismaClient => (process.env['PRISMA_LOG'] === '1' ? withQueryLog(createClient()) : createClient());

export const db = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
