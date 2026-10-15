import { CATALOG_CODES, CHECKS, SNAPSHOT, STRICT_UNIT_PCT, SUBPOSITIONS, nf } from './data';
import { Chapter } from './primitives';

/* Four stages on one rule, each with the real artefact it produces — the
   column mapping, the checks, the decision controls, the exported file's own
   columns. Sources: header hints in src/app/actions/catalog.ts; checks in
   src/core/audit/checks.ts; keys in src/app/review/review-list.tsx; export
   columns and status values in src/app/api/export/route.ts + i18n. */

const MAPPING = [
  ['Наименование', 'Tovar nomi'],
  ['Штрих-код', 'Shtrix kod'],
  ['ИКПУ', 'MXIK kodi'],
  ['Ед. изм.', 'Oʻlchov birligi'],
] as const;

const STATUS_VALUES = ['qabul_qilindi', 'rad_etildi', 'korib_chiqilmagan', 'risk_yoq'] as const;

function Stage({
  n, title, body, children,
}: {
  n: string; title: string; body: string; children: React.ReactNode;
}) {
  return (
    <li className="relative min-w-0 border-l border-ink pb-10 pl-6 last:pb-0 lg:border-l-0 lg:border-t lg:pb-0 lg:pl-0 lg:pt-6">
      {/* The node on the rule: left edge on phones, top edge on desktop. */}
      <span aria-hidden="true" className="absolute -left-[5px] top-1 h-[9px] w-[9px] bg-ink lg:-top-[5px] lg:left-0" />
      <p className="code text-[13px] text-ink-faint">{n}</p>
      <h3 className="mt-1 text-[22px]">{title}</h3>
      <p className="mt-2 text-sm text-ink-soft lg:min-h-[5.5rem]">{body}</p>
      <div className="mt-4">{children}</div>
    </li>
  );
}

export function Workflow() {
  return (
    <Chapter n="04" label="Jarayon">
      <h2 className="max-w-[26ch] text-[28px] leading-tight sm:text-[34px]">
        Topilmadan tuzatilgan faylgacha
      </h2>
      <p className="mt-3 max-w-[64ch] text-ink-soft">
        Natija — roʻyxat emas, katalogingizning oʻzi: tasdiqlangan kodlar joyiga qoʻyilgan,
        har bir qatorda holati yozilgan.
      </p>

      <ol className="mt-10 grid list-none grid-cols-1 gap-x-8 p-0 lg:grid-cols-4">
        <Stage n="01" title="Yuklash" body="Excel yoki CSV. Ustunlar tartibi muhim emas — oʻzbekcha yoki ruscha sarlavhadan aniqlanadi.">
          <dl className="text-[13px]">
            {MAPPING.map(([from, to]) => (
              <div key={from} className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5">
                <dt className="truncate text-ink-soft">{from}</dt>
                <dd className="shrink-0">{to}</dd>
              </div>
            ))}
          </dl>
        </Stage>

        <Stage n="02" title="Tekshirish" body="Har bir qator toʻrt savoldan oʻtadi. Birortasidan oʻtmasa, qator riskli.">
          <ol className="list-none p-0 text-[13px]">
            {CHECKS.map((c) => (
              <li key={c.q} className="border-b border-rule py-1.5">{c.q}</li>
            ))}
          </ol>
        </Stage>

        <Stage n="03" title="Qaror" body="Har bir taklifni qabul qilasiz yoki rad etasiz; xatoni bekor qilasiz. Kim va qachon qilgani tarixda qoladi.">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            {[['j / k', 'keyingi / oldingi qator'], ['Enter', 'qabul qilish'], ['r', 'rad etish']].map(([k, v]) => (
              <div key={k} className="contents">
                <dt><kbd className="border border-rule-strong bg-paper px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt>
                <dd className="text-ink-soft">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-ink-soft">Ishonchi 90% dan yuqorilarini bir bosishda qabul qilish mumkin.</p>
        </Stage>

        <Stage n="04" title="Eksport" body="Asl fayl, asl ustunlar tartibida. MXIK va birlik oʻz joyida almashtiriladi, oxiriga ikki ustun qoʻshiladi.">
          <p className="text-[13px]">
            <span className="code">… | qadoqlash | audit_status</span>
          </p>
          <ul className="mt-2 list-none p-0 text-[13px]">
            {STATUS_VALUES.map((v) => (
              <li key={v} className="code border-b border-rule py-1.5 text-ink-soft">{v}</li>
            ))}
          </ul>
        </Stage>
      </ol>

      <p className="mt-12 border-t border-rule pt-4 text-[13px] text-ink-soft">
        Tasniflagich: <span className="tnum">{nf.format(CATALOG_CODES)}</span> kod ·{' '}
        <span className="tnum">{nf.format(SUBPOSITIONS)}</span> subpozitsiya · kodlarning{' '}
        <span className="tnum">{STRICT_UNIT_PCT}</span>ida oʻlchov birligi qatʼiy
        biriktirilgan · <span className="mono">tasnif.soliq.uz</span> eksporti, {SNAPSHOT}
      </p>
    </Chapter>
  );
}
