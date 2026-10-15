import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, Todo } from '@/components/landing/legal-page';

/* Every factual sentence below was checked against code on 15.10.2026:
   - form fields: Lead model (prisma/schema.prisma), src/app/actions/lead.ts;
   - app data: User (scrypt hash, src/lib/password.ts), Catalog/CatalogItem
     (every original cell kept for export), AuditEvent (append-only);
   - cookie: iron-session `mxik_audit_session`, 7 days (src/lib/session.ts);
     no analytics or ad scripts anywhere in src/; fonts are self-hosted by
     next/font, so the browser makes no request to Google;
   - external AI: src/core/match/rerank.ts and src/core/embed/index.ts, only
     when a key is configured;
   - deletion: no mechanism in code yet, so: by hand, on request.
   Company details are TODOs. Never fill them with guesses. */
export const metadata: Metadata = {
  title: 'Maxfiylik siyosati — MXIK Audit',
  description: 'MXIK Audit qanday maʼlumot yigʻadi, qayerda saqlaydi va kimga yuboradi.',
  // Not indexed while it still carries TODO blanks.
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Maxfiylik siyosati" updated={<>15.10.2026 — <Todo>yurist koʻrib chiqqan sana</Todo></>}>
      <section>
        <h2>Kim</h2>
        <p className="mt-2">
          Maʼlumotlarni qayta ishlovchi: <Todo>kompaniya nomi</Todo>, STIR{' '}
          <Todo>STIR</Todo>, manzil: <Todo>yuridik manzil</Todo>. Aloqa:{' '}
          <Todo>email yoki telefon</Todo>.
        </p>
      </section>

      <section>
        <h2>Nimani yigʻamiz</h2>
        <ul>
          <li>
            <strong className="font-medium text-ink">Bepul audit formasi:</strong> telefon raqami
            yoki Telegram manzili, katalog fayli (agar yuborsangiz), fayl nomi va hajmi.
          </li>
          <li>
            <strong className="font-medium text-ink">Ilovada:</strong> email, parol (faqat
            xeshi saqlanadi, parolning oʻzi emas), yuklangan kataloglar — barcha ustunlari
            bilan, topilmalar va qarorlar jurnali (kim, qachon, qaysi kod).
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
      </section>

      <section>
        <h2>Nima uchun</h2>
        <p className="mt-2">
          Katalogingizni MXIK tasniflagichi bilan solishtirish, natijani sizga yuborish va
          siz bilan bogʻlanish uchun. Boshqa maqsadda ishlatmaymiz.
        </p>
      </section>

      <section>
        <h2>Serverdan nima chiqadi</h2>
        <p className="mt-2">
          Tavsiyani aniqlashtirish uchun tashqi AI xizmatlari ishlatilishi mumkin — faqat
          ular sozlamada yoqilgan boʻlsa:
        </p>
        <ul>
          <li>
            Anthropic (Claude) — tovar nomi, undan ajratilgan belgilar (masalan, hajm) va
            oʻlchov birligi.
          </li>
          <li>OpenAI yoki Voyage AI — tovar nomi (qidiruv uchun).</li>
        </ul>
        <p className="mt-3">
          Narx, shtrix kod, miqdor, kontragentlar, aloqa maʼlumotlaringiz va faylning
          oʻzi tashqariga yuborilmaydi. Xohlasangiz, katalogingizni tashqi xizmatsiz
          tekshiramiz.
        </p>
      </section>

      <section>
        <h2>Qayerda va qancha saqlanadi</h2>
        <p className="mt-2">
          Maʼlumotlar bizning serverimizdagi maʼlumotlar bazasida saqlanadi:{' '}
          <Todo>server joylashuvi va hosting provayderi</Todo>. Saqlash muddati:{' '}
          <Todo>muddat</Todo>. Hozircha avtomatik oʻchirish yoʻq — soʻrovingiz boʻyicha
          faylni va unga tegishli maʼlumotlarni qoʻlda oʻchiramiz.
        </p>
      </section>

      <section>
        <h2>Huquqlaringiz</h2>
        <p className="mt-2">
          Biz saqlayotgan maʼlumotlaringiz haqida soʻrashingiz, ularni tuzatish yoki
          oʻchirishni talab qilishingiz mumkin. Soʻrov uchun: <Todo>email yoki Telegram</Todo>.
          Javob muddati: <Todo>muddat</Todo>.
        </p>
      </section>

      <p className="text-[13px]">
        Xizmat shartlari — <Link href="/oferta" className="underline">ommaviy ofertada</Link>.
      </p>
    </LegalPage>
  );
}
