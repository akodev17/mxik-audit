// Fixtures of the catalogs / imports / share e2e tests: a session cookie for any member, small
// spreadsheets built with exceljs, and a contract check of an answer. Import ./setup-env first.
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import ExcelJS from 'exceljs';
import { sealData } from 'iron-session';
import type { ZodTypeAny } from 'zod';
import { createRecord } from '@tasnivo/domain/security/session-store';
import { sessionOptions, type SessionData } from '@tasnivo/domain/session';
import { SESSION_COOKIE } from '../src/auth-core/session.service';

/** The Cookie header of a live session of this member (a real session record, sealed like the web app does). */
export async function sessionCookie(member: { userId: string; orgId: string; email: string }, extra: Partial<SessionData> = {}): Promise<string> {
  const sid = await createRecord(member.userId, member.orgId, 'api-e2e');
  const seal = await sealData({ userId: member.userId, orgId: member.orgId, email: member.email, sid, ...extra } satisfies SessionData, { password: sessionOptions.password });
  return `${SESSION_COOKIE}=${seal}`;
}

/** An .xlsx with a header row and data rows; codes stay text. */
export async function xlsx(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  for (const row of rows) sheet.addRow(row);
  sheet.columns.forEach((c) => { c.numFmt = '@'; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Asserts the answer has the registry's shape (as the api-client would parse it). */
export function matches(schema: ZodTypeAny, body: unknown, label = 'answer'): void {
  const parsed = schema.safeParse(body);
  assert.ok(parsed.success, `${label} does not match the contract: ${parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 5))}`);
}

/** Polls until `check` answers a value (not undefined), or fails after the timeout. */
export async function eventually<T>(check: () => Promise<T | undefined>, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** supertest's binary parser: the raw bytes of a download. */
export function binary(res: unknown, done: (error: Error | null, body: Buffer) => void): void {
  const stream = res as IncomingMessage;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
}
