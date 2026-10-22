import { z } from 'zod';
import { checkProducts, CheckItemSchema } from '@tasnivo/domain/api/check';
import { HEADERS } from '@tasnivo/domain/api/contract';
import { fingerprint, idempotent, readIdempotencyKey } from '@tasnivo/domain/api/idempotency';
import { checkAllowance, apiConfig, recordUsage } from '@tasnivo/domain/api/limits';
import { crashed, enter, failure, type Outcome } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const OP = 'check';
const Body = z.union([CheckItemSchema, z.object({ items: z.array(CheckItemSchema).min(1) })]);

export async function POST(request: Request) {
  const entered = await enter(OP, request);
  if ('response' in entered) return entered.response;
  const { caller, reply } = entered;
  try {
    const idem = readIdempotencyKey(request.headers);
    if (!idem.ok) return reply(failure(OP, 'invalid_request', 'Idempotency-Key must be 1 to 255 visible ASCII characters.'));
    const body = Body.safeParse(await request.json().catch(() => null));
    if (!body.success) return reply(failure(OP, 'invalid_request', 'Send {"name": "..."} or {"items": [{"name": "..."}]}; name is required.'));
    const items = 'items' in body.data ? body.data.items : [body.data];
    const max = apiConfig().maxCheckItems;
    if (items.length > max) return reply(failure(OP, 'invalid_request', `At most ${max} items per request.`));

    const run = async (): Promise<Outcome> => {
      const allowance = await checkAllowance(caller.orgId, items.length);
      if (!allowance.ok) {
        return allowance.reason === 'expired'
          ? failure(OP, 'plan_expired', 'The trial has ended; activate a plan.')
          : failure(OP, 'plan_limit', 'The monthly check allowance of the plan is used up.');
      }
      const results = await checkProducts(caller.orgId, items);
      await recordUsage(caller.keyId, caller.orgId, items.length);
      return { status: 200, body: { results } };
    };
    if (!idem.key) return reply(await run());

    const done = await idempotent(caller.keyId, idem.key, fingerprint(JSON.stringify(items)), run);
    if (done.kind === 'in_progress') return reply(failure(OP, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running. Retry after it finishes.'));
    if (done.kind === 'reused') return reply(failure(OP, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request.'));
    return reply(done.outcome, done.kind === 'replayed' ? { [HEADERS.replayed]: 'true' } : {});
  } catch (error) {
    return crashed(OP, error, reply);
  }
}
