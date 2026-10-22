import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [DbModule],
  controllers: [BillingController, PaymentsController],
  providers: [BillingService],
})
export class BillingModule {}
