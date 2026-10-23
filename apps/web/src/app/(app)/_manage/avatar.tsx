import { cx } from '@/ui/cx';

// Tint and ink of one status family, so an avatar is readable in both themes (ink on tint >= 4.5:1).
const TONES = [
  'bg-brand-tint text-brand-ink',
  'bg-info-tint text-info-ink',
  'bg-good-tint text-good-ink',
  'bg-warn-tint text-warn-ink',
  'bg-sunken text-muted',
] as const;

/** Up to two letters for an email: "ali.valiyev@…" → "AV", "buxgalter@…" → "BU". */
export function initials(email: string): string {
  const local = (email.split('@')[0] ?? email).replace(/[^\p{L}\p{N}._-]/gu, '');
  const parts = local.split(/[._-]+/).filter(Boolean);
  const two = parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : local.slice(0, 2);
  return (two || '?').toUpperCase();
}

/** The same person always gets the same colour. */
export function toneOf(email: string): string {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length] ?? TONES[0];
}

/** Decorative initials; the email beside it (or a title) carries the name. */
export function Avatar({ email, size = 'md', className }: { email: string; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-grid shrink-0 select-none place-items-center rounded-full font-semibold ring-2 ring-raised',
        size === 'sm' ? 'size-6 text-[11px]' : 'size-8 text-micro',
        toneOf(email),
        className,
      )}
    >
      {initials(email)}
    </span>
  );
}

/** A person as a chip: initials and email. */
export function PersonChip({ email }: { email: string }) {
  return (
    <span className="inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-line bg-raised pl-0.5 pr-2.5 text-small" title={email}>
      <Avatar email={email} size="sm" className="ring-0" />
      <span className="min-w-0 truncate">{email}</span>
    </span>
  );
}

/** Overlapping initials for a table cell, the full list in the accessible text and the title. */
export function AvatarStack({ emails, max = 3, moreLabel }: { emails: readonly string[]; max?: number; moreLabel: (n: number) => string }) {
  const shown = emails.slice(0, max);
  const rest = emails.length - shown.length;
  const all = emails.join(', ');
  return (
    <span className="relative inline-flex min-w-0 items-center gap-2" title={all}>
      <span className="flex shrink-0 -space-x-1.5">
        {shown.map((e) => <Avatar key={e} email={e} size="sm" />)}
      </span>
      <span className="min-w-0 truncate text-small text-muted">
        {shown.length === 1 && rest === 0 ? shown[0] : <><span className="sr-only">{all}</span><span aria-hidden>{rest > 0 ? moreLabel(rest) : shown.map((e) => e.split('@')[0]).join(', ')}</span></>}
      </span>
    </span>
  );
}
