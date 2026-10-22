import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { AdminController } from './admin.controller';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({
  imports: [DbModule],
  controllers: [AdminController],
  providers: [PlatformAdminGuard],
})
export class AdminModule {}
