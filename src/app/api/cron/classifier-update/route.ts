// Starts a classifier update (scripts/update-classifier.ts) in the background.
// Protected by CRON_SECRET; disabled when the secret is unset. See DEPLOY.md.
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NextResponse } from 'next/server';

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

  const logPath = process.env['CLASSIFIER_UPDATE_LOG'] ?? join('data', 'classifier-update.log');
  mkdirSync(dirname(logPath), { recursive: true });
  const out = openSync(logPath, 'a');
  // Detached: the update outlives this request; the advisory lock keeps it single.
  const child = spawn(process.execPath, [join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/update-classifier.ts'], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
  return NextResponse.json({ started: true, pid: child.pid ?? null, log: logPath }, { status: 202 });
}
