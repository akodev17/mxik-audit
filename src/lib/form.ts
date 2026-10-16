/** A form field as text; files and missing fields read as empty. */
export function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
