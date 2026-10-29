// What the isolation matrix sends each registry operation: the seed id behind every path parameter,
// the id fields of bodies, queries and upload fields, the upload files, and the operations that are
// deliberately outside the matrix (one reason each). A new operation with a path parameter the map
// does not know, or a new body id the matrix does not fill, fails the matrix until it is added here.
import { readFileSync } from 'node:fs';
import type { Endpoint } from '@tasnivo/contracts';
import { sample } from './zod-sample';
import type { ClientSeed, OrgSeed } from './isolation-seeds';
import { xlsx } from '../upload-fixtures';

export type Seeds = { c: ClientSeed; o: OrgSeed; code: string };

/** Operations the matrix leaves out on purpose. */
export const OUTSIDE: Record<string, string> = {
  // No session: these never see an org's ids.
  'auth.config': 'public sign-in settings; no org data',
  'auth.signIn': 'public form; auth.test.ts',
  'auth.resendConfirmation': 'public form; auth.test.ts',
  'auth.forgotPassword': 'public form; security.test.ts',
  'auth.resetTarget': 'the token is the credential; security.test.ts',
  'auth.resetPassword': 'the token is the credential; security.test.ts',
  'auth.signUp': 'public form; auth.test.ts',
  'auth.signOut': 'ends the caller\'s own session only',
  'auth.verifyEmail': 'the token is the credential; auth.test.ts',
  'auth.google': 'OAuth redirect; no org data',
  'auth.googleCallback': 'OAuth state is the credential; security.test.ts',
  'auth.twoFactorSubmit': 'pending 2FA state lives in the caller\'s cookie',
  'auth.twoFactorPending': 'pending 2FA state lives in the caller\'s cookie',
  'auth.telegramLoginStart': 'public; telegram.test.ts',
  'auth.telegramLogin': 'signed Telegram data is the credential; telegram.test.ts',
  'auth.telegramBind': 'signed Telegram data and a state token; telegram.test.ts',
  'account.modules': 'public module states; no org data',
  'account.config': 'public site settings; no org data',
  'account.setLocale': 'a cookie preference; no org data',
  'account.setTheme': 'a cookie preference; no org data',
  'account.setSidebar': 'a cookie preference; no org data',
  'account.telegramWebhook': 'Telegram callback, signed with the webhook secret; telegram.test.ts',
  'team.readInvite': 'the invite token is the credential; team.test.ts',
  'team.join': 'the invite token is the credential; team.test.ts',
  'team.joinCheck': 'the invite token is the credential; team.test.ts (D5)',
  'team.joinWithAccount': 'the invite token is the credential; team.test.ts (D5)',
  'billing.click': 'provider callback, signature-checked; billing.test.ts',
  'billing.payme': 'provider callback, signature-checked; billing.test.ts',
  'demo.config': 'public demo settings',
  'demo.request': 'public lead form',
  'demo.peek': 'the demo link token is the credential; demo.test.ts',
  'demo.open': 'the demo link token is the credential; demo.test.ts',
  'demo.lead': 'public lead form',
  'check': 'API key, no id: answers only what it was sent; public-api.test.ts',
  'openapi': 'public document',
  'share.view': 'the share token is the credential; catalogs.test.ts share cases',
  'share.pdf': 'the share token is the credential; catalogs.test.ts share cases',
  'cron.daily': 'cron bearer; no caller org; cron.test.ts',
  'cron.classifierUpdate': 'cron bearer; no caller org; cron.test.ts',
  'health.get': 'public health probe',
  // Signed-in, but only the caller's own account, never an id of someone else's data.
  'auth.verifyCode': 'the caller\'s own e-mail code',
  'auth.resendCode': 'the caller\'s own e-mail code',
  'auth.twoFactorState': 'the caller\'s own 2FA state',
  'auth.twoFactorStart': 'the caller\'s own 2FA (noDemo guard covered)',
  'auth.twoFactorFinish': 'the caller\'s own 2FA (noDemo guard covered)',
  'auth.twoFactorOff': 'the caller\'s own 2FA (noDemo guard covered)',
  'auth.recoveryCodes': 'the caller\'s own 2FA (noDemo guard covered)',
  'auth.changePassword': 'the caller\'s own password (noDemo guard covered)',
  'auth.telegramBindStart': 'the caller\'s own Telegram (noDemo guard covered)',
  'auth.telegramUnbind': 'the caller\'s own Telegram (noDemo guard covered)',
  'auth.endOtherSessions': 'the caller\'s own sessions (noDemo guard covered)',
  'account.setTour': 'the caller\'s own tour flag',
  'notifications.markAllRead': 'the caller\'s own read marks',
};

/** Writes open to every role (not `writer`/`admin`), each with why a viewer may call it. */
export const ANY_ROLE_WRITES: Record<string, string> = {
  'auth.verifyCode': 'own account', 'auth.resendCode': 'own account', 'auth.changePassword': 'own account',
  'auth.twoFactorStart': 'own account', 'auth.twoFactorFinish': 'own account', 'auth.twoFactorOff': 'own account',
  'auth.recoveryCodes': 'own account', 'auth.endSession': 'own sessions', 'auth.endOtherSessions': 'own sessions',
  'auth.telegramBindStart': 'own account', 'auth.telegramUnbind': 'own account', 'account.setTour': 'own preference',
  'clients.switchActive': 'which visible client the session shows', 'notifications.markRead': 'own read marks',
  'notifications.markAllRead': 'own read marks', 'team.joinWithAccount': 'own account joins a firm',
  'onec.prepare': 'a dry run that builds the file in memory and stores nothing',
};

const PREVIEW_OPS = new Set(['catalogs.preview', 'catalogs.diagnose', 'catalogs.commit', 'catalogs.discard']);

/** Path parameters that never name an org's resource (credentials checked elsewhere). */
const TOKEN_PARAMS = new Set(['token', 'state']);

/** The seed behind a path parameter of an operation; undefined = the map does not know it. */
export function paramValue(e: Endpoint, name: string, s: Seeds): string | undefined {
  const { c, o } = s;
  if (name === 'batchId') return { bank: c.bankBatchId, onec: c.bankBatchId, didox: c.didoxBatchId, products: c.productBatchId }[e.module as string];
  if (name === 'recordId') return { bank: c.bankRecordId, onec: c.bankRecordId, didox: c.didoxRecordId, products: c.productRecordId }[e.module as string];
  if (name === 'linkId') return e.module === 'account' ? o.telegramLinkId : c.shareLinkId;
  if (name === 'listId' && e.operationId === 'imports.restartDoc') return c.failedDocListId;
  if (name === 'listId') return e.path.startsWith('/api/purchases') ? c.purchaseListId : c.docListId;
  if (name === 'entryId') return e.module === 'dictionary' ? o.entryId : undefined;
  // The upload steps act on a catalogue still in preview; retry on one whose audit failed.
  if (name === 'catalogId' && PREVIEW_OPS.has(e.operationId)) return c.uploadCatalogId;
  if (name === 'catalogId' && e.operationId === 'catalogs.retry') return c.failedCatalogId;
  if (name === 'findingId' && e.operationId === 'workspace.nameFromBarcode') return c.barcodeFindingId;
  const plain: Record<string, string> = {
    clientId: c.clientId, catalogId: c.catalogId, findingId: c.findingId, eventId: c.flagEventId, taskId: c.reminderTaskId,
    exportId: c.exportId, ruleId: c.bankRuleId, productId: c.productId, viewId: o.viewId, userId: o.memberId,
    inviteId: o.inviteId, keyId: o.apiKeyId, sid: o.sessionId, formatId: o.bankFormatId,
  };
  return plain[name];
}

/** Path parameters naming a client's resource (the scoped check applies); the rest are org-wide. */
export const CLIENT_PARAMS = new Set(['clientId', 'catalogId', 'findingId', 'eventId', 'taskId', 'exportId', 'ruleId', 'productId', 'batchId', 'recordId', 'listId']);
export const isClientParam = (e: Endpoint, name: string): boolean => CLIENT_PARAMS.has(name) || (name === 'linkId' && e.module !== 'account');

export const pathParamsOf = (e: Endpoint): string[] => [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').filter((p) => !TOKEN_PARAMS.has(p));

/** Body, query and upload-field ids, per operation (merged over a valid sample of the schema). */
type Fill = { body?: (s: Seeds) => Record<string, unknown>; query?: (s: Seeds) => Record<string, string>; fields?: (s: Seeds) => Record<string, string>; file?: () => Promise<Upload> };
export type Upload = { name: string; data: Buffer };

const sheet = async (): Promise<Upload> => ({ name: 'mahsulotlar.xlsx', data: await xlsx([['Nomi', 'MXIK', 'Birlik', 'Shtrixkod'], ['Non oq 400 g', '', 'dona', '']]) });
const bankFile = (): Promise<Upload> => Promise.resolve({ name: 'vypiska.xlsx', data: readFileSync(new URL('../../../../packages/domain/src/bank/fixtures/ru-debit-credit.xlsx', import.meta.url)) });

export const FILL: Record<string, Fill> = {
  'account.activity': { query: ({ c, o }) => ({ client: c.clientId, user: o.memberId }) },
  'clients.switchActive': { body: ({ c }) => ({ clientId: c.clientId }) },
  'clients.remove': { body: () => ({ confirmName: 'x' }) },
  'clients.setAccountants': { body: ({ o }) => ({ userIds: [o.memberId] }) },
  'catalogs.list': { query: ({ c }) => ({ clientId: c.clientId }) },
  'catalogs.previewUpload': { fields: ({ c }) => ({ clientId: c.clientId }), file: sheet },
  'catalogs.exportFile': { query: ({ c }) => ({ catalog: c.catalogId }) },
  'catalogs.exportDiffCsv': { query: ({ c }) => ({ catalog: c.catalogId }) },
  'catalogs.exportReportCsv': { query: ({ c }) => ({ catalog: c.catalogId }) },
  'catalogs.exportPdf': { query: ({ c }) => ({ catalog: c.catalogId }) },
  'catalogs.assignReview': { body: ({ o }) => ({ assigneeId: o.memberId }) },
  'workspace.decide': { body: ({ code }) => ({ decision: 'accepted', chosenMxik: code }) },
  'workspace.decideGroup': { body: ({ c }) => ({ findingIds: [c.findingId], decision: 'rejected' }) },
  // The eventId form names another member's decision; lastInCatalog only ever undoes the caller's own.
  'workspace.undo': { body: ({ c }) => ({ eventId: c.decisionEventId }) },
  'workspace.bulkPreview': { body: ({ c }) => ({ target: { ids: [c.findingId] }, action: { kind: 'reject' } }) },
  'workspace.bulkApply': { body: ({ c }) => ({ target: { ids: [c.findingId] }, action: { kind: 'reject' } }) },
  'workspace.setFlag': { body: () => ({ flag: 'resolved' }) },
  'workspace.setDefaultView': { body: ({ o }) => ({ viewId: o.viewId }) },
  'workspace.queue': { query: ({ c, o }) => ({ client: c.clientId, accountant: o.memberId }) },
  'workspace.dashboard': { query: ({ o }) => ({ accountant: o.memberId }) },
  'dictionary.update': { body: ({ code }) => ({ code }) },
  'imports.uploadPurchases': { file: sheet },
  'imports.uploadDoc': { fields: () => ({ kind: 'sales' }), file: sheet },
  'imports.applyPurchases': { body: () => ({ map: { name: 0, mxik: 1, unit: -1 } }) },
  'imports.applyDoc': { body: () => ({ map: { name: -1, mxik: 0, unit: -1, quantity: -1, amount: -1, date: -1 } }) },
  'team.invite': { body: ({ c }) => ({ role: 'accountant', kind: 'link', access: 'selected', clientIds: [c.clientId] }) },
  'team.updateMember': { body: ({ c }) => ({ role: 'accountant', access: 'selected', clientIds: [c.clientId] }) },
  'reminders.saveSchedule': { body: ({ o }) => ({ dayOfMonth: 5, assigneeId: o.memberId, enabled: true }) },
  'notifications.markRead': { body: ({ o }) => ({ ids: [o.notificationId] }) },
  'billing.checkout': { body: ({ c }) => ({ planId: 'catalog_500', catalogId: c.catalogId, provider: 'click' }) },
  'onec.batches': { query: ({ c }) => ({ client: c.clientId }) },
  'onec.prepare': { body: ({ c }) => ({ format: 'bank_exchange_1_02', recordIds: [c.bankRecordId] }) },
  'onec.exportBatch': { body: ({ c }) => ({ format: 'bank_exchange_1_02', recordIds: [c.bankRecordId] }) },
  'onec.transfer': { body: ({ c }) => ({ format: 'odata', recordIds: [c.bankRecordId] }) },
  'onec.decideMany': { body: ({ c }) => ({ recordIds: [c.bankRecordId], decision: { action: 'approve' } }) },
  'onec.counterparties': { query: ({ c }) => ({ client: c.clientId }) },
  'onec.importCounterparties': { fields: ({ c }) => ({ clientId: c.clientId }), file: sheet },
  'bank.preview': { fields: ({ c }) => ({ clientId: c.clientId }), file: bankFile },
  'bank.create': { fields: ({ c }) => ({ clientId: c.clientId }), file: bankFile },
  'bank.list': { query: ({ c }) => ({ client: c.clientId }) },
  'bank.approve': { body: ({ c }) => ({ scope: 'ids', ids: [c.bankRecordId] }) },
  'didox.list': { query: ({ c }) => ({ clientId: c.clientId }) },
  'didox.upload': { fields: ({ c }) => ({ clientId: c.clientId }), file: sheet },
  'didox.commitSheet': { fields: ({ c }) => ({ clientId: c.clientId, map: JSON.stringify({ name: 0 }), header: '0' }), file: sheet },
  'didox.saveConnection': { body: ({ c }) => ({ kind: 'token', companyTin: '123456789', token: 'tok-1234567890', clientId: c.clientId }) },
  'products.list': { query: ({ c }) => ({ client: c.clientId }) },
  'products.confirm': { body: ({ code }) => ({ code }) },
  'products.check': { body: ({ c }) => ({ ids: [c.productId], clientId: c.clientId }) },
  'products.importPreview': { fields: ({ c }) => ({ clientId: c.clientId }), file: sheet },
  'products.importCommit': { fields: ({ c }) => ({ clientId: c.clientId, mapping: JSON.stringify({ name: 0, mxik: 1, unit: 2, barcode: 3 }) }), file: sheet },
  'products.exportAll': { body: ({ c }) => ({ clientId: c.clientId }) },
};

/** No-id operations whose body/query/fields carry an id of another tenant's resource (FILL marks them). */
export const takesBodyId = (e: Endpoint): boolean => e.operationId in FILL && !!(FILL[e.operationId]?.body || FILL[e.operationId]?.query || FILL[e.operationId]?.fields);

export type Built = { path: string; query: Record<string, string>; body: unknown; fields: Record<string, string> | null; file: Upload | null };

/** The full request for an operation against these seeds; throws for a path parameter the map does not know. */
export async function build(e: Endpoint, s: Seeds): Promise<Built> {
  const fill = FILL[e.operationId] ?? {};
  let path = e.path;
  for (const name of [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '')) {
    const value = TOKEN_PARAMS.has(name) ? 'x' : paramValue(e, name, s);
    if (value === undefined) throw new Error(`${e.operationId}: isolation-specs.ts has no seed for {${name}}`);
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }
  const baseQuery = e.query ? sample(e.query) as Record<string, unknown> : {};
  const query = Object.fromEntries(Object.entries({ ...baseQuery, ...fill.query?.(s) }).map(([k, v]) => [k, String(v)]));
  const body = e.body ? { ...(sample(e.body) as Record<string, unknown>), ...fill.body?.(s) } : undefined;
  if (e.body && !e.body.safeParse(body).success) throw new Error(`${e.operationId}: the matrix body does not pass the contract: ${JSON.stringify(body)}`);
  const fields = e.multipart ? Object.fromEntries(Object.entries({ ...(sample(e.multipart.fields) as Record<string, unknown>), ...fill.fields?.(s) }).map(([k, v]) => [k, String(v)])) : null;
  const file = e.multipart ? await (fill.file ?? sheet)() : null;
  return { path, query, body, fields, file };
}
