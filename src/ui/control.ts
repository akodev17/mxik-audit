// Shared look of text fields, selects and textareas: one border, one focus ring, one error state.
import { cx } from './cx';

export type ControlSize = 'compact' | 'md' | 'lg';

export const CONTROL_HEIGHT: Record<ControlSize, string> = {
  compact: 'h-control-compact text-small',
  md: 'h-control-md text-data',
  lg: 'h-control-lg text-body',
};

export type ControlLook = { invalid?: boolean; readOnly?: boolean };

/** Border, colours and states without a height; the focus ring comes from the base layer. */
export function controlSurface(look: ControlLook = {}, extra?: string): string {
  return cx(
    'w-full rounded-ctl border px-3 text-fg placeholder:text-subtle',
    'transition-colors duration-(--duration-fast)',
    'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted',
    look.readOnly ? 'bg-surface' : 'bg-raised',
    look.invalid ? 'border-danger' : 'border-line-input hover:border-muted',
    extra,
  );
}

export function controlClass(size: ControlSize = 'md', look: ControlLook = {}, extra?: string): string {
  return controlSurface(look, cx(CONTROL_HEIGHT[size], extra));
}

type AriaInvalid = boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined;

/** A control is invalid when told so directly or through aria-invalid (which Field sets). */
export function isInvalid(invalid: boolean | undefined, ariaInvalid: AriaInvalid): boolean {
  return invalid === true || ariaInvalid === true || ariaInvalid === 'true';
}
