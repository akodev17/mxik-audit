// Telegram webhook. Off (404) without TELEGRAM_BOT_TOKEN; refuses to run
// without TELEGRAM_WEBHOOK_SECRET, since anyone could otherwise post fake
// updates claiming to be a linked chat.
import { NextResponse } from 'next/server';
import { telegramConfig } from '@tasnivo/domain/telegram/config';
import { webhookHandler } from '@tasnivo/domain/telegram/webhook';

export const dynamic = 'force-dynamic';

let handler: ((request: Request) => Promise<Response>) | null = null;

export async function POST(request: Request) {
  const config = telegramConfig();
  if (!config.enabled) return NextResponse.json({ error: 'telegram disabled' }, { status: 404 });
  if (!config.webhookSecret) return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET not set' }, { status: 503 });
  handler ??= webhookHandler(config, config.webhookSecret, 'std/http');
  return handler(request);
}
