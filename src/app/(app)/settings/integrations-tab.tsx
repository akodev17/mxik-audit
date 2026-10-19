import { isAdminRole } from '@/lib/access';
import { apiConfig, monthlyCheckCap, usageThisMonth } from '@/lib/api/limits';
import { listApiKeys, MAX_ACTIVE_KEYS } from '@/lib/api/keys';
import { db } from '@/lib/db';
import { fmtDate, fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { planStatus } from '@/lib/plan';
import type { CurrentUser } from '@/lib/session';
import { telegramConfig } from '@/lib/telegram/config';
import { Section } from '@/ui/page';
import { ApiKeysPanel } from './api-keys-panel';
import { TelegramPanel } from './telegram-panel';

/** Admin only: Telegram notification chats and API keys. */
export async function IntegrationsTab({ user }: { user: CurrentUser }) {
  if (!isAdminRole(user)) return null;
  const { locale, ta } = await getI18n();
  const s = ta.setX.integrations;
  const tg = telegramConfig();
  const [links, members, keys, usage, status] = await Promise.all([
    db.telegramLink.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, username: true, createdAt: true, linkedBy: true } }),
    db.user.findMany({ where: { orgId: user.orgId }, select: { id: true, email: true } }),
    listApiKeys(user.orgId),
    usageThisMonth(user.orgId),
    planStatus(user.orgId),
  ]);
  const emailOf = new Map(members.map((m) => [m.id, m.email]));
  const n = (v: number): string => fmtNumber(locale, v);
  const cap = monthlyCheckCap(status.state, apiConfig());

  return (
    <>
      {/* Without a bot there is nothing to link, so the section is not shown. */}
      {tg.enabled ? (
        <Section title={s.telegram} hint={s.telegramHint}>
          <TelegramPanel
            bot={tg.username}
            chats={links.map((l) => ({ id: l.id, username: l.username, linked: fmtDate(locale, l.createdAt), by: l.linkedBy ? emailOf.get(l.linkedBy) ?? null : null }))}
          />
        </Section>
      ) : null}

      <Section title={s.api}>
        <ApiKeysPanel
          max={MAX_ACTIVE_KEYS}
          usage={{ checks: n(usage.checks), requests: n(usage.requests), cap: cap === null ? null : n(cap) }}
          keys={keys.map((k) => ({
            id: k.id, name: k.name, prefix: k.prefix, created: fmtDate(locale, k.createdAt),
            lastUsed: k.lastUsedAt ? fmtDate(locale, k.lastUsedAt) : null, revoked: k.revokedAt !== null, checks: n(k.checksThisMonth),
            // Admins see whose keys exist; a creator who left the team no longer resolves to an email.
            creator: k.createdBy ? emailOf.get(k.createdBy) ?? null : null,
            creatorRemoved: k.createdBy !== null && !emailOf.has(k.createdBy),
          }))}
        />
      </Section>
    </>
  );
}
