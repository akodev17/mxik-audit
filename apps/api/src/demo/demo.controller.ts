// The public demo and the landing page's lead form: no session needed. Each answers the old
// actions' form state ({ error, field } in the visitor's language), never an HTTP error, and
// keeps their database-backed limits per client address.
import { Body, Controller, Inject, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { endpoints, LIMITS } from '@tasnivo/contracts';
import { demoTimes, enterDemo, openDemoLink, peekDemo, requestDemo, type DemoFields, type DemoState } from '@tasnivo/domain/demo-request';
import { leadRateRefusal, submitLeadForm, type LeadState } from '@tasnivo/domain/lead-submit';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { SessionService } from '../auth-core/session.service';
import { Route } from '../http/route';
import { Locale } from '../http/decorators';
import { clientIp, header, type ApiRequest } from '../http/request';
import { discardBody, MULTIPART_ALLOWANCE, readFormData } from '../http/request-body';
import { acquireUploadSlot } from '../http/upload-slots';

const e = endpoints.demo;

const fieldsOf = (body: unknown): DemoFields => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});
const tokenOf = (body: unknown): unknown => (body && typeof body === 'object' ? (body as { token?: unknown }).token : undefined);

@ApiTags('demo')
@Controller()
export class DemoController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  @Route(e.config)
  config() {
    return demoTimes();
  }

  @Route(e.request)
  request(@Body() body: unknown, @Req() req: ApiRequest, @Locale() locale: LocaleCode): Promise<DemoState> {
    return requestDemo(fieldsOf(body), { ip: clientIp(req), locale });
  }

  /** `null` (the JSON value) for a used, expired or unknown link. */
  @Route(e.peek)
  peek(@Param('token') token: string): Promise<{ name: string } | null> {
    return peekDemo(token);
  }

  /** Uses the link up, signs this browser in to a fresh demo org and answers where to go: its sample catalogue. */
  @Route(e.open)
  async open(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response, @Locale() locale: LocaleCode): Promise<{ redirect: string } | DemoState> {
    const opened = await openDemoLink(tokenOf(body), { ip: clientIp(req), locale });
    if (!opened.ok) return opened.state;
    await enterDemo(await this.sessions.forSignIn(req, res), opened.session, header(req, 'user-agent'));
    return { redirect: opened.landing };
  }

  /**
   * Multipart: contact, optional company/note, the honeypot and an optional sample file (5 MB, .xlsx/.csv).
   * The address limit is spent before the body is read, so a refused sender's upload is never held;
   * the body is capped at the file's 5 MB plus the form around it (413 past it).
   */
  @Route(e.lead)
  async lead(@Req() req: ApiRequest): Promise<LeadState> {
    const ip = clientIp(req);
    const refused = await leadRateRefusal(ip);
    if (refused) {
      // Nothing of the body is kept or parsed; it is only read to its end so the answer arrives.
      await discardBody(req);
      return refused;
    }
    const release = await acquireUploadSlot(req);
    try {
      const form = await readFormData(req, { maxBytes: LIMITS.leadBytes + MULTIPART_ALLOWANCE });
      return await submitLeadForm(form ?? new FormData(), ip, { rateChecked: true });
    } finally {
      release();
    }
  }
}
