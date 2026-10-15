import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { listCatalogs } from '@/lib/catalogs';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { DeleteCatalogButton } from './delete-button';

export default async function CatalogsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const catalogs = await listCatalogs(user.orgId);

  return (
    <>
      <Header email={user.email} current="/catalogs" demo={user.demo} />
      <Shell demo={user.demo}>
        <h1 className="text-2xl">{t.catalogsTitle}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">{t.catalogsHint}</p>

        {catalogs.length === 0 ? (
          <p className="mt-6 text-ink-soft">
            {t.catalogsEmpty}{' '}
            <Link href="/upload" className="underline">{t.navUpload}</Link>
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto border border-rule">
            <table className="min-w-full text-sm">
              <thead className="bg-paper-tint">
                <tr className="text-left">
                  <th className="border-b border-rule px-3 py-2 font-medium">{t.catalogsFile}</th>
                  <th className="border-b border-rule px-3 py-2 font-medium">{t.catalogsDate}</th>
                  <th className="border-b border-rule px-3 py-2 text-right font-medium">{t.catalogsRows}</th>
                  <th className="border-b border-rule px-3 py-2 text-right font-medium">{t.catalogsRisky}</th>
                  <th className="border-b border-rule px-3 py-2 font-medium">{t.catalogsStatus}</th>
                  <th className="border-b border-rule px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {catalogs.map((c) => (
                  <tr key={c.id} className="border-b border-rule align-top last:border-0">
                    <td className="max-w-xs break-words px-3 py-2">{c.filename}</td>
                    <td className="whitespace-nowrap px-3 py-2 tnum text-ink-soft">{c.createdAt.toLocaleString('uz-UZ')}</td>
                    <td className="px-3 py-2 text-right tnum">{c.rowCount.toLocaleString('uz-UZ')}</td>
                    <td className="px-3 py-2 text-right tnum">{c.riskyRows.toLocaleString('uz-UZ')}</td>
                    <td className="px-3 py-2 text-ink-soft">{t.catalogStatus[c.status as keyof typeof t.catalogStatus] ?? c.status}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <Link href={`/report?catalog=${c.id}`} className="whitespace-nowrap underline">{t.navReport}</Link>
                        <Link href={`/review?catalog=${c.id}`} className="whitespace-nowrap underline">{t.navReview}</Link>
                        <Link href={`/export?catalog=${c.id}`} className="whitespace-nowrap underline">{t.navExport}</Link>
                        <DeleteCatalogButton catalogId={c.id} filename={c.filename} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Shell>
    </>
  );
}
