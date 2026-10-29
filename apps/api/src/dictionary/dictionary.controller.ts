// The firm dictionary: the /dictionary page's list, the workspace's accept-all button, confirmations,
// admin edits, the org's auto-accept setting, and where a row's suggestion or decision came from.
// Thin: the domain (dictionary-ops, finding-provenance) decides, as for the server actions.
import { Body, Controller, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { endpoints } from '@tasnivo/contracts';
import {
  acceptDictionaryFor, confirmDictionaryEntry, deleteDictionaryEntry, dictionaryPage, setDictionaryAutoAccept, updateDictionaryEntry,
} from '@tasnivo/domain/dictionary-ops';
import { findingProvenance } from '@tasnivo/domain/finding-provenance';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import type { z, ZodTypeAny } from 'zod';
import { ApiError } from '../http/errors';
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
    return updateDictionaryEntry(user, p.entryId, body.code, locale, body.confirm === true);
  }

  @Route(e.confirm)
  confirm(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(pipe(e.confirm.params)) p: In<typeof e.confirm.params>) {
    return confirmDictionaryEntry(user, p.entryId, locale);
  }

  @Route(e.remove)
  remove(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Param(pipe(e.remove.params)) p: In<typeof e.remove.params>) {
    return deleteDictionaryEntry(user, p.entryId, locale);
  }

  @Route(e.provenance)
  async provenance(@CurrentUser() user: User, @Param(pipe(e.provenance.params)) p: In<typeof e.provenance.params>) {
    const found = await findingProvenance(user, p.findingId);
    if (!found) throw new ApiError(404, 'not_found', 'Not found.');
    return found;
  }
}
