'use client';

// What the palette offers before anything is typed: the clients, catalogues and products opened last.
// Kept in this browser only (localStorage); a blocked or empty store simply means no recent items.
import { useSyncExternalStore } from 'react';

export type RecentKind = 'client' | 'catalog' | 'product';
export type RecentItem = { kind: RecentKind; id: string; label: string; detail?: string; href: string };

export const RECENT_KEY = 'tasnivo.palette.recent';
export const RECENT_MAX = 6;
const KINDS: readonly string[] = ['client', 'catalog', 'product'];
const CHANGED = 'tasnivo:recent';

/** Newest first, one entry per thing, at most RECENT_MAX. */
export function withRecent(list: readonly RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((x) => !(x.kind === item.kind && x.id === item.id))].slice(0, RECENT_MAX);
}

/** Whatever the store held, as valid items only; internal addresses only, so a tampered entry cannot send anyone away. */
export function parseRecent(raw: string | null): RecentItem[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((x): RecentItem[] => {
      if (typeof x !== 'object' || x === null) return [];
      const { kind, id, label, detail, href } = x as Record<string, unknown>;
      if (typeof kind !== 'string' || !KINDS.includes(kind) || typeof id !== 'string' || typeof label !== 'string') return [];
      if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return [];
      return [{ kind: kind as RecentKind, id, label, href, ...(typeof detail === 'string' ? { detail } : {}) }];
    }).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

let cache: { raw: string | null; items: RecentItem[] } = { raw: null, items: [] };

function read(): RecentItem[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(RECENT_KEY);
  } catch {
    return cache.items;
  }
  if (raw !== cache.raw) cache = { raw, items: parseRecent(raw) };
  return cache.items;
}

export function rememberRecent(item: RecentItem): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(withRecent(read(), item)));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // Private window or blocked storage: nothing to remember.
  }
}

function subscribe(notify: () => void): () => void {
  window.addEventListener('storage', notify);
  window.addEventListener(CHANGED, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(CHANGED, notify);
  };
}

const NONE: RecentItem[] = [];

/** The recent items of this browser; none on the server and in the first render. */
export function useRecent(): RecentItem[] {
  return useSyncExternalStore(subscribe, read, () => NONE);
}
