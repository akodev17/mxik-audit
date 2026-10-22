// Payme Merchant API endpoint (JSON-RPC). 404 while Payme is not configured.
import { NextResponse } from 'next/server';
import { billingConfig } from '@tasnivo/domain/billing/config';
import { answerPayme } from '@tasnivo/domain/billing/payme';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = billingConfig().payme;
  if (!config) return NextResponse.json({ error: 'payme disabled' }, { status: 404 });
  const body = await request.json().then((json: unknown) => ({ json }), () => null);
  return NextResponse.json(await answerPayme(body, request.headers.get('authorization'), config));
}
