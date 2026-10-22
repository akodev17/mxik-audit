// What a demo may take with it. A demo shows synthetic data only, but downloads are still capped per
// demo org so a demo cannot be used to pull files in bulk. Uploads are switched off in demo orgs
// altogether (see isDemoOrg in the upload actions), so nothing is processed for them either.
import { NextResponse } from 'next/server';
import { isDemoOrg } from './demo.js';
import { demoMaxExports } from './demo-config.js';
import { hit } from './security/rate-limit.js';

/**
 * A 429 response when this demo has used up its downloads; null for any other org and while there are some left.
 * The check reads the org's kind from the database, not from the cookie.
 */
export async function demoExportRefusal(orgId: string): Promise<NextResponse | null> {
  if (!(await isDemoOrg(orgId))) return null;
  const verdict = await hit({ kind: 'demo_export', limit: demoMaxExports(), windowMs: 24 * 3_600_000 }, orgId);
  return verdict.allowed ? null : NextResponse.json({ error: 'demo download limit reached' }, { status: 429, headers: { 'cache-control': 'no-store' } });
}
