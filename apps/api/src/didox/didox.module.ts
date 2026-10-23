import { Module } from '@nestjs/common';
import { DidoxController } from './didox.controller';

/** endpoints.didox (Agent 3). The domain uses the shared Prisma client itself, so no DbModule here. */
@Module({ controllers: [DidoxController] })
export class DidoxModule {}
