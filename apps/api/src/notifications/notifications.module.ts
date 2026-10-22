import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';

/** Notifications and the command-palette search (registry module `notifications`). */
@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
