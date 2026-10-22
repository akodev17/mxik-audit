// Daily jobs, started by cron: monthly check reminders (and, as they are added,
// retention). Protected by CRON_SECRET; disabled when the secret is unset.
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runDailyJobs } from '@tasnivo/domain/daily';

export const dynamic = 'force-dynamic';

function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  const secret = process.env['CRON_SECRET']?.trim() ?? '';
  if (secret.length < 16) return NextResponse.json({ error: 'cron disabled' }, { status: 503 });
  if (!authorized(request.headers.get('authorization'), secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await runDailyJobs());
}
