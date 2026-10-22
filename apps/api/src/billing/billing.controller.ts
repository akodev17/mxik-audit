import { Body, Controller, Inject, Param } from '@nestjs/common';
import { endpoints } from '@tasnivo/contracts';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { ContractRoute } from '../http/contract-route';
import { CurrentUser, Locale } from '../http/decorators';
import { BillingService } from './billing.service';

const e = endpoints.billing;

@Controller()
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @ContractRoute(e.plan)
  plan(@CurrentUser() user: User) {
    return this.billing.plan(user);
  }

  @ContractRoute(e.catalogPurchase)
  catalogPurchase(@CurrentUser() user: User, @Param('catalogId') catalogId: string) {
    return this.billing.catalogPurchase(user, catalogId);
  }

  // Registered as "any": the service answers a non-admin with { ok: false, error } as the action did (see the endpoint's notes).
  @ContractRoute({ ...e.checkout, role: 'any' })
  checkout(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body() body: unknown) {
    return this.billing.checkout(user, body, locale);
  }
}
