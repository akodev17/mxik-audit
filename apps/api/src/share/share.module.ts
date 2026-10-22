import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';

/** endpoints.share (public: the share token is the credential). */
@Module({ controllers: [ShareController] })
export class ShareModule {}
