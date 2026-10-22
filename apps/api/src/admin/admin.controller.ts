// Platform-admin pages: traction, pipeline status and accuracy, and the accuracy CSV. Anyone who is
// not a platform admin, signed in or not, gets 404 as the pages and the CSV route did: the routes
// read the session with OptionalSessionGuard and PlatformAdminGuard decides (ContractRoute's own
// guard knows no platformAdmin role).
import { applyDecorators, Controller, Query, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiProduces, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { endpoints, type Endpoint } from '@tasnivo/contracts';
import { accuracyReport, metricsCsv } from '@tasnivo/domain/accuracy';
import { pipelineStatus } from '@tasnivo/domain/pipeline-status';
import { tractionMetrics } from '@tasnivo/domain/traction';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { OptionalSessionGuard } from '../auth-core/session.guard';
import { ContractRoute } from '../http/contract-route';
import { Locale } from '../http/decorators';
import { ApiError } from '../http/errors';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { PlatformAdminGuard } from './platform-admin.guard';

const e = endpoints.admin;
/** The registry route behind OptionalSessionGuard, then PlatformAdminGuard (guards run in the order applied). */
const AdminRoute = (endpoint: Endpoint): MethodDecorator => applyDecorators(
  ContractRoute({ ...endpoint, auth: 'public' }), UseGuards(OptionalSessionGuard, PlatformAdminGuard), ApiCookieAuth('session'),
  ApiResponse({ status: 404, description: 'not_found: not a platform admin (or not signed in)' }),
);

@Controller()
export class AdminController {
  @AdminRoute(e.traction)
  traction() {
    return tractionMetrics();
  }

  @AdminRoute(e.pipeline)
  pipeline(@Locale() locale: LocaleCode) {
    return pipelineStatus(process.env, { ta: appDict(locale), locale });
  }

  @AdminRoute(e.accuracy)
  accuracy(@Query(new ZodValidationPipe(e.accuracy.query)) query: { by: 'stage' | 'label' | 'org' | 'week' }) {
    return accuracyReport(query.by);
  }

  /** by=stage (default), label, org, week or reasons; anything else is a 400. */
  @AdminRoute(e.metricsCsv)
  @ApiProduces('text/csv')
  async metricsCsv(@Query('by') by: string | undefined, @Locale() locale: LocaleCode, @Res() res: Response): Promise<void> {
    const dimension = typeof by === 'string' ? by : 'stage';
    const body = await metricsCsv(dimension, locale);
    if (body === null) throw new ApiError(400, 'invalid_request', 'bad dimension');
    res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="accuracy-${dimension}.csv"` }).send(body);
  }
}
