// The link in the confirmation email: confirms the address and signs the user in.
import { redirectTo } from '@/lib/security/redirect';
import { openSession } from '@/lib/security/sign-in';
import { confirmEmail } from '@tasnivo/domain/security/verification';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await confirmEmail(token);
  // The notice on the sign-in page offers a new link.
  if (!user) return redirectTo('/sign-in?error=verify');
  const next = await openSession({ id: user.userId, orgId: user.orgId, email: user.email }, { via: 'email', landing: '/dashboard' });
  return redirectTo(next ?? '/sign-in');
}
