// Request and response shapes of the auth routes. Local for now; W1c's @tasnivo/contracts will own
// them (and generate the OpenAPI schemas, which are written out by hand below until then).
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/** Shape only. The e-mail format is judged by the service, which answers like a wrong password. */
export const SignInBody = z.object({
  email: z.string().max(200),
  password: z.string().max(200),
  /** Where to land afterwards: a same-site path (safeNext); anything else means /dashboard. */
  next: z.string().max(512).optional(),
});
export type SignInBody = z.infer<typeof SignInBody>;

export type SignInResponse = {
  ok: true;
  /** The page to open: the landing page, /sign-in/2fa while a code is due, or /account-deleted. */
  next: string;
  /** Password accepted, two-factor code still to enter (next = /sign-in/2fa). */
  twoFactor: boolean;
};

export const signInBodySchema: SchemaObject = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', maxLength: 200, example: 'buxgalter@demo.uz' },
    password: { type: 'string', maxLength: 200 },
    next: { type: 'string', maxLength: 512, example: '/dashboard' },
  },
};

export const signInResponseSchema: SchemaObject = {
  type: 'object',
  properties: { ok: { type: 'boolean', enum: [true] }, next: { type: 'string' }, twoFactor: { type: 'boolean' } },
};

export const errorSchema: SchemaObject = {
  type: 'object',
  properties: {
    error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } },
  },
};

export const meResponseSchema: SchemaObject = {
  type: 'object',
  properties: {
    user: {
      type: 'object',
      properties: {
        userId: { type: 'string' }, orgId: { type: 'string' }, email: { type: 'string' }, demo: { type: 'boolean' },
        clientId: { type: 'string', nullable: true }, role: { type: 'string', enum: ['admin', 'accountant', 'viewer'] },
        clientIds: { type: 'array', items: { type: 'string' }, nullable: true },
      },
    },
    org: {
      type: 'object',
      properties: {
        id: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
        deletedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    role: { type: 'string', enum: ['admin', 'accountant', 'viewer'] },
    clientIds: { type: 'array', items: { type: 'string' }, nullable: true },
    locale: { type: 'string', enum: ['uz', 'ru'] },
  },
};
