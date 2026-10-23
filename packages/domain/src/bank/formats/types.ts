// What a statement layout is. Pure; shared with the browser.
import type { BankConventions, BankRole } from '@tasnivo/contracts/modules/bank';

export type BankFormatDef = {
  id: string;
  name: string;
  /** The bank the layout belongs to; null for a generic layout. */
  bankName: string | null;
  /** True only once a real statement of this layout was parsed and its balance reconciled. */
  verified: boolean;
  /** Where the layout's words come from. */
  source: string;
  /** Header words per role this layout uses (bankHeaderKey form). They detect the layout. */
  columns: Partial<Record<BankRole, readonly string[]>>;
  /** Roles that must all be found for a file to be this layout. */
  required: readonly BankRole[];
  conventions: BankConventions;
  /** Rows this layout prints that are not transactions, besides the common balances, totals and footers. */
  dropRows: readonly RegExp[];
};
