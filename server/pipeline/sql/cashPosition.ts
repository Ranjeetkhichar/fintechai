/**
 * Cash position: the current snapshot on `account.available_balance`.
 *
 * This is deliberately not a sum of transactions. The two never agree and the
 * user must never be shown one while asking for the other.
 */
import { query } from '../../db/pool.js';
import { Params, whereClause } from './common.js';
import type { Slots } from '../types.js';

export interface CashRow {
  bank_code: string | null;
  bank_name: string | null;
  accounts: string;
  balance: string;
}

export interface CashPositionResult {
  rows: CashRow[];
  total: string;
  accountCount: number;
}

/** Balances grouped by bank, with a grand total computed in SQL. */
export async function cashPosition(slots: Slots): Promise<CashPositionResult> {
  const params = new Params();
  const conditions: string[] = [];

  if (slots.bankCode) conditions.push(`a.bank_code = ${params.next(slots.bankCode)}`);
  if (slots.programId !== undefined) conditions.push(`a.program_id = ${params.next(slots.programId)}`);

  const sql = `
    SELECT b.bank_code,
           b.bank_name,
           COUNT(*)                    AS accounts,
           SUM(a.available_balance)    AS balance
      FROM account a
      JOIN bank b ON b.bank_code = a.bank_code
    ${whereClause(conditions)}
     GROUP BY GROUPING SETS ((b.bank_code, b.bank_name), ())
     ORDER BY (b.bank_code IS NULL), SUM(a.available_balance) DESC`;

  const rows = await query<CashRow>(sql, params.values);
  const totalRow = rows.find((row) => row.bank_code === null);
  const bankRows = rows.filter((row) => row.bank_code !== null);

  return {
    rows: bankRows,
    total: totalRow?.balance ?? '0',
    accountCount: Number(totalRow?.accounts ?? 0)
  };
}
