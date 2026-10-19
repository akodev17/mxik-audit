import { getSession } from '@/lib/session';
import { redirectTo } from '@/lib/security/redirect';
import { endRecord } from '@/lib/security/session-store';

export async function POST() {
  const session = await getSession();
  if (session.sid) await endRecord(session.sid);
  session.destroy();
  return redirectTo('/sign-in', 303);
}
