/**
 * The fixed clock.
 *
 * Every relative date phrase resolves against CHEESE_AS_OF rather than the real
 * system time. Without this, "last month" would mean something different every
 * month and the gold answers in docs/EXAMPLES.md would rot overnight.
 */

export const DEFAULT_AS_OF = '2026-09-05';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns the as-of date as YYYY-MM-DD. */
export function asOf(): string {
  const configured = (process.env.CHEESE_AS_OF || process.env.MEOW_AS_OF)?.trim();
  if (configured && ISO_DATE.test(configured)) return configured;
  return DEFAULT_AS_OF;
}

/** Returns the as-of date as a UTC Date, for arithmetic. */
export function asOfDate(): Date {
  return new Date(`${asOf()}T00:00:00Z`);
}
