import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { DemoController } from './demo.controller';

@Module({
  imports: [DbModule],
  controllers: [DemoController],
})
export class DemoModule {}
