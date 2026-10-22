import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';

/** endpoints.team (members, invites, joining with an invite). */
@Module({ controllers: [TeamController] })
export class TeamModule {}
