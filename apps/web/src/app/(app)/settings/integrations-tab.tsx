import type { Me } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Section } from '@/ui/page';
import { ApiKeysPanel } from './api-keys-panel';
import { TelegramPanel } from './telegram-panel';

/** Admin only: Telegram notification chats and API keys. */
export async function IntegrationsTab({ user }: { user: Me }) {
  if (user.role !== 'admin') return null;
  const { ta } = await getI18n();
  const s = ta.setX.integrations;
  const [telegram, keys] = await Promise.all([serverApi().account.telegramLinks(), serverApi().account.apiKeys()]);

  return (
    <>
      {/* Without a bot there is nothing to link, so the section is not shown. */}
      {telegram.enabled ? (
        <Section title={s.telegram} hint={s.telegramHint}>
          <TelegramPanel initial={telegram} />
        </Section>
      ) : null}

      <Section title={s.api}>
        <ApiKeysPanel initial={keys} />
      </Section>
    </>
  );
}
