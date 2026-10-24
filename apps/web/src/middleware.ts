// Module flags on the web side: a page under the route prefix of a COMING_SOON module (packages/
// contracts/src/feature-modules.ts) is answered by /coming-soon/<module>; one of a HIDDEN module, and
// /admin/features for anyone but a platform admin, by the 404 of an address that does not exist. The
// URL in the address bar stays. Here rather than in a page, so the 404 is the status too (a page under
// (app) streams behind loading.tsx and has sent 200 by the time it calls notFound()).
import { NextResponse, type NextRequest } from 'next/server';
import { modulesOfRoute, strictest, underPrefix } from '@tasnivo/contracts/feature-modules';
import { getModuleStates } from '@/lib/modules';

/** No page lives here (a leading underscore is a private folder), so Next answers its 404. */
const NOT_FOUND = '/_module-off';
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** The admin read answers 404 to everyone but a platform admin (ADMIN_EMAILS); a failed call lets the page decide. */
async function platformAdmin(req: NextRequest): Promise<boolean> {
  const res = await fetch(`${API}/api/admin/features`, { headers: { cookie: req.headers.get('cookie') ?? '' }, cache: 'no-store' }).catch(() => null);
  return !res || res.ok || res.status >= 500;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (underPrefix(pathname, '/admin/features')) {
    return (await platformAdmin(req)) ? NextResponse.next() : NextResponse.rewrite(new URL(NOT_FOUND, req.url));
  }
  const keys = modulesOfRoute(pathname);
  if (keys.length === 0) return NextResponse.next();
  // Unreadable states let the page through: the API refuses a switched-off module's routes itself.
  const hit = await getModuleStates().then((states) => strictest(keys, states), () => null);
  if (!hit || hit.state === 'ENABLED') return NextResponse.next();
  return NextResponse.rewrite(new URL(hit.state === 'HIDDEN' ? NOT_FOUND : `/coming-soon/${hit.key}`, req.url));
}

export const config = {
  runtime: 'nodejs',
  // Pages only: no /api (the API's own guard), Next's assets or files with an extension.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
