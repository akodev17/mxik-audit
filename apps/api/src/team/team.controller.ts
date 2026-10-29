// endpoints.team: members, invites and joining with one (a new account, or an existing one that
// moves in, plan D5). Thin: each handler parses with the
// registry's schemas and calls @tasnivo/domain/team-forms, as the web app's team actions do.
import { Body, Controller, Inject, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { endpoints, type ResponseOf } from '@tasnivo/contracts';
import { isDemoOrg } from '@tasnivo/domain/demo';
import { readInvite } from '@tasnivo/domain/invites';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import {
  inviteMemberForm, joinCheckForm, joinWithAccountForm, joinWithInviteForm, removeMemberForm, resendInviteForm, revokeInviteForm, teamOverview, updateMemberForm,
  type InviteInput,
} from '@tasnivo/domain/team-forms';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { SessionService } from '../auth-core/session.service';
import { CurrentUser, Locale } from '../http/decorators';
import { requestFacts } from '../http/facts';
import type { ApiRequest } from '../http/request';
import { Route } from '../http/route';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.team;

type Answer<K extends keyof typeof e> = ResponseOf<(typeof e)[K]>;
type UserParam = { userId: string };
type InviteParam = { inviteId: string };
type TokenParam = { token: string };

@ApiTags('team')
@Controller()
export class TeamController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  /** An admin of a real org gets the lists; anyone else empty ones, as the page reads nothing for them. */
  @Route(e.list)
  async list(@CurrentUser() user: User): Promise<Answer<'list'>> {
    const team = await teamOverview(user, await isDemoOrg(user.orgId));
    return {
      ...team,
      members: team.members.map((m) => ({ ...m, lastSeenAt: m.lastSeenAt ? m.lastSeenAt.toISOString() : null })),
      invites: team.invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() })),
    };
  }

  @Route(e.invite)
  invite(@CurrentUser() user: User, @Body(new ZodValidationPipe(e.invite.body)) body: InviteInput, @Locale() locale: LocaleCode): Promise<Answer<'invite'>> {
    return inviteMemberForm(user, body, locale);
  }

  @Route(e.updateMember)
  updateMember(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(e.updateMember.params)) { userId }: UserParam,
    @Body(new ZodValidationPipe(e.updateMember.body)) body: { role: string; access: string; clientIds: string[] },
    @Locale() locale: LocaleCode,
  ): Promise<Answer<'updateMember'>> {
    return updateMemberForm(user, { userId, ...body }, locale);
  }

  @Route(e.removeMember)
  removeMember(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.removeMember.params)) { userId }: UserParam, @Locale() locale: LocaleCode): Promise<Answer<'removeMember'>> {
    return removeMemberForm(user, userId, locale);
  }

  @Route(e.revokeInvite)
  revokeInvite(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.revokeInvite.params)) { inviteId }: InviteParam, @Locale() locale: LocaleCode): Promise<Answer<'revokeInvite'>> {
    return revokeInviteForm(user, inviteId, locale);
  }

  @Route(e.resendInvite)
  resendInvite(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.resendInvite.params)) { inviteId }: InviteParam, @Locale() locale: LocaleCode): Promise<Answer<'resendInvite'>> {
    return resendInviteForm(user, inviteId, locale);
  }

  @Route(e.readInvite)
  readInvite(@Param(new ZodValidationPipe(e.readInvite.params)) { token }: TokenParam): Promise<Answer<'readInvite'>> {
    return readInvite(token);
  }

  /** Creates the account and signs this browser in. */
  @Route(e.join)
  async join(
    @Param(new ZodValidationPipe(e.join.params)) { token }: TokenParam,
    @Body(new ZodValidationPipe(e.join.body)) body: { email: string; password: string },
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Answer<'join'>> {
    return joinWithInviteForm(await this.sessions.forSignIn(req, res), token, body, requestFacts(req));
  }

  /** May the signed-in user join with this account (plan D5); if not, why and whom to ask. */
  @Route(e.joinCheck)
  joinCheck(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.joinCheck.params)) { token }: TokenParam, @Locale() locale: LocaleCode): Promise<Answer<'joinCheck'>> {
    return joinCheckForm(user, token, locale);
  }

  /** Moves the signed-in account into the inviting org; this browser's session is renewed there. */
  @Route(e.joinWithAccount)
  async joinWithAccount(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(e.joinWithAccount.params)) { token }: TokenParam,
    @Locale() locale: LocaleCode,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Answer<'joinWithAccount'>> {
    return joinWithAccountForm(await this.sessions.forSignIn(req, res), user, token, { userAgent: requestFacts(req).userAgent, locale });
  }
}
