// The order of the sessions list (Settings → Security). Pure, so the web page and the API share it.
type Session = { id: string; lastSeenAt: Date };

/** This device first, then the most recently active. */
export function orderSessions<T extends Session>(sessions: readonly T[], currentId: string | null | undefined): T[] {
  return [...sessions].sort((a, b) => {
    if ((a.id === currentId) !== (b.id === currentId)) return a.id === currentId ? -1 : 1;
    return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
  });
}
