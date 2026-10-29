// Records a refund the owner has already made by hand: Click and Payme are not called (no refund API
// is wired here), so return the money in the provider's cabinet or by bank transfer first. Marks the
// paid order refunded, shortens the org's paid period by --days (or by the months this order bought;
// never before now), writes a billing.refunded audit event and prints what changed. A catalogue
// order's corrected file is locked again.
// Run: npm run billing:refund -- <orderId> [--days N] [--note "..."]
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { db } from '@tasnivo/db';
import { refundOrder } from '@tasnivo/domain/billing/refunds';

const args = process.argv.slice(2);
const option = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const orderId = args[0];
const daysRaw = option('--days');
const note = option('--note');
if (!orderId || orderId.startsWith('--') || (daysRaw !== undefined && !/^\d+$/.test(daysRaw)) || (args.includes('--note') && !note)) {
  console.error('usage: npm run billing:refund -- <orderId> [--days N] [--note "..."]');
  process.exit(1);
}

const REFUSED = {
  not_found: `no order ${orderId}`,
  not_paid: 'the order is not paid (it is open, cancelled or already refunded): nothing changed',
  bad_days: '--days must be a whole number above 0',
} as const;

const result = await refundOrder({ orderId, days: daysRaw === undefined ? undefined : Number(daysRaw), note });
if (!result.ok) {
  console.error(REFUSED[result.reason]);
  await db.$disconnect();
  process.exit(1);
}
const { refund } = result;
const iso = (d: Date | null): string | null => d?.toISOString() ?? null;
console.log(JSON.stringify({
  orderId: refund.orderId, orgId: refund.orgId, planId: refund.planId, amount: refund.amount, status: 'refunded',
  subscriptionUntil: { before: iso(refund.until.before), after: iso(refund.until.after) },
}, null, 2));
console.log('No money was moved by this script: return it through Click, Payme or the bank yourself.');
await db.$disconnect();
