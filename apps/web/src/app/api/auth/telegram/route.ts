// Callback of the Telegram Login Widget on the sign-in page. The rules (who signs in, when a trial
// account opens) are @tasnivo/domain/telegram/login-callbacks, shared with the API.
import type { NextRequest } from 'next/server';
import { clientIp } from '@tasnivo/domain/security/client-ip';
import { redirectTo } from '@/lib/security/redirect';
import { getSession } from '@/lib/session';
import { telegramSignIn } from '@tasnivo/domain/telegram/login-callbacks';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const data = Object.fromEntries(request.nextUrl.searchParams.entries());
  return redirectTo(await telegramSignIn(await getSession(), data, { ip: clientIp(request.headers), userAgent: request.headers.get('user-agent') }));
}
