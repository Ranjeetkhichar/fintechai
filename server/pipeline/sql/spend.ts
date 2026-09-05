/**
 * Period spend and the row sample behind it.
 *
 * The total comes from an uncapped aggregate; only the table of source rows is
 * capped, so a user always sees the true figure even when the list is trimmed.
 */
import { query } from '../../db/pool.js';
import { aliasByKey } from '../resolve/aliases.js';
import {
  descriptionCondition,
  Params,
  ROW_CAP,
  TX_JOIN,
  TX_ROW_COLUMNS,
  txConditions,
  whereClause,
  type DateRange,
  type TxRow
} from './common.js';
import type { Slots } from '../types.js';

export interface SpendTotals {
  total: string;
  rowCount: number;
}

export interface SpendResult extends SpendTotals {
  rows: TxRow[];
}

function counterpartyCondition(params: Params, slots: Slots): string | null {
  if (!slots.counterpartyKey) return null;
  const alias = aliasByKey(slots.counterpartyKey);
  if (!alias) return null;
  return descriptionCondition(params, alias.pattern);
}

/** Uncapped total and row count for the current filters. */
export async function spendTotals(slots: Slots, range?: DateRange): Promise<SpendTotals> {
  const params = new Params();
  const conditions = txConditions(params, slots, { range });
  const counterparty = counterpartyCondition(params, slots);
  if (counterparty) conditions.push(counterparty);

  const sql = `
    SELECT COALESCE(SUM(t.transaction_amount), 0) AS total,
           COUNT(*)                               AS row_count
    ${TX_JOIN}
    ${whereClause(conditions)}`;

  const [row] = await query<{ total: string; row_count: string }>(sql, params.values);
  return { total: row?.total ?? '0', rowCount: Number(row?.row_count ?? 0) };
}

/** Capped list of the underlying transactions, oldest first. */
export async function spendRows(slots: Slots, range?: DateRange, limit = ROW_CAP): Promise<TxRow[]> {
  const params = new Params();
  const conditions = txConditions(params, slots, { range });
  const counterparty = counterpartyCondition(params, slots);
  if (counterparty) conditions.push(counterparty);

  const sql = `
    SELECT ${TX_ROW_COLUMNS}
    ${TX_JOIN}
    ${whereClause(conditions)}
     ORDER BY t.transaction_date
     LIMIT ${params.next(limit)}`;

  return query<TxRow>(sql, params.values);
}

/** Total plus the rows behind it. */
export async function periodSpend(slots: Slots, range?: DateRange): Promise<SpendResult> {
  const totals = await spendTotals(slots, range);
  if (totals.rowCount === 0) return { ...totals, rows: [] };
  return { ...totals, rows: await spendRows(slots, range) };
}
