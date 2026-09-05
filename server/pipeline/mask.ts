/**
 * Masking and money formatting.
 *
 * Two rules live here and nowhere else: an account number is never printed in
 * full, a UTR is never printed at all. Amounts are formatted straight from the
 * decimal string Postgres returns, so no total passes through a float.
 */

/** "HDFC 5020****9069" from a bank code and a raw account number. */
export function maskAccount(bankCode: string, accountNumber: string): string {
  const digits = (accountNumber ?? '').trim();
  if (digits.length <= 8) return `${bankCode} ${'*'.repeat(Math.max(digits.length, 4))}`;
  return `${bankCode} ${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

/** UTR is never shown. Callers report presence only. */
export function utrDisplay(hasUtr: boolean): string {
  return hasUtr ? 'present, masked' : 'missing';
}

/**
 * Indian digit grouping on a decimal string: last three digits, then pairs.
 * 231680596.77 becomes 23,16,80,596.77. Operates on the string, never a Number.
 */
export function formatInr(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '0.00';

  const raw = String(amount).trim();
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;

  const [intPartRaw, fracRaw = ''] = unsigned.split('.');
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
  const frac = (fracRaw + '00').slice(0, 2);

  let grouped: string;
  if (intPart.length <= 3) {
    grouped = intPart;
  } else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    const pairs: string[] = [];
    let remaining = rest;
    while (remaining.length > 2) {
      pairs.unshift(remaining.slice(-2));
      remaining = remaining.slice(0, -2);
    }
    if (remaining) pairs.unshift(remaining);
    grouped = `${pairs.join(',')},${last3}`;
  }

  return `${negative ? '-' : ''}${grouped}.${frac}`;
}

/** "INR 1,69,299.00". The unit is always explicit in headlines. */
export function inr(amount: string | number | null | undefined): string {
  return `INR ${formatInr(amount)}`;
}

/**
 * Share of a total, to one decimal place. Ratios are display-only, so a float
 * here cannot corrupt a reported amount.
 */
export function formatShare(part: string | number, total: string | number): string {
  const p = Number(part);
  const t = Number(total);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t === 0) return '-';
  return `${((p / t) * 100).toFixed(1)}%`;
}

/** Collapses runs of whitespace in bank-statement text so tables stay readable. */
export function tidyDescription(description: string | null | undefined, limit = 90): string {
  const text = (description ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

/** "24 Jun 2026 06:30" from a Postgres timestamp string. */
export function formatTimestamp(value: string): string {
  const [datePart, timePart = ''] = String(value).split(/[ T]/);
  const [y, m, d] = datePart.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hhmm = timePart.slice(0, 5);
  return `${d} ${months[m - 1]} ${y}${hhmm ? ` ${hhmm}` : ''}`;
}
