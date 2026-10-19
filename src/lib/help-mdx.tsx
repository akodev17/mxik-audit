// Compiles one help article (MDX) to a React component on the server.
import { evaluate } from '@mdx-js/mdx';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as runtime from 'react/jsx-runtime';
import type { HelpLang } from './help';

export async function helpBody(lang: HelpLang, slug: string): Promise<React.ComponentType> {
  const file = path.join(process.cwd(), 'src', 'content', 'yordam', lang, `${slug}.mdx`);
  const { default: Content } = await evaluate(await readFile(file, 'utf8'), { ...runtime, development: false });
  return Content;
}
