'use client';

import { Button } from './button';
import { IconPrint } from './icons';

/** Opens the browser's print dialog for the current page; the shell's header and sidebar are left out of the printout. */
export function PrintButton({ children }: { children: string }) {
  return <Button variant="secondary" onClick={() => window.print()}><IconPrint size={16} />{children}</Button>;
}
