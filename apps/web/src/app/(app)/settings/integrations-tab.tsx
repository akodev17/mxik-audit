import type { Me } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { ApiKeysPanel } from './api-keys-panel';
import { TelegramPanel } from './telegram-panel';

/** Admin only: Telegram notification chats and API keys. */
export async function IntegrationsTab({ user }: { user: Me }) {
  if (user.role !== 'admin') return null;
  const { ta } = await getI18n();
  const s = ta.setX.integrations;
  const [telegram, keys] = await Promise.all([serverApi().account.telegramLinks(), serverApi().account.apiKeys()]);

  return (
    <div className="space-y-4">
      {/* Without a bot there is nothing to link, so the card is not shown. */}
      {telegram.enabled ? <TelegramPanel initial={telegram} title={s.telegram} hint={s.telegramHint} /> : null}
      <ApiKeysPanel initial={keys} title={s.api} />
    </div>
  );
}
