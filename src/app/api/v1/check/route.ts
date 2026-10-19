import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkProducts, CheckItemSchema } from '@/lib/api/check';
import { checkAllowance, apiConfig, recordUsage } from '@/lib/api/limits';
import { apiError, enter } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const Body = z.union([CheckItemSchema, z.object({ items: z.array(CheckItemSchema).min(1) })]);

export async function POST(request: Request) {
  const entered = await enter(request);
  if ('response' in entered) return entered.response;
  const { caller } = entered;

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError('invalid_request', 'Send {"name": "..."} or {"items": [{"name": "..."}]}; name is required.');
  const items = 'items' in body.data ? body.data.items : [body.data];
  const max = apiConfig().maxCheckItems;
  if (items.length > max) return apiError('invalid_request', `At most ${max} items per request.`);

  const allowance = await checkAllowance(caller.orgId, items.length);
  if (!allowance.ok) return apiError(allowance.reason === 'expired' ? 'plan_expired' : 'plan_limit', allowance.reason === 'expired' ? 'The trial has ended; activate a plan.' : 'The monthly check allowance of the plan is used up.');

  try {
    const results = await checkProducts(caller.orgId, items);
    await recordUsage(caller.keyId, caller.orgId, items.length);
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[api] check failed', error);
    return apiError('server_error', 'The check could not be completed.');
  }
}
