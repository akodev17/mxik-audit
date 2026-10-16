// The link in the confirmation email: confirms the address and signs the user in.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { confirmEmail } from '@/lib/signup';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(request.url).origin;
  const user = await confirmEmail(token);
  if (!user) return NextResponse.redirect(`${origin}/sign-in?error=verify`);
  const session = await getSession();
  session.userId = user.userId;
  session.orgId = user.orgId;
  session.email = user.email;
  session.demo = false;
  session.clientId = undefined;
  await session.save();
  return NextResponse.redirect(`${origin}/dashboard`);
}
