import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';

/** endpoints.imports. The domain uses the shared Prisma client itself, so no DbModule here. */
@Module({ controllers: [ImportsController] })
export class ImportsModule {}
