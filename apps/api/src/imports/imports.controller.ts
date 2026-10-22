// endpoints.imports: a client's purchase lists and cheque / sales lists (upload, map, restart,
// remove), the activity type, the list screens' data and the blank templates. Thin: parse the path
// and query, call @tasnivo/domain (list-upload, list-pages, catalog-exports). Bodies go to the
// domain as they came, like the actions' payloads, so a bad one gets the action's own refusal.
import { Body, Controller, Param, Query, Res, UseInterceptors, type StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { endpoints } from '@tasnivo/contracts';
import { docTemplate, purchaseTemplate } from '@tasnivo/domain/catalog-exports';
import type { UploadedFile } from '@tasnivo/domain/catalog-upload';
import { docListsPage, docReport, purchaseListsPage } from '@tasnivo/domain/list-pages';
import {
  applyDocFile, applyPurchaseFile, removeDocFile, removePurchaseFile, restartDocFile, setActivityFor, uploadDocFile, uploadPurchaseFile,
} from '@tasnivo/domain/list-upload';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { CurrentUser, Locale } from '../http/decorators';
import { queryValue, sendFile } from '../http/download';
import { Route } from '../http/route';
import { FilePart, MultipartInterceptor } from '../http/multipart';
import { found, withPath } from '../http/payload';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.imports;
type ClientPath = z.output<typeof e.purchases.params>;
type ListPath = z.output<typeof e.applyPurchases.params>;

@ApiTags('imports')
@Controller()
export class ImportsController {
  @Route(e.purchases)
  async purchases(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.purchases.params)) { clientId }: ClientPath) {
    return found(await purchaseListsPage(user, clientId));
  }

  @Route(e.uploadPurchases)
  @UseInterceptors(MultipartInterceptor(e.uploadPurchases.multipart))
  uploadPurchases(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(new ZodValidationPipe(e.uploadPurchases.params)) { clientId }: ClientPath,
    @FilePart('file') file: UploadedFile | null,
  ) {
    return uploadPurchaseFile(user, locale, { clientId, file });
  }

  @Route(e.applyPurchases)
  applyPurchases(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.applyPurchases.params)) { listId }: ListPath, @Body() body: unknown) {
    return applyPurchaseFile(user, locale, withPath(body, { listId }));
  }

  @Route(e.removePurchases)
  removePurchases(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.removePurchases.params)) { listId }: ListPath) {
    return removePurchaseFile(user, locale, listId);
  }

  @Route(e.setActivity)
  setActivity(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.setActivity.params)) { clientId }: ClientPath, @Body() body: unknown) {
    return setActivityFor(user, withPath(body, { clientId }));
  }

  @Route(e.docs)
  async docs(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(e.docs.params)) { clientId }: ClientPath,
    @Query(new ZodValidationPipe(e.docs.query)) { kind }: z.output<typeof e.docs.query>,
  ) {
    return found(await docListsPage(user, clientId, kind));
  }

  @Route(e.uploadDoc)
  @UseInterceptors(MultipartInterceptor(e.uploadDoc.multipart))
  uploadDoc(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(new ZodValidationPipe(e.uploadDoc.params)) { clientId }: ClientPath,
    @FilePart('file') file: UploadedFile | null,
    @Body() fields: Record<string, unknown>,
  ) {
    // An unknown kind is refused by the domain with the action's message, not a 400.
    return uploadDocFile(user, locale, { clientId, kind: fields['kind'], file });
  }

  @Route(e.doc)
  async doc(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(e.doc.params)) { listId }: ListPath,
    @Query(new ZodValidationPipe(e.doc.query)) { issue }: z.output<typeof e.doc.query>,
  ) {
    return found(await docReport(user, listId, issue));
  }

  @Route(e.applyDoc)
  applyDoc(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.applyDoc.params)) { listId }: ListPath, @Body() body: unknown) {
    return applyDocFile(user, locale, withPath(body, { listId }));
  }

  @Route(e.restartDoc)
  restartDoc(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.restartDoc.params)) { listId }: ListPath) {
    return restartDocFile(user, locale, listId);
  }

  @Route(e.removeDoc)
  removeDoc(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.removeDoc.params)) { listId }: ListPath) {
    return removeDocFile(user, locale, listId);
  }

  /** Kept URL /api/doc-template; any kind but "sales" is the cheque template, as before. */
  @Route(e.docTemplate)
  async docTemplate(@Locale() locale: LocaleCode, @Query() q: Record<string, unknown>, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendFile(res, await docTemplate(locale, queryValue(q['kind']) === 'sales' ? 'sales' : 'cheques'));
  }

  @Route(e.purchaseTemplate)
  async purchaseTemplate(@Locale() locale: LocaleCode, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendFile(res, await purchaseTemplate(locale));
  }
}
