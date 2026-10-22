// A domain download (@tasnivo/domain/catalog-exports) as the route handler's response: the file
// with its headers, or the old routes' `{ error }` JSON with the refusal's status.
import { NextResponse } from 'next/server';
import type { Download, FileOut } from '@tasnivo/domain/catalog-exports';

export function fileResponse(file: FileOut): NextResponse {
  return new NextResponse(typeof file.body === 'string' ? file.body : new Uint8Array(file.body), { headers: file.headers });
}

export function downloadResponse(download: Download): NextResponse {
  if (download.ok) return fileResponse(download.file);
  // The demo limit was the one refusal sent with its own no-store header.
  return NextResponse.json({ error: download.message }, { status: download.status, ...(download.status === 429 ? { headers: { 'cache-control': 'no-store' } } : {}) });
}
