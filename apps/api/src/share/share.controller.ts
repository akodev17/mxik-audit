// endpoints.share: the read-only report behind a share link and its PDF. No session: the token in
// the path is the credential, checked by the domain (resolveShare: live, not expired or revoked,
// account open). Anything else is 404. Reading the report counts one view (countView), as the
// share page's render did.
import { Controller, Param, Res, type StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { endpoints } from '@tasnivo/contracts';
import { sharePdf } from '@tasnivo/domain/catalog-exports';
import { shareView } from '@tasnivo/domain/catalog-pages';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { Locale } from '../http/decorators';
import { sendDownload } from '../http/download';
import { Endpoint } from '../http/endpoint';
import { found } from '../http/payload';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.share;
type TokenPath = z.output<typeof e.view.params>;

@ApiTags('share')
@Controller()
export class ShareController {
  @Endpoint(e.view)
  async view(@Param(new ZodValidationPipe(e.view.params)) { token }: TokenPath, @Res({ passthrough: true }) res: Response) {
    // The share page asked search engines and referrers to leave it alone; so does its data.
    res.set({ 'x-robots-tag': 'noindex', 'cache-control': 'private, no-store' });
    return found(await shareView(token));
  }

  /** The old /r/<token>/pdf. */
  @Endpoint(e.pdf)
  async pdf(@Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.pdf.params)) { token }: TokenPath, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendDownload(res, await sharePdf(token, locale));
  }
}
