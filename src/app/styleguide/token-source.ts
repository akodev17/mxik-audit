import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type TokenGroup = 'color' | 'type' | 'radius' | 'shadow' | 'spacing' | 'layout' | 'motion' | 'other';
export type Token = { name: string; declared: string; group: TokenGroup };

const FILES = { app: 'src/styles/app-tokens.css', landing: 'src/components/landing/landing.css' } as const;

function groupOf(name: string): TokenGroup {
  if (/^(color|lp-color)-/.test(name) || name.startsWith('color-')) return 'color';
  if (name.startsWith('text-') || name.startsWith('font-')) return 'type';
  if (name.startsWith('radius-')) return 'radius';
  if (name.startsWith('shadow-') || name.startsWith('elevation-')) return 'shadow';
  if (name.startsWith('spacing-')) return 'spacing';
  if (name.startsWith('container-') || name.startsWith('z-index-')) return 'layout';
  if (name.startsWith('duration-') || name.startsWith('ease-') || name.startsWith('animate-')) return 'motion';
  return 'other';
}

/** Every `--name: value;` declaration of a stylesheet, first declaration wins (the light values). */
function parse(css: string): Token[] {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const seen = new Map<string, Token>();
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
    const name = m[1] ?? '';
    if (!seen.has(name)) seen.set(name, { name, declared: (m[2] ?? '').trim().replace(/\s+/g, ' '), group: groupOf(name) });
  }
  return [...seen.values()];
}

/** The tokens exactly as the stylesheets declare them; the guide shows these, never copies. */
export async function readTokens(): Promise<{ app: Token[]; landing: Token[] }> {
  const [app, landing] = await Promise.all(Object.values(FILES).map((f) => readFile(join(process.cwd(), f), 'utf8')));
  return { app: parse(app ?? ''), landing: parse(landing ?? '').filter((t) => t.name.startsWith('color-lp-') || t.name.startsWith('radius-lp')) };
}
