// A domain download (@tasnivo/domain/catalog-exports) as the response: the old route's headers
// (Content-Type, Content-Disposition with the same file name, Cache-Control) and the bytes, or its
// refusal as the error envelope with the same status.
import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { Download, FileOut } from '@tasnivo/domain/catalog-exports';
import { ApiError } from './errors';

export function sendFile(res: Response, file: FileOut): StreamableFile {
  res.set(file.headers);
  return new StreamableFile(typeof file.body === 'string' ? Buffer.from(file.body, 'utf8') : Buffer.from(file.body.buffer, file.body.byteOffset, file.body.byteLength));
}

export function sendDownload(res: Response, download: Download): StreamableFile {
  if (!download.ok) throw new ApiError(download.status, download.code, download.message);
  return sendFile(res, download.file);
}

/** One query-string value as the old routes read it (searchParams.get): the first, or null. */
export function queryValue(value: unknown): string | null {
  const first: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  return typeof first === 'string' ? first : null;
}
