import Link from 'next/link';
import { TELEGRAM_URL } from './config';
import { CANONICAL_UNITS, CATALOG_CODES, MARKED_CODES, SNAPSHOT, SUBPOSITIONS, nf } from './data';
import { CONTAINER } from './container';

const LINK = 'rounded-lp text-lp-ink underline decoration-lp-line-strong underline-offset-4 hover:decoration-lp-ink';

// Source of the classifier data, legal links, contact and the tax-advice note.
export function SiteFooter() {
  return (
    <footer className="border-t border-lp-line bg-lp-surface">
      <div className={`${CONTAINER} grid grid-cols-1 gap-8 py-12 md:grid-cols-[1fr_auto]`}>
        <div className="max-w-[68ch] space-y-3 text-[15px] text-lp-muted">
          <p className="text-[17px] font-bold text-lp-ink">MXIK Audit</p>
          <p>
            Tasniflagich maʼlumotlari <span className="text-lp-ink">tasnif.soliq.uz</span> rasmiy
            eksportidan olingan, holati {SNAPSHOT}: <span className="num">{nf.format(CATALOG_CODES)}</span> ta
            kod, <span className="num">{nf.format(SUBPOSITIONS)}</span> ta subpozitsiya, shundan{' '}
            <span className="num">{nf.format(MARKED_CODES)}</span> ta kod markirovka qilinadigan,{' '}
            <span className="num">{CANONICAL_UNITS}</span> ta oʻlchov birligi.
          </p>
          <p>
            Yuridik havolalar lex.uz va Soliq qoʻmitasining rasmiy kanaliga olib boradi. Soliq
            oqibatlari boʻyicha qarorni oʻz maslahatchingiz bilan tasdiqlang.
          </p>
        </div>
        <nav aria-label="Huquqiy va aloqa">
          <ul className="space-y-2 text-[16px]">
            <li><Link href="/sign-up" className={LINK}>Bepul sinab koʻrish</Link></li>
            <li><Link href="/yordam" className={LINK}>Yordam</Link></li>
            <li><Link href="/maxfiylik" className={LINK}>Maxfiylik siyosati</Link></li>
            <li><Link href="/oferta" className={LINK}>Ommaviy oferta</Link></li>
            <li>
              {TELEGRAM_URL ? (
                <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                  Telegram orqali yozish
                </a>
              ) : (
                <Link href="/#audit" className={LINK}>Forma orqali yozish</Link>
              )}
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
