// The signed-in user as the API sees it, read once per server render (the layout and the page share it).
import { cache } from 'react';
import { pageData } from './page-data';
import { serverApi } from './server';

/** `GET /api/auth/me`; no session redirects to sign-in. */
export const apiMe = cache(() => pageData(serverApi().auth.me()));
