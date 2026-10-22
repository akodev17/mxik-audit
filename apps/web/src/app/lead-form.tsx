'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { submitLead, type LeadState } from '@/app/actions/lead';
import { HONEYPOT_FIELD, LEAD_LIMITS } from '@tasnivo/domain/lead-guard';

export function LeadForm() {
  const [state, action, pending] = useActionState<LeadState, FormData>(submitLead, {});
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);

  // React resets the form after every submit, which empties the file input. On
  // an error the "ready to send" card must not keep claiming a file is staged,
  // so drop it when a new error arrives (adjusting state during render, not in
  // an effect, so there is no frame where the two disagree).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.error) setFile(null);
  }

  if (state.ok) {
    return (
      <div role="status" aria-live="polite">
        <p className="text-[24px] font-bold leading-snug">
          Soʻrovingiz qabul qilindi.
        </p>
        <ol className="mt-4 list-none space-y-3 border-t border-lp-line p-0 pt-4 text-[17px]">
          <li className="flex gap-3">
            <span className="num shrink-0 font-bold text-lp-brand">1.</span>
            <span>Faylni oʻqib, katalogni tasniflagich bilan solishtiramiz.</span>
          </li>
          <li className="flex gap-3">
            <span className="num shrink-0 font-bold text-lp-brand">2.</span>
            <span>
              Bir ish kuni ichida riskli pozitsiyalar roʻyxatini yuboramiz, siz
              koʻrsatgan raqam yoki Telegram orqali.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="num shrink-0 font-bold text-lp-brand">3.</span>
            <span>Toʻgʻrilash kerak yoki yoʻqligini shundan keyin hal qilasiz.</span>
          </li>
        </ol>
        <p className="mt-5 text-[15px] text-lp-muted">
          Bu bosqich uchun toʻlov yoʻq va hech narsaga obuna boʻlmaysiz.
        </p>
      </div>
    );
  }

  const contactError = state.error && state.field === 'contact';
  const fileError = state.error && state.field === 'file';

  return (
    <form action={action} className="space-y-5" noValidate>
      <div>
        <label htmlFor="lead-contact" className="block text-[16px] font-bold">
          Telegram yoki telefon <span className="text-lp-risk" aria-hidden="true">*</span>
        </label>
        <input
          id="lead-contact"
          name="contact"
          required
          maxLength={LEAD_LIMITS.contact}
          defaultValue={state.contact ?? ''}
          placeholder="@username  yoki  +998 90 123 45 67"
          autoComplete="tel"
          inputMode="text"
          aria-invalid={contactError ? true : undefined}
          aria-describedby={contactError ? 'lead-error lead-contact-hint' : 'lead-contact-hint'}
          className={
            'mt-2 min-h-12 w-full rounded-lp border-2 bg-lp-base px-4 py-3 text-[17px] text-lp-ink placeholder:text-lp-muted focus:border-lp-brand focus:outline-none '
            + (contactError ? 'border-lp-risk' : 'border-lp-line-strong')
          }
        />
        <p id="lead-contact-hint" className="mt-1.5 text-[15px] text-lp-muted">
          Javobni shu manzilga yuboramiz.
        </p>
      </div>

      {/* One label wrapping both the caption and the click target: two labels
          pointing at the same input is invalid and confuses screen readers. */}
      <label htmlFor="lead-file" className="block rounded-lp has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-lp-brand has-[input:focus-visible]:outline-solid">
        <span className="block text-[16px] font-bold">
          Excel yoki CSV katalog{' '}
          <span className="font-normal text-lp-muted">(.xlsx, .csv, 5 MB gacha)</span>
        </span>
        <span
          className={
            'mt-2 flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-lp '
            + 'border-2 border-dashed px-4 py-3 transition-colors hover:border-lp-brand '
            + (fileError ? 'border-lp-risk' : file ? 'border-lp-ok bg-lp-ok-fill' : 'border-lp-line-strong bg-lp-base')
          }
        >
          <span className="min-w-0">
            <span
              className={`block truncate text-[16px] ${file ? 'text-lp-ink' : 'text-lp-muted'}`}
              data-testid="lead-filename"
            >
              {file ? file.name : 'Faylni tanlang'}
            </span>
            {file ? (
              <span className="num block text-[15px] text-lp-muted">
                {(file.size / 1024).toFixed(0)} KB, yuborishga tayyor
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-[16px] font-medium text-lp-brand-ink underline underline-offset-4">
            {file ? 'almashtirish' : 'tanlash'}
          </span>
        </span>
        <input
          id="lead-file"
          name="file"
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          aria-invalid={fileError ? true : undefined}
          aria-describedby={fileError ? 'lead-error' : undefined}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            setFile(picked ? { name: picked.name, size: picked.size } : null);
          }}
        />
      </label>

      {/* Honeypot. Off-screen rather than display:none, which some bots skip;
          out of the tab order and hidden from assistive tech, so no person
          ever reaches it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="lead-website">Veb-sayt (toʻldirmang)</label>
        <input id="lead-website" name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {state.error ? (
        <p
          id="lead-error"
          role="alert"
          className="rounded-lp border-l-4 border-lp-risk bg-lp-risk-fill px-4 py-3 text-[16px] text-lp-ink"
        >
          {state.error}
          {fileError ? ' Faylni qayta tanlang.' : null}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 w-full rounded-lp bg-lp-brand px-6 py-3 text-[17px] font-medium text-white transition-colors hover:bg-lp-brand-ink disabled:opacity-60"
      >
        {pending ? 'Yuborilmoqda…' : 'Bepul audit soʻrash'}
      </button>

      <p className="text-[15px] text-lp-muted">
        Roʻyxatdan oʻtish, parol yoki karta kerak emas. Fayl faqat shu audit uchun
        ishlatiladi. Tashqi AI xizmatiga faqat tovar nomi va oʻlchov birligi
        borishi mumkin: narx, shtrix kod va boshqa ustunlar emas. Batafsil:{' '}
        <Link href="/maxfiylik" className="rounded-lp text-lp-ink underline underline-offset-4">maxfiylik siyosati</Link>,{' '}
        <Link href="/oferta" className="rounded-lp text-lp-ink underline underline-offset-4">oferta</Link>.
      </p>
    </form>
  );
}
