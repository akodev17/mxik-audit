import Link from 'next/link';
import { fmtNumber } from '@tasnivo/i18n/format';
import { helpPath } from '@tasnivo/domain/help';
import { TasnivoLogo } from '@/ui/logo';
import { pluralRu } from '@tasnivo/i18n/plural';
import { TELEGRAM_URL } from './config';
import { CONTAINER } from './container';
import { CANONICAL_UNITS, CATALOG_CODES, MARKED_CODES, SNAPSHOT, SUBPOSITIONS } from './data';
import { SHELL_COPY, type SiteLang } from './shell-copy';

const LINK = 'rounded-lp text-lp-ink underline decoration-lp-line-strong underline-offset-4 hover:decoration-lp-ink';

function Num({ lang, n }: { lang: SiteLang; n: number }) {
  return <span className="num">{fmtNumber(lang, n)}</span>;
}

/** Where the classifier figures come from, in the footer's language. */
function Source({ lang }: { lang: SiteLang }) {
  if (lang === 'ru') {
    const ru = (n: number, one: string, few: string, many: string) => pluralRu(n, one, few, many);
    return (
      <p>
        Данные классификатора взяты из официальной выгрузки <span className="text-lp-ink">tasnif.soliq.uz</span>,
        по состоянию на {SNAPSHOT}: <Num lang={lang} n={CATALOG_CODES} /> {ru(CATALOG_CODES, 'код', 'кода', 'кодов')},{' '}
        <Num lang={lang} n={SUBPOSITIONS} /> {ru(SUBPOSITIONS, 'субпозиция', 'субпозиции', 'субпозиций')}, из них{' '}
        <Num lang={lang} n={MARKED_CODES} /> {ru(MARKED_CODES, 'код подлежит', 'кода подлежат', 'кодов подлежат')} маркировке,{' '}
        <Num lang={lang} n={CANONICAL_UNITS} /> {ru(CANONICAL_UNITS, 'единица', 'единицы', 'единиц')} измерения.
      </p>
    );
  }
  return (
    <p>
      Tasniflagich maʼlumotlari <span className="text-lp-ink">tasnif.soliq.uz</span> rasmiy
      eksportidan olingan, holati {SNAPSHOT}: <Num lang={lang} n={CATALOG_CODES} /> ta
      kod, <Num lang={lang} n={SUBPOSITIONS} /> ta subpozitsiya, shundan{' '}
      <Num lang={lang} n={MARKED_CODES} /> ta kod markirovka qilinadigan,{' '}
      <Num lang={lang} n={CANONICAL_UNITS} /> ta oʻlchov birligi.
    </p>
  );
}

// Source of the classifier data, legal links, contact and the tax-advice note.
export function SiteFooter({ lang = 'uz' }: { lang?: SiteLang }) {
  const c = SHELL_COPY[lang];
  return (
    <footer id="site-footer" className="border-t border-lp-line bg-lp-base text-lp-muted">
      <div className={`${CONTAINER} grid grid-cols-1 gap-8 py-12 md:grid-cols-[1fr_auto]`}>
        <div className="max-w-[68ch] space-y-3 text-[15px]">
          <p className="text-[18px] text-lp-ink"><TasnivoLogo markClassName="size-7" accent="var(--color-lp-brand)" /></p>
          <Source lang={lang} />
          <p>{c.legalNote}</p>
        </div>
        <nav aria-label={c.footerNav}>
          <ul className="space-y-2 text-[16px]">
            <li><Link href="/sign-up" className={LINK}>{c.signUp}</Link></li>
            <li><Link href={helpPath(lang)} className={LINK}>{c.help}</Link></li>
            <li><Link href="/maxfiylik" className={LINK} hrefLang="uz">{c.privacy}</Link></li>
            <li><Link href="/oferta" className={LINK} hrefLang="uz">{c.offer}</Link></li>
            <li>
              {TELEGRAM_URL ? (
                <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className={LINK}>{c.writeTelegram}</a>
              ) : (
                <Link href="/#audit" className={LINK}>{c.writeForm}</Link>
              )}
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
