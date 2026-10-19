// The link in the confirmation email: confirms the address and signs the user in.
import { NextResponse } from 'next/server';
import { openSession } from '@/lib/security/sign-in';
import { confirmEmail } from '@/lib/signup';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(request.url).origin;
  const user = await confirmEmail(token);
  if (!user) return NextResponse.redirect(`${origin}/sign-in?error=verify`);
  const next = await openSession({ id: user.userId, orgId: user.orgId, email: user.email }, { via: 'email', landing: '/dashboard' });
  return NextResponse.redirect(`${origin}${next ?? '/sign-in'}`);
}
