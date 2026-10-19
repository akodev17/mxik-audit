import { securityExtras } from '@/app/actions/security';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { deviceLabel } from '@/lib/security/device';
import { listSessions } from '@/lib/security/session-store';
import { twoFactorState } from '@/lib/security/two-factor';
import { getSession, type CurrentUser } from '@/lib/session';
import { SecurityPanel } from './security-panel';

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
      sessions={sessions.map((s) => ({
        id: s.id, device: deviceLabel(s.userAgent), current: s.id === session.sid,
        created: fmtDate(locale, s.createdAt), seen: fmtDateTime(locale, s.lastSeenAt),
      }))}
    />
  );
}
