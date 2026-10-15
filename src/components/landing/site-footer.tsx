import { CANONICAL_UNITS, CATALOG_CODES, MARKED_CODES, SNAPSHOT, nf } from './data';
import { WRAP } from './primitives';

export function SiteFooter() {
  return (
    <footer className="border-t border-rule py-9">
      <div className={`${WRAP} space-y-1.5 text-xs text-ink-faint`}>
        <p>
          Tasniflagich maʼlumotlari <span className="mono">tasnif.soliq.uz</span> rasmiy
          eksportidan olingan, holat: {SNAPSHOT} — {nf.format(CATALOG_CODES)} kod,
          shundan {nf.format(MARKED_CODES)} tasi markirovka qilinadigan,
          {' '}{nf.format(CANONICAL_UNITS)} oʻlchov birligi.
        </p>
        <p>
          Yuridik havolalar <span className="mono">lex.uz</span>ga ishora qiladi. Soliq
          oqibatlari boʻyicha qarorni oʻz maslahatchingiz bilan tasdiqlang.
        </p>
      </div>
    </footer>
  );
}
