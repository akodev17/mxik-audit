import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Never cached: a load balancer or uptime check needs the live answer.
export const dynamic = 'force-dynamic';

/**
 * 200 when the app can serve audits: database reachable and the classifier
 * loaded. 503 otherwise. Reports booleans only — nothing about data or keys.
 */
export async function GET() {
  let database = false;
  let classifier = false;
  try {
    const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok FROM mxik_code WHERE "retiredAt" IS NULL LIMIT 1`;
    database = true;
    classifier = rows.length > 0;
  } catch {
    // Unreachable database, or migrations not applied yet.
  }
  const ok = database && classifier;
  return NextResponse.json(
    { status: ok ? 'ok' : 'unavailable', database, classifier },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
