// Agent 5 Phase A walk: every page as the seed user, uz/ru, 1280 light and 375 dark, in Edge.
// Records navigation status, console errors, page errors, failed API calls, horizontal overflow,
// suspicious text (undefined, NaN, raw i18n keys, Uzbek text in Russian), and a screenshot each.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.WALK_BASE ?? 'http://a5q.localhost:3025';
const S = JSON.parse(readFileSync('tmp/agent5/seed-ids.json', 'utf8'));
const SHOTS = 'tmp/agent5/walk';
mkdirSync(SHOTS, { recursive: true });
const routes = [
  '/', '/demo', '/sign-in', '/sign-up', '/sign-in/forgot', '/maxfiylik', '/oferta', '/api-docs', '/yordam', '/nope-404',
  '/dashboard', '/queue', '/review', '/clients', `/clients/${S.clientId}`, `/clients/${S.clientId}/imports`, `/clients/${S.clientId}/purchases`,
  `/clients/${S.clientId}/purchases`.replace('purchases', 'imports/' + S.purchaseListId),
  '/catalogs', `/catalogs/${S.catalogId}`, `/catalogs/${S.catalogId}/diff`, `/catalogs/${S.catalogId}/report`, '/catalogs/doesnotexist',
  '/upload', '/activity', '/notifications', '/dictionary', '/team', '/export', '/report',
  '/settings?tab=account', '/settings?tab=security', '/settings?tab=plan', '/settings?tab=integrations', '/settings?tab=data',
  '/admin', '/bank', '/didox', '/products', '/onec', '/r/not-a-token', '/invite/not-a-token', '/reset/not-a-token', '/demo/verify/not-a-token',
];
const browser = await chromium.launch({ channel: 'msedge' });
const results = [];
for (const locale of (process.env.WALK_LOCALES ?? 'uz,ru').split(',')) {
  for (const [width, theme] of [[1280, 'light'], [375, 'dark']].filter(([w]) => !process.env.WALK_WIDTHS || process.env.WALK_WIDTHS.split(',').includes(String(w)))) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    const host = new URL(BASE).hostname;
    await context.addCookies([{ name: 'mxik_locale', value: locale, domain: host, path: '/' }, { name: 'mxik_theme', value: theme, domain: host, path: '/' }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/sign-in`);
    await page.locator('#email').fill('buxgalter@demo.uz');
    await page.locator('#password').fill('demo12345');
    await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/dashboard'), { timeout: 60000 }), page.locator('form button[type=submit]').first().click()]);
    await context.addCookies([{ name: 'mxik_locale', value: locale, domain: host, path: '/' }]);
    for (const route of routes) {
      const errors = []; const failed = [];
      const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); };
      const onPageError = (e) => errors.push('pageerror: ' + String(e).slice(0, 200));
      const onResponse = (r) => { if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); };
      page.on('console', onConsole); page.on('pageerror', onPageError); page.on('response', onResponse);
      let status = null;
      try {
        const res = await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 });
        status = res?.status() ?? null;
      } catch (e) { errors.push('goto: ' + String(e).slice(0, 120)); }
      await page.waitForTimeout(400);
      const info = await page.evaluate((loc) => {
        const text = document.body?.innerText ?? '';
        const over = document.documentElement.scrollWidth - window.innerWidth;
        const sus = [];
        for (const re of [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/, /\b[a-z]+X\.[a-zA-Z]+\.[a-zA-Z.]+/, /\{\{?\w+\}\}?/]) { const m = text.match(re); if (m) sus.push(m[0]); }
        let uzInRu = [];
        if (loc === 'ru') {
          const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 3 && /[ʻʼ]|\b(va|bilan|uchun|yoʻq|qilish|Yuklash|Mijoz|Katalog|tekshir)/i.test(l) && !/[а-яё]/i.test(l));
          uzInRu = lines.slice(0, 6);
        }
        const wide = over > 1 ? [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`) : [];
        return { title: document.title, h1: document.querySelector('h1')?.innerText?.slice(0, 80) ?? null, path: location.pathname + location.search, over, wide, sus, uzInRu };
      }, locale).catch((e) => ({ err: String(e) }));
      const name = `${locale}-${width}-${route.replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'root'}.jpg`;
      await page.screenshot({ path: `${SHOTS}/${name}`, type: 'jpeg', quality: 50 }).catch(() => {});
      page.off('console', onConsole); page.off('pageerror', onPageError); page.off('response', onResponse);
      results.push({ locale, width, route, status, ...info, errors: [...new Set(errors)].slice(0, 5), failed: [...new Set(failed)].slice(0, 5), shot: name });
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(`tmp/agent5/walk-${process.env.WALK_LOCALES ?? 'all'}.json`, JSON.stringify(results, null, 1));
for (const r of results) {
  const flags = [];
  if (r.status && r.status >= 400) flags.push(`status ${r.status}`);
  if (r.over > 1) flags.push(`overflow ${r.over}px ${r.wide.join(' ')}`);
  if (r.errors.length) flags.push(`console ${r.errors.join(' || ')}`);
  if (r.failed.length) flags.push(`api ${r.failed.join(', ')}`);
  if (r.sus?.length) flags.push(`text ${r.sus.join(', ')}`);
  if (r.uzInRu?.length) flags.push(`uz-in-ru ${r.uzInRu.join(' / ').slice(0, 200)}`);
  console.log(`${r.locale} ${r.width} ${r.route} -> ${r.path} [${r.status}] "${r.title}" ${flags.length ? '!! ' + flags.join(' ;; ') : 'ok'}`);
}
