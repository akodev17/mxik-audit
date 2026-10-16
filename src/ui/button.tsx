import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-[#1c47d6] border border-transparent',
  secondary: 'bg-base text-fg border border-line-strong hover:bg-surface',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-surface hover:text-fg',
  danger: 'bg-base text-danger border border-line-strong hover:bg-danger-tint',
};
const SIZE: Record<Size, string> = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-[15px]' };

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', extra?: string): string {
  return cx(
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-ctl font-medium transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANT[variant], SIZE[size], extra,
  );
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export function Button({ variant, size, className, type = 'button', ...rest }: Props) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

type LinkProps = { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode; download?: boolean; target?: string };

export function ButtonLink({ href, variant, size, className, children, download, target }: LinkProps) {
  const cls = buttonClass(variant, size, className);
  // Plain anchors for downloads and new tabs; router links otherwise.
  if (download || target) return <a href={href} download={download} target={target} rel="noopener" className={cls}>{children}</a>;
  return <Link href={href} className={cls}>{children}</Link>;
}
