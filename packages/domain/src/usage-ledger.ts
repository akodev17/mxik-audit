// The monthly row allowance as a ledger. A catalogue's rows are written here in the transaction
// that commits it, and the entry stays when the catalogue is deleted: deleting never gives the
// allowance back, so upload → delete → upload cannot pass the plan's cap. usageOf sums the month.
import type { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';

const ROWS = 'rowsPerMonth';

/** The UTC calendar month a moment counts in, as its first instant. */
export const monthStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

type Ledger = Pick<Prisma.TransactionClient, 'usageLedger'>;

/** Rows the org has consumed in the month of `now`, deleted catalogues included. */
export async function rowsUsed(orgId: string, now = new Date(), tx: Ledger = db): Promise<number> {
  const sum = await tx.usageLedger.aggregate({ where: { orgId, key: ROWS, period: monthStart(now) }, _sum: { amount: true } });
  return sum._sum.amount ?? 0;
}

/**
 * Queues an org's capped writes (catalogue rows, clients, seats) on one transaction-scoped advisory
 * lock, so two requests at once cannot both read the same count and together pass a plan cap. Take
 * it inside the transaction that writes, then count, then refuse or write.
 */
export async function lockOrgUsage(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('usage_ledger'), hashtext(${orgId}))`;
}

/** Refused inside the commit's transaction: the rows would pass the monthly cap. */
export class OverAllowance extends Error {
  constructor() { super('over_allowance'); }
}

/**
 * Records a catalogue's rows inside the transaction that commits it. Commits of one org queue on
 * a transaction-scoped advisory lock, so two at once cannot both read the same total and together
 * pass `cap` (null = uncapped); a refusal throws OverAllowance and the transaction rolls back.
 * A catalogue already in the ledger consumes nothing again.
 */
export async function consumeRows(
  tx: Prisma.TransactionClient,
  entry: { orgId: string; catalogId: string; amount: number; cap: number | null; now?: Date },
): Promise<void> {
  const now = entry.now ?? new Date();
  await lockOrgUsage(tx, entry.orgId);
  const already = await tx.usageLedger.findUnique({ where: { catalogId_key: { catalogId: entry.catalogId, key: ROWS } }, select: { id: true } });
  if (already) return;
  if (entry.cap !== null && (await rowsUsed(entry.orgId, now, tx)) + entry.amount > entry.cap) throw new OverAllowance();
  await tx.usageLedger.create({
    data: { orgId: entry.orgId, key: ROWS, amount: entry.amount, period: monthStart(now), catalogId: entry.catalogId, reason: 'catalog.committed' },
  });
}
