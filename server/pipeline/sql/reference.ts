/**
 * Reference lookup and the missing-reference proxy.
 *
 * The UTR branch exists but is deliberately blunt: if that column is stored
 * encrypted, a plain equality match will not find anything, and Swiss Cheese says so
 * rather than reporting a false "not found".
 */
import { query } from '../../db/pool.js';
import {
  Params,
  ROW_CAP,
  TX_JOIN,
  TX_ROW_COLUMNS,
  txConditions,
  whereClause,
  type TxRow
} from './common.js';
import type { RefField, Slots } from '../types.js';

/** Point read on a reference number. */
export async function lookupReference(reference: string, field: RefField): Promise<TxRow | null> {
  const params = new Params();
  const column = field === 'utr' ? 't.utr_number' : 't.transaction_reference_id';

  const sql = `
    SELECT ${TX_ROW_COLUMNS}
    ${TX_JOIN}
     WHERE ${column} = ${params.next(reference)}
     LIMIT 1`;

  const rows = await query<TxRow>(sql, params.values);
  return rows[0] ?? null;
}

export interface MissingReferenceResult {
  rows: TxRow[];
  rowCount: number;
  /** Rows that have a reference but no UTR. Reported separately, never merged. */
  missingUtrCount: number;
}

/**
 * Transactions with no reference number. A labeled proxy for reconciliation
 * questions, never presented as reconciliation status.
 */
export async function missingReference(slots: Slots): Promise<MissingReferenceResult> {
  const countParams = new Params();
  const countConditions = txConditions(countParams, slots);
  countConditions.push('t.transaction_reference_id IS NULL');

  const countSql = `
    SELECT COUNT(*) AS row_count,
           (SELECT COUNT(*)
              FROM transaction t2
             WHERE t2.transaction_reference_id IS NOT NULL
               AND t2.utr_number IS NULL) AS missing_utr
    ${TX_JOIN}
    ${whereClause(countConditions)}`;

  const [counts] = await query<{ row_count: string; missing_utr: string }>(countSql, countParams.values);

  const rowParams = new Params();
  const rowConditions = txConditions(rowParams, slots);
  rowConditions.push('t.transaction_reference_id IS NULL');

  const rowSql = `
    SELECT ${TX_ROW_COLUMNS}
    ${TX_JOIN}
    ${whereClause(rowConditions)}
     ORDER BY t.transaction_date DESC
     LIMIT ${rowParams.next(ROW_CAP)}`;

  const rows = await query<TxRow>(rowSql, rowParams.values);

  return {
    rows,
    rowCount: Number(counts?.row_count ?? 0),
    missingUtrCount: Number(counts?.missing_utr ?? 0)
  };
}
