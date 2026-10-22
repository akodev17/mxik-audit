import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [DbModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
