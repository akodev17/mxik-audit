// The signed-in user as the API sees it, for server components: once per render (React cache), so
// the metadata, the page and the parts it renders share one call. Null when the API answers 401.
import { cache } from 'react';
import { isApiError, type OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { serverApi } from './server';

export type Me = OutputOf<typeof endpoints.auth.me>;
export type Role = Me['role'];

export const signedIn = cache(async (): Promise<Me | null> => {
  try {
    return await serverApi().auth.me();
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
});
