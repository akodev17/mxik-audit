import { NextResponse } from 'next/server';
import { appOrigin } from '@tasnivo/domain/app-url';
import { openApiSpec } from '@tasnivo/domain/api/openapi';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return NextResponse.json(openApiSpec(appOrigin() ?? new URL(request.url).origin));
}
