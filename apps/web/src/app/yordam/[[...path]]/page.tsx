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
  findArticle, HELP_ARTICLES, HELP_COPY, HELP_LANG_NAMES, HELP_LANG_PARAM, headingId, helpHeadings, helpPath, type HelpArticle, type HelpHeading, type HelpLang,
} from '@/lib/help';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { helpBody } from '@/lib/help-mdx';
import { getLocale } from '@/lib/locale';
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
  return <h2 id={headingId(textOf(children))} className="scroll-mt-24">{children}</h2>;
}

async function articleSource(lang: HelpLang, slug: string): Promise<string> {
  return readFile(path.join(process.cwd(), 'apps', 'web', 'src', 'content', 'yordam', lang, `${slug}.mdx`), 'utf8');
}

// Readable long-form text: a 17px body with generous leading, clear section breaks, lists with
// quiet markers, links that read as links, code and tables in the landing's surface tokens.
const ARTICLE_STYLE = [
  'text-[17px] leading-[1.75] text-lp-ink',
  '[&>*+*]:mt-5',
  '[&_h2]:mt-12 [&_h2]:border-t [&_h2]:border-lp-line [&_h2]:pt-8 [&_h2]:text-[24px] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-tight',
  '[&_h2:first-child]:mt-0 [&_h2:first-child]:border-t-0 [&_h2:first-child]:pt-0',
  '[&_h3]:mt-8 [&_h3]:text-[19px] [&_h3]:font-semibold',
  '[&_strong]:font-semibold',
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mt-2 [&_li]:pl-1 [&_li::marker]:text-lp-muted',
  '[&_a]:font-medium [&_a]:text-lp-brand [&_a]:underline [&_a]:decoration-lp-brand/40 [&_a]:underline-offset-4 hover:[&_a]:decoration-lp-brand',
  '[&_code]:rounded [&_code]:bg-lp-surface [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.9em]',
  '[&_blockquote]:border-l-4 [&_blockquote]:border-lp-line-strong [&_blockquote]:pl-4 [&_blockquote]:text-lp-muted',
  '[&_table]:w-full [&_table]:text-[15px] [&_th]:border-b [&_th]:border-lp-line-strong [&_th]:py-2 [&_th]:text-left [&_td]:border-b [&_td]:border-lp-line [&_td]:py-2',
].join(' ');

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

/** The headings of the article being read. */
function Toc({ headings, title }: { headings: HelpHeading[]; title: string }) {
  return (
    <nav aria-label={title} className="text-[15px]">
      <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-lp-muted">{title}</p>
      <ol className="space-y-2 border-l border-lp-line">
        {headings.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} className="-ml-px block border-l-2 border-transparent pl-3 leading-snug text-lp-muted hover:border-lp-brand hover:text-lp-ink">{h.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Every article of the help centre, the open one marked. */
function ArticleNav({ lang, current, title }: { lang: HelpLang; current: string; title: string }) {
  return (
    <nav aria-label={title} className="text-[15px]">
      <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-lp-muted">{title}</p>
      <ul className="space-y-0.5">
        {HELP_ARTICLES.map((a) => {
          const open = a.slug === current;
          return (
            <li key={a.slug}>
              <Link
                href={helpPath(lang, a.slug)} aria-current={open ? 'page' : undefined}
                className={`block rounded-lp px-3 py-2 leading-snug ${open ? 'bg-lp-surface font-semibold text-lp-ink' : 'text-lp-muted hover:bg-lp-surface hover:text-lp-ink'}`}
              >
                {a.title[lang]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** An article on the index as a card: title, one line, an arrow. */
function ArticleCard({ lang, article }: { lang: HelpLang; article: HelpArticle }) {
  return (
    <Link
      href={helpPath(lang, article.slug)}
      className="group flex h-full flex-col rounded-lp-lg border border-lp-line bg-lp-base p-5 transition-colors hover:border-lp-line-strong hover:bg-lp-surface"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-[19px] font-semibold leading-snug text-lp-ink group-hover:text-lp-brand">{article.title[lang]}</span>
        <span aria-hidden className="mt-0.5 text-lp-muted transition-transform group-hover:translate-x-0.5 group-hover:text-lp-brand">→</span>
      </span>
      <span className="mt-2 text-[15px] leading-relaxed text-lp-muted">{article.description[lang]}</span>
    </Link>
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
  const article = slug ? findArticle(slug) : null;
  // The numbers an article quotes come from the API's configuration (live-config.tsx).
  const [user, theme, config] = await Promise.all([signedIn().catch(() => null), readTheme(), article ? serverApi().account.config() : null]);

  const copy = HELP_COPY[lang];
  const Body = article ? (await helpBody(lang, article.slug)) as ComponentType<{ components: Record<string, ComponentType> }> : null;
  const headings = article ? helpHeadings(await articleSource(lang, article.slug)) : [];

  return (
    <LandingShell lang={lang} signedIn={user !== null} theme={theme}>
      <div className={`${CONTAINER} py-10 sm:py-14`}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-[15px]">
          {article ? (
            <nav aria-label={copy.back}>
              <ol className="flex flex-wrap items-center gap-2 text-lp-muted">
                <li><Link href={helpPath(lang)} className="hover:text-lp-ink hover:underline">{copy.back}</Link></li>
                <li aria-hidden>/</li>
                <li aria-current="page" className="text-lp-ink">{article.title[lang]}</li>
              </ol>
            </nav>
          ) : <span />}
          <LangSwitch lang={lang} slug={slug} label={copy.language} />
        </div>

        {Body && article && config ? (
          <div className="mt-8 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[14rem_minmax(0,44rem)_13rem]">
            <aside className="hidden lg:block">
              <div className="sticky top-8"><ArticleNav lang={lang} current={article.slug} title={copy.articles} /></div>
            </aside>
            <article className="min-w-0">
              <h1 className="text-[34px] font-semibold leading-tight tracking-tight sm:text-[42px]">{article.title[lang]}</h1>
              <p className="mt-3 text-[18px] leading-relaxed text-lp-muted">{article.description[lang]}</p>
              {headings.length > 1 ? (
                <details className="mt-6 rounded-lp border border-lp-line p-4 xl:hidden">
                  <summary className="cursor-pointer text-[15px] font-semibold">{copy.onPage}</summary>
                  <div className="mt-4"><Toc headings={headings} title={copy.onPage} /></div>
                </details>
              ) : null}
              <div className={`mt-10 ${ARTICLE_STYLE}`}><Body components={{ h2: H2, ...liveComponents(lang, config) }} /></div>
              <div className="mt-14 border-t border-lp-line pt-8 lg:hidden">
                <ArticleNav lang={lang} current={article.slug} title={copy.home} />
              </div>
            </article>
            {headings.length > 1 ? (
              <aside className="hidden xl:block">
                <div className="sticky top-8"><Toc headings={headings} title={copy.onPage} /></div>
              </aside>
            ) : null}
          </div>
        ) : (
          <div className="mt-8">
            <h1 className="text-[34px] font-semibold leading-tight tracking-tight sm:text-[44px]">{copy.title}</h1>
            <p className="mt-3 max-w-[44rem] text-[18px] leading-relaxed text-lp-muted">{copy.description}</p>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {HELP_ARTICLES.map((a) => <li key={a.slug}><ArticleCard lang={lang} article={a} /></li>)}
            </ul>
          </div>
        )}
      </div>
    </LandingShell>
  );
}
