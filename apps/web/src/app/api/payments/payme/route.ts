// Payme Merchant API endpoint (JSON-RPC). 404 while Payme is not configured.
import { NextResponse } from 'next/server';
import { billingConfig } from '@/lib/billing/config';
import { handlePayme, PAYME_ERRORS, paymeAuthorized } from '@/lib/billing/payme';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = billingConfig().payme;
  if (!config) return NextResponse.json({ error: 'payme disabled' }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: PAYME_ERRORS.parse });
  }
  const id = typeof body === 'object' && body !== null ? (body as { id?: unknown }).id ?? null : null;
  // Payme expects HTTP 200 with a JSON-RPC error, not a 401.
  if (!paymeAuthorized(request.headers.get('authorization'), config)) {
    return NextResponse.json({ jsonrpc: '2.0', id, error: PAYME_ERRORS.auth });
  }
  return NextResponse.json(await handlePayme(body));
}
