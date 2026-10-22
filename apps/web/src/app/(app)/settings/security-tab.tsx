import { securityExtras } from '@/app/actions/security';
import { fmtDateTime } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { deviceLabel } from '@/lib/security/device';
import { listSessions } from '@/lib/security/session-store';
import { twoFactorState } from '@/lib/security/two-factor';
import { getSession, type CurrentUser } from '@/lib/session';
import { SecurityPanel } from './security-panel';
import { agoLabel, orderSessions } from './session-rows';

/** Two-factor, password, Telegram sign-in and sessions; everything loaded here so the panel needs no round trip. */
export async function SecurityTab({ user }: { user: CurrentUser }) {
  const { locale } = await getI18n();
  const [state, sessions, extras, session] = await Promise.all([
    twoFactorState(user.userId), listSessions(user.userId), securityExtras(), getSession(),
  ]);
  return (
    <SecurityPanel
      {...state}
      extras={extras}
      sessions={orderSessions(sessions, session.sid).map((s) => ({
        id: s.id, device: deviceLabel(s.userAgent), current: s.id === session.sid,
        created: fmtDateTime(locale, s.createdAt),
        seen: agoLabel(locale, s.lastSeenAt) ?? fmtDateTime(locale, s.lastSeenAt),
        seenAt: fmtDateTime(locale, s.lastSeenAt),
      }))}
    />
  );
}
