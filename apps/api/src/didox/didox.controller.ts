// endpoints.didox: Didox incoming invoices (Agent 3). Thin: parse the path and query, call
// @tasnivo/domain/didox/*, map a null to 404 and a file refusal to 409. Upload bodies and decision
// bodies go to the domain as they came; the domain validates them and answers its own refusal.
import { Body, Controller, Param, Query, Res, UseInterceptors, type StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { endpoints } from '@tasnivo/contracts';
import type { UploadedFile } from '@tasnivo/domain/catalog-upload';
import { getConnection, passwordLogin, removeConnection, saveConnection, syncIncoming, testConnection } from '@tasnivo/domain/didox/connection';
import {
  approveMany, commitDidoxSheet, decideLine, exportInvoice, invoiceDetail, invoicePdf, listInvoices, prepareInvoice, removeInvoice, suggestMxik, uploadDidoxFile,
} from '@tasnivo/domain/didox/service';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { CurrentUser, Locale } from '../http/decorators';
import { sendFile } from '../http/download';
import { ApiError } from '../http/errors';
import { FilePart, MultipartInterceptor } from '../http/multipart';
import { found } from '../http/payload';
import { Route } from '../http/route';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.didox;
type BatchPath = z.output<typeof e.get.params>;
type RecordPath = z.output<typeof e.decide.params>;

@ApiTags('didox')
@Controller()
export class DidoxController {
  @Route(e.list)
  async list(@CurrentUser() user: User, @Query(new ZodValidationPipe(e.list.query)) query: z.output<typeof e.list.query>) {
    const [page, connection] = await Promise.all([listInvoices(user, query), getConnection(user)]);
    return { ...page, connection: { connected: connection.connected, lastSyncAt: connection.lastSyncAt, lastError: connection.lastError } };
  }

  @Route(e.upload)
  @UseInterceptors(MultipartInterceptor(e.upload.multipart))
  upload(@CurrentUser() user: User, @Locale() locale: LocaleCode, @FilePart('file') file: UploadedFile | null, @Body() fields: Record<string, unknown>) {
    return uploadDidoxFile(user, locale, { file, clientId: fields['clientId'] });
  }

  @Route(e.commitSheet)
  @UseInterceptors(MultipartInterceptor(e.commitSheet.multipart))
  commitSheet(@CurrentUser() user: User, @Locale() locale: LocaleCode, @FilePart('file') file: UploadedFile | null, @Body() fields: Record<string, unknown>) {
    return commitDidoxSheet(user, locale, { file, clientId: fields['clientId'], map: fields['map'], header: fields['header'] });
  }

  @Route(e.get)
  async get(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.get.params)) { batchId }: BatchPath) {
    return found(await invoiceDetail(user, batchId));
  }

  @Route(e.pdf)
  async pdf(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.pdf.params)) { batchId }: BatchPath, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendFile(res, found(await invoicePdf(user, batchId)));
  }

  @Route(e.remove)
  async remove(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.remove.params)) { batchId }: BatchPath) {
    return { ok: await removeInvoice(user, batchId) };
  }

  @Route(e.decide)
  decide(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.decide.params)) { recordId }: RecordPath, @Body() body: unknown) {
    return decideLine(user, locale, recordId, body);
  }

  @Route(e.suggestion)
  async suggestion(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.suggestion.params)) { recordId }: RecordPath) {
    return found(await suggestMxik(user, recordId));
  }

  @Route(e.approveMany)
  approveMany(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(new ZodValidationPipe(e.approveMany.params)) { batchId }: BatchPath,
    @Body(new ZodValidationPipe(e.approveMany.body)) { scope }: z.output<typeof e.approveMany.body>,
  ) {
    return approveMany(user, locale, batchId, scope);
  }

  @Route(e.prepare)
  prepare(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.prepare.params)) { batchId }: BatchPath) {
    return prepareInvoice(user, locale, batchId);
  }

  @Route(e.exportFile)
  async exportFile(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(new ZodValidationPipe(e.exportFile.params)) { batchId }: BatchPath,
    @Query(new ZodValidationPipe(e.exportFile.query)) { format }: z.output<typeof e.exportFile.query>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const out = await exportInvoice(user, locale, batchId, format);
    if (!out.ok) throw new ApiError(out.code === 'not_found' ? 404 : out.code === 'forbidden' ? 403 : 409, out.code, out.error);
    return sendFile(res, out.file);
  }

  @Route(e.sync)
  sync(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body() body: unknown) {
    return syncIncoming(user, locale, body);
  }

  @Route(e.connection)
  connection(@CurrentUser() user: User) {
    return getConnection(user);
  }

  @Route(e.saveConnection)
  saveConnection(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body() body: unknown) {
    return saveConnection(user, locale, body);
  }

  @Route(e.removeConnection)
  async removeConnection(@CurrentUser() user: User) {
    return { ok: await removeConnection(user) };
  }

  @Route(e.testConnection)
  testConnection(@CurrentUser() user: User, @Locale() locale: LocaleCode) {
    return testConnection(user, locale);
  }

  @Route(e.passwordLogin)
  passwordLogin(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body() body: unknown) {
    return passwordLogin(user, locale, body);
  }
}
