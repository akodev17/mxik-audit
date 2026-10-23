import type { Metadata } from 'next';
import Link from 'next/link';
import { LEAD_FILE_RETENTION_DAYS } from '@/components/landing/config';
import { Todo } from '@/components/landing/legal-page';
import { LegalDoc, type LegalSection } from './legal-doc';

/* Every factual sentence below was checked against code on 15.10.2026:
   - form fields: Lead model (prisma/schema.prisma), packages/domain/src/lead-submit.ts (POST /api/lead);
   - app data: User (scrypt hash, src/lib/password.ts), Catalog/CatalogItem
     (every original cell kept for export), AuditEvent (append-only);
   - cookie: iron-session `mxik_audit_session`, 7 days (src/lib/session.ts);
     no analytics or ad scripts anywhere in src/; fonts are self-hosted by
     next/font, so the browser makes no request to Google;
   - external AI, only when a key is configured: the reranker (renderRow in
     src/core/match/rerank-prompt.ts, uncertain rows only, off when
     MXIK_LLM_ENABLED=false) and the embedder (src/core/embed/index.ts);
   - deletion: lead files after LEAD_FILE_RETENTION_DAYS (default 30) by
     `npm run purge:expired`, at once on request by `npm run lead:delete`
     (src/lib/retention.ts); catalogues by their owner at /catalogs, with
     their rows, findings and cached AI verdicts (deleteCatalog in
     src/lib/catalogs.ts); the activity log (AuditEvent, payloads may hold
     product names) is append-only and kept, and goes only with the
     organisation when a closed account is purged (purge in
     src/lib/security/account.ts, cascade in prisma/schema.prisma), re-checked
     19.10.2026; demo copies after DEMO_TTL_HOURS (src/lib/demo-config.ts).
   Company details are TODOs. Never fill them with guesses. */
export const metadata: Metadata = {
  title: 'Maxfiylik siyosati — Tasnivo',
  description: 'Tasnivo qanday maʼlumot yigʻadi, qayerda saqlaydi va kimga yuboradi.',
  // Not indexed while it still carries TODO blanks.
  robots: { index: false, follow: true },
};

const SECTIONS: LegalSection[] = [
  {
    id: 'kim',
    title: 'Kim',
    body: (
      <p>
        Maʼlumotlarni qayta ishlovchi: <Todo>kompaniya nomi</Todo>, STIR{' '}
        <Todo>STIR</Todo>, manzil: <Todo>yuridik manzil</Todo>. Aloqa:{' '}
        <Todo>email yoki telefon</Todo>.
      </p>
    ),
  },
  {
    id: 'nimani-yigamiz',
    title: 'Nimani yigʻamiz',
    body: (
      <ul>
        <li>
          <strong className="font-medium text-ink">Bepul audit formasi:</strong> telefon raqami
          yoki Telegram manzili, katalog fayli (agar yuborsangiz), fayl nomi va hajmi.
        </li>
        <li>
          <strong className="font-medium text-ink">Ilovada:</strong> email, parol (faqat
          xeshi saqlanadi, parolning oʻzi emas), yuklangan kataloglar — barcha ustunlari
          bilan, topilmalar, qarorlar tarixi (kim, qachon, qaysi kod) va tashqi AI
          bergan takliflar (qayta soʻramaslik uchun; kaliti — xesh, tovar matni emas).
        </li>
        <li>
          <strong className="font-medium text-ink">IP manzil:</strong> formani suiisteʼmol
          qilishdan himoya uchun (bir manzildan 10 daqiqada 5 tadan ortiq soʻrov
          qabul qilinmaydi) server xotirasida vaqtincha turadi, bazaga yozilmaydi.
        </li>
        <li>
          <strong className="font-medium text-ink">Cookie:</strong> faqat tizimga kirganingizda
          sessiya cookieʼsi, 7 kun. Analitika va reklama cookieʼlari yoʻq.
        </li>
      </ul>
    ),
  },
  {
    id: 'nima-uchun',
    title: 'Nima uchun',
    body: (
      <p>
        Katalogingizni MXIK tasniflagichi bilan solishtirish, natijani sizga yuborish va
        siz bilan bogʻlanish uchun. Boshqa maqsadda ishlatmaymiz.
      </p>
    ),
  },
  {
    id: 'tashqi-xizmatlar',
    title: 'Serverdan nima chiqadi',
    body: (
      <>
        <p>
          Tavsiyani aniqlashtirish uchun tashqi AI xizmatlari ishlatilishi mumkin — faqat
          ular sozlamada yoqilgan boʻlsa:
        </p>
        <ul>
          <li>
            Anthropic (Claude) — faqat tizim ishonchi past boʻlgan qatorlar uchun:
            tozalangan tovar nomi, oʻlchov birligi va nomdan aniqlangan «tayyor taom»
            belgisi (ha/yoʻq).
          </li>
          <li>OpenAI yoki Voyage AI — tovar nomi (qidiruv uchun).</li>
        </ul>
        <p>
          Narx, shtrix kod, miqdor, kontragentlar, aloqa maʼlumotlaringiz va faylning
          oʻzi tashqariga yuborilmaydi. Xohlasangiz, katalogingizni tashqi xizmatsiz
          tekshiramiz.
        </p>
      </>
    ),
  },
  {
    id: 'saqlash',
    title: 'Qayerda va qancha saqlanadi',
    body: (
      <>
        <p>
          Maʼlumotlar bizning serverimizdagi maʼlumotlar bazasida saqlanadi:{' '}
          <Todo>server joylashuvi va hosting provayderi</Todo>.
        </p>
        <ul>
          <li>
            Bepul audit uchun yuborilgan fayl {LEAD_FILE_RETENTION_DAYS} kundan keyin
            avtomatik oʻchiriladi; soʻrovingiz boʻyicha — darhol, xohlasangiz aloqa
            maʼlumotingiz bilan birga.
          </li>
          <li>
            Ilovadagi katalogni «Kataloglar» sahifasida istalgan payt oʻzingiz
            oʻchirasiz: uning qatorlari, topilmalari va saqlab qoʻyilgan AI
            takliflari birga oʻchadi. Harakatlar jurnalidagi yozuvlar (ularda tovar
            nomlari boʻlishi mumkin) saqlanib qoladi va faqat hisob oʻchirilganda
            oʻchadi.
          </li>
          <li>Demo nusxasi oʻz muddati tugagach oʻchiriladi.</li>
          <li>
            Aloqa maʼlumotlari va hisob: <Todo>saqlash muddati</Todo>.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'huquqlar',
    title: 'Huquqlaringiz',
    body: (
      <p>
        Biz saqlayotgan maʼlumotlaringiz haqida soʻrashingiz, ularni tuzatish yoki
        oʻchirishni talab qilishingiz mumkin. Soʻrov uchun: <Todo>email yoki Telegram</Todo>.
        Javob muddati: <Todo>muddat</Todo>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Maxfiylik siyosati" updated={<>19.10.2026 — <Todo>yurist koʻrib chiqqan sana</Todo></>} sections={SECTIONS}
      footer={(
        <p>
          Xizmat shartlari — <Link href="/oferta" className="underline">ommaviy ofertada</Link>.
        </p>
      )}
    />
  );
}
