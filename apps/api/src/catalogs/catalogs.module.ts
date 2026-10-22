import { Module } from '@nestjs/common';
import { CatalogsController } from './catalogs.controller';
import { ExportsController } from './exports.controller';

/** endpoints.catalogs. The domain uses the shared Prisma client itself, so no DbModule here. */
@Module({ controllers: [CatalogsController, ExportsController] })
export class CatalogsModule {}
