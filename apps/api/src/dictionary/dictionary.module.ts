import { Module } from '@nestjs/common';
import { DictionaryController } from './dictionary.controller';

/** The firm dictionary (registry module `dictionary`). */
@Module({ controllers: [DictionaryController] })
export class DictionaryModule {}
