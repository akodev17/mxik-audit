// Click Prepare/Complete callback (one URL for both; "action" tells them
// apart). 404 while Click is not configured.
import { NextResponse } from 'next/server';
import { billingConfig } from '@/lib/billing/config';
import { CLICK_ERRORS, handleClick } from '@/lib/billing/click';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = billingConfig().click;
  if (!config) return NextResponse.json({ error: 'click disabled' }, { status: 404 });
  let fields: Record<string, string>;
  try {
    const form = new URLSearchParams(await request.text());
    fields = Object.fromEntries(form.entries());
  } catch {
    return NextResponse.json(CLICK_ERRORS.request);
  }
  return NextResponse.json(await handleClick(fields, config));
}
