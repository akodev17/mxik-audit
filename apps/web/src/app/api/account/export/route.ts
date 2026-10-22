import { NextResponse } from 'next/server';
import { isDemoOrg } from '@/lib/demo';
import { getLocale } from '@/lib/locale';
import { exportAccount } from '@tasnivo/domain/account-settings';
import { currentUser } from '@/lib/session';
import { isAdminRole } from '@tasnivo/domain/access';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The whole account as a zip; admins only, and always the caller's own org. */
export async function GET() {
  const user = await currentUser();
  if (!user || !isAdminRole(user) || (await isDemoOrg(user.orgId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { zip, filename } = await exportAccount(user, await getLocale());
  return new NextResponse(new Uint8Array(zip), {
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${filename}"` },
  });
}
