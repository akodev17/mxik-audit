import { NextResponse } from 'next/server';
import { db } from '@tasnivo/db';
import { isDemoOrg } from '@/lib/demo';
import { getLocale } from '@/lib/locale';
import { buildAccountExport } from '@tasnivo/domain/security/export';
import { currentUser } from '@/lib/session';
import { isAdminRole } from '@tasnivo/domain/access';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The whole account as a zip; admins only, and always the caller's own org. */
export async function GET() {
  const user = await currentUser();
  if (!user || !isAdminRole(user) || (await isDemoOrg(user.orgId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const zip = await buildAccountExport(user.orgId, await getLocale());
  await db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'account.exported', payload: {} } });
  return new NextResponse(new Uint8Array(zip), {
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="mxik-audit-export-${new Date().toISOString().slice(0, 10)}.zip"` },
  });
}
