// Server components of the catalogue screens: the signed-in user and API reads, once per request.
import { isApiError } from '@tasnivo/api-client';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { signedIn, type Me } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';

/** The signed-in user (auth.me); signed out goes to the sign-in page, as currentUser() did. */
export async function signedInUser(): Promise<Me> {
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  return user;
}

/** An API read whose 404 is the page's 404 (another org's catalogue reads like a missing one); 401 signs in. */
export async function orNotFound<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (isApiError(error) && error.status === 404) notFound();
    if (isApiError(error) && error.status === 401) redirect('/sign-in');
    throw error;
  }
}

/** The same, with null instead of the 404 page (and for a signed-out visitor). */
export async function orNull<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 401)) return null;
    throw error;
  }
}

/** The catalogue header (catalogs.get), once per request: the tab title and the page both need it. */
export const catalogHeader = cache((catalogId: string) => serverApi().catalogs.get({ catalogId }));
