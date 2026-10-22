// Plural forms for count templates. Uzbek does not inflect nouns after numbers; Russian has three forms.
const rules = new Intl.PluralRules('ru');

/** pluralRu(3, 'строка', 'строки', 'строк') -> 'строки' */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const form = rules.select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
}
