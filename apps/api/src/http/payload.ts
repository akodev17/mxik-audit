// Small helpers between a route and the domain call.
import { ApiError } from './errors';

/** 404 `not_found`: a resource that does not exist and one the user may not see answer the same. */
export const notFound = (): ApiError => new ApiError(404, 'not_found', 'Not found.');

/** The value, or 404 when the domain answered null (missing, or not the user's to see). */
export function found<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw notFound();
  return value;
}

/**
 * The action's payload from a JSON body and the path's ids: the API moved the id into the path,
 * the domain still reads one object. A body that is not an object adds nothing (the domain then
 * refuses the payload as the action did); the path wins over a body field of the same name.
 */
export function withPath(body: unknown, path: Record<string, string>): Record<string, unknown> {
  return { ...(body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {}), ...path };
}
