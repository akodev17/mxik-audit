import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  const session = await getSession();
  if (session.sid) await db.userSession.updateMany({ where: { id: session.sid, revokedAt: null }, data: { revokedAt: new Date() } });
  session.destroy();
  return NextResponse.redirect(new URL('/sign-in', request.url));
}
