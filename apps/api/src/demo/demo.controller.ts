// The public demo and the landing page's lead form: no session needed. Each answers the old
// actions' form state ({ error, field } in the visitor's language), never an HTTP error, and
// keeps their database-backed limits per client address.
import { Body, Controller, Inject, Param, Req, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { endpoints } from '@tasnivo/contracts';
import { demoTimes, enterDemo, openDemoLink, peekDemo, requestDemo, type DemoFields, type DemoState } from '@tasnivo/domain/demo-request';
import { submitLeadForm, type LeadState } from '@tasnivo/domain/lead-submit';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { SessionService } from '../auth-core/session.service';
import { ContractRoute } from '../http/contract-route';
import { Locale } from '../http/decorators';
import { clientIp, header, type ApiRequest } from '../http/request';
import { readFormData } from '../http/request-body';

const e = endpoints.demo;

const fieldsOf = (body: unknown): DemoFields => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});
const tokenOf = (body: unknown): unknown => (body && typeof body === 'object' ? (body as { token?: unknown }).token : undefined);

@Controller()
export class DemoController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  @ContractRoute(e.config)
  config() {
    return demoTimes();
  }

  @ContractRoute(e.request)
  request(@Body() body: unknown, @Req() req: ApiRequest, @Locale() locale: LocaleCode): Promise<DemoState> {
    return requestDemo(fieldsOf(body), { ip: clientIp(req), locale });
  }

  /** `null` (the JSON value) for a used, expired or unknown link. */
  @ContractRoute(e.peek)
  async peek(@Param('token') token: string, @Res() res: Response): Promise<void> {
    res.json(await peekDemo(token));
  }

  /** Uses the link up, signs this browser in to a fresh demo org and answers where to go: its sample catalogue. */
  @ContractRoute(e.open)
  async open(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response, @Locale() locale: LocaleCode): Promise<{ redirect: string } | DemoState> {
    const opened = await openDemoLink(tokenOf(body), { ip: clientIp(req), locale });
    if (!opened.ok) return opened.state;
    await enterDemo(await this.sessions.forSignIn(req, res), opened.session, header(req, 'user-agent'));
    return { redirect: opened.landing };
  }

  /** Multipart: contact, optional company/note, the honeypot and an optional sample file (5 MB, .xlsx/.csv). */
  @ContractRoute(e.lead)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['contact'], properties: { contact: { type: 'string' }, company: { type: 'string' }, note: { type: 'string' }, file: { type: 'string', format: 'binary' } } } })
  async lead(@Req() req: ApiRequest): Promise<LeadState> {
    return submitLeadForm(await readFormData(req) ?? new FormData(), clientIp(req));
  }
}
