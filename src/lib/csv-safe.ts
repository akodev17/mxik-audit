// Formula-injection guard for anything we write into a spreadsheet or CSV: a
// cell that starts with = + - @ tab or CR is prefixed with an apostrophe, so
// Excel shows it as text instead of running it. Plain numbers ("-5", "-12,50")
// cannot be formulas and stay as they are. Pure.

const TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d[\d\s]*([.,]\d+)?$/;

export function formulaSafe(value: string): string {
  if (!TRIGGER.test(value) || PLAIN_NUMBER.test(value)) return value;
  return `'${value}`;
}
