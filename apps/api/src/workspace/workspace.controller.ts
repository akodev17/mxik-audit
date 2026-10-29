// The review workspace (grid rows, row detail, decisions, bulk, comments, views, code lookup) and the
// cross-catalogue queue and dashboard. Thin: parse with the registry's schemas, call the domain
// function the web's server action calls, answer its result. Access is the domain's (catalogScope,
// findingScope, mayWrite); ContractGuard adds the registry's role and demo refusals in front.
import { Body, Controller, Inject, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { endpoints } from '@tasnivo/contracts';
import { lookupCodes } from '@tasnivo/domain/code-lookup';
import { codeRequestText } from '@tasnivo/domain/code-request';
import { listComments, setFlag } from '@tasnivo/domain/comments';
import { catalogMoneyAtRisk } from '@tasnivo/domain/money-at-risk';
import { dashboardView, queueView } from '@tasnivo/domain/overview';
import { rowDetail } from '@tasnivo/domain/row-detail';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import { recordWrongSuggestion } from '@tasnivo/domain/suggestion-feedback';
import { applyBarcodeName } from '@tasnivo/domain/barcode-name';
import { listViews } from '@tasnivo/domain/views';
import { workspaceFailedRows } from '@tasnivo/domain/workspace';
import { readFilter } from '@tasnivo/domain/workspace-filter';
import {
  acceptSure, applyBulk, decideFinding, decideGroup, postCommentFor, previewBulk, previewSure, removeViewFor, rowsCounts, rowsPage,
  saveViewFor, setDefaultViewFor, splitRow, undoBulkFlags, undoReview,
} from '@tasnivo/domain/workspace-ops';
import { i18nFor } from '@tasnivo/i18n/locale';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import type { z, ZodTypeAny } from 'zod';
import { Route } from '../http/route';
import { CurrentUser, Locale } from '../http/decorators';
import { ApiError } from '../http/errors';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { ClassifierSearchService } from './classifier-search.service';

const e = endpoints.workspace;
type In<S extends ZodTypeAny> = z.output<S>;
const pipe = <S extends ZodTypeAny>(schema: S) => new ZodValidationPipe(schema);

const notFound = (): ApiError => new ApiError(404, 'not_found', 'Not found.');

@Controller()
@ApiTags('workspace')
export class WorkspaceController {
  constructor(@Inject(ClassifierSearchService) private readonly classifier: ClassifierSearchService) {}

  @Route(e.rows)
  rows(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(pipe(e.rows.params)) p: In<typeof e.rows.params>, @Query(pipe(e.rows.query)) q: In<typeof e.rows.query>,
  ) {
    const { cursor, row, ...filter } = q;
    return rowsPage(user, p.catalogId, filter, cursor, locale, row ?? null);
  }

  @Route(e.counts)
  async counts(@CurrentUser() user: User, @Param(pipe(e.counts.params)) p: In<typeof e.counts.params>, @Query(pipe(e.counts.query)) q: In<typeof e.counts.query>) {
    const counts = await rowsCounts(user, p.catalogId, readFilter(q));
    if (!counts) throw notFound();
    return counts;
  }

  @Route(e.failedRows)
  async failedRows(@CurrentUser() user: User, @Param(pipe(e.failedRows.params)) p: In<typeof e.failedRows.params>) {
    const rows = await workspaceFailedRows(user, p.catalogId);
    if (!rows) throw notFound();
    return rows;
  }

  @Route(e.moneyAtRisk)
  async moneyAtRisk(@CurrentUser() user: User, @Param(pipe(e.moneyAtRisk.params)) p: In<typeof e.moneyAtRisk.params>) {
    const sums = await catalogMoneyAtRisk(user, p.catalogId);
    if (sums === undefined) throw notFound();
    return sums;
  }

  @Route(e.rowDetail)
  rowDetail(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(pipe(e.rowDetail.params)) p: In<typeof e.rowDetail.params>) {
    return rowDetail(user, p.findingId, i18nFor(locale).ta, locale);
  }

  @Route(e.decide)
  decide(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(pipe(e.decide.params)) p: In<typeof e.decide.params>, @Body(pipe(e.decide.body)) body: In<typeof e.decide.body>,
  ) {
    return decideFinding(user, { findingId: p.findingId, ...body }, locale);
  }

  @Route(e.decideGroup)
  decideGroup(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body(pipe(e.decideGroup.body)) body: In<typeof e.decideGroup.body>) {
    return decideGroup(user, body, locale);
  }

  @Route(e.split)
  split(@CurrentUser() user: User, @Param(pipe(e.split.params)) p: In<typeof e.split.params>) {
    return splitRow(user, p.findingId);
  }

  @Route(e.acceptSure)
  acceptSure(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(pipe(e.acceptSure.params)) p: In<typeof e.acceptSure.params>, @Body(pipe(e.acceptSure.body)) body: In<typeof e.acceptSure.body>,
  ) {
    return acceptSure(user, { catalogId: p.catalogId, minConfidence: body.minConfidence, filter: body.filter }, locale);
  }

  @Route(e.previewSure)
  previewSure(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(pipe(e.previewSure.params)) p: In<typeof e.previewSure.params>, @Body(pipe(e.previewSure.body)) body: In<typeof e.previewSure.body>,
  ) {
    return previewSure(user, p.catalogId, body.filter, locale);
  }

  @Route(e.undo)
  undo(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body(pipe(e.undo.body)) body: In<typeof e.undo.body>) {
    return undoReview(user, body, locale);
  }

  @Route(e.bulkPreview)
  bulkPreview(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(pipe(e.bulkPreview.params)) p: In<typeof e.bulkPreview.params>, @Body(pipe(e.bulkPreview.body)) body: In<typeof e.bulkPreview.body>,
  ) {
    return previewBulk(user, p.catalogId, body.target, body.action, locale);
  }

  @Route(e.bulkApply)
  bulkApply(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(pipe(e.bulkApply.params)) p: In<typeof e.bulkApply.params>, @Body(pipe(e.bulkApply.body)) body: In<typeof e.bulkApply.body>,
  ) {
    return applyBulk(user, p.catalogId, body.target, body.action, locale);
  }

  @Route(e.bulkUndoFlags)
  bulkUndoFlags(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(pipe(e.bulkUndoFlags.params)) p: In<typeof e.bulkUndoFlags.params>) {
    return undoBulkFlags(user, p.eventId, locale);
  }

  @Route(e.comments)
  comments(@CurrentUser() user: User, @Param(pipe(e.comments.params)) p: In<typeof e.comments.params>) {
    return listComments(user, p.findingId);
  }

  @Route(e.postComment)
  postComment(
    @CurrentUser() user: User,
    @Param(pipe(e.postComment.params)) p: In<typeof e.postComment.params>, @Body(pipe(e.postComment.body)) body: In<typeof e.postComment.body>,
  ) {
    return postCommentFor(user, p.findingId, body.body);
  }

  @Route(e.setFlag)
  setFlag(
    @CurrentUser() user: User,
    @Param(pipe(e.setFlag.params)) p: In<typeof e.setFlag.params>, @Body(pipe(e.setFlag.body)) body: In<typeof e.setFlag.body>,
  ) {
    return setFlag(user, p.findingId, body.flag);
  }

  @Route(e.views)
  views(@CurrentUser() user: User) {
    return listViews(user);
  }

  @Route(e.saveView)
  saveView(@CurrentUser() user: User, @Body(pipe(e.saveView.body)) body: In<typeof e.saveView.body>) {
    return saveViewFor(user, body);
  }

  @Route(e.removeView)
  removeView(@CurrentUser() user: User, @Param(pipe(e.removeView.params)) p: In<typeof e.removeView.params>) {
    return removeViewFor(user, p.viewId);
  }

  @Route(e.setDefaultView)
  setDefaultView(@CurrentUser() user: User, @Body(pipe(e.setDefaultView.body)) body: In<typeof e.setDefaultView.body>) {
    return setDefaultViewFor(user, body.viewId);
  }

  @Route(e.lookupCodes)
  lookupCodes(@Locale() locale: LocaleCode, @Query(pipe(e.lookupCodes.query)) q: In<typeof e.lookupCodes.query>) {
    return lookupCodes(q.q, locale, this.classifier.search);
  }

  @Route(e.newCodeRequest)
  newCodeRequest(@CurrentUser() user: User, @Param(pipe(e.newCodeRequest.params)) p: In<typeof e.newCodeRequest.params>) {
    return codeRequestText(user, p.findingId);
  }

  @Route(e.wrongSuggestion)
  async wrongSuggestion(
    @CurrentUser() user: User,
    @Param(pipe(e.wrongSuggestion.params)) p: In<typeof e.wrongSuggestion.params>, @Body(pipe(e.wrongSuggestion.body)) body: In<typeof e.wrongSuggestion.body>,
  ) {
    return { ok: await recordWrongSuggestion(user, { findingId: p.findingId, ...body }) };
  }

  @Route(e.nameFromBarcode)
  nameFromBarcode(@CurrentUser() user: User, @Param(pipe(e.nameFromBarcode.params)) p: In<typeof e.nameFromBarcode.params>) {
    return applyBarcodeName(user, p.findingId);
  }

  @Route(e.queue)
  queue(@CurrentUser() user: User, @Query(pipe(e.queue.query)) q: In<typeof e.queue.query>) {
    return queueView(user, q);
  }

  @Route(e.dashboard)
  dashboard(@CurrentUser() user: User, @Query(pipe(e.dashboard.query)) q: In<typeof e.dashboard.query>) {
    return dashboardView(user, { accountant: q.accountant, mine: q.rv === 'mine' });
  }
}
