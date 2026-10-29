// endpoints.team: members, invites and joining with one. Thin: each handler parses with the
// registry's schemas and calls @tasnivo/domain/team-forms, as the web app's team actions do.
import { Body, Controller, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { endpoints, type ResponseOf } from '@tasnivo/contracts';
import { isDemoOrg } from '@tasnivo/domain/demo';
import { readInvite } from '@tasnivo/domain/invites';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import {
  inviteMemberForm, joinWithInviteForm, resendInviteForm, revokeInviteForm, teamOverview, updateMemberForm, type InviteInput,
} from '@tasnivo/domain/team-forms';
import { removalCheckFor, removeMemberForm } from '@tasnivo/domain/team-removal';
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

  @Route(e.removalCheck)
  removalCheck(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.removalCheck.params)) { userId }: UserParam): Promise<Answer<'removalCheck'>> {
    return removalCheckFor(user, userId);
  }

  /** The member's open reviews go to `reassignTo`, or with `dropReviews` are dropped; neither, and they hold some, is refused. */
  @Route(e.removeMember)
  removeMember(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(e.removeMember.params)) { userId }: UserParam,
    @Query(new ZodValidationPipe(e.removeMember.query)) query: { reassignTo?: string; dropReviews?: boolean },
    @Locale() locale: LocaleCode,
  ): Promise<Answer<'removeMember'>> {
    return removeMemberForm(user, userId, query, locale);
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
}
