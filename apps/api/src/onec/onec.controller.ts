// endpoints.onec: the import history, a batch with its records, decisions, "Prepare for 1C", the
// export and its stored file, the direct transfer, the 1C settings and the counterparties. Thin:
// parse with the registry's schemas, call OnecService (the domain), answer. Roles and demo
// refusals come from the registry entry (AccessGuard).
import { Body, Controller, Inject, Param, Query, Res, UseInterceptors, type StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { endpoints } from '@tasnivo/contracts';
import type { UploadedFile } from '@tasnivo/domain/catalog-upload';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { CurrentUser, Locale } from '../http/decorators';
import { sendFile } from '../http/download';
import { FilePart, MultipartInterceptor } from '../http/multipart';
import { Route } from '../http/route';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { OnecService } from './onec.service';

const e = endpoints.onec;
type BatchPath = z.output<typeof e.batch.params>;

@ApiTags('onec')
@Controller()
export class OnecController {
  constructor(@Inject(OnecService) private readonly onec: OnecService) {}

  @Route(e.batches)
  batches(@CurrentUser() user: User, @Query(new ZodValidationPipe(e.batches.query)) query: z.output<typeof e.batches.query>) {
    return this.onec.batches(user, query);
  }

  @Route(e.batch)
  batch(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(e.batch.params)) { batchId }: BatchPath,
    @Query(new ZodValidationPipe(e.batch.query)) query: z.output<typeof e.batch.query>,
  ) {
    return this.onec.batch(user, batchId, query);
  }

  @Route(e.prepare)
  prepare(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(new ZodValidationPipe(e.prepare.params)) { batchId }: BatchPath,
    @Body(new ZodValidationPipe(e.prepare.body)) body: z.output<typeof e.prepare.body>,
  ) {
    return this.onec.prepare(user, locale, batchId, body);
  }

  @Route(e.exportBatch)
  exportBatch(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(new ZodValidationPipe(e.exportBatch.params)) { batchId }: BatchPath,
    @Body(new ZodValidationPipe(e.exportBatch.body)) body: z.output<typeof e.exportBatch.body>,
  ) {
    return this.onec.exportBatch(user, locale, batchId, body);
  }

  @Route(e.transfer)
  transfer(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(new ZodValidationPipe(e.transfer.params)) { batchId }: BatchPath,
    @Body(new ZodValidationPipe(e.transfer.body)) body: z.output<typeof e.transfer.body>,
  ) {
    return this.onec.transfer(user, locale, batchId, body);
  }

  @Route(e.exportFile)
  async exportFile(
    @CurrentUser() user: User, @Param(new ZodValidationPipe(e.exportFile.params)) { exportId }: z.output<typeof e.exportFile.params>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendFile(res, await this.onec.exportFile(user, exportId));
  }

  @Route(e.decide)
  decide(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(new ZodValidationPipe(e.decide.params)) { recordId }: z.output<typeof e.decide.params>,
    @Body() body: unknown,
  ) {
    // The domain validates the decision and answers a bad one in words, like the other refusals.
    return this.onec.decide(user, locale, recordId, body);
  }

  @Route(e.decideMany)
  decideMany(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(new ZodValidationPipe(e.decideMany.params)) { batchId }: BatchPath, @Body() body: unknown) {
    return this.onec.decideMany(user, locale, batchId, body);
  }

  @Route(e.connection)
  connection(@CurrentUser() user: User) {
    return this.onec.connection(user);
  }

  @Route(e.saveConnection)
  saveConnection(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body() body: unknown) {
    return this.onec.saveConnection(user, locale, body);
  }

  @Route(e.testConnection)
  testConnection(@CurrentUser() user: User) {
    return this.onec.testConnection(user);
  }

  @Route(e.counterparties)
  counterparties(@CurrentUser() user: User, @Query(new ZodValidationPipe(e.counterparties.query)) query: z.output<typeof e.counterparties.query>) {
    return this.onec.counterparties(user, query);
  }

  @Route(e.importCounterparties)
  @UseInterceptors(MultipartInterceptor(e.importCounterparties.multipart))
  importCounterparties(
    @CurrentUser() user: User, @Locale() locale: LocaleCode, @FilePart('file') file: UploadedFile | null, @Body() fields: Record<string, unknown>,
  ) {
    return this.onec.importCounterparties(user, locale, fields, file);
  }
}
