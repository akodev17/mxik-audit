import Link from 'next/link';
import { TELEGRAM_URL } from './config';
import { CANONICAL_UNITS, CATALOG_CODES, MARKED_CODES, SNAPSHOT, nf } from './data';
import { WIDE } from './primitives';

export function SiteFooter() {
  return (
    <footer className="border-t border-rule py-9">
      <div className={`${WIDE} space-y-5 text-[13px] text-ink-soft`}>
        <nav aria-label="Huquqiy" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/maxfiylik" className="underline hover:text-ink">
            Maxfiylik siyosati
          </Link>
          <Link href="/oferta" className="underline hover:text-ink">
            Ommaviy oferta
          </Link>
          {TELEGRAM_URL ? (
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">
              Telegram orqali bogʻlanish
            </a>
          ) : (
            <Link href="/#audit" className="underline hover:text-ink">
              Bogʻlanish — forma orqali
            </Link>
          )}
        </nav>
        <div className="space-y-1.5 text-xs text-ink-faint">
          <p>
            Tasniflagich maʼlumotlari <span className="mono">tasnif.soliq.uz</span> rasmiy
            eksportidan olingan, holat: {SNAPSHOT} — {nf.format(CATALOG_CODES)} kod,
            shundan {nf.format(MARKED_CODES)} tasi markirovka qilinadigan,
            {' '}{nf.format(CANONICAL_UNITS)} oʻlchov birligi.
          </p>
          <p>
            Yuridik havolalar <span className="mono">lex.uz</span> va Soliq qoʻmitasi
            rasmiy kanaliga ishora qiladi. Soliq oqibatlari boʻyicha qarorni oʻz
            maslahatchingiz bilan tasdiqlang.
          </p>
        </div>
      </div>
    </footer>
  );
}
