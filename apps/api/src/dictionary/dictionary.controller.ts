// The firm dictionary: the /dictionary page's list, the workspace's accept-all button, edits, and
// the org's auto-accept setting. Thin: the domain (dictionary-ops) decides, as for the server actions.
import { Body, Controller, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { endpoints } from '@tasnivo/contracts';
import {
  acceptDictionaryFor, deleteDictionaryEntry, dictionaryPage, setDictionaryAutoAccept, updateDictionaryEntry,
} from '@tasnivo/domain/dictionary-ops';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import type { z, ZodTypeAny } from 'zod';
import { Route } from '../http/route';
import { CurrentUser, Locale } from '../http/decorators';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.dictionary;
type In<S extends ZodTypeAny> = z.output<S>;
const pipe = <S extends ZodTypeAny>(schema: S) => new ZodValidationPipe(schema);

@Controller()
@ApiTags('dictionary')
export class DictionaryController {
  @Route(e.list)
  async list(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Query(pipe(e.list.query)) q: In<typeof e.list.query>) {
    const { rows, counts, total, pageSize, available } = await dictionaryPage(user, q, locale);
    return { rows, counts, total, pageSize, available };
  }

  @Route(e.acceptForCatalog)
  acceptForCatalog(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(pipe(e.acceptForCatalog.params)) p: In<typeof e.acceptForCatalog.params>) {
    return acceptDictionaryFor(user, p.catalogId, locale);
  }

  @Route(e.setAutoAccept)
  setAutoAccept(@CurrentUser() user: User, @Body(pipe(e.setAutoAccept.body)) body: In<typeof e.setAutoAccept.body>) {
    return setDictionaryAutoAccept(user, body.on);
  }

  @Route(e.update)
  update(
    @CurrentUser() user: User, @Locale() locale: LocaleCode,
    @Param(pipe(e.update.params)) p: In<typeof e.update.params>, @Body(pipe(e.update.body)) body: In<typeof e.update.body>,
  ) {
    return updateDictionaryEntry(user, p.entryId, body.code, locale);
  }

  @Route(e.remove)
  remove(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(pipe(e.remove.params)) p: In<typeof e.remove.params>) {
    return deleteDictionaryEntry(user, p.entryId, locale);
  }
}
