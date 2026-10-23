// Platform-admin access for the admin pages' titles: the API refuses everyone else, and the page
// then renders the not-found page, so the tab must not keep the admin title (B14).
import { cache } from 'react';
import { isApiError } from '@tasnivo/api-client';
import { serverApi } from '@/lib/api/server';

/** The cross-org numbers, read once per request by the metadata and the page. */
export const tractionOnce = cache(() => serverApi().admin.traction());

/** Whether this user may open the admin pages (the traction read answers 403/404 to everyone else). */
export async function adminAllowed(): Promise<boolean> {
  return tractionOnce().then(() => true, (error: unknown) => {
    if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
    throw error;
  });
}
