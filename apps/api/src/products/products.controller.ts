// endpoints.products: the product catalogue (list, drawer, packaging, "Confirm MXIK", checks), the
// bulk catalogue import (preview, commit, progress + records, decisions, save, 1C hand-over) and
// "Add to product catalogue" from an audit. Thin: the domain (packages/domain/src/products) decides;
// "not yours / missing" is a 404.
import { Body, Controller, Param, Query, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z, ZodTypeAny } from 'zod';
import { endpoints } from '@tasnivo/contracts';
import type { UploadedFile } from '@tasnivo/domain/catalog-upload';
import {
  checkProducts, confirmProductMxik, exportProducts, listProducts, productDetail, productPackages, productsFromAudit,
} from '@tasnivo/domain/products/catalog';
import {
  applyProductBatch, commitProductImport, decideProductRecord, exportProductBatch, previewProductImport, productBatchView,
} from '@tasnivo/domain/products/import';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { CurrentUser, Locale } from '../http/decorators';
import { FilePart, MultipartInterceptor } from '../http/multipart';
import { found } from '../http/payload';
import { Route } from '../http/route';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.products;
type In<S extends ZodTypeAny> = z.output<S>;
const pipe = <S extends ZodTypeAny>(schema: S) => new ZodValidationPipe(schema);

@Controller()
@ApiTags('products')
export class ProductsController {
  @Route(e.list)
  list(@CurrentUser() user: User, @Query(pipe(e.list.query)) q: In<typeof e.list.query>) {
    return listProducts(user, q);
  }

  @Route(e.importPreview)
  @UseInterceptors(MultipartInterceptor(e.importPreview.multipart))
  importPreview(
    @CurrentUser() user: User, @Locale() locale: LocaleCode, @FilePart('file') file: UploadedFile | null,
    @Body(pipe(e.importPreview.multipart.fields)) fields: In<typeof e.importPreview.multipart.fields>,
  ) {
    return previewProductImport(user, locale, { file, clientId: fields.clientId || null });
  }

  @Route(e.importCommit)
  @UseInterceptors(MultipartInterceptor(e.importCommit.multipart))
  importCommit(
    @CurrentUser() user: User, @Locale() locale: LocaleCode, @FilePart('file') file: UploadedFile | null,
    @Body(pipe(e.importCommit.multipart.fields)) fields: In<typeof e.importCommit.multipart.fields>,
  ) {
    return commitProductImport(user, locale, { file, clientId: fields.clientId || null, mapping: fields.mapping, clearEmpty: fields.clearEmpty === '1' });
  }

  @Route(e.check)
  check(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body(pipe(e.check.body)) body: In<typeof e.check.body>) {
    return checkProducts(user, body, locale);
  }

  @Route(e.exportAll)
  exportAll(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body(pipe(e.exportAll.body)) body: In<typeof e.exportAll.body>) {
    return exportProducts(user, body, locale);
  }

  @Route(e.importBatch)
  async importBatch(
    @CurrentUser() user: User, @Param(pipe(e.importBatch.params)) p: In<typeof e.importBatch.params>, @Query(pipe(e.importBatch.query)) q: In<typeof e.importBatch.query>,
  ) {
    return found(await productBatchView(user, p.batchId, q));
  }

  @Route(e.importDecide)
  importDecide(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(pipe(e.importDecide.params)) p: In<typeof e.importDecide.params>, @Body(pipe(e.importDecide.body)) body: In<typeof e.importDecide.body>,
  ) {
    return decideProductRecord(user, p.batchId, p.recordId, body, locale);
  }

  @Route(e.importApply)
  importApply(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(pipe(e.importApply.params)) p: In<typeof e.importApply.params>) {
    return applyProductBatch(user, p.batchId, locale);
  }

  @Route(e.importExport)
  importExport(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(pipe(e.importExport.params)) p: In<typeof e.importExport.params>) {
    return exportProductBatch(user, p.batchId, locale);
  }

  @Route(e.fromAudit)
  fromAudit(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(pipe(e.fromAudit.params)) p: In<typeof e.fromAudit.params>) {
    return productsFromAudit(user, p.catalogId, locale);
  }

  @Route(e.detail)
  async detail(@CurrentUser() user: User, @Param(pipe(e.detail.params)) p: In<typeof e.detail.params>) {
    return found(await productDetail(user, p.productId));
  }

  @Route(e.packages)
  async packages(@CurrentUser() user: User, @Param(pipe(e.packages.params)) p: In<typeof e.packages.params>) {
    return found(await productPackages(user, p.productId));
  }

  @Route(e.confirm)
  confirm(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(pipe(e.confirm.params)) p: In<typeof e.confirm.params>, @Body(pipe(e.confirm.body)) body: In<typeof e.confirm.body>,
  ) {
    return confirmProductMxik(user, p.productId, body.code, locale);
  }
}
