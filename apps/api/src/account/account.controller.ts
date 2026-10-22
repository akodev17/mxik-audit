// endpoints.account: the org's settings (branding, retention, closing and reopening, the export,
// Telegram chats, API keys, the audit log) and the browser's preferences (language, theme, sidebar).
// Thin: each handler parses with the registry's schemas and calls the same @tasnivo/domain function
// as the server action, route handler or page it replaces.
import { Body, Controller, Inject, Param, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { endpoints, type ResponseOf } from '@tasnivo/contracts';
import {
  accountSettings, addApiKeyForm, apiKeysView, chooseLocale, exportAccount, saveBrandingForm, telegramLinkCode, telegramLinksView,
} from '@tasnivo/domain/account-settings';
import { activityView, type ActivityQuery } from '@tasnivo/domain/activity-view';
import { revokeApiKey } from '@tasnivo/domain/api/keys';
import { apiConfig } from '@tasnivo/domain/api/limits';
import { appOrigin } from '@tasnivo/domain/app-url';
import { planLimits, TRIAL_DAYS } from '@tasnivo/domain/billing/limits';
import { MAX_UPLOAD_BYTES } from '@tasnivo/domain/catalog-import';
import { RETENTION_CHOICES, setRetention } from '@tasnivo/domain/security/account';
import { closeAccountForm, closedAccountStatus, reopenAccount } from '@tasnivo/domain/security/account-security';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import { telegramConfig } from '@tasnivo/domain/telegram/config';
import { unlink } from '@tasnivo/domain/telegram/linking';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { SessionService } from '../auth-core/session.service';
import { CurrentUser, Locale } from '../http/decorators';
import { ApiError } from '../http/errors';
import type { ApiRequest } from '../http/request';
import { Route } from '../http/route';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { setLocaleCookie, setPrefCookie, SIDEBAR_COOKIE, THEME_COOKIE } from './prefs';
import { TelegramWebhook } from './telegram-webhook';

const e = endpoints.account;

type Answer<K extends keyof typeof e> = ResponseOf<(typeof e)[K]>;
type Upload = { buffer: Buffer; size: number };

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * The logo's own limit (300 KB, PNG/JPEG by content) is checked by the domain and answered as a
 * form error, as the action did; this cap only stops absurd uploads before they reach memory.
 */
const LOGO_UPLOAD_CAP = 5 * 1024 * 1024;

@ApiTags('account')
@Controller()
export class AccountController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(TelegramWebhook) private readonly webhook: TelegramWebhook,
  ) {}

  @Route(e.get)
  async get(@CurrentUser() user: User): Promise<Answer<'get'>> {
    const org = await accountSettings(user.orgId);
    return { ...org, rawRetentionSince: isoOrNull(org.rawRetentionSince) };
  }

  @Route(e.config)
  config(): Answer<'config'> {
    const api = apiConfig();
    return {
      uploadMaxBytes: MAX_UPLOAD_BYTES,
      api: { ratePerMinute: api.ratePerMinute, maxCheckItems: api.maxCheckItems, checksPerMonth: api.checksPerMonth },
      plans: planLimits(),
      trialDays: TRIAL_DAYS,
      retentionChoices: [...RETENTION_CHOICES],
      origin: appOrigin(),
    };
  }

  @Route(e.saveBranding)
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: LOGO_UPLOAD_CAP, files: 1 } }))
  saveBranding(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(e.saveBranding.multipart.fields)) fields: { brandName?: string; removeLogo?: 'on' },
    @UploadedFile() logo: Upload | undefined,
    @Locale() locale: LocaleCode,
  ): Promise<Answer<'saveBranding'>> {
    return saveBrandingForm(user, { brandName: fields.brandName, removeLogo: fields.removeLogo === 'on', logo: logo && logo.size > 0 ? logo.buffer : null }, locale);
  }

  @Route(e.setRetention)
  setRetention(@CurrentUser() user: User, @Body(new ZodValidationPipe(e.setRetention.body)) body: { days: number | null }): Promise<Answer<'setRetention'>> {
    return setRetention(user, body.days);
  }

  /** Closed: this browser is signed out too. */
  @Route(e.close)
  async close(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(e.close.body)) body: { password: string },
    @Locale() locale: LocaleCode,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Answer<'close'>> {
    const result = await closeAccountForm(user, body.password, locale);
    if ('redirect' in result) this.sessions.clear(res);
    return result;
  }

  /** The session of a closed org: accepted here while its record is live (SessionGuard refuses a closed org). */
  @Route(e.closedStatus, { session: 'manual' })
  async closedStatus(@Req() req: ApiRequest): Promise<Answer<'closedStatus'>> {
    const status = await closedAccountStatus(await this.sessions.read(req));
    if (!status) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
    return { purgeOn: isoOrNull(status.purgeOn), canReopen: status.canReopen };
  }

  @Route(e.reopen, { session: 'manual' })
  async reopen(@Req() req: ApiRequest): Promise<Answer<'reopen'>> {
    return { redirect: await reopenAccount(await this.sessions.read(req)) };
  }

  @Route(e.exportZip)
  async exportZip(@CurrentUser() user: User, @Locale() locale: LocaleCode, @Res() res: Response): Promise<void> {
    const { zip, filename } = await exportAccount(user, locale);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(zip);
  }

  /** The cookie for this browser, and the user's saved choice when signed in (not a demo visitor). */
  @Route(e.setLocale)
  async setLocale(@Body(new ZodValidationPipe(e.setLocale.body)) body: { locale: string }, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response): Promise<Answer<'setLocale'>> {
    setLocaleCookie(res, await chooseLocale(body.locale, await this.sessions.currentUser(req)));
    return { ok: true };
  }

  @Route(e.setTheme)
  setTheme(@Body(new ZodValidationPipe(e.setTheme.body)) body: { theme: string }, @Res({ passthrough: true }) res: Response): Answer<'setTheme'> {
    setPrefCookie(res, THEME_COOKIE, body.theme);
    return { ok: true };
  }

  @Route(e.setSidebar)
  setSidebar(@Body(new ZodValidationPipe(e.setSidebar.body)) body: { state: string }, @Res({ passthrough: true }) res: Response): Answer<'setSidebar'> {
    setPrefCookie(res, SIDEBAR_COOKIE, body.state);
    return { ok: true };
  }

  @Route(e.telegramLinks)
  async telegramLinks(@CurrentUser() user: User): Promise<Answer<'telegramLinks'>> {
    const view = await telegramLinksView(user.orgId);
    return { ...view, links: view.links.map((l) => ({ ...l, createdAt: iso(l.createdAt) })) };
  }

  @Route(e.telegramCode)
  telegramCode(@CurrentUser() user: User): Promise<Answer<'telegramCode'>> {
    return telegramLinkCode(user);
  }

  @Route(e.telegramUnlink)
  async telegramUnlink(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.telegramUnlink.params)) { linkId }: { linkId: string }): Promise<Answer<'telegramUnlink'>> {
    return { ok: await unlink(user, linkId) };
  }

  /** grammy's webhook handler; 404 while the bot is off, 503 without TELEGRAM_WEBHOOK_SECRET. */
  @Route(e.telegramWebhook)
  async telegramWebhook(@Req() req: ApiRequest, @Res() res: Response): Promise<void> {
    const config = telegramConfig();
    if (!config.enabled) throw new ApiError(404, 'not_found', 'telegram disabled');
    if (!config.webhookSecret) throw new ApiError(503, 'unavailable', 'TELEGRAM_WEBHOOK_SECRET not set');
    await this.webhook.handle(config, config.webhookSecret, req, res);
  }

  @Route(e.apiKeys)
  async apiKeys(@CurrentUser() user: User): Promise<Answer<'apiKeys'>> {
    const view = await apiKeysView(user.orgId);
    return {
      ...view,
      keys: view.keys.map((k) => ({ ...k, createdAt: iso(k.createdAt), lastUsedAt: isoOrNull(k.lastUsedAt), revokedAt: isoOrNull(k.revokedAt) })),
    };
  }

  @Route(e.createApiKey)
  createApiKey(@CurrentUser() user: User, @Body(new ZodValidationPipe(e.createApiKey.body)) body: { name: string }): Promise<Answer<'createApiKey'>> {
    return addApiKeyForm(user, body.name);
  }

  @Route(e.revokeApiKey)
  revokeApiKey(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.revokeApiKey.params)) { keyId }: { keyId: string }): Promise<Answer<'revokeApiKey'>> {
    return revokeApiKey(user, keyId);
  }

  @Route(e.activity)
  async activity(@CurrentUser() user: User, @Query(new ZodValidationPipe(e.activity.query)) query: ActivityQuery): Promise<Answer<'activity'>> {
    const view = await activityView(user, query);
    return { ...view, rows: view.rows.map((r) => ({ ...r, at: iso(r.at) })) };
  }
}
