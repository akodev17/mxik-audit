'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { startDemoSession } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { clientKey, createRateLimiter } from '@/lib/lead-guard';
import { getSession } from '@/lib/session';

export type DemoState = { error?: string };

// Each demo is a full copy of the sample catalogue, so cap both the rate per
// client and the number alive at once.
const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
const MAX_LIVE_DEMOS = 500;

/** Signs the visitor into a fresh demo org. No signup, no password. */
export async function startDemo(_prev: DemoState): Promise<DemoState> {
  if (!limiter.hit(clientKey(await headers())).allowed) return { error: t.demoUnavailable };
  const live = await db.organization.count({ where: { kind: 'demo', expiresAt: { gt: new Date() } } });
  if (live >= MAX_LIVE_DEMOS) return { error: t.demoUnavailable };

  const demo = await startDemoSession();
  if (!demo) return { error: t.demoUnavailable };

  const session = await getSession();
  session.userId = demo.userId;
  session.orgId = demo.orgId;
  session.email = demo.email;
  session.demo = true;
  session.clientId = undefined;
  await session.save();
  redirect('/report');
}
