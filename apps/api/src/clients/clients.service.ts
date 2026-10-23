// The clients endpoints (formerly the web app's clients and switchClient server actions) over the domain:
// the same refusals, in the user's language, and the same change to the session's active client.
import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { endpoints } from '@tasnivo/contracts';
import { switchableClient } from '@tasnivo/domain/active-client';
import { clientList, clientPage, type ClientListQuery } from '@tasnivo/domain/client-page';
import {
  archiveClient, assignableAccountants, deleteClient, renameClient, restoreClient, setClientAccountants,
  type Dependant, type LifecycleError,
} from '@tasnivo/domain/client-lifecycle';
import { createClient, ownedClient } from '@tasnivo/domain/clients';
import { allows, planStatus } from '@tasnivo/domain/plan';
import type { CurrentUser } from '@tasnivo/domain/session';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { SessionService } from '../auth-core/session.service';
import { ApiError } from '../http/errors';
import type { ApiRequest } from '../http/request';

type Fail = { ok: false; error: string };
type Ok = { ok: true };
const e = endpoints.clients;

/** A body or path the action would have refused gets the action's message, not a 400. */
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data as z.infer<S> : null;
}

@Injectable()
export class ClientsService {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  list(user: CurrentUser, query: ClientListQuery) {
    return clientList(user, query);
  }

  /** 404 for a client that is missing, another org's or outside the user's scope: the page's notFound(). */
  async page(user: CurrentUser, clientId: string) {
    const page = await clientPage(user, clientId);
    if (!page) throw new ApiError(404, 'not_found', 'Client not found.');
    return page;
  }

  /** actions/clients.ts addClient: plan gate, create, and the new client becomes the active one. */
  async create(user: CurrentUser, body: unknown, locale: Locale, req: ApiRequest, res: Response): Promise<{ ok: true; clientId: string } | Fail> {
    const { t, ta } = i18nFor(locale);
    const status = await planStatus(user.orgId);
    const allowed = allows(status, 'clients');
    if (!allowed.ok) return { ok: false, error: ta.msg.gate[allowed.reason] };
    const input = parse(e.create.body, body);
    if (!input) return { ok: false, error: t.clientsBadName };
    // The cap again, counted under the org's lock in createClient: parallel requests cannot pass it.
    const result = await createClient(user, input.name, status.limits.clients);
    if (!result.ok) {
      const error = result.error === 'full' ? ta.msg.gate.clients : result.error === 'forbidden' ? ta.firmX.errors.forbidden : t.clientsBadName;
      return { ok: false, error };
    }
    await this.setActive(req, res, result.clientId);
    return { ok: true, clientId: result.clientId };
  }

  /** shell.ts switchClient / clients.ts rememberClient: only a client the user may see and that is not archived. */
  async switchActive(user: CurrentUser, body: unknown, req: ApiRequest, res: Response) {
    const input = parse(e.switchActive.body, body);
    if (!input) return { ok: false as const, error: 'invalid' as const };
    const client = await switchableClient(user, input.clientId);
    if (!client) return { ok: false as const, error: 'not_found' as const };
    await this.setActive(req, res, client.id);
    return { ok: true as const, client: { id: client.id, name: client.name } };
  }

  async rename(user: CurrentUser, clientId: string, body: unknown, locale: Locale): Promise<Ok | Fail> {
    const input = parse(e.rename.body, body);
    if (!input || !parse(e.rename.params, { clientId })) return this.failure(locale, 'bad name');
    const result = await renameClient(user, clientId, input.name);
    return result.ok ? { ok: true } : this.failure(locale, result.error);
  }

  /** The archived client stops being the active one of whoever archived it. */
  async archive(user: CurrentUser, clientId: string, locale: Locale, req: ApiRequest, res: Response): Promise<{ ok: true; stranded: string[] } | Fail> {
    if (!parse(e.archive.params, { clientId })) return this.failure(locale, 'not found');
    const result = await archiveClient(user, clientId);
    if (!result.ok) return this.failure(locale, result.error);
    if (user.clientId === clientId) await this.setActive(req, res, undefined);
    return { ok: true, stranded: result.stranded };
  }

  async restore(user: CurrentUser, clientId: string, locale: Locale): Promise<Ok | Fail> {
    if (!parse(e.restore.params, { clientId })) return this.failure(locale, 'not found');
    const result = await restoreClient(user, clientId);
    return result.ok ? { ok: true } : this.failure(locale, result.error);
  }

  /** Needs the exact name typed; refused with the members it would widen, when it is someone's only client. */
  async remove(user: CurrentUser, clientId: string, body: unknown, locale: Locale, req: ApiRequest, res: Response): Promise<Ok | Fail & { blockers?: Dependant[] }> {
    const input = parse(e.remove.body, body);
    if (!input || !parse(e.remove.params, { clientId })) return this.failure(locale, 'name mismatch');
    const result = await deleteClient(user, clientId, input.confirmName);
    if (!result.ok && 'blockers' in result) return { ok: false, error: i18nFor(locale).ta.firmX.client.deleteBlocked, blockers: result.blockers };
    if (!result.ok) return this.failure(locale, result.error);
    if (user.clientId === clientId) await this.setActive(req, res, undefined);
    return { ok: true };
  }

  /** The assignment editor of the client's page: another org's client is a 404, like the page. */
  async accountants(user: CurrentUser, clientId: string) {
    if (!(await ownedClient(user.orgId, clientId))) throw new ApiError(404, 'not_found', 'Client not found.');
    return assignableAccountants(user.orgId, clientId);
  }

  async setAccountants(user: CurrentUser, clientId: string, body: unknown, locale: Locale): Promise<Ok | Fail> {
    const input = parse(e.setAccountants.body, body);
    if (!input || !parse(e.setAccountants.params, { clientId })) return this.failure(locale, 'bad user');
    const result = await setClientAccountants(user, clientId, input.userIds);
    return result.ok ? { ok: true } : this.failure(locale, result.error);
  }

  private failure(locale: Locale, error: LifecycleError): Fail {
    return { ok: false, error: i18nFor(locale).ta.firmX.errors[error] };
  }

  /** session.clientId = id (undefined: none) and the cookie re-sealed, as the actions' session.save() did. */
  private async setActive(req: ApiRequest, res: Response, clientId: string | undefined): Promise<void> {
    const session = await this.sessions.read(req);
    await this.sessions.write(res, { ...session, clientId });
  }
}
