// Links that keep a list page's filters while changing one of them (domain query-string.ts).

type Params = Record<string, string | string[] | undefined>;

/** `path` with the current params, `change` applied on top (null or '' removes a key). */
export function withQuery(path: string, current: Params, change: Record<string, string | null> = {}): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (key in change) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) q.set(key, v);
  }
  for (const [key, value] of Object.entries(change)) if (value) q.set(key, value);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
