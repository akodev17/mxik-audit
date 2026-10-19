import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CONTAINER } from '@/components/landing/container';
import { LandingShell } from '@/components/landing/shell';
import { findArticle, HELP_ARTICLES, HELP_COPY, helpPath, type HelpLang } from '@/lib/help';
import { helpBody } from '@/lib/help-mdx';

type Route = { lang: HelpLang; slug: string | null };

/** /yordam, /yordam/<slug>, /yordam/ru and /yordam/ru/<slug>. */
function resolve(path: string[] | undefined): Route | null {
  const parts = path ?? [];
  const lang: HelpLang = parts[0] === 'ru' ? 'ru' : 'uz';
  const rest = lang === 'ru' ? parts.slice(1) : parts;
  if (rest.length > 1) return null;
  const slug = rest[0] ?? null;
  if (slug && !findArticle(slug)) return null;
  return { lang, slug };
}

export function generateStaticParams() {
  const slugs = HELP_ARTICLES.map((a) => a.slug);
  return [[], ['ru'], ...slugs.map((s) => [s]), ...slugs.map((s) => ['ru', s])].map((path) => ({ path }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ path?: string[] }> }): Promise<Metadata> {
  const route = resolve((await params).path);
  if (!route) return {};
  const article = route.slug ? findArticle(route.slug) : null;
  const other: HelpLang = route.lang === 'uz' ? 'ru' : 'uz';
  return {
    title: `${article ? article.title[route.lang] : HELP_COPY[route.lang].title} — MXIK Audit`,
    description: article ? article.description[route.lang] : HELP_COPY[route.lang].description,
    alternates: {
      canonical: helpPath(route.lang, route.slug ?? undefined),
      languages: { uz: helpPath('uz', route.slug ?? undefined), ru: helpPath('ru', route.slug ?? undefined), [other]: helpPath(other, route.slug ?? undefined) },
    },
    openGraph: { title: article ? article.title[route.lang] : HELP_COPY[route.lang].title, type: 'article', locale: route.lang === 'ru' ? 'ru_RU' : 'uz_UZ' },
  };
}

const ARTICLE_STYLE = 'space-y-4 text-[17px] leading-relaxed [&_h2]:mt-8 [&_h2]:text-[24px] [&_li]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-lp-brand [&_a]:underline [&_code]:rounded [&_code]:bg-lp-surface [&_code]:px-1';

export default async function HelpPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const route = resolve((await params).path);
  if (!route) notFound();
  const { lang, slug } = route;
  const copy = HELP_COPY[lang];
  const article = slug ? findArticle(slug) : null;
  const Body = article ? await helpBody(lang, article.slug) : null;

  return (
    <LandingShell>
      <div className={`${CONTAINER} py-12 sm:py-16`}>
        <article className="max-w-[44rem]" lang={lang}>
          <p className="text-[15px]">
            {article ? <Link href={helpPath(lang)} className="text-lp-brand underline">{copy.back}</Link> : null}
            <Link href={helpPath(lang === 'uz' ? 'ru' : 'uz', slug ?? undefined)} className="float-right text-lp-brand underline" hrefLang={lang === 'uz' ? 'ru' : 'uz'}>{copy.other}</Link>
          </p>
          <h1 className="mt-4 text-[34px] sm:text-[44px]">{article ? article.title[lang] : copy.title}</h1>
          {Body ? <div className={`mt-8 ${ARTICLE_STYLE}`}><Body /></div> : (
            <>
              <p className="mt-3 text-[17px] text-lp-muted">{copy.description}</p>
              <ul className="mt-8 space-y-5">
                {HELP_ARTICLES.map((a) => (
                  <li key={a.slug}>
                    <Link href={helpPath(lang, a.slug)} className="text-[20px] text-lp-brand underline">{a.title[lang]}</Link>
                    <p className="mt-1 text-[16px] text-lp-muted">{a.description[lang]}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      </div>
    </LandingShell>
  );
}
