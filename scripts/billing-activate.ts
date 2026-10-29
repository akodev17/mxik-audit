// Records a bank transfer the owner has received and switches the plan on: a paid order (provider
// "bank") at the plan's price or the agreed --amount, then the same effects as a Click or Payme
// callback (a subscription extends the paid period by 1 or 12 months; a catalogue order unlocks
// that catalogue's corrected file). Plan ids: billing/plans.ts (company_monthly, firm_yearly, ...).
// The tier rule applies as online (billing/period.ts): while a subscription runs, the same tier
// extends it and a dearer tier starts now with the unused days credited at the price ratio; a
// cheaper tier is refused unless --force, which converts the unused days the same way.
// Run: npm run billing:activate -- --org <org id or a member's e-mail> --plan <plan id> [--catalog <id>] [--amount <soʻm>] [--force]
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { db } from '@tasnivo/db';
import { recordTransfer } from '@tasnivo/domain/billing/orders';
import { PLANS, SUBSCRIPTION_IDS } from '@tasnivo/domain/billing/plans';

const args = process.argv.slice(2);
const option = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const org = option('--org');
const planId = option('--plan');
const amountRaw = option('--amount')?.replace(/[\s_]/g, '');
const force = args.includes('--force');
if (!org || !planId || (amountRaw !== undefined && !/^\d+$/.test(amountRaw))) {
  console.error('usage: npm run billing:activate -- --org <org id or e-mail> --plan <plan id> [--catalog <id>] [--amount <soʻm>] [--force]');
  console.error(`plans: ${[...SUBSCRIPTION_IDS, ...PLANS.catalog.map((c) => c.id)].join(', ')}`);
  process.exit(1);
}

const orgId = org.includes('@')
  ? (await db.user.findFirst({ where: { email: org.toLowerCase() }, select: { orgId: true } }))?.orgId
  : (await db.organization.findUnique({ where: { id: org }, select: { id: true } }))?.id;
if (!orgId) {
  console.error(`no organisation for ${org}`);
  process.exit(1);
}

const REFUSED = {
  catalog: 'a catalogue plan needs --catalog: a ready catalogue of this organisation in that size tier',
  already_paid: 'this catalogue is already paid for',
  plan_change: 'a subscription of a dearer tier is running: a cheaper tier waits until it ends (or pass --force to convert the unused days at the price ratio)',
} as const;

const result = await recordTransfer({ orgId, planId, catalogId: option('--catalog') ?? null, amount: amountRaw === undefined ? undefined : Number(amountRaw), force });
if (!result.ok) {
  console.error(result.reason === 'unknown_plan' ? `unknown plan ${planId}` : REFUSED[result.reason]);
  process.exit(1);
}
const { subscriptionUntil } = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { subscriptionUntil: true } });
console.log(JSON.stringify({ ...result, orgId, planId, subscriptionUntil }));
await db.$disconnect();
