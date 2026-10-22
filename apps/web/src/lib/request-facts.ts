// The request facts the domain's forms take as arguments (client address, user agent, language),
// read through Next for server actions and route handlers.
import { headers } from 'next/headers';
import { clientIp } from '@tasnivo/domain/security/client-ip';
import type { RequestFacts } from '@tasnivo/domain/security/auth-forms';
import { getLocale } from './locale';

export async function requestFacts(): Promise<RequestFacts> {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get('user-agent'), locale: await getLocale() };
}
