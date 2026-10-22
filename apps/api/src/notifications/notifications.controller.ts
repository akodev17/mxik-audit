// In-app notifications (the page, the bell, marking read) and the command-palette search. Thin: the
// domain (shell-ops) reads and writes; a database error is `{ ok: false, error: 'failed' }`, as the
// shell actions answered.
import { Body, Controller, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { endpoints } from '@tasnivo/contracts';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import { bellPreview, noticesPage, paletteSearch, readAllNotices, readNotices } from '@tasnivo/domain/shell-ops';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import type { z, ZodTypeAny } from 'zod';
import { Route } from '../http/route';
import { CurrentUser, Locale } from '../http/decorators';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.notifications;
type In<S extends ZodTypeAny> = z.output<S>;
const pipe = <S extends ZodTypeAny>(schema: S) => new ZodValidationPipe(schema);

@Controller()
@ApiTags('notifications')
export class NotificationsController {
  @Route(e.list)
  list(@CurrentUser() user: User, @Query(pipe(e.list.query)) q: In<typeof e.list.query>) {
    return noticesPage(user, { page: q.page, unreadOnly: q.unread === true, group: q.group });
  }

  @Route(e.preview)
  preview(@CurrentUser() user: User) {
    return bellPreview(user);
  }

  @Route(e.markRead)
  markRead(@CurrentUser() user: User, @Body(pipe(e.markRead.body)) body: In<typeof e.markRead.body>) {
    return readNotices(user, body.ids);
  }

  @Route(e.markAllRead)
  markAllRead(@CurrentUser() user: User) {
    return readAllNotices(user);
  }

  @Route(e.search)
  search(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Query(pipe(e.search.query)) q: In<typeof e.search.query>) {
    return paletteSearch(user, q.q, locale);
  }
}
