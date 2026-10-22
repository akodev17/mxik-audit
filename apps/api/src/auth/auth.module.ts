import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';

/** endpoints.auth (sign-in, sign-up, password, two-factor, sessions, e-mail confirmation, Telegram sign-in). */
@Module({ controllers: [AuthController] })
export class AuthModule {}
