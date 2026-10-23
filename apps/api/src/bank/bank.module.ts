import { Module } from '@nestjs/common';
import { BankController } from './bank.controller';

/** endpoints.bank. The domain uses the shared Prisma client itself, so no DbModule here. */
@Module({ controllers: [BankController] })
export class BankModule {}
