/**
 * Bank resolution. Bank names come from the `bank` table and nowhere else, so
 * Swiss Cheese can never answer about a bank that is not in the data.
 *
 * The pure matcher is separated from the loader so it can be tested without a
 * database.
 */
import { query } from '../../db/pool.js';

export interface BankRow {
  bank_code: string;
  bank_name: string;
}

export type BankResolution =
  | { ok: true; bankCode: string; bankName: string }
  | { ok: false; reason: 'unknown'; text: string };

/**
 * Everyday names a treasury user types, mapped to IFSC prefixes. Only codes
 * that exist in the table can ever be returned, so an entry here for a bank
 * with no rows is harmless.
 */
const COLLOQUIAL: Record<string, string> = {
  sbi: 'SBIN',
  statebank: 'SBIN',
  statebankofindia: 'SBIN',
  axis: 'UTIB',
  axisbank: 'UTIB',
  kotak: 'KKBK',
  kotakmahindra: 'KKBK',
  icici: 'ICIC',
  hdfc: 'HDFC',
  canara: 'CNRB',
  canarabank: 'CNRB',
  union: 'UBIN',
  unionbank: 'UBIN',
  unionbankofindia: 'UBIN',
  au: 'AUBL',
  aubank: 'AUBL',
  ausmallfinance: 'AUBL',
  ausmallfinancebank: 'AUBL',
  rbl: 'RATN',
  rblbank: 'RATN',
  tmb: 'TMBL',
  tamilnadmercantile: 'TMBL'
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Pure matcher: text plus the bank table, no I/O. */
export function resolveBankFromList(text: string | null | undefined, banks: BankRow[]): BankResolution {
  const raw = (text ?? '').trim();
  if (!raw) return { ok: false, reason: 'unknown', text: '' };

  const needle = normalize(raw);
  if (!needle) return { ok: false, reason: 'unknown', text: raw };

  const byCode = banks.find((b) => b.bank_code.toLowerCase() === needle);
  if (byCode) return { ok: true, bankCode: byCode.bank_code, bankName: byCode.bank_name };

  const mapped = COLLOQUIAL[needle];
  if (mapped) {
    const hit = banks.find((b) => b.bank_code === mapped);
    if (hit) return { ok: true, bankCode: hit.bank_code, bankName: hit.bank_name };
  }

  const byExactName = banks.find((b) => normalize(b.bank_name) === needle);
  if (byExactName) return { ok: true, bankCode: byExactName.bank_code, bankName: byExactName.bank_name };

  const byPartialName = banks.filter((b) => normalize(b.bank_name).includes(needle));
  if (byPartialName.length === 1) {
    return { ok: true, bankCode: byPartialName[0].bank_code, bankName: byPartialName[0].bank_name };
  }

  return { ok: false, reason: 'unknown', text: raw };
}

let cache: BankRow[] | null = null;

/** Loads and caches the bank table. The list is tiny and effectively static. */
export async function loadBanks(): Promise<BankRow[]> {
  if (cache) return cache;
  cache = await query<BankRow>('SELECT bank_code, bank_name FROM bank ORDER BY bank_code');
  return cache;
}

/** Clears the cache. Used by the eval harness between runs. */
export function clearBankCache(): void {
  cache = null;
}

export async function resolveBank(text: string | null | undefined): Promise<BankResolution> {
  return resolveBankFromList(text, await loadBanks());
}
