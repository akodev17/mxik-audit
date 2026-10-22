// Callback of the Telegram Login Widget in Settings → Security: binds the signed-in user's own
// Telegram account for signing in. The rules (one-time state, signature, replay) are
// @tasnivo/domain/telegram/login-callbacks, shared with the API.
import type { NextRequest } from 'next/server';
import { redirectTo } from '@/lib/security/redirect';
import { currentUser, getSession } from '@/lib/session';
import { telegramBindCallback } from '@tasnivo/domain/telegram/login-callbacks';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  const data = Object.fromEntries(request.nextUrl.searchParams.entries());
  return redirectTo(await telegramBindCallback(await getSession(), await currentUser(), state, data));
}
