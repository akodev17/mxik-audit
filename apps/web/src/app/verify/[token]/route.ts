// The link in the confirmation email: confirms the address and signs the user in
// (@tasnivo/domain/security/auth-forms verifyEmailLink, shared with the API).
import { headers } from 'next/headers';
import { redirectTo } from '@/lib/security/redirect';
import { getSession } from '@/lib/session';
import { verifyEmailLink } from '@tasnivo/domain/security/auth-forms';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return redirectTo(await verifyEmailLink(await getSession(), token, (await headers()).get('user-agent')));
}
