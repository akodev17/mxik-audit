import { Body, Controller, Inject, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { endpoints } from '@tasnivo/contracts';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { Route } from '../http/route';
import { CurrentUser, Locale } from '../http/decorators';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { BillingService } from './billing.service';

const e = endpoints.billing;

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Route(e.plan)
  plan(@CurrentUser() user: User) {
    return this.billing.plan(user);
  }

  @Route(e.catalogPurchase)
  catalogPurchase(@CurrentUser() user: User, @Param('catalogId') catalogId: string) {
    return this.billing.catalogPurchase(user, catalogId);
  }

  @Route(e.orders)
  orders(@CurrentUser() user: User) {
    return this.billing.orders(user);
  }

  @Route(e.receipt)
  receipt(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.receipt.params)) p: { orderId: string }) {
    return this.billing.receipt(user, p.orderId);
  }

  // Registered as "any": the service answers a non-admin with { ok: false, error } as the action did (see the endpoint's notes).
  @Route({ ...e.checkout, role: 'any' })
  checkout(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Body() body: unknown) {
    return this.billing.checkout(user, body, locale);
  }
}
