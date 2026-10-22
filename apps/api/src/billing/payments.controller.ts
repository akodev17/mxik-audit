// Provider callbacks under the URLs registered with Click and Payme. No session and no CSRF header:
// each provider's own check (Click's sign_string in handleClick, Payme's Basic auth) decides.
import { Controller, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { endpoints } from '@tasnivo/contracts';
import { CLICK_ERRORS, handleClick } from '@tasnivo/domain/billing/click';
import { billingConfig } from '@tasnivo/domain/billing/config';
import { answerPayme } from '@tasnivo/domain/billing/payme';
import { Route } from '../http/route';
import { SkipCsrf } from '../http/decorators';
import { ApiError } from '../http/errors';
import { header, type ApiRequest } from '../http/request';
import { readFormFields, readJson } from '../http/request-body';

const e = endpoints.billing;

@ApiTags('billing')
@Controller()
@SkipCsrf()
export class PaymentsController {
  /** Prepare and Complete on one URL ("action" tells them apart). 404 while Click is not configured. */
  @Route(e.click)
  async click(@Req() req: ApiRequest) {
    const config = billingConfig().click;
    if (!config) throw new ApiError(404, 'not_found', 'click disabled');
    const fields = await readFormFields(req).catch(() => null);
    if (!fields) return CLICK_ERRORS.request;
    return handleClick(fields, config);
  }

  /** JSON-RPC; every refusal is HTTP 200 with a JSON-RPC error. 404 while Payme is not configured. */
  @Route(e.payme)
  async payme(@Req() req: ApiRequest) {
    const config = billingConfig().payme;
    if (!config) throw new ApiError(404, 'not_found', 'payme disabled');
    return answerPayme(await readJson(req), header(req, 'authorization'), config);
  }
}
