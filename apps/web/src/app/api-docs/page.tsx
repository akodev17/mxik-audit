import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ERROR_CODES, ERROR_STATUS, IDEMPOTENCY, PAGE } from '@tasnivo/contracts/modules/public-api';
import { fmtNumber } from '@tasnivo/i18n/format';
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { readTheme } from '@/ui/shell/server-prefs';
import { Table, Td, Th } from '@/ui/table';
import { CodeBlock } from './code-block';
import { CodeText } from './code-text';
import { DocsNav, MethodTag, type NavGroup } from './docs-nav';
import { DocsShell } from './docs-shell';
import { endpointInfo, type DocEndpoint } from './endpoint-info';
import { docExamples } from './examples';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.setX.docs.title} — ${t.appName}`, description: ta.apiDocs.intro };
}

/** The public origin for the examples' $BASE: APP_URL when set (the API's config answers it), else this request's host. */
async function baseUrl(configured: string | null): Promise<string> {
  if (configured) return configured;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-4">
      <h2 id={`${id}-title`} className="text-[1.25rem] font-semibold leading-7">{title}</h2>
      {children}
    </section>
  );
}

/** A small fact about an endpoint, as a pill. */
function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-6 items-center rounded-full border border-line bg-surface px-2.5 text-micro font-medium text-muted">{children}</span>;
}

/** One endpoint as a card: method and path, what it does, its parameters and errors from the contract, then the samples. */
function Endpoint({ id, endpoint, title, text, request, response, d, m }: {
  id: string; endpoint: DocEndpoint; title: string; text: string; request: string; response: string;
  d: AppDict['setX']['docs']; m: AppDict['mgX']['docs'];
}) {
  const info = endpointInfo(endpoint);
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 overflow-hidden rounded-lg border border-line bg-raised">
      <div className="space-y-3 border-b border-line px-4 py-4 sm:px-5">
        <h2 id={`${id}-title`} className="text-[1.25rem] font-semibold leading-7">{title}</h2>
        <p className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-sunken px-3 py-2 font-mono text-mono">
          <MethodTag method={info.method} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{info.path}</span>
        </p>
        <p className="text-body"><CodeText>{text}</CodeText></p>
        <div className="flex flex-wrap gap-1.5">
          <Chip>{m.auth}</Chip>
          <Chip>{m.success}: {info.success}</Chip>
          {info.idempotent ? <Chip>{m.idempotent}</Chip> : null}
          {info.paginated ? <Chip>{m.paginated}</Chip> : null}
        </div>
      </div>
      <div className="space-y-5 px-4 py-4 sm:px-5">
        {info.params.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-small font-semibold">{m.params}</h3>
            <Table label={`${title}: ${m.params}`}>
              <thead><tr><Th>{m.param}</Th><Th>{m.where}</Th><Th /></tr></thead>
              <tbody>
                {info.params.map((p) => (
                  <tr key={`${p.where}:${p.name}`}>
                    <Td className="font-mono text-mono">{p.name}</Td>
                    <Td className="font-mono text-mono text-muted">{p.where}</Td>
                    <Td className="text-small">{p.required ? <span className="font-medium text-danger-ink">{m.required}</span> : <span className="text-muted">{m.optional}</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}
        <div className="space-y-2">
          <h3 className="text-small font-semibold">{m.errors}</h3>
          <ul className="flex flex-wrap gap-1.5">
            {info.errors.map((code) => (
              <li key={code}>
                <a href="#errors" title={d.errors[code]} className="inline-flex h-6 items-center gap-1.5 rounded-sm bg-sunken px-2 font-mono text-[12px] text-fg hover:bg-brand-tint hover:text-brand-ink">
                  <span className="tabular-nums text-muted">{ERROR_STATUS[code as keyof typeof ERROR_STATUS]}</span>{code}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <CodeBlock label={d.request} code={request} />
        <CodeBlock label={d.response} code={response} />
      </div>
    </section>
  );
}

export default async function ApiDocsPage() {
  await cookies();
  const { locale, ta } = await getI18n();
  const d = ta.setX.docs;
  const m = ta.mgX.docs;
  const api = serverApi();
  // Signed in or not only picks the back link; any failure reads as signed out.
  const [user, settings] = await Promise.all([api.auth.me().catch(() => null), api.account.config()]);
  const config = settings.api;
  const limits = settings.plans;
  const ex = docExamples(await baseUrl(settings.origin), config.ratePerMinute, d.keyWhere);
  const n = (v: number): string => fmtNumber(locale, v);
  const cap = (v: number | null): string => (v === null ? d.unlimited : d.upTo(n(v)));
  const groups: NavGroup[] = [
    { title: m.guide, items: (['start', 'auth', 'limits', 'paging', 'idempotency'] as const).map((id) => ({ id, label: d.sections[id] })) },
    {
      title: m.endpoints,
      items: (['check', 'list', 'upload', 'report'] as const).map((id) => ({ id, label: d.sections[id], method: endpointInfo(id).method })),
    },
    { title: m.reference, items: (['errors', 'spec'] as const).map((id) => ({ id, label: d.sections[id] })) },
  ];
  const limitRows: [string, string][] = [
    [d.limitRows.rate, d.perMinute(n(config.ratePerMinute))],
    [d.limitRows.items, d.upTo(n(config.maxCheckItems))],
    [d.limitRows.checksTrial, cap(config.checksPerMonth.trial)],
    [d.limitRows.checksFirm, cap(config.checksPerMonth.firm)],
    [d.limitRows.rowsTrial, cap(limits.trial.rowsPerMonth)],
    [d.limitRows.rowsFirm, cap(limits.firm.rowsPerMonth)],
    [d.limitRows.fileSize, d.megabytes(n(settings.uploadMaxBytes / 1024 / 1024))],
    [d.limitRows.pageCatalogs, d.upTo(n(PAGE.catalogs.max))],
    [d.limitRows.pageFindings, d.upTo(n(PAGE.findings.max))],
  ];
  const samples = { d, m };

  return (
    <DocsShell locale={locale} theme={await readTheme()} title={d.title} back={user ? { href: '/dashboard', label: d.backApp } : { href: '/', label: d.backSite }}>
      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-6">
            <DocsNav label={d.onPage} groups={groups} />
          </div>
        </aside>

        <article className="min-w-0 max-w-3xl space-y-12">
          <header className="space-y-3 border-b border-line pb-8">
            <p className="text-small font-medium text-brand-ink">{m.guide}</p>
            <h1 className="text-[1.875rem] font-semibold leading-9 tracking-tight">{ta.apiDocs.title}</h1>
            <p className="max-w-2xl text-body text-muted">{ta.apiDocs.intro}</p>
            <details className="rounded-lg border border-line bg-raised p-3 lg:hidden">
              <summary className="cursor-pointer text-small font-semibold">{d.onPage}</summary>
              <div className="mt-3"><DocsNav label={d.onPage} groups={groups} /></div>
            </details>
            <p className="text-micro text-muted lg:hidden">{d.scrollHint}</p>
          </header>

          <DocSection id="start" title={d.sections.start}>
            <p><CodeText>{d.startText}</CodeText></p>
            <CodeBlock label="shell" code={ex.setup} />
          </DocSection>

          <DocSection id="auth" title={d.sections.auth}>
            <p><CodeText>{d.authText}</CodeText></p>
            <CodeBlock label="HTTP" code={ex.auth} />
          </DocSection>

          <DocSection id="limits" title={d.sections.limits}>
            <Table label={d.sections.limits}>
              <thead><tr><Th>{d.limit}</Th><Th>{d.value}</Th></tr></thead>
              <tbody>{limitRows.map(([label, value]) => <tr key={label}><Td>{label}</Td><Td className="font-medium">{value}</Td></tr>)}</tbody>
            </Table>
            <p><CodeText>{d.headersText}</CodeText></p>
            <CodeBlock label="HTTP" code={ex.headers} />
            <p><CodeText>{d.usageText}</CodeText></p>
          </DocSection>

          <DocSection id="paging" title={d.sections.paging}>
            <p><CodeText>{d.pagingText}</CodeText></p>
          </DocSection>

          <DocSection id="idempotency" title={d.sections.idempotency}>
            <p><CodeText>{d.idempotencyText}</CodeText></p>
            <ul className="list-disc space-y-1.5 pl-5 marker:text-subtle">
              {d.idempotencyRules(IDEMPOTENCY.ttlHours, IDEMPOTENCY.maxLength).map((rule) => <li key={rule}><CodeText>{rule}</CodeText></li>)}
            </ul>
          </DocSection>

          <div className="space-y-6">
            <Endpoint id="check" endpoint="check" title={d.sections.check} text={d.endpoint.check} request={ex.check} response={ex.checkResponse} {...samples} />
            <p className="text-small text-muted"><CodeText>{d.confidenceNote}</CodeText></p>
            <Endpoint id="list" endpoint="list" title={d.sections.list} text={d.endpoint.list} request={ex.list} response={ex.listResponse} {...samples} />
            <Endpoint id="upload" endpoint="upload" title={d.sections.upload} text={d.endpoint.upload} request={ex.upload} response={ex.uploadResponse} {...samples} />
            <Endpoint id="report" endpoint="report" title={d.sections.report} text={d.endpoint.report} request={ex.report} response={ex.reportResponse} {...samples} />
            <p className="text-small text-muted">{d.sampleNote}</p>
          </div>

          <DocSection id="errors" title={d.sections.errors}>
            <p><CodeText>{d.errorsText}</CodeText></p>
            <CodeBlock label="JSON" code={ex.error} />
            <Table label={d.sections.errors}>
              <thead><tr><Th>{d.code}</Th><Th numeric>{d.status}</Th><Th>{d.meaning}</Th></tr></thead>
              <tbody>
                {ERROR_CODES.map((code) => (
                  <tr key={code}>
                    <Td className="whitespace-nowrap font-mono text-mono">{code}</Td>
                    <Td numeric>{ERROR_STATUS[code]}</Td>
                    <Td className="min-w-48"><CodeText>{d.errors[code] ?? ''}</CodeText></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </DocSection>

          <DocSection id="spec" title={d.sections.spec}>
            <p>{d.specText} <Link href="/api/v1/openapi.json" className="font-mono font-medium text-brand-ink underline">/api/v1/openapi.json</Link></p>
          </DocSection>
        </article>
      </div>
    </DocsShell>
  );
}
