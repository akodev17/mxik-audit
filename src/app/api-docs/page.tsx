import type { Metadata } from 'next';
import Link from 'next/link';
import { getI18n } from '@/lib/locale';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.apiDocs.title} — ${t.appName}`, description: ta.apiDocs.intro };
}

const CHECK = `curl -X POST "$BASE/api/v1/check" \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Sut 3.2% 1 L", "barcode": "4780000000000", "unit": "dona"}'`;

const UPLOAD = `curl -X POST "$BASE/api/v1/catalogs" \\
  -H "Authorization: Bearer $KEY" \\
  -F "file=@katalog.xlsx"
# 202 {"id": "...", "status": "analyzing", "rows": 1200, "clientId": "..."}`;

const REPORT = `curl "$BASE/api/v1/catalogs/CATALOG_ID/report?limit=200" \\
  -H "Authorization: Bearer $KEY"
# status: analyzing | ready | failed; findings appear when ready; pass nextCursor as ?cursor=`;

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-ctl border border-line bg-surface p-3 text-xs leading-relaxed"><code>{children}</code></pre>;
}

export default async function ApiDocsPage() {
  const { ta } = await getI18n();
  const d = ta.apiDocs;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl">{d.title}</h1>
        <p className="mt-2 text-sm text-muted">{d.intro}</p>
      </div>
      <section className="space-y-2">
        <h2 className="text-lg">{d.auth}</h2>
        <p className="text-sm">{d.authText}</p>
        <Code>{'Authorization: Bearer mxk_...'}</Code>
        <p className="text-sm text-muted">{d.limits}</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg">POST /api/v1/check</h2>
        <p className="text-sm">{d.check}</p>
        <Code>{CHECK}</Code>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg">POST /api/v1/catalogs</h2>
        <p className="text-sm">{d.upload}</p>
        <Code>{UPLOAD}</Code>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg">GET /api/v1/catalogs/:id/report</h2>
        <p className="text-sm">{d.report}</p>
        <Code>{REPORT}</Code>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg">{d.errors}</h2>
        <p className="text-sm">{d.errorsText}</p>
        <Code>{'{"error": {"code": "rate_limited", "message": "..."}}'}</Code>
      </section>
      <p className="text-sm"><Link href="/api/v1/openapi.json" className="text-brand hover:underline">OpenAPI (JSON)</Link></p>
    </main>
  );
}
