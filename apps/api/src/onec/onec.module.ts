import { Module } from '@nestjs/common';
import { OnecController } from './onec.controller';
import { OnecService } from './onec.service';

@Module({
  controllers: [OnecController],
  providers: [OnecService],
})
export class OnecModule {}
