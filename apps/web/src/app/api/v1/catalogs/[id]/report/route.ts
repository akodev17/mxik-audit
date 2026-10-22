import { reportOperation } from '@tasnivo/domain/api/handlers';
import { crashed, enter } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const OP = 'report';

/** Status, summary and one page of findings (cursor = nextCursor of the previous page). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const entered = await enter(OP, request);
  if ('response' in entered) return entered.response;
  const { caller, reply } = entered;
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const done = await reportOperation(caller, id, { limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor') });
    return reply(done.outcome, done.headers);
  } catch (error) {
    return crashed(OP, error, reply);
  }
}
