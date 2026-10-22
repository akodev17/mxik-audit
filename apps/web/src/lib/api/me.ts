// The signed-in user as the API sees them (GET /api/auth/me), read once per server render.
// No session sends the browser to sign-in, as currentUser() + redirect did; any other failure
// reaches the error page.
import { isApiError } from '@tasnivo/api-client';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { serverApi } from './server';

export const requireMe = cache(async () => {
  try {
    return await serverApi().auth.me();
  } catch (error) {
    if (isApiError(error) && error.status === 401) redirect('/sign-in');
    throw error;
  }
});

type Role = Awaited<ReturnType<typeof requireMe>>['role'];

/** Admins and accountants change data; viewers only read (domain access.ts canWrite). */
export const canWrite = (me: { role: Role }): boolean => me.role === 'admin' || me.role === 'accountant';
export const isAdminRole = (me: { role: Role }): boolean => me.role === 'admin';
