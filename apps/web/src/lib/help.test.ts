import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { liveComponents, type HelpConfig } from '@/app/yordam/[[...path]]/live-config';
import { HELP_ARTICLES, headingId, helpHeadings, type HelpLang } from '@/lib/help';
import { helpBody } from './help-mdx';

const LANGS: HelpLang[] = ['uz', 'ru'];
const source = (lang: HelpLang, slug: string): Promise<string> => readFile(path.join(process.cwd(), 'apps', 'web', 'src', 'content', 'yordam', lang, `${slug}.mdx`), 'utf8');

/** GET /api/config with the defaults the API ships (apps/api's account test checks the endpoint). */
const CONFIG: HelpConfig = {
  uploadMaxBytes: 20 * 1024 * 1024,
  api: { ratePerMinute: 60, maxCheckItems: 100, checksPerMonth: { trial: 500, firm: null } },
  plans: { trial: { clients: 3, rowsPerMonth: 5_000, seats: 2 }, firm: { clients: null, rowsPerMonth: null, seats: null } },
  trialDays: 14, retentionChoices: [7, 30, 90], origin: null, firmPrice: null, closeAfterDays: 30,
};

async function render(lang: HelpLang, slug: string, config: HelpConfig = CONFIG): Promise<string> {
  const Body = (await helpBody(lang, slug)) as (props: { components: Record<string, unknown> }) => ReactNode;
  // Article headings are plain text, so children is a string here.
  const h2 = ({ children }: { children?: string }) => createElement('h2', { id: headingId(children ?? '') }, children);
  return renderToStaticMarkup(createElement(Body, { components: { h2, ...liveComponents(lang, config) } }));
}

describe('help center articles', () => {
  it('every article exists in both languages, compiles and renders with the live tags', async () => {
    for (const article of HELP_ARTICLES) {
      for (const lang of LANGS) {
        const html = await render(lang, article.slug);
        assert.ok(html.length > 200, `${lang}/${article.slug} rendered`);
      }
    }
  });

  it('the table of contents points at the ids the headings get', async () => {
    for (const article of HELP_ARTICLES) {
      for (const lang of LANGS) {
        const html = await render(lang, article.slug);
        for (const heading of helpHeadings(await source(lang, article.slug))) {
          assert.ok(html.includes(`id="${heading.id}"`), `${lang}/${article.slug}: #${heading.id}`);
        }
      }
    }
  });

  it('uses the honest suggestion labels, never the old certainty words', async () => {
    const uz = await source('uz', 'hisobotni-oqish');
    const ru = await source('ru', 'hisobotni-oqish');
    for (const label of ['Yuqori moslik', 'Oʻrtacha moslik', 'Past moslik']) assert.ok(uz.includes(label), label);
    for (const label of ['Высокое совпадение', 'Среднее совпадение', 'Низкое совпадение']) assert.ok(ru.includes(label), label);
    assert.doesNotMatch(uz, /\*Aniq\*|\*Ehtimoliy\*/);
    assert.doesNotMatch(ru, /\*Точно\*|\*Вероятно\*/);
  });

  it('no longer says uploaded cells are kept forever', async () => {
    assert.doesNotMatch(await source('uz', 'tez-tez-soraladigan-savollar'), /Asl hujayralar saqlanadi/);
    assert.doesNotMatch(await source('ru', 'tez-tez-soraladigan-savollar'), /Исходные ячейки сохраняются/);
  });

  it('quotes the firm price only from configuration', async () => {
    assert.match(await render('uz', 'tariflar-va-limitlar'), /kelishiladi/);
    assert.match(await render('ru', 'tariflar-va-limitlar'), /по запросу/);
    assert.match(await render('uz', 'tariflar-va-limitlar', { ...CONFIG, firmPrice: 450_000 }), /450\s000 soʻm \/ oy/);
  });

  it('heading ids keep letters of both scripts', () => {
    assert.equal(headingId('Lugʻat sahifasi'), 'lugʻat-sahifasi');
    assert.equal(headingId('Как это работает'), 'как-это-работает');
  });
});
