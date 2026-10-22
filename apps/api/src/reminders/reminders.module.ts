import { Module } from '@nestjs/common';
import { RemindersController } from './reminders.controller';

/** Monthly check reminders (registry module `reminders`). */
@Module({ controllers: [RemindersController] })
export class RemindersModule {}
