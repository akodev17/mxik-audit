// Starts a classifier update (scripts/update-classifier.ts) in the background.
// Protected by CRON_SECRET; disabled when the secret is unset. See DEPLOY.md.
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { startClassifierUpdate } from '@tasnivo/domain/classifier-start';

export const dynamic = 'force-dynamic';

function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function POST(request: Request) {
  const secret = process.env['CRON_SECRET']?.trim() ?? '';
  if (secret.length < 16) return NextResponse.json({ error: 'cron disabled' }, { status: 503 });
  if (!authorized(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const started = startClassifierUpdate();
  return NextResponse.json({ started: true, pid: started.pid, log: started.log }, { status: 202 });
}
