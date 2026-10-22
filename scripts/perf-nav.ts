// Tab switching benchmark (docs/engineering/TAB_SWITCH_PERFORMANCE_PLAN.md §4). Signs in as the
// seed org on a running production build and times, per switch: first feedback (skeleton or new
// heading), address change, content shown, the _rsc fetches it made, long tasks, the click's event
// timing and React commit time (profiling builds only). Passes: header tabs cold (fresh browser
// profile) and warm (same profile, every tab seen seconds ago), the settings ?tab= strip, the
// workspace (open, filter, sort, back), Back/Forward, rapid double clicks, heap growth, initial
// load. Appends { label, commit, date, conditions, results } to docs/perf-nav-results.json.
//
// Run against `npx next start -p 3001` in a worktree, never against `next dev`:
//   npm run perf:nav -- --label before
// --passes 5          cold and warm passes (one fresh profile each)
// --dwell 0           ms the pointer rests on a link before the click (intent prefetch gets that long)
// --slow              adds one cold and one warm pass under Fast 3G
// --server-log FILE   the server's stdout, started with PRISMA_LOG=1: replays each captured
//                     navigation request alone and counts its queries (docs: src/lib/db.ts)
// --commit SHA        the commit the served build was made from (default: HEAD)
// --only a,b          only these passes: tabs, settings, workspace, history, heap, fast3g (debugging; implies --no-save)
// PERF_VERBOSE=1      prints every switch as it is measured
// --no-save           print only
// PERF_BASE_URL (default http://localhost:3001), PERF_EMAIL / PERF_PASSWORD (default: the seed org
// from the README, `npm run seed`).
import '@tasnivo/domain/load-env';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright';
import { taUz } from '@tasnivo/i18n/i18n-app';

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const BASE = (process.env['PERF_BASE_URL'] ?? 'http://localhost:3001').replace(/\/$/, '');
const EMAIL = process.env['PERF_EMAIL'] ?? 'buxgalter@demo.uz';
const PASSWORD = process.env['PERF_PASSWORD'] ?? 'demo12345';
const LABEL = arg('--label') ?? 'run';
const PASSES = Number(arg('--passes') ?? '5');
const DWELL_MS = Number(arg('--dwell') ?? '0');
const SERVER_LOG = arg('--server-log');
const SLOW = process.argv.includes('--slow');
const SAVE = !process.argv.includes('--no-save') && !process.argv.includes('--only');
const BUILT_FROM = arg('--commit');
const ONLY = arg('--only')?.split(',') ?? null;
const runs = (pass: string): boolean => ONLY === null || ONLY.includes(pass);
const RESULTS = 'docs/perf-nav-results.json';
/** Sign-in attempts are rate limited per address; a per-run address keeps runs apart (as e2e/fixture.ts). */
const RUN_IP = `perf-${randomBytes(6).toString('hex')}`;
/** Pause after each switch's content is shown, as a user reading the page; the page's own link prefetches run in it. */
const SETTLE_MS = 500;
const VIEWPORT = { width: 1440, height: 900 };

/** The header tabs and the rail's settings, in the plan's order; the pass ends where it started. */
const HOME = '/dashboard';
const TABS = [HOME, '/queue', '/clients', '/catalogs', '/dictionary', '/activity', '/settings', '/team'];
const SETTINGS_TABS = ['/settings?tab=security', '/settings?tab=plan', '/settings?tab=integrations', '/settings?tab=data', '/settings'];

// ------------------------------------------------------------------ in-page probe

type Trigger = 'click' | 'change' | 'popstate';

export type Sample = {
  feedbackMs: number | null;
  /** First frame with the navigation progress bar up (src/ui/shell/navigation-progress.tsx); null when it never showed. */
  barMs: number | null;
  urlMs: number | null;
  contentMs: number | null;
  /** _rsc fetches started between the trigger and the content (the ones the switch waited for). */
  rscFetches: number;
  /** _rsc fetches started after arming and before the trigger: the intent prefetch on hover. */
  rscBeforeClick: number;
  rscKB: number;
  rscWireKB: number;
  rscMs: number | null;
  longTasks: number;
  longTaskMaxMs: number;
  /** Longest event-timing entry of the interaction (16 ms resolution floor; 0 = below it). */
  inpMs: number;
  commits: number;
  commitMs: number | null;
};

type ProbeWindow = Window & {
  __perf?: { phase: string; actualDuration: number; commitTime: number }[];
  __navProbe?: { arm: (trigger: Trigger, ready: string) => void; contentShown: () => boolean; describe: () => string; collect: () => Sample };
};

/** Installed in every page before its scripts run. Self-contained: Playwright serialises it. */
function installProbe(): void {
  const w = window as ProbeWindow;
  w.__perf = w.__perf ?? [];
  performance.setResourceTimingBufferSize(5000);
  type State = {
    armAt: number; t0: number | null; feedback: number | null; bar: number | null; url: number | null; content: number | null; done: boolean;
    start: string; oldReady: Element | null; oldBusy: Set<Element>; longTasks: [number, number][]; events: [number, number][];
  };
  let st: State | null = null;
  let observers: PerformanceObserver[] = [];
  const address = (): string => `${location.pathname}${location.search}`;

  w.__navProbe = {
    arm(trigger, ready) {
      performance.clearResourceTimings();
      const main = document.querySelector('main');
      const state: State = {
        armAt: performance.now(), t0: null, feedback: null, bar: null, url: null, content: null, done: false,
        start: address(), oldReady: document.querySelector(ready),
        oldBusy: new Set(main ? Array.from(main.querySelectorAll('[aria-busy="true"]')) : []),
        longTasks: [], events: [],
      };
      st = state;
      window.addEventListener(trigger, (e) => { if (state.t0 === null) state.t0 = e.timeStamp; }, { capture: true, once: true });
      const longTasks = new PerformanceObserver((list) => { for (const e of list.getEntries()) state.longTasks.push([e.startTime, e.duration]); });
      const events = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { interactionId?: number })[]) if (e.interactionId) state.events.push([e.startTime, e.duration]);
      });
      try { longTasks.observe({ type: 'longtask' }); } catch { /* not supported */ }
      try { events.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit); } catch { /* not supported */ }
      observers = [longTasks, events];
      const tick = (): void => {
        if (state.done) return;
        if (state.t0 !== null) {
          const now = performance.now() - state.t0;
          const main = document.querySelector('main');
          const busy = main ? Array.from(main.querySelectorAll('[aria-busy="true"]')).some((el) => !state.oldBusy.has(el)) : false;
          const node = document.querySelector(ready);
          const fresh = node !== null && node !== state.oldReady;
          const moved = address() !== state.start;
          if (state.feedback === null && (busy || (moved && fresh))) state.feedback = now;
          if (state.bar === null && state.content === null && document.querySelector('[data-navigation-pending]') !== null) state.bar = now;
          if (state.url === null && moved) state.url = now;
          if (state.content === null && moved && fresh && !busy) state.content = now;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    contentShown: () => st !== null && st.content !== null,
    describe: () => JSON.stringify({ address: address(), t0: st?.t0, feedback: st?.feedback, url: st?.url, start: st?.start }),
    collect() {
      const s = st;
      if (!s || s.t0 === null) throw new Error('probe was not triggered');
      s.done = true;
      for (const o of observers) o.disconnect();
      const t0 = s.t0;
      const end = t0 + (s.content ?? 0);
      const rsc = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((e) => e.name.includes('_rsc='));
      const nav = rsc.filter((e) => e.startTime >= t0 - 1 && e.startTime <= end);
      const before = rsc.filter((e) => e.startTime >= s.armAt && e.startTime < t0 - 1);
      const tasks = s.longTasks.filter(([start, duration]) => start + duration >= t0);
      const commits = (w.__perf ?? []).filter((c) => c.commitTime >= t0);
      const kb = (n: number): number => Math.round(n / 102.4) / 10;
      return {
        feedbackMs: s.feedback, barMs: s.bar, urlMs: s.url, contentMs: s.content,
        rscFetches: nav.length,
        rscBeforeClick: before.length,
        rscKB: kb(nav.reduce((n, e) => n + e.decodedBodySize, 0)),
        rscWireKB: kb(nav.reduce((n, e) => n + e.encodedBodySize, 0)),
        rscMs: nav.length > 0 ? Math.max(...nav.map((e) => e.responseEnd)) - t0 : null,
        longTasks: tasks.length,
        longTaskMaxMs: tasks.reduce((m, [, d]) => Math.max(m, d), 0),
        inpMs: s.events.filter(([start]) => start >= s.armAt).reduce((m, [, d]) => Math.max(m, d), 0),
        commits: commits.length,
        commitMs: commits.length > 0 ? commits.reduce((n, c) => n + c.actualDuration, 0) : null,
      };
    },
  };
}

// ------------------------------------------------------------------ browser helpers

async function newProfile(browser: Browser, storageState?: Awaited<ReturnType<BrowserContext['storageState']>>): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: BASE, viewport: VIEWPORT, locale: 'uz-UZ', timezoneId: 'Asia/Tashkent',
    extraHTTPHeaders: { 'x-real-ip': RUN_IP }, ...(storageState ? { storageState } : {}),
  });
  await context.addCookies([{ name: 'mxik_locale', value: 'uz', url: BASE }, { name: 'mxik_theme', value: 'light', url: BASE }]);
  // tsx keeps function names with an `__name` helper that the page does not have; give it one.
  await context.addInitScript({ content: `var __name = (f) => f; (${installProbe.toString()})();` });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { context, page };
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname.startsWith('/dashboard'), { waitUntil: 'commit', timeout: 60_000 }),
    page.locator('form button[type="submit"]').first().click(),
  ]);
  await page.locator('main h1').first().waitFor();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Arms the probe, runs the action, waits for the content and the settle pause, and reads the probe. */
async function measure(page: Page, trigger: Trigger, ready: string, act: () => Promise<unknown>): Promise<Sample> {
  await page.evaluate(([t, r]) => (window as ProbeWindow).__navProbe?.arm(t as Trigger, r as string), [trigger, ready]);
  await act();
  await page.waitForFunction(() => (window as ProbeWindow).__navProbe?.contentShown() === true, null, { timeout: 30_000, polling: 25 }).catch(async (error: Error) => {
    const seen = await page.evaluate(() => (window as ProbeWindow).__navProbe?.describe()).catch(() => 'page gone');
    throw new Error(`${error.message}\n    waiting for ${ready} after ${trigger}: ${seen}`);
  });
  await sleep(SETTLE_MS);
  const sample = await page.evaluate(() => {
    const probe = (window as ProbeWindow).__navProbe;
    if (!probe) throw new Error('no probe in the page');
    return probe.collect();
  });
  if (process.env['PERF_VERBOSE'] === '1') process.stdout.write(`  ${trigger} ${page.url().replace(BASE, '')}: feedback ${sample.feedbackMs} content ${sample.contentMs} rsc ${sample.rscBeforeClick}+${sample.rscFetches} responseEnd ${sample.rscMs}\n`);
  return sample;
}

/** Clicks a visible link to `href` (hovering `DWELL_MS` first) and measures the switch. */
async function clickTo(page: Page, href: string, ready = 'main h1'): Promise<Sample> {
  const link = page.locator(`a[href="${href}"]:visible`).first();
  await link.waitFor();
  return measure(page, 'click', ready, async () => {
    if (DWELL_MS > 0) {
      await link.hover();
      await sleep(DWELL_MS);
    }
    await link.click();
  });
}

/** Navigation requests the server answered while switching, kept to replay them alone (--server-log). */
type Captured = { name: string; url: string; headers: Record<string, string> };
const captured = new Map<string, Captured>();

function captureRequests(page: Page): void {
  page.on('request', (req: Request) => {
    if (!req.url().includes('_rsc=')) return;
    void req.allHeaders().then((headers) => {
      const url = new URL(req.url());
      const kind = headers['next-router-prefetch'] === '1' ? 'prefetch' : 'render';
      const name = `${kind} ${url.pathname}${url.search.replace(/[?&]_rsc=[^&]*/, '').replace(/^&/, '?')}`;
      if (!captured.has(name)) captured.set(name, { name, url: `${url.pathname}${url.search}`, headers });
    }).catch(() => undefined);
  });
}

// ------------------------------------------------------------------ statistics

const pct = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN);
};
const nums = (samples: Sample[], pick: (s: Sample) => number | null): number[] => samples.flatMap((s) => { const v = pick(s); return v === null ? [] : [v]; });

function summary(samples: Sample[]) {
  const spread = (pick: (s: Sample) => number | null) => {
    const v = nums(samples, pick);
    return { p50: pct(v, 50), p95: pct(v, 95), max: v.length ? Math.round(Math.max(...v)) : null };
  };
  const commits = nums(samples, (s) => s.commitMs);
  return {
    n: samples.length,
    feedbackMs: spread((s) => s.feedbackMs),
    /** First visible sign of any kind: skeleton, new content or the progress bar. */
    anyFeedbackMs: spread((s) => (s.barMs === null ? s.feedbackMs : s.feedbackMs === null ? s.barMs : Math.min(s.barMs, s.feedbackMs))),
    urlMs: spread((s) => s.urlMs),
    contentMs: spread((s) => s.contentMs),
    rscFetchesPerSwitch: Math.round((samples.reduce((n, s) => n + s.rscFetches, 0) / Math.max(1, samples.length)) * 100) / 100,
    rscBeforeClickPerSwitch: Math.round((samples.reduce((n, s) => n + s.rscBeforeClick, 0) / Math.max(1, samples.length)) * 100) / 100,
    switchesWithoutRequest: samples.filter((s) => s.rscFetches === 0 && s.rscBeforeClick === 0).length,
    rscKB: spread((s) => (s.rscFetches > 0 ? s.rscKB : null)),
    rscMs: spread((s) => s.rscMs),
    longTasks: { total: samples.reduce((n, s) => n + s.longTasks, 0), maxMs: Math.round(Math.max(0, ...samples.map((s) => s.longTaskMaxMs))) },
    inpMs: spread((s) => s.inpMs),
    commitMs: commits.length ? { p50: pct(commits, 50), p95: pct(commits, 95), max: Math.round(Math.max(...commits)) } : null,
  };
}

const label = (href: string): string => href.replace(/^\//, '').replace('?tab=', ':') || 'root';

// ------------------------------------------------------------------ passes

type Transition = { from: string; to: string; sample: Sample };

/** One round of the header tabs from `TABS[0]`, back to it. */
async function tabRound(page: Page): Promise<Transition[]> {
  const out: Transition[] = [];
  let from = HOME;
  for (const to of [...TABS.slice(1), HOME]) {
    out.push({ from, to, sample: await clickTo(page, to) });
    from = to;
  }
  return out;
}

async function initialLoad(page: Page) {
  await page.goto('/dashboard');
  await page.locator('main h1').first().waitFor();
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      ttfbMs: Math.round(nav.responseStart), domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
      loadMs: Math.round(nav.loadEventEnd), fcpMs: paint ? Math.round(paint.startTime) : null,
      documentKB: Math.round(nav.decodedBodySize / 102.4) / 10,
      jsKB: Math.round((performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .filter((e) => e.name.endsWith('.js')).reduce((n, e) => n + e.encodedBodySize, 0) / 102.4) / 10,
    };
  });
}

async function heapMB(context: BrowserContext, page: Page): Promise<number> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  return Math.round(((metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576) * 10) / 10;
}

async function slowNetwork(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  // DevTools' "Fast 3G": 562.5 ms round trip, 1.44 Mbit/s down, 675 kbit/s up.
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 });
}

// ------------------------------------------------------------------ server replay

type QueryLine = { ms: number; op: string; key: string };

function readFrom(file: string, offset: number): string {
  const size = statSync(file).size;
  if (size <= offset) return '';
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

const parseQueries = (text: string): QueryLine[] => text.split(/\r?\n/).flatMap((line) => {
  const m = /\[prisma\] ([\d.]+)ms (\S+) #(\S+)/.exec(line);
  return m ? [{ ms: Number(m[1]), op: m[2] ?? '?', key: `${m[2]} #${m[3]}` }] : [];
});

/** Replays one captured request with nothing else in flight and returns its queries and time. */
async function replay(file: string, req: Captured): Promise<{ ms: number; bytes: number; queries: QueryLine[] }> {
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k === 'cookie' || k === 'rsc' || k === 'accept' || k === 'x-real-ip' || k.startsWith('next-')));
  const offset = statSync(file).size;
  const t = performance.now();
  let bytes: number;
  try {
    const res = await fetch(`${BASE}${req.url}`, { headers, redirect: 'manual' });
    bytes = (await res.arrayBuffer()).byteLength;
  } catch (error) {
    process.stderr.write(`replay of ${req.name} failed: ${String(error)}\n`);
    bytes = -1;
  }
  const ms = performance.now() - t;
  await sleep(300);
  return { ms, bytes, queries: parseQueries(readFrom(file, offset)) };
}

async function serverPass(file: string, cookie: string) {
  const out: Record<string, unknown> = {};
  const targets = [...captured.values()].sort((a, b) => a.name.localeCompare(b.name));
  // The document of a tab (a full render with the layout), for comparison with soft navigations.
  targets.push({ name: 'document /dashboard', url: '/dashboard', headers: { cookie, accept: 'text/html', 'x-real-ip': RUN_IP } });
  for (const req of targets) {
    if (!req.headers['cookie']) req.headers['cookie'] = cookie;
    await replay(file, req); // warm-up: connection pool, JIT
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await replay(file, req));
    const last = runs[runs.length - 1] ?? runs[0];
    if (!last) continue;
    const counts = new Map<string, number>();
    for (const q of last.queries) counts.set(q.key, (counts.get(q.key) ?? 0) + 1);
    const slowest = [...last.queries].sort((a, b) => b.ms - a.ms)[0];
    out[req.name] = {
      queries: last.queries.length,
      dbMs: Math.round(last.queries.reduce((n, q) => n + q.ms, 0)),
      slowest: slowest ? `${slowest.op} ${slowest.ms}ms` : null,
      duplicates: [...counts.entries()].filter(([, n]) => n > 1).map(([key, n]) => `${key.replace(/ #.*/, '')} x${n}`),
      ops: last.queries.map((q) => q.op),
      responseMs: pct(runs.map((r) => r.ms), 50),
      responseKB: Math.round(last.bytes / 102.4) / 10,
    };
  }
  return out;
}

// ------------------------------------------------------------------ main

const git = (cmd: string): string => { try { return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim(); } catch { return ''; } };

async function main(): Promise<void> {
  if (SERVER_LOG && !existsSync(SERVER_LOG)) throw new Error(`--server-log ${SERVER_LOG} does not exist`);
  const browser = await chromium.launch({ headless: process.env['PERF_HEADED'] !== '1' });
  const results: Record<string, unknown> = {};
  try {
    const first = await newProfile(browser);
    await signIn(first.page);
    const state = await first.context.storageState();
    const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    await first.context.close();

    // Header tabs: a fresh profile per pass (empty router cache), then the same round again warm.
    if (runs('tabs')) {
    const loads = [];
    const cold: Transition[] = [];
    const warm: Transition[] = [];
    for (let i = 0; i < PASSES; i++) {
      const { context, page } = await newProfile(browser, state);
      if (i === 0) captureRequests(page);
      loads.push(await initialLoad(page));
      await page.waitForLoadState('networkidle');
      cold.push(...await tabRound(page));
      warm.push(...await tabRound(page));
      await context.close();
      process.stdout.write(`tabs pass ${i + 1}/${PASSES}\n`);
    }
    const perTransition: Record<string, unknown> = {};
    for (const t of cold) {
      const key = `${label(t.from)}>${label(t.to)}`;
      const c = cold.filter((x) => x.from === t.from && x.to === t.to).map((x) => x.sample);
      const w = warm.filter((x) => x.from === t.from && x.to === t.to).map((x) => x.sample);
      perTransition[key] = {
        cold: { contentMs: pct(nums(c, (s) => s.contentMs), 50), feedbackMs: pct(nums(c, (s) => s.feedbackMs), 50), rscKB: pct(nums(c, (s) => s.rscKB), 50) },
        warm: { contentMs: pct(nums(w, (s) => s.contentMs), 50), feedbackMs: pct(nums(w, (s) => s.feedbackMs), 50), rscFetches: w.reduce((n, s) => n + s.rscFetches + s.rscBeforeClick, 0) },
      };
    }
    results['initialLoad'] = {
      n: loads.length,
      ttfbMs: pct(loads.map((l) => l.ttfbMs), 50), fcpMs: pct(loads.flatMap((l) => (l.fcpMs === null ? [] : [l.fcpMs])), 50),
      domContentLoadedMs: pct(loads.map((l) => l.domContentLoadedMs), 50), loadMs: pct(loads.map((l) => l.loadMs), 50),
      documentKB: loads[0]?.documentKB, jsKB: loads[0]?.jsKB,
    };
    results['tabs'] = { cold: summary(cold.map((t) => t.sample)), warm: summary(warm.map((t) => t.sample)), perTransition };
    }

    // Settings ?tab= strip, cold then warm, in one profile per pass.
    if (runs('settings')) {
    const settingsCold: Sample[] = [];
    const settingsWarm: Sample[] = [];
    for (let i = 0; i < PASSES; i++) {
      const { context, page } = await newProfile(browser, state);
      if (i === 0) captureRequests(page);
      await page.goto('/settings');
      await page.locator('main h1').first().waitFor();
      await page.waitForLoadState('networkidle');
      for (const round of [settingsCold, settingsWarm]) {
        for (const to of SETTINGS_TABS) round.push(await clickTo(page, to, `main a[aria-current="page"][href="${to}"]`));
      }
      await context.close();
    }
    results['settingsTabs'] = { cold: summary(settingsCold), warm: summary(settingsWarm) };
    process.stdout.write('settings done\n');
    }

    // Workspace on the org's newest ready catalogue: open from the list, decision filter, sort, Back.
    if (runs('workspace')) {
    const ws = { open: [] as Sample[], filter: [] as Sample[], sort: [] as Sample[], back: [] as Sample[] };
    let catalogPath: string | null = null;
    for (let i = 0; i < PASSES; i++) {
      const { context, page } = await newProfile(browser, state);
      if (i === 0) captureRequests(page);
      await page.goto('/catalogs');
      await page.locator('main h1').first().waitFor();
      await page.waitForLoadState('networkidle');
      catalogPath ??= await page.locator('main a[href^="/catalogs/"]').evaluateAll((links) =>
        links.map((a) => a.getAttribute('href') ?? '').find((h) => /^\/catalogs\/[^/?]+$/.test(h)) ?? null);
      if (!catalogPath) throw new Error('the seed org has no catalogue to open');
      ws.open.push(await clickTo(page, catalogPath, '[role="grid"]'));
      const decision = page.locator('main select:has(option[value="carried"]):visible').first();
      ws.filter.push(await measure(page, 'change', '[role="grid"]', () => decision.selectOption('all')));
      // Sort sits behind the toolbar's Filters button on desktop.
      await page.getByRole('button', { name: taUz.wsX.filter.button, exact: true }).click();
      const sort = page.locator('select:has(option[value="row"]):visible').first();
      ws.sort.push(await measure(page, 'change', '[role="grid"]', () => sort.selectOption('row')));
      // Filters replace the address, so Back returns to the list.
      ws.back.push(await measure(page, 'popstate', 'main h1', () => page.goBack({ waitUntil: 'commit' })));
      await context.close();
    }
    results['workspace'] = { catalog: 'newest ready catalogue of the seed org', open: summary(ws.open), filter: summary(ws.filter), sort: summary(ws.sort), back: summary(ws.back) };
    process.stdout.write('workspace done\n');
    }

    // Back and Forward across six entries, after one round of tabs.
    if (runs('history')) {
      const { context, page } = await newProfile(browser, state);
      await page.goto('/dashboard');
      await page.locator('main h1').first().waitFor();
      await page.waitForLoadState('networkidle');
      for (const to of TABS.slice(1, 7)) await clickTo(page, to);
      const back: Sample[] = [];
      const forward: Sample[] = [];
      for (let i = 0; i < 6; i++) back.push(await measure(page, 'popstate', 'main h1', () => page.goBack({ waitUntil: 'commit' })));
      for (let i = 0; i < 6; i++) forward.push(await measure(page, 'popstate', 'main h1', () => page.goForward({ waitUntil: 'commit' })));
      results['history'] = { back: summary(back), forward: summary(forward) };

      // Rapid switching: a second tab clicked right after the first; the address and the heading must be the second's.
      const rapid: { pair: string; ok: boolean }[] = [];
      for (const [a, b] of [['/queue', '/clients'], ['/catalogs', '/activity'], ['/dictionary', '/dashboard'], ['/team', '/queue'], ['/clients', '/catalogs']] as const) {
        await page.locator(`a[href="${a}"]:visible`).first().click();
        await sleep(30);
        await page.locator(`a[href="${b}"]:visible`).first().click();
        const settled = (want: string): boolean =>
          location.pathname === want && document.querySelector('main [aria-busy="true"]') === null && document.querySelector('main h1') !== null;
        const shown = await page.waitForFunction(settled, b, { timeout: 15_000, polling: 50 }).then(() => true, () => false);
        // A late response for the first tab must not take over afterwards.
        await sleep(1500);
        rapid.push({ pair: `${a} then ${b}`, ok: shown && await page.evaluate(settled, b) });
      }
      results['rapid'] = { passed: rapid.filter((r) => r.ok).length, of: rapid.length, failures: rapid.filter((r) => !r.ok).map((r) => r.pair) };
      await context.close();
    }
    process.stdout.write('history and rapid done\n');

    // Heap: after 5 switches and after 40, garbage collected first.
    if (runs('heap')) {
      const { context, page } = await newProfile(browser, state);
      await page.goto('/dashboard');
      await page.locator('main h1').first().waitFor();
      const ring = [...TABS.slice(1), HOME];
      let after5 = 0;
      for (let i = 0; i < 40; i++) {
        await clickTo(page, ring[i % ring.length] ?? HOME);
        if (i === 4) after5 = await heapMB(context, page);
      }
      const after40 = await heapMB(context, page);
      results['heap'] = { after5MB: after5, after40MB: after40, growthPct: Math.round(((after40 - after5) / Math.max(after5, 0.1)) * 1000) / 10 };
      await context.close();
    }
    process.stdout.write('heap done\n');

    if (SLOW && runs('fast3g')) {
      const { context, page } = await newProfile(browser, state);
      await slowNetwork(context, page);
      await page.goto('/dashboard', { timeout: 120_000 });
      await page.locator('main h1').first().waitFor({ timeout: 120_000 });
      await page.waitForLoadState('networkidle', { timeout: 120_000 });
      const c = (await tabRound(page)).map((t) => t.sample);
      const w = (await tabRound(page)).map((t) => t.sample);
      const brief = (s: Sample[]) => ({ feedbackMs: summary(s).feedbackMs, anyFeedbackMs: summary(s).anyFeedbackMs, contentMs: summary(s).contentMs });
      results['fast3g'] = { cold: brief(c), warm: brief(w) };
      await context.close();
      process.stdout.write('fast 3g done\n');
    }

    if (SERVER_LOG) {
      await sleep(1000);
      results['server'] = await serverPass(SERVER_LOG, cookie);
      process.stdout.write('server replay done\n');
    }
  } finally {
    await browser.close();
  }

  const buildId = existsSync('.next/BUILD_ID') ? readFileSync('.next/BUILD_ID', 'utf8').trim() : null;
  const run = {
    label: LABEL,
    commit: BUILT_FROM ?? git('rev-parse --short HEAD') + (git('status --porcelain --untracked-files=no') ? '+dirty' : ''),
    date: new Date().toISOString(),
    conditions: {
      baseUrl: BASE, build: `next start (production), BUILD_ID ${buildId ?? 'unknown'}`,
      org: 'seed org (npm run seed): 2 clients, 5 catalogues, 213 rows', database: 'local Postgres 16 in Docker (shared)',
      browser: `Chromium ${browser.version()} headless, ${VIEWPORT.width}x${VIEWPORT.height}`,
      machine: { cpu: cpus()[0]?.model.trim(), threads: cpus().length, memGb: Math.round(totalmem() / 1073741824), os: process.platform },
      passes: PASSES, dwellMs: DWELL_MS, settleMs: SETTLE_MS, profiling: process.env['NEXT_PUBLIC_PERF_PROFILE'] === '1' ? 'yes' : 'unknown (commitMs is null unless the build is a profiling one)',
    },
    results,
  };
  console.log(JSON.stringify(run, null, 2));
  if (SAVE) {
    const history = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as { runs: unknown[] }) : { runs: [] };
    history.runs.push(run);
    writeFileSync(RESULTS, JSON.stringify({ note: 'Append-only history of `npm run perf:nav` (docs/engineering/TAB_SWITCH_PERFORMANCE_PLAN.md §4).', runs: history.runs }, null, 2) + '\n');
    console.log(`appended "${LABEL}" to ${RESULTS}`);
  }
}

await main();
