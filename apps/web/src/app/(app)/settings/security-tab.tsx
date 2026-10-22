import { serverApi } from '@/lib/api/server';
import { SecurityPanel } from './security-panel';

/** Two-factor, password, Telegram sign-in and sessions; everything loaded here so the panel needs no round trip. */
export async function SecurityTab() {
  const api = serverApi();
  const [twoFactor, sessions, extras] = await Promise.all([api.auth.twoFactorState(), api.auth.sessions(), api.auth.security()]);
  return <SecurityPanel initial={{ twoFactor, sessions, extras }} />;
}
