'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { submitLead, type LeadState } from '@/app/actions/lead';

export function LeadForm() {
  const [state, action, pending] = useActionState<LeadState, FormData>(submitLead, {});
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);

  if (state.ok) {
    return (
      <div aria-live="polite">
        <p className="font-serif text-[22px] leading-snug text-ok">
          Soʻrovingiz qabul qilindi.
        </p>
        <ol className="mt-4 list-none space-y-3 border-t border-rule p-0 pt-4 text-sm text-ink-soft">
          <li className="flex gap-3">
            <span className="shrink-0 tnum text-ink-faint">1.</span>
            <span>Faylni oʻqib, katalogni tasniflagich bilan solishtiramiz.</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 tnum text-ink-faint">2.</span>
            <span>
              Bir ish kuni ichida riskli pozitsiyalar roʻyxatini yuboramiz — siz
              koʻrsatgan raqam yoki Telegram orqali.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 tnum text-ink-faint">3.</span>
            <span>Toʻgʻrilash kerak yoki yoʻqligini shundan keyin hal qilasiz.</span>
          </li>
        </ol>
        <p className="mt-5 text-xs text-ink-faint">
          Bu bosqich uchun toʻlov yoʻq va hech narsaga obuna boʻlmaysiz.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <div>
        <label htmlFor="lead-contact" className="block text-sm font-medium">
          Telegram yoki telefon <span className="text-risk">*</span>
        </label>
        <input
          id="lead-contact"
          name="contact"
          required
          placeholder="@username  yoki  +998 90 123 45 67"
          autoComplete="tel"
          inputMode="text"
          className="mt-1.5 w-full border border-rule-strong bg-paper px-3.5 py-3 text-base focus:border-ink focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-ink-faint">Javobni shu manzilga yuboramiz.</p>
      </div>

      {/* One label wrapping both the caption and the click target: two labels
          pointing at the same input is invalid and confuses screen readers. */}
      <label htmlFor="lead-file" className="block">
        <span className="block text-sm font-medium">
          Excel yoki CSV katalog{' '}
          <span className="font-normal text-ink-faint">(.xlsx, .csv — 20 MB gacha)</span>
        </span>
        <span
          className={
            'mt-1.5 flex min-h-[3.25rem] cursor-pointer items-center justify-between gap-3 '
            + 'border border-dashed px-3.5 py-3 transition-colors hover:border-ink '
            + (file ? 'border-ok bg-ok-tint' : 'border-rule-strong')
          }
        >
          <span className="min-w-0">
            <span
              className={`block truncate text-sm ${file ? 'text-ink' : 'text-ink-faint'}`}
              data-testid="lead-filename"
            >
              {file ? file.name : 'Faylni tanlang'}
            </span>
            {file ? (
              <span className="block text-xs text-ink-soft tnum">
                {(file.size / 1024).toFixed(0)} KB — yuborishga tayyor
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-sm text-ink-soft underline">
            {file ? 'almashtirish' : 'tanlash'}
          </span>
        </span>
        <input
          id="lead-file"
          name="file"
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            setFile(picked ? { name: picked.name, size: picked.size } : null);
          }}
        />
      </label>

      {state.error ? (
        <p role="alert" className="border-l-2 border-risk bg-risk-tint px-3.5 py-2.5 text-sm text-risk">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-ink px-6 py-3.5 font-medium text-paper transition-colors hover:bg-black disabled:opacity-50"
      >
        {pending ? 'Yuborilmoqda…' : 'Bepul audit soʻrash'}
      </button>

      <p className="text-xs text-ink-faint">
        Roʻyxatdan oʻtish, parol yoki karta kerak emas. Fayl faqat shu audit uchun
        ishlatiladi. Tashqi AI xizmatiga faqat tovar nomi va oʻlchov birligi
        borishi mumkin — narx, shtrix kod va boshqa ustunlar emas. Batafsil:{' '}
        <Link href="/maxfiylik" className="underline">maxfiylik siyosati</Link>,{' '}
        <Link href="/oferta" className="underline">oferta</Link>.
      </p>
    </form>
  );
}
