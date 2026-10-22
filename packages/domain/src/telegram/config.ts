// Telegram bot settings from the environment. Unset token = bot fully off:
// no webhook, no delivery, and the settings page says so.
export type TelegramConfig = {
  enabled: boolean;
  token: string | null;
  /** Required for webhook mode: Telegram echoes it in a header on every update. */
  webhookSecret: string | null;
  /** Public origin for links in messages, e.g. https://mxikaudit.uz. */
  appUrl: string | null;
  /** The bot's @username, shown on the settings page. */
  username: string | null;
  /** Bot API endpoint; a self-hosted Bot API server lifts the 20 MB file limit. */
  apiRoot: string;
};

export function telegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig {
  const token = env['TELEGRAM_BOT_TOKEN']?.trim() || null;
  const appUrl = (env['APP_URL'] ?? env['NEXT_PUBLIC_SITE_URL'])?.trim().replace(/\/+$/, '') || null;
  return {
    enabled: token !== null,
    token,
    webhookSecret: env['TELEGRAM_WEBHOOK_SECRET']?.trim() || null,
    appUrl: appUrl && /^https?:\/\//.test(appUrl) ? appUrl : null,
    username: env['TELEGRAM_BOT_USERNAME']?.trim().replace(/^@/, '') || null,
    apiRoot: env['TELEGRAM_API_ROOT']?.trim().replace(/\/+$/, '') || 'https://api.telegram.org',
  };
}

/** Absolute link into the app, or null when no public origin is configured. */
export function appLink(config: TelegramConfig, path: string): string | null {
  return config.appUrl ? `${config.appUrl}${path}` : null;
}
