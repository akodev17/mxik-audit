import { NextResponse } from 'next/server';
import { classifierHealth } from '@tasnivo/domain/classifier-health';
import { classifierState, type ClassifierState } from '@tasnivo/domain/classifier-state';
import { db } from '@tasnivo/db';

// Never cached: a load balancer or uptime check needs the live answer.
export const dynamic = 'force-dynamic';

/**
 * 200 when the app can serve audits: database reachable and the classifier
 * loaded. 503 otherwise. Besides booleans it reports how old the classifier copy
 * is and how the last update ended (the failure message is one bounded line from
 * our own update script) — nothing about customer data or keys. A stale copy does
 * not turn the status to 503: the app still serves, and `classifier.stale` says so.
 */
export async function GET() {
  let database = false;
  let loaded = false;
  let state: ClassifierState | null = null;
  try {
    const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok FROM mxik_code WHERE "retiredAt" IS NULL LIMIT 1`;
    database = true;
    loaded = rows.length > 0;
    state = await classifierState();
  } catch {
    // Unreachable database, or migrations not applied yet.
  }
  const ok = database && loaded;
  return NextResponse.json(
    { status: ok ? 'ok' : 'unavailable', database, classifier: classifierHealth(loaded, state) },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
