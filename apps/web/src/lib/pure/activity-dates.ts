// The audit log's day filters are typed as dd.mm.yyyy (domain activity-dates.ts); the API reads
// what was typed and answers the days it applied as yyyy-mm-dd.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** yyyy-mm-dd back to dd.mm.yyyy for the input. */
export function dayInputValue(isoDay: string): string {
  const m = ISO.exec(isoDay);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}
