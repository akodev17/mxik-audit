// Multipart uploads with the registry's caps: multer memory storage (@nestjs/platform-express),
// files kept per field on `req.parts`, text fields on `req.body`. A file over its cap is not a 413:
// the old actions answered "too big" in the user's language next to their other refusals (and
// after the demo and role checks), so the part is kept with its name and no bytes, and the
// domain refuses it like before. Each upload holds one of upload-slots.ts's slots from before its
// body is read until its handler is done (F13).
import {
  createParamDecorator, Injectable, mixin, PayloadTooLargeException,
  type CallHandler, type ExecutionContext, type NestInterceptor, type Type,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { finalize, type Observable } from 'rxjs';
import type { Multipart } from '@tasnivo/contracts';
import type { UploadedFile } from '@tasnivo/domain/catalog-upload';
import type { ApiRequest } from './request';
import { acquireUploadSlot } from './upload-slots';

/** One received file part; `buffer` null when it was over the cap (`size` is then cap + 1). */
export type Part = { field: string; name: string; size: number; buffer: Buffer | null };

type MulterFile = { fieldname: string; originalname: string; size: number; buffer: Buffer };
type UploadRequest = ApiRequest & { parts?: Record<string, Part>; seenParts?: { field: string; name: string }[]; files?: unknown };

/** Text fields of a multipart form beyond these are refused (400), like an oversized field value. */
const FIELD_LIMITS = { fields: 20, fieldSize: 64 * 1024, parts: 40 };

/** An interceptor class for one endpoint's `multipart` definition: `@UseInterceptors(MultipartInterceptor(e.multipart))`. */
export function MultipartInterceptor(multipart: Multipart): Type<NestInterceptor> {
  const caps = Object.entries(multipart.files);
  const maxBytes = Math.max(...caps.map(([, f]) => f.maxBytes));
  const Multer = AnyFilesInterceptor({
    limits: { fileSize: maxBytes, files: caps.length, ...FIELD_LIMITS },
    // Browsers send the file name as raw UTF-8 (Cyrillic and Uzbek names); busboy's default is latin1.
    defParamCharset: 'utf8',
    fileFilter: (req: UploadRequest, file: { fieldname: string; originalname: string }, accept: (error: Error | null, take: boolean) => void) => {
      (req.seenParts ??= []).push({ field: file.fieldname, name: file.originalname });
      // Parts the endpoint does not define are read past and dropped, as FormData.get() ignored them.
      accept(null, Object.hasOwn(multipart.files, file.fieldname));
    },
  });

  @Injectable()
  class Interceptor implements NestInterceptor {
    private readonly multer = new Multer();

    async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      const req = ctx.switchToHttp().getRequest<UploadRequest>();
      const parts: Record<string, Part> = {};
      const release = await acquireUploadSlot(req);
      try {
        await this.multer.intercept(ctx, { handle: () => undefined as unknown as Observable<unknown> });
      } catch (error) {
        // multer stops at the part over the cap: the last one it saw.
        const over = req.seenParts?.at(-1);
        const cap = over ? multipart.files[over.field]?.maxBytes : undefined;
        if (!(error instanceof PayloadTooLargeException) || !over || cap === undefined) {
          release();
          throw error;
        }
        parts[over.field] = { field: over.field, name: over.name, size: cap + 1, buffer: null };
      }
      for (const file of (Array.isArray(req.files) ? req.files : []) as MulterFile[]) {
        const cap = multipart.files[file.fieldname]?.maxBytes;
        if (cap === undefined || parts[file.fieldname]) continue;
        parts[file.fieldname] = file.size > cap
          ? { field: file.fieldname, name: file.originalname, size: file.size, buffer: null }
          : { field: file.fieldname, name: file.originalname, size: file.size, buffer: file.buffer };
      }
      req.parts = parts;
      req.body ??= {};
      return next.handle().pipe(finalize(release));
    }
  }
  return mixin(Interceptor);
}

/** `@FilePart('file')`: the part as the domain's UploadedFile, or null when none was sent. */
export const FilePart = createParamDecorator((field: string, ctx: ExecutionContext): UploadedFile | null => {
  const part = ctx.switchToHttp().getRequest<UploadRequest>().parts?.[field];
  if (!part) return null;
  const { buffer } = part;
  return {
    name: part.name,
    size: part.size,
    read: () => (buffer ? Promise.resolve(buffer) : Promise.reject(new Error(`${field}: over the upload cap`))),
  };
});
