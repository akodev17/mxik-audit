// The catalogue downloads at their kept URLs (/api/export, /api/catalog-diff, /api/catalog-report-csv,
// /api/report-pdf): links in e-mails, bookmarks and the web app point at them. The query is read
// the way the old routes read it (an unknown format means xlsx, audience=client or internal,
// download=1 or inline), so every link that worked keeps working; the files and refusals come
// from @tasnivo/domain/catalog-exports, shared with the web routes. Exports of big catalogues take
// minutes: nothing here sets a timeout.
import { Controller, Query, Res, type StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { endpoints } from '@tasnivo/contracts';
import { catalogDiffCsv, catalogExport, catalogReportCsv, catalogReportPdf } from '@tasnivo/domain/catalog-exports';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { CurrentUser, Locale } from '../http/decorators';
import { queryValue, sendDownload } from '../http/download';
import { Route } from '../http/route';

const e = endpoints.catalogs;
type RawQuery = Record<string, unknown>;

@ApiTags('catalogs')
@Controller()
export class ExportsController {
  @Route(e.exportFile)
  async exportFile(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Query() q: RawQuery, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendDownload(res, await catalogExport(user, locale, queryValue(q['catalog']), queryValue(q['format'])));
  }

  @Route(e.exportDiffCsv)
  async exportDiffCsv(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Query() q: RawQuery, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendDownload(res, await catalogDiffCsv(user, locale, queryValue(q['catalog']), queryValue(q['with'])));
  }

  @Route(e.exportReportCsv)
  async exportReportCsv(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Query() q: RawQuery, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendDownload(res, await catalogReportCsv(user, locale, queryValue(q['catalog'])));
  }

  @Route(e.exportPdf)
  async exportPdf(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Query() q: RawQuery, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendDownload(res, await catalogReportPdf(user, locale, queryValue(q['catalog']), {
      audience: queryValue(q['audience']) === 'client' ? 'client' : 'internal',
      download: queryValue(q['download']) === '1',
    }));
  }
}
