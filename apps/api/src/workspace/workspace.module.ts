import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ClassifierSearchService } from './classifier-search.service';
import { WorkspaceController } from './workspace.controller';

/** The review workspace, the queue and the dashboard (registry module `workspace`). */
@Module({ imports: [DbModule], controllers: [WorkspaceController], providers: [ClassifierSearchService] })
export class WorkspaceModule {}
