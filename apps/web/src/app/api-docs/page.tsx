import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ERROR_CODES, ERROR_STATUS, IDEMPOTENCY, PAGE } from '@tasnivo/domain/api/contract';
import { apiConfig } from '@tasnivo/domain/api/limits';
import { appOrigin } from '@tasnivo/domain/app-url';
import { planLimits } from '@tasnivo/domain/billing/limits';
import { MAX_UPLOAD_BYTES } from '@tasnivo/domain/catalog-import';
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';
import { readTheme } from '@/ui/shell/server-prefs';
import { Table, Td, Th } from '@/ui/table';
import { CodeBlock } from './code-block';
import { CodeText } from './code-text';
import { DocsShell } from './docs-shell';
import { docExamples } from './examples';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.setX.docs.title} — ${t.appName}`, description: ta.apiDocs.intro };
}

/** The public origin for the examples' $BASE: APP_URL when set, else this request's host. */
async function baseUrl(): Promise<string> {
  const configured = appOrigin();
  if (configured) return configured;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-3">
      <h2 id={`${id}-title`} className="text-section">{title}</h2>
      {children}
    </section>
  );
}

function Endpoint({ id, method, path, title, text, request, response, labels }: {
  id: string; method: string; path: string; title: string; text: string; request: string; response: string; labels: { request: string; response: string };
}) {
  return (
    <DocSection id={id} title={title}>
      <p className="font-mono text-mono"><span className="mr-2 rounded-sm bg-brand-tint px-1.5 py-0.5 font-semibold text-brand-ink">{method}</span>{path}</p>
      <p className="text-body"><CodeText>{text}</CodeText></p>
      <CodeBlock label={labels.request} code={request} />
      <CodeBlock label={labels.response} code={response} />
    </DocSection>
  );
}

export default async function ApiDocsPage() {
  await cookies();
  const { locale, ta } = await getI18n();
  const d = ta.setX.docs;
  const user = await currentUser().catch(() => null);
  const config = apiConfig();
  const limits = planLimits();
  const ex = docExamples(await baseUrl(), config.ratePerMinute, d.keyWhere);
  const n = (v: number): string => fmtNumber(locale, v);
  const cap = (v: number | null): string => (v === null ? d.unlimited : d.upTo(n(v)));
  const toc: [string, string][] = [
    ['start', d.sections.start], ['auth', d.sections.auth], ['limits', d.sections.limits], ['paging', d.sections.paging],
    ['idempotency', d.sections.idempotency], ['check', d.sections.check], ['list', d.sections.list], ['upload', d.sections.upload],
    ['report', d.sections.report], ['errors', d.sections.errors], ['spec', d.sections.spec],
  ];
  const limitRows: [string, string][] = [
    [d.limitRows.rate, d.perMinute(n(config.ratePerMinute))],
    [d.limitRows.items, d.upTo(n(config.maxCheckItems))],
    [d.limitRows.checksTrial, cap(config.checksPerMonth.trial)],
    [d.limitRows.checksFirm, cap(config.checksPerMonth.firm)],
    [d.limitRows.rowsTrial, cap(limits.trial.rowsPerMonth)],
    [d.limitRows.rowsFirm, cap(limits.firm.rowsPerMonth)],
    [d.limitRows.fileSize, d.megabytes(n(MAX_UPLOAD_BYTES / 1024 / 1024))],
    [d.limitRows.pageCatalogs, d.upTo(n(PAGE.catalogs.max))],
    [d.limitRows.pageFindings, d.upTo(n(PAGE.findings.max))],
  ];
  const labels = { request: d.request, response: d.response };
  const tocList = (
    <ol className="space-y-1 text-small">
      {toc.map(([id, label]) => <li key={id}><a href={`#${id}`} className="text-brand-ink hover:underline">{label}</a></li>)}
    </ol>
  );

  return (
    <DocsShell locale={locale} theme={await readTheme()} title={d.title} back={user ? { href: '/dashboard', label: d.backApp } : { href: '/', label: d.backSite }}>
      <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label={d.onPage} className="hidden lg:block">
          <div className="sticky top-6">
            <p className="mb-2 text-small font-semibold">{d.onPage}</p>
            {tocList}
          </div>
        </nav>

        <article className="min-w-0 max-w-3xl space-y-12">
          <header className="space-y-2">
            <h1 className="text-title">{ta.apiDocs.title}</h1>
            <p className="text-body text-muted">{ta.apiDocs.intro}</p>
            <details className="rounded-md border border-line p-3 lg:hidden">
              <summary className="cursor-pointer text-small font-semibold">{d.onPage}</summary>
              <div className="mt-2">{tocList}</div>
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
              <tbody>{limitRows.map(([label, value]) => <tr key={label}><Td>{label}</Td><Td>{value}</Td></tr>)}</tbody>
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
            <ul className="list-disc space-y-1 pl-5">
              {d.idempotencyRules(IDEMPOTENCY.ttlHours, IDEMPOTENCY.maxLength).map((rule) => <li key={rule}><CodeText>{rule}</CodeText></li>)}
            </ul>
          </DocSection>

          <Endpoint id="check" method="POST" path="/api/v1/check" title={d.sections.check} text={d.endpoint.check} request={ex.check} response={ex.checkResponse} labels={labels} />
          <p className="text-small text-muted"><CodeText>{d.confidenceNote}</CodeText></p>
          <Endpoint id="list" method="GET" path="/api/v1/catalogs" title={d.sections.list} text={d.endpoint.list} request={ex.list} response={ex.listResponse} labels={labels} />
          <Endpoint id="upload" method="POST" path="/api/v1/catalogs" title={d.sections.upload} text={d.endpoint.upload} request={ex.upload} response={ex.uploadResponse} labels={labels} />
          <Endpoint id="report" method="GET" path="/api/v1/catalogs/{id}/report" title={d.sections.report} text={d.endpoint.report} request={ex.report} response={ex.reportResponse} labels={labels} />
          <p className="text-small text-muted">{d.sampleNote}</p>

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
            <p>{d.specText} <Link href="/api/v1/openapi.json" className="font-medium text-brand-ink underline">/api/v1/openapi.json</Link></p>
          </DocSection>
        </article>
      </div>
    </DocsShell>
  );
}
