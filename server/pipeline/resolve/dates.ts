/**
 * Date phrase resolution. The single place that decides what "last month" or
 * "this quarter" means.
 *
 * Fiscal year is the Indian FY: April to March. Q1 is Apr-Jun, so "this
 * quarter" on 5 Sep 2026 is Q2 FY26-27 (Jul-Sep), not calendar Q3. Getting this
 * wrong is the fastest way to lose a treasury team's trust.
 */
import { asOfDate } from '../clock.js';
import type { Granularity, Period } from '../types.js';

export type PeriodResolution =
  | { ok: true; period: Period }
  | { ok: false; reason: 'vague' | 'unparsed'; phrase: string };

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LONG_MONTH = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/** Phrases that name no window at all. These must ask, never guess. */
const VAGUE = [
  'recently', 'recent', 'lately', 'these days', 'a while back', 'some time ago',
  'the other day', 'nowadays', 'of late'
];

function utc(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Human date for labels and prose: "1 Apr 2026". */
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${d} ${SHORT_MONTH[m - 1]} ${y}`;
}

/** FY starting year for a date. April onwards belongs to that calendar year. */
export function fyStartYear(date: Date): number {
  const month = date.getUTCMonth() + 1;
  return month >= 4 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/** "FY26-27" from the starting year. */
export function fyLabel(startYear: number): string {
  const a = String(startYear % 100).padStart(2, '0');
  const b = String((startYear + 1) % 100).padStart(2, '0');
  return `FY${a}-${b}`;
}

/** Fiscal quarter number (1-4) for a date, where Q1 is Apr-Jun. */
export function fyQuarter(date: Date): number {
  const month = date.getUTCMonth() + 1;
  return Math.floor(((month - 4 + 12) % 12) / 3) + 1;
}

export function monthPeriod(year: number, month1: number): Period {
  return {
    from: iso(utc(year, month1, 1)),
    to: iso(utc(year, month1, daysInMonth(year, month1))),
    label: `${LONG_MONTH[month1 - 1]} ${year}`,
    granularity: 'month'
  };
}

export function quarterPeriod(fyStart: number, quarter: number): Period {
  const startMonthAbs = 4 + (quarter - 1) * 3; // 4, 7, 10, 13
  const startYear = fyStart + (startMonthAbs > 12 ? 1 : 0);
  const startMonth = startMonthAbs > 12 ? startMonthAbs - 12 : startMonthAbs;
  const endMonthAbs = startMonthAbs + 2;
  const endYear = fyStart + (endMonthAbs > 12 ? 1 : 0);
  const endMonth = endMonthAbs > 12 ? endMonthAbs - 12 : endMonthAbs;

  return {
    from: iso(utc(startYear, startMonth, 1)),
    to: iso(utc(endYear, endMonth, daysInMonth(endYear, endMonth))),
    label: `Q${quarter} ${fyLabel(fyStart)}`,
    granularity: 'quarter'
  };
}

export function fyPeriod(fyStart: number): Period {
  return {
    from: iso(utc(fyStart, 4, 1)),
    to: iso(utc(fyStart + 1, 3, 31)),
    label: fyLabel(fyStart),
    granularity: 'fy'
  };
}

export function ytdPeriod(reference: Date): Period {
  const fyStart = fyStartYear(reference);
  return {
    from: iso(utc(fyStart, 4, 1)),
    to: iso(reference),
    label: `${fyLabel(fyStart)} year to date`,
    granularity: 'ytd'
  };
}

function customPeriod(from: string, to: string): Period {
  return { from, to, label: `${formatDay(from)} to ${formatDay(to)}`, granularity: 'custom' };
}

/** Parses "fy26-27", "fy2026-27", "fy 26-27" into a starting year. */
function parseFyToken(text: string): number | null {
  const match = text.match(/fy\s?'?(\d{2}|\d{4})\s?[-/]?\s?'?(\d{2}|\d{4})?/);
  if (!match) return null;
  const raw = Number(match[1]);
  if (Number.isNaN(raw)) return null;
  return raw > 999 ? raw : 2000 + raw;
}

/**
 * Turns a natural date phrase into an inclusive window.
 * Returns `vague` for phrases like "recently" so the caller can ask instead of
 * inventing a range.
 */
export function resolvePeriod(phrase: string | null | undefined, reference = asOfDate()): PeriodResolution {
  const text = (phrase ?? '').toLowerCase().trim();
  if (!text) return { ok: false, reason: 'unparsed', phrase: '' };

  if (VAGUE.some((v) => text.includes(v))) {
    return { ok: false, reason: 'vague', phrase: text };
  }

  const refYear = reference.getUTCFullYear();
  const refMonth = reference.getUTCMonth() + 1;

  // Explicit range: "2026-06-01 to 2026-06-30"
  const range = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|-)\s*(\d{4}-\d{2}-\d{2})/);
  if (range) return { ok: true, period: customPeriod(range[1], range[2]) };

  const singleDate = text.match(/^on\s+(\d{4}-\d{2}-\d{2})$|^(\d{4}-\d{2}-\d{2})$/);
  if (singleDate) {
    const day = singleDate[1] ?? singleDate[2];
    return { ok: true, period: { from: day, to: day, label: formatDay(day), granularity: 'day' } };
  }

  if (/\b(today)\b/.test(text)) {
    const day = iso(reference);
    return { ok: true, period: { from: day, to: day, label: `${formatDay(day)}`, granularity: 'day' } };
  }

  if (/\byesterday\b/.test(text)) {
    const d = new Date(reference);
    d.setUTCDate(d.getUTCDate() - 1);
    return { ok: true, period: { from: iso(d), to: iso(d), label: formatDay(iso(d)), granularity: 'day' } };
  }

  const lastNDays = text.match(/(?:last|past|previous)\s+(\d+)\s+days?/);
  if (lastNDays) {
    const n = Number(lastNDays[1]);
    const start = new Date(reference);
    start.setUTCDate(start.getUTCDate() - (n - 1));
    return { ok: true, period: { ...customPeriod(iso(start), iso(reference)), label: `last ${n} days` } };
  }

  const lastNMonths = text.match(/(?:last|past|previous)\s+(\d+)\s+months?/);
  if (lastNMonths) {
    const n = Number(lastNMonths[1]);
    const startMonthAbs = refMonth - n;
    const startYear = refYear + Math.floor((startMonthAbs - 1) / 12);
    const startMonth = ((startMonthAbs - 1 + 1200) % 12) + 1;
    const prev = previousMonth(refYear, refMonth);
    return {
      ok: true,
      period: {
        from: iso(utc(startYear, startMonth, 1)),
        to: monthPeriod(prev.year, prev.month).to,
        label: `last ${n} months`,
        granularity: 'custom'
      }
    };
  }

  // Year to date and fiscal year
  if (/\b(ytd|year to date|so far this year|this year so far)\b/.test(text)) {
    return { ok: true, period: ytdPeriod(reference) };
  }

  const fyStartFromToken = parseFyToken(text);
  if (fyStartFromToken !== null && !/\bq[1-4]\b|quarter/.test(text)) {
    return { ok: true, period: fyPeriod(fyStartFromToken) };
  }

  if (/\b(this|current)\s+(financial\s+year|fiscal\s+year|fy|year)\b/.test(text)) {
    return { ok: true, period: fyPeriod(fyStartYear(reference)) };
  }

  if (/\b(last|previous|prior)\s+(financial\s+year|fiscal\s+year|fy|year)\b/.test(text)) {
    return { ok: true, period: fyPeriod(fyStartYear(reference) - 1) };
  }

  // Quarters
  const quarterMatch = text.match(/\bq([1-4])\b/) ?? text.match(/\b(first|second|third|fourth)\s+quarter\b/);
  if (quarterMatch) {
    const ordinal = ['first', 'second', 'third', 'fourth'].indexOf(quarterMatch[1]);
    const quarter = ordinal >= 0 ? ordinal + 1 : Number(quarterMatch[1]);
    const fyStart = parseFyToken(text) ?? fyStartYear(reference);
    return { ok: true, period: quarterPeriod(fyStart, quarter) };
  }

  if (/\b(this|current)\s+quarter\b/.test(text)) {
    return { ok: true, period: quarterPeriod(fyStartYear(reference), fyQuarter(reference)) };
  }

  if (/\b(last|previous|prior)\s+quarter\b/.test(text)) {
    const q = fyQuarter(reference);
    const fyStart = fyStartYear(reference);
    return q === 1
      ? { ok: true, period: quarterPeriod(fyStart - 1, 4) }
      : { ok: true, period: quarterPeriod(fyStart, q - 1) };
  }

  // Months
  if (/\b(this|current)\s+month\b/.test(text)) {
    return { ok: true, period: monthPeriod(refYear, refMonth) };
  }

  if (/\b(last|previous|prior)\s+month\b/.test(text)) {
    const prev = previousMonth(refYear, refMonth);
    return { ok: true, period: monthPeriod(prev.year, prev.month) };
  }

  const named = findNamedMonth(text);
  if (named !== null) {
    const yearMatch = text.match(/\b(20\d{2})\b/);
    if (yearMatch) return { ok: true, period: monthPeriod(Number(yearMatch[1]), named) };
    // No year given: the most recent occurrence at or before the as-of month.
    const year = named <= refMonth ? refYear : refYear - 1;
    return { ok: true, period: monthPeriod(year, named) };
  }

  return { ok: false, reason: 'unparsed', phrase: text };
}

function previousMonth(year: number, month1: number): { year: number; month: number } {
  return month1 === 1 ? { year: year - 1, month: 12 } : { year, month: month1 - 1 };
}

function findNamedMonth(text: string): number | null {
  for (let i = 0; i < MONTHS.length; i += 1) {
    if (new RegExp(`\\b${MONTHS[i]}\\b`).test(text)) return i + 1;
  }
  for (let i = 0; i < MONTH_ABBR.length; i += 1) {
    if (new RegExp(`\\b${MONTH_ABBR[i]}\\b`).test(text)) return i + 1;
  }
  return null;
}

/**
 * The window immediately before this one, at the same granularity.
 * Powers "how does that compare to the month before".
 */
export function previousPeriod(period: Period): Period {
  const from = new Date(`${period.from}T00:00:00Z`);

  if (period.granularity === 'month') {
    const prev = previousMonth(from.getUTCFullYear(), from.getUTCMonth() + 1);
    return monthPeriod(prev.year, prev.month);
  }

  if (period.granularity === 'quarter') {
    const q = fyQuarter(from);
    const fyStart = fyStartYear(from);
    return q === 1 ? quarterPeriod(fyStart - 1, 4) : quarterPeriod(fyStart, q - 1);
  }

  if (period.granularity === 'fy' || period.granularity === 'ytd') {
    return fyPeriod(fyStartYear(from) - 1);
  }

  // Day or custom: shift back by its own length.
  const to = new Date(`${period.to}T00:00:00Z`);
  const lengthMs = to.getTime() - from.getTime();
  const newTo = new Date(from.getTime() - 86_400_000);
  const newFrom = new Date(newTo.getTime() - lengthMs);
  return customPeriod(iso(newFrom), iso(newTo));
}

/** Granularity label used in trails, e.g. "month" or "quarter". */
export function granularityNoun(granularity: Granularity): string {
  return granularity === 'ytd' ? 'year to date' : granularity;
}
