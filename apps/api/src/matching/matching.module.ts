import { Module } from '@nestjs/common';
import { EmbedderService } from './embedder.service';

/** The matching setup the API process shares across checks and inline audits (Q1). */
@Module({ providers: [EmbedderService], exports: [EmbedderService] })
export class MatchingModule {}
