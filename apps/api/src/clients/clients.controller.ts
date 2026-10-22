import { Body, Controller, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { endpoints, type QueryOf } from '@tasnivo/contracts';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { Route } from '../http/route';
import { CurrentUser, Locale } from '../http/decorators';
import type { ApiRequest } from '../http/request';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { ClientsService } from './clients.service';

const e = endpoints.clients;
type ListQuery = Required<Pick<QueryOf<typeof e.list>, 'page'>> & Omit<QueryOf<typeof e.list>, 'page'>;

/**
 * The firm's clients. Role and demo refusals come from the registry (403); what the actions
 * answered in the form ({ ok: false, error }) stays a 200 with the same message.
 */
@ApiTags('clients')
@Controller()
export class ClientsController {
  constructor(@Inject(ClientsService) private readonly clients: ClientsService) {}

  @Route(e.list)
  list(@CurrentUser() user: User, @Query(new ZodValidationPipe(e.list.query)) query: ListQuery) {
    return this.clients.list(user, query);
  }

  @Route(e.switchActive)
  switchActive(@CurrentUser() user: User, @Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    return this.clients.switchActive(user, body, req, res);
  }

  @Route(e.get)
  get(@CurrentUser() user: User, @Param('clientId') clientId: string) {
    return this.clients.page(user, clientId);
  }

  @Route(e.create)
  create(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    return this.clients.create(user, body, locale, req, res);
  }

  @Route(e.rename)
  rename(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param('clientId') clientId: string, @Body() body: unknown) {
    return this.clients.rename(user, clientId, body, locale);
  }

  @Route(e.archive)
  archive(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param('clientId') clientId: string, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    return this.clients.archive(user, clientId, locale, req, res);
  }

  @Route(e.restore)
  restore(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param('clientId') clientId: string) {
    return this.clients.restore(user, clientId, locale);
  }

  @Route(e.remove)
  remove(
    @CurrentUser() user: User, @Locale() locale: LocaleCode, @Param('clientId') clientId: string, @Body() body: unknown,
    @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response,
  ) {
    return this.clients.remove(user, clientId, body, locale, req, res);
  }

  @Route(e.accountants)
  accountants(@CurrentUser() user: User, @Param('clientId') clientId: string) {
    return this.clients.accountants(user, clientId);
  }

  @Route(e.setAccountants)
  setAccountants(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param('clientId') clientId: string, @Body() body: unknown) {
    return this.clients.setAccountants(user, clientId, body, locale);
  }
}
