import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Children, isValidElement, type ComponentType, type ReactNode } from 'react';
import { CONTAINER } from '@/components/landing/container';
import { LandingShell } from '@/components/landing/shell';
import {
  findArticle, HELP_ARTICLES, HELP_COPY, HELP_LANG_NAMES, HELP_LANG_PARAM, headingId, helpHeadings, helpPath, type HelpHeading, type HelpLang,
} from '@tasnivo/domain/help';
import { helpBody } from '@/lib/help-mdx';
import { getLocale } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { readTheme } from '@/ui/shell/server-prefs';
import { liveComponents } from './live-config';

type Route = { lang: HelpLang; slug: string | null };
type Params = Promise<{ path?: string[] }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** /yordam, /yordam/<slug>, /yordam/ru and /yordam/ru/<slug>. */
function resolve(parts: string[] | undefined): Route | null {
  const all = parts ?? [];
  const lang: HelpLang = all[0] === 'ru' ? 'ru' : 'uz';
  const rest = lang === 'ru' ? all.slice(1) : all;
  if (rest.length > 1) return null;
  const slug = rest[0] ?? null;
  if (slug && !findArticle(slug)) return null;
  return { lang, slug };
}

export function generateStaticParams() {
  const slugs = HELP_ARTICLES.map((a) => a.slug);
  return [[], ['ru'], ...slugs.map((s) => [s]), ...slugs.map((s) => ['ru', s])].map((p) => ({ path: p }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const route = resolve((await params).path);
  if (!route) return {};
  const article = route.slug ? findArticle(route.slug) : null;
  const slug = route.slug ?? undefined;
  return {
    title: `${article ? article.title[route.lang] : HELP_COPY[route.lang].title} — Tasnivo`,
    description: article ? article.description[route.lang] : HELP_COPY[route.lang].description,
    alternates: { canonical: helpPath(route.lang, slug), languages: { uz: helpPath('uz', slug), ru: helpPath('ru', slug) } },
    openGraph: { title: article ? article.title[route.lang] : HELP_COPY[route.lang].title, type: 'article', locale: route.lang === 'ru' ? 'ru_RU' : 'uz_UZ' },
  };
}

/** The visible text of a heading's children, for its anchor. */
function textOf(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : '';
  }).join('');
}

function H2({ children }: { children?: ReactNode }) {
  return <h2 id={headingId(textOf(children))} className="scroll-mt-6">{children}</h2>;
}

async function articleSource(lang: HelpLang, slug: string): Promise<string> {
  return readFile(path.join(process.cwd(), 'apps', 'web', 'src', 'content', 'yordam', lang, `${slug}.mdx`), 'utf8');
}

const ARTICLE_STYLE = 'space-y-4 text-[17px] leading-relaxed [&_h2]:mt-10 [&_h2]:text-[24px] [&_li]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-lp-brand [&_a]:underline [&_code]:rounded [&_code]:bg-lp-surface [&_code]:px-1';

/** Both languages as a two-part switch; the current one is marked, the other links to the same article. */
function LangSwitch({ lang, slug, label }: { lang: HelpLang; slug: string | null; label: string }) {
  const href = (l: HelpLang): string => `${helpPath(l, slug ?? undefined)}${l === 'uz' ? `?${HELP_LANG_PARAM}=uz` : ''}`;
  return (
    <nav aria-label={label}>
      <ul className="inline-flex rounded-lp border border-lp-line-strong p-0.5 text-[15px]">
        {(['uz', 'ru'] as const).map((l) => (
          <li key={l}>
            <Link
              href={href(l)} hrefLang={l} lang={l} aria-current={l === lang ? 'page' : undefined}
              className={`block rounded-[7px] px-3 py-1 font-medium ${l === lang ? 'bg-lp-ink text-lp-base' : 'text-lp-muted hover:text-lp-ink'}`}
            >
              {HELP_LANG_NAMES[l]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Toc({ headings, title }: { headings: HelpHeading[]; title: string }) {
  return (
    <nav aria-label={title} className="text-[15px]">
      <p className="mb-2 font-semibold">{title}</p>
      <ol className="space-y-1.5 border-l border-lp-line pl-3">
        {headings.map((h) => <li key={h.id}><a href={`#${h.id}`} className="text-lp-muted hover:text-lp-brand hover:underline">{h.text}</a></li>)}
      </ol>
    </nav>
  );
}

export default async function HelpPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const route = resolve((await params).path);
  if (!route) notFound();
  const { lang, slug } = route;
  // Readers get their language cookie's version unless they chose Uzbek on the switch; signed-in
  // readers also get a way back to the app. cookies() first marks the page dynamic.
  await cookies();
  const chose = (await searchParams)[HELP_LANG_PARAM];
  if (lang === 'uz' && chose !== 'uz' && (await getLocale()) === 'ru') redirect(helpPath('ru', slug ?? undefined));
  const [user, theme] = await Promise.all([currentUser().catch(() => null), readTheme()]);

  const copy = HELP_COPY[lang];
  const article = slug ? findArticle(slug) : null;
  const Body = article ? (await helpBody(lang, article.slug)) as ComponentType<{ components: Record<string, ComponentType> }> : null;
  const headings = article ? helpHeadings(await articleSource(lang, article.slug)) : [];

  return (
    <LandingShell lang={lang} signedIn={user !== null} theme={theme}>
      <div className={`${CONTAINER} py-10 sm:py-14`}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-[15px]">
          {article ? <Link href={helpPath(lang)} className="text-lp-brand underline">{copy.back}</Link> : <span />}
          <LangSwitch lang={lang} slug={slug} label={copy.language} />
        </div>
        {Body && article ? (
          <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,46rem)_15rem] lg:gap-16">
            <article className="min-w-0">
              <h1 className="text-[34px] sm:text-[44px]">{article.title[lang]}</h1>
              {headings.length > 1 ? (
                <details className="mt-6 rounded-lp border border-lp-line p-3 lg:hidden">
                  <summary className="cursor-pointer text-[15px] font-semibold">{copy.onPage}</summary>
                  <div className="mt-3"><Toc headings={headings} title={copy.onPage} /></div>
                </details>
              ) : null}
              <div className={`mt-8 ${ARTICLE_STYLE}`}><Body components={{ h2: H2, ...liveComponents(lang) }} /></div>
              <p className="mt-12 text-[15px]"><Link href={helpPath(lang)} className="text-lp-brand underline">{copy.home}</Link></p>
            </article>
            {headings.length > 1 ? (
              <aside className="hidden lg:block">
                <div className="sticky top-8"><Toc headings={headings} title={copy.onPage} /></div>
              </aside>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 max-w-5xl">
            <h1 className="text-[34px] sm:text-[44px]">{copy.title}</h1>
            <p className="mt-3 max-w-[44rem] text-[17px] text-lp-muted">{copy.description}</p>
            <ul className="mt-10 grid gap-x-10 gap-y-7 md:grid-cols-2">
              {HELP_ARTICLES.map((a) => (
                <li key={a.slug}>
                  <Link href={helpPath(lang, a.slug)} className="text-[20px] text-lp-brand underline">{a.title[lang]}</Link>
                  <p className="mt-1 text-[16px] text-lp-muted">{a.description[lang]}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </LandingShell>
  );
}
