// Server-side readers for the shell's cookies (layouts only).
import { cookies } from 'next/headers';
import { parseTheme, THEME_COOKIE, type Theme } from '../theme';
import { parseSidebar, SIDEBAR_COOKIE, type SidebarPref } from './prefs';

export async function readTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}

export async function readSidebar(): Promise<SidebarPref> {
  return parseSidebar((await cookies()).get(SIDEBAR_COOKIE)?.value);
}
