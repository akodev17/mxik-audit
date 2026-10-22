// Redirects inside the site with a relative Location. Behind a proxy, request.url carries the
// server's own host (localhost:3000), so an absolute URL built from it would leave the site.
import { NextResponse } from 'next/server';

/** 307 keeps the method (GET callbacks); 303 turns a POST into a GET (sign-out). */
export function redirectTo(path: string, status: 303 | 307 = 307): NextResponse {
  return new NextResponse(null, { status, headers: { location: path } });
}
