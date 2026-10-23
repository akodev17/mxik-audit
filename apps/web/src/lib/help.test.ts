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

type Tier = HelpConfig['tiers'][number]['tier'];
const LIMITS = {
  trial: { clients: 3, rowsPerMonth: 5_000, seats: 2 },
  company: { clients: 1, rowsPerMonth: 20_000, seats: 3 },
  accountant: { clients: 10, rowsPerMonth: 50_000, seats: 5 },
  firm: { clients: null, rowsPerMonth: 200_000, seats: 10 },
};
const CHECKS = { trial: 500, company: 1_000, accountant: 10_000, firm: 50_000 };
const offer = (tier: Tier, monthly: number) => ({
  tier, limits: LIMITS[tier], apiChecks: CHECKS[tier],
  monthly: { id: `${tier}_monthly`, price: monthly, kind: 'subscription' as const, maxRows: null, tier, months: 1 },
  yearly: { id: `${tier}_yearly`, price: monthly * 10, kind: 'subscription' as const, maxRows: null, tier, months: 12 },
});

/** GET /api/config with the plans the API ships (apps/api's account test checks the endpoint). */
const CONFIG: HelpConfig = {
  uploadMaxBytes: 20 * 1024 * 1024,
  api: { ratePerMinute: 60, maxCheckItems: 100, checksPerMonth: CHECKS },
  plans: LIMITS,
  tiers: [offer('company', 390_000), offer('accountant', 900_000), offer('firm', 1_800_000)],
  trialDays: 14, retentionChoices: [7, 30, 90], origin: null, firmPrice: 1_800_000, closeAfterDays: 30,
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

  it('quotes plan names, prices and limits only from configuration and the pricing dictionary', async () => {
    const uz = await render('uz', 'tariflar-va-limitlar');
    for (const name of ['Koʻrik', 'Korxona', 'Buxgalter', 'Byuro']) assert.match(uz, new RegExp(name));
    assert.match(uz, /390\s000 soʻm \/ oy/);
    assert.match(uz, /3\s900\s000 soʻm \/ yil/);
    assert.match(uz, /200\s000/);
    const ru = await render('ru', 'tariflar-va-limitlar');
    for (const name of ['Проверка', 'Предприятие', 'Бухгалтер', 'Бюро']) assert.match(ru, new RegExp(name));
    assert.match(ru, /18\s000\s000 сум \/ год/);
    const repriced = await render('uz', 'tariflar-va-limitlar', { ...CONFIG, tiers: [offer('company', 450_000), offer('accountant', 900_000), offer('firm', 1_800_000)] });
    assert.match(repriced, /450\s000 soʻm \/ oy/);
    assert.doesNotMatch(repriced, /390\s000/);
  });

  it('heading ids keep letters of both scripts', () => {
    assert.equal(headingId('Lugʻat sahifasi'), 'lugʻat-sahifasi');
    assert.equal(headingId('Как это работает'), 'как-это-работает');
  });
});
