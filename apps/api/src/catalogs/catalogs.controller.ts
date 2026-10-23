// endpoints.catalogs: the upload wizard, progress, the list and header, versions and diff, the
// report, share links and review assignment. Downloads are in exports.controller.ts. Thin: parse
// the path and query, call @tasnivo/domain (catalog-upload, catalog-pages, catalog-review, share),
// map "not yours / missing" to 404. Bodies go to the domain as they came, like the actions' payloads:
// it validates them with the same schemas and answers a bad one with the action's own refusal.
import { Body, Controller, Inject, Param, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { endpoints } from '@tasnivo/contracts';
import {
  catalogDiff, catalogHeader, catalogListPage, catalogPreview, catalogProgress, catalogReport, catalogReview, catalogSummary, catalogVersions, uploadOptions,
} from '@tasnivo/domain/catalog-pages';
import { assignCatalogReview, finishCatalogReview } from '@tasnivo/domain/catalog-review';
import {
  commitCatalogUpload, diagnoseCatalogUpload, discardCatalogUpload, previewCatalogUpload, removeCatalogFor, retryCatalogAudit,
  type UploadedFile,
} from '@tasnivo/domain/catalog-upload';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import { shareAllowed, shareCreateFor, shareRevokeFor, shareRows } from '@tasnivo/domain/share';
import { i18nFor } from '@tasnivo/i18n/locale';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { SessionService } from '../auth-core/session.service';
import { CurrentUser, Locale } from '../http/decorators';
import { Route } from '../http/route';
import { ApiError } from '../http/errors';
import { FilePart, MultipartInterceptor } from '../http/multipart';
import { found, notFound, withPath } from '../http/payload';
import type { ApiRequest } from '../http/request';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.catalogs;
type CatalogPath = z.output<typeof e.get.params>;

@ApiTags('catalogs')
@Controller()
export class CatalogsController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  @Route(e.list)
  list(@CurrentUser() user: User, @Query(new ZodValidationPipe(e.list.query)) query: z.output<typeof e.list.query>) {
    return catalogListPage(user, query);
  }

  @Route(e.previewUpload)
  @UseInterceptors(MultipartInterceptor(e.previewUpload.multipart))
  previewUpload(
    @CurrentUser() user: User,
    @Locale() locale: LocaleCode,
    @FilePart('file') file: UploadedFile | null,
    @Body(new ZodValidationPipe(e.previewUpload.multipart.fields)) fields: z.output<typeof e.previewUpload.multipart.fields>,
  ) {
    return previewCatalogUpload(user, locale, { file, clientId: fields.clientId || null });
  }

  @Route(e.uploadOptions)
  uploadOptions(@CurrentUser() user: User) {
    return uploadOptions(user);
  }

  @Route(e.preview)
  preview(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.preview.params)) { catalogId }: CatalogPath) {
    return catalogPreview(user, catalogId);
  }

  @Route(e.diagnose)
  diagnose(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.diagnose.params)) { catalogId }: CatalogPath, @Body() body: unknown) {
    return diagnoseCatalogUpload(user, locale, withPath(body, { catalogId }));
  }

  /** Starts the audit through jobs(); the catalogue's client becomes the session's active client, as the action did. */
  @Route(e.commit)
  async commit(
    @CurrentUser() user: User,
    @Locale() locale: LocaleCode,
    @Param(new ZodValidationPipe(e.commit.params)) { catalogId }: CatalogPath,
    @Body() body: unknown,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { result, clientId } = await commitCatalogUpload(user, locale, withPath(body, { catalogId }));
    if (result.ok && clientId && clientId !== user.clientId) {
      const session = await this.sessions.read(req);
      if (session.userId) await this.sessions.write(res, { ...session, clientId });
    }
    return result;
  }

  @Route(e.discard)
  discard(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.discard.params)) { catalogId }: CatalogPath) {
    return discardCatalogUpload(user, locale, catalogId);
  }

  /** The former /upload/progress: 404 for a catalogue the user may not see; resumes a stalled audit. */
  @Route(e.progress)
  async progress(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.progress.params)) { catalogId }: CatalogPath) {
    return found(await catalogProgress(user, catalogId));
  }

  @Route(e.retry)
  retry(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.retry.params)) { catalogId }: CatalogPath) {
    return retryCatalogAudit(user, catalogId);
  }

  @Route(e.remove)
  remove(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.remove.params)) { catalogId }: CatalogPath) {
    return removeCatalogFor(user, locale, catalogId);
  }

  @Route(e.get)
  async get(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.get.params)) { catalogId }: CatalogPath) {
    return found(await catalogHeader(user, catalogId));
  }

  @Route(e.summary)
  async summary(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.summary.params)) { catalogId }: CatalogPath) {
    return found(await catalogSummary(user, catalogId));
  }

  @Route(e.versions)
  async versions(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.versions.params)) { catalogId }: CatalogPath) {
    return found(await catalogVersions(user, catalogId));
  }

  /** Null when there is nothing to compare with; 404 for a catalogue the user may not see. */
  @Route(e.diff)
  async diff(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(e.diff.params)) { catalogId }: CatalogPath,
    @Query(new ZodValidationPipe(e.diff.query)) query: z.output<typeof e.diff.query>,
  ) {
    const { found: visible, diff } = await catalogDiff(user, catalogId, query);
    if (!visible) throw notFound();
    return diff;
  }

  @Route(e.report)
  async report(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.report.params)) { catalogId }: CatalogPath) {
    const read = await catalogReport(user, catalogId);
    if (read.ok) return read.report;
    throw read.reason === 'not_ready' ? new ApiError(409, 'audit_not_finished', 'audit not finished') : notFound();
  }

  @Route(e.shareLinks)
  shareLinks(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.shareLinks.params)) { catalogId }: CatalogPath) {
    return shareRows(user, catalogId);
  }

  @Route(e.createShareLink)
  async createShareLink(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.createShareLink.params)) { catalogId }: CatalogPath, @Body() body: unknown) {
    if (!(await shareAllowed(user))) {
      const { prX } = i18nFor(locale).ta;
      throw new ApiError(403, 'plan_feature', prX.notInPlan(prX.features.clientLinks));
    }
    return shareCreateFor(user, withPath(body, { catalogId }));
  }

  @Route(e.revokeShareLink)
  revokeShareLink(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.revokeShareLink.params)) { linkId }: z.output<typeof e.revokeShareLink.params>) {
    return shareRevokeFor(user, linkId);
  }

  @Route(e.review)
  async review(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.review.params)) { catalogId }: CatalogPath) {
    return found(await catalogReview(user, catalogId));
  }

  @Route(e.assignReview)
  assignReview(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.assignReview.params)) { catalogId }: CatalogPath, @Body() body: unknown) {
    return assignCatalogReview(user, locale, withPath(body, { catalogId }));
  }

  @Route(e.finishReview)
  finishReview(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.finishReview.params)) { catalogId }: CatalogPath, @Body() body: unknown) {
    return finishCatalogReview(user, locale, withPath(body, { catalogId }));
  }
}

