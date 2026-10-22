import { HEADERS } from '@tasnivo/domain/api/contract';
import { checkOperation } from '@tasnivo/domain/api/handlers';
import { crashed, enter } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const OP = 'check';

export async function POST(request: Request) {
  const entered = await enter(OP, request);
  if ('response' in entered) return entered.response;
  const { caller, reply } = entered;
  try {
    const body: unknown = await request.json().catch(() => null);
    const done = await checkOperation(caller, { idempotencyKey: request.headers.get(HEADERS.idempotencyKey), body });
    return reply(done.outcome, done.headers);
  } catch (error) {
    return crashed(OP, error, reply);
  }
}
