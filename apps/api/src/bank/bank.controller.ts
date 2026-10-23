// endpoints.bank: bank statements (Agent 2 of docs/TASNIVO_AI_PLAN_2026-10-23.md). Thin: parse the
// path and query, call @tasnivo/domain/bank/service, map refusals. The 1C file comes from the 1C
// interface (Agent 1) through the domain; this module never builds one.
import { Body, Controller, HttpCode, Param, Query, Res, UseInterceptors, type StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { endpoints } from '@tasnivo/contracts';
import {
  approveMany, bankFormats, bankRules, clientOptions, createStatement, decideRecord, exportStatement, listStatements, prepareStatement, previewStatement,
  reconcileCsvFile, reconcileStatement, removeBankFormat, removeBankRule, removeStatement, statementDetail, statementRecords,
} from '@tasnivo/domain/bank/service';
import type { UploadedFile } from '@tasnivo/domain/catalog-upload';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { CurrentUser, Locale } from '../http/decorators';
import { sendFile } from '../http/download';
import { ApiError } from '../http/errors';
import { FilePart, MultipartInterceptor } from '../http/multipart';
import { found } from '../http/payload';
import { Route } from '../http/route';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.bank;
type StatementPath = z.output<typeof e.statement.params>;
type RecordPath = z.output<typeof e.decide.params>;

@ApiTags('bank')
@Controller()
export class BankController {
  @Route(e.preview)
  @UseInterceptors(MultipartInterceptor(e.preview.multipart))
  preview(@CurrentUser() user: User, @Locale() locale: LocaleCode, @FilePart('file') file: UploadedFile | null, @Body() fields: Record<string, unknown>) {
    return previewStatement(user, locale, { clientId: fields['clientId'], file, columnMap: fields['columnMap'], conventions: fields['conventions'] });
  }

  @Route(e.create)
  @UseInterceptors(MultipartInterceptor(e.create.multipart))
  create(@CurrentUser() user: User, @Locale() locale: LocaleCode, @FilePart('file') file: UploadedFile | null, @Body() fields: Record<string, unknown>) {
    return createStatement(user, locale, { clientId: fields['clientId'], file, columnMap: fields['columnMap'], conventions: fields['conventions'], formatName: fields['formatName'] });
  }

  @Route(e.list)
  async list(@CurrentUser() user: User, @Query(new ZodValidationPipe(e.list.query)) { client }: z.output<typeof e.list.query>) {
    const chosen = client && client !== 'all' ? client : null;
    const [statements, clients] = await Promise.all([listStatements(user, chosen), clientOptions(user)]);
    return { statements, clients, client: chosen };
  }

  @Route(e.statement)
  async statement(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.statement.params)) { batchId }: StatementPath) {
    return found(await statementDetail(user, batchId));
  }

  @Route(e.records)
  async records(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(e.records.params)) { batchId }: StatementPath,
    @Query(new ZodValidationPipe(e.records.query)) query: z.output<typeof e.records.query>,
  ) {
    return found(await statementRecords(user, batchId, query));
  }

  @Route(e.decide)
  decide(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.decide.params)) { recordId }: RecordPath, @Body() body: unknown) {
    // A bad body gets the domain's own refusal in the user's language, like the other modules.
    return decideRecord(user, locale, recordId, body);
  }

  @Route(e.approve)
  approve(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.approve.params)) { batchId }: StatementPath, @Body() body: unknown) {
    return approveMany(user, locale, batchId, body);
  }

  @Route(e.prepare)
  prepare(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.prepare.params)) { batchId }: StatementPath) {
    return prepareStatement(user, locale, batchId);
  }

  @Route(e.export)
  // A download answered to a POST: 200, not Nest's 201 for POST.
  @HttpCode(200)
  async export(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.export.params)) { batchId }: StatementPath, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const out = await exportStatement(user, locale, batchId);
    if (!out.ok) throw new ApiError(out.status, out.code, out.message);
    return sendFile(res, out.file);
  }

  @Route(e.reconcile)
  async reconcile(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.reconcile.params)) { batchId }: StatementPath) {
    return found(await reconcileStatement(user, batchId));
  }

  @Route(e.reconcileCsv)
  async reconcileCsv(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.reconcileCsv.params)) { batchId }: StatementPath, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const out = await reconcileCsvFile(user, locale, batchId);
    if (!out.ok) throw new ApiError(out.status, out.code, out.message);
    return sendFile(res, out.file);
  }

  @Route(e.remove)
  remove(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.remove.params)) { batchId }: StatementPath) {
    return removeStatement(user, locale, batchId);
  }

  @Route(e.formats)
  async formats(@CurrentUser() user: User) {
    return { formats: await bankFormats(user) };
  }

  @Route(e.removeFormat)
  removeFormat(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.removeFormat.params)) { formatId }: z.output<typeof e.removeFormat.params>) {
    return removeBankFormat(user, locale, formatId);
  }

  @Route(e.rules)
  async rules(@CurrentUser() user: User) {
    return { rules: await bankRules(user) };
  }

  @Route(e.removeRule)
  removeRule(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.removeRule.params)) { ruleId }: z.output<typeof e.removeRule.params>) {
    return removeBankRule(user, locale, ruleId);
  }
}
