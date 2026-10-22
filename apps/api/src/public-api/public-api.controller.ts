// The public API v1 (/api/v1/*, "Authorization: Bearer mxk_…"). ApiKeyGuard authenticates the key
// and spends its per-minute budget (401/429 and the X-RateLimit-* headers); the operations are
// @tasnivo/domain/api/handlers, the same functions the web app's route handlers run, so answers,
// error envelopes and idempotency replays are the same byte for byte. A throw becomes the
// documented 500 envelope in ApiExceptionFilter.
import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { buildOpenApi, endpoints } from '@tasnivo/contracts';
import { appOrigin } from '@tasnivo/domain/app-url';
import { HEADERS } from '@tasnivo/domain/api/contract';
import { checkOperation, listCatalogsOperation, reportOperation, uploadCatalogOperation, type Reply } from '@tasnivo/domain/api/handlers';
import type { ApiCaller } from '@tasnivo/domain/api/keys';
import { apiConfig } from '@tasnivo/domain/api/limits';
import { ApiKeyGuard } from '../auth-core/api-key.guard';
import { ContractRoute, routePath } from '../http/contract-route';
import { header, type ApiRequest } from '../http/request';
import { readFormData, readJson } from '../http/request-body';

const e = endpoints.publicApi;

/** One query parameter as URLSearchParams.get() read it: the first value, or null. */
function queryParam(req: ApiRequest, name: string): string | null {
  return new URL(req.originalUrl, 'http://api.local').searchParams.get(name);
}

function send(res: Response, reply: Reply): void {
  res.status(reply.outcome.status).set(reply.headers).json(reply.outcome.body);
}

const callerOf = (req: ApiRequest): ApiCaller => {
  if (!req.apiCaller) throw new Error('ApiKeyGuard did not run.');
  return req.apiCaller;
};

@Controller()
export class PublicApiController {
  @ContractRoute(e.check)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  async check(@Req() req: ApiRequest, @Res() res: Response): Promise<void> {
    const body = await readJson(req);
    send(res, await checkOperation(callerOf(req), { idempotencyKey: header(req, HEADERS.idempotencyKey), body: body?.json ?? null }));
  }

  @ContractRoute(e.listCatalogs)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  async listCatalogs(@Req() req: ApiRequest, @Res() res: Response): Promise<void> {
    send(res, await listCatalogsOperation(callerOf(req), {
      limit: queryParam(req, 'limit'), cursor: queryParam(req, 'cursor'), clientId: queryParam(req, 'clientId'),
    }));
  }

  @ContractRoute(e.uploadCatalog)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, clientId: { type: 'string' } } } })
  async uploadCatalog(@Req() req: ApiRequest, @Res() res: Response): Promise<void> {
    const form = await readFormData(req);
    const file = form?.get('file');
    const requested = form?.get('clientId');
    send(res, await uploadCatalogOperation(callerOf(req), {
      idempotencyKey: header(req, HEADERS.idempotencyKey),
      form: form !== null,
      file: file instanceof File ? { name: file.name, size: file.size, bytes: async () => Buffer.from(await file.arrayBuffer()) } : null,
      clientId: typeof requested === 'string' && requested ? requested : null,
    }));
  }

  @ContractRoute(e.report)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  async report(@Param('id') id: string, @Req() req: ApiRequest, @Res() res: Response): Promise<void> {
    send(res, await reportOperation(callerOf(req), id, { limit: queryParam(req, 'limit'), cursor: queryParam(req, 'cursor') }));
  }

  /** The v1 contract (OpenAPI 3.0.3, version 1.1.0) for the configured limits; no key needed. */
  @Get(routePath(e.openapi))
  @ApiExcludeEndpoint()
  openapi(@Req() req: ApiRequest) {
    const { ratePerMinute, maxCheckItems } = apiConfig();
    return buildOpenApi({ origin: appOrigin() ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`, scope: 'public', config: { ratePerMinute, maxCheckItems } });
  }
}
