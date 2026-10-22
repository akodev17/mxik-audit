// Page reads through serverApi(): a missing session goes to sign-in and a record the user may not see
// (404, or 403 for a role) is the page's not-found, as when the pages read the database themselves.
import { notFound, redirect } from 'next/navigation';
import { isApiError } from '@tasnivo/api-client';

export async function pageData<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (isApiError(error)) {
      if (error.status === 401) redirect('/sign-in');
      if (error.status === 403 || error.status === 404) notFound();
    }
    throw error;
  }
}
