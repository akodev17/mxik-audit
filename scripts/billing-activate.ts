// Records a bank transfer the owner has received and switches the plan on: a paid order (provider
// "bank") at the plan's price or the agreed --amount, then the same effects as a Click or Payme
// callback (a subscription extends the paid period by 1 or 12 months; a catalogue order unlocks
// that catalogue's corrected file). Plan ids: billing/plans.ts (company_monthly, firm_yearly, ...).
// Run: npm run billing:activate -- --org <org id or a member's e-mail> --plan <plan id> [--catalog <id>] [--amount <soʻm>]
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
if (!org || !planId || (amountRaw !== undefined && !/^\d+$/.test(amountRaw))) {
  console.error('usage: npm run billing:activate -- --org <org id or e-mail> --plan <plan id> [--catalog <id>] [--amount <soʻm>]');
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

const result = await recordTransfer({ orgId, planId, catalogId: option('--catalog') ?? null, amount: amountRaw === undefined ? undefined : Number(amountRaw) });
if (!result.ok) {
  console.error(result.reason === 'unknown_plan' ? `unknown plan ${planId}` : 'a catalogue plan needs --catalog: a ready catalogue of this organisation in that size tier');
  process.exit(1);
}
const { subscriptionUntil } = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { subscriptionUntil: true } });
console.log(JSON.stringify({ ...result, orgId, planId, subscriptionUntil }));
await db.$disconnect();
