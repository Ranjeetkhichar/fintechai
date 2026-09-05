/**
 * Inflow vs outflow, and the two-window comparison behind "how does that
 * compare to the month before".
 *
 * The comparison is one query. Both windows and every difference are computed
 * in Postgres, so no subtraction ever happens in JavaScript.
 */
import { query } from '../../db/pool.js';
import { aliasByKey } from '../resolve/aliases.js';
import {
  descriptionCondition,
  Params,
  TX_JOIN,
  txConditions,
  whereClause,
  type DateRange
} from './common.js';
import type { Slots } from '../types.js';

export interface FlowResult {
  inflow: string;
  outflow: string;
  net: string;
  creditRows: number;
  debitRows: number;
  rowCount: number;
}

function counterpartyCondition(params: Params, slots: Slots): string | null {
  if (!slots.counterpartyKey) return null;
  const alias = aliasByKey(slots.counterpartyKey);
  if (!alias) return null;
  return descriptionCondition(params, alias.pattern);
}

/** Credits, debits and net movement for one window. */
export async function inflowOutflow(slots: Slots, range?: DateRange): Promise<FlowResult> {
  const params = new Params();
  const conditions = txConditions(params, slots, { range, ignoreType: true });
  const counterparty = counterpartyCondition(params, slots);
  if (counterparty) conditions.push(counterparty);

  const sql = `
    SELECT COALESCE(SUM(t.transaction_amount) FILTER (WHERE t.transaction_type = 'credit'), 0) AS inflow,
           COALESCE(SUM(t.transaction_amount) FILTER (WHERE t.transaction_type = 'debit'), 0)  AS outflow,
           COALESCE(SUM(CASE WHEN t.transaction_type = 'credit'
                             THEN t.transaction_amount
                             ELSE -t.transaction_amount END), 0)                               AS net,
           COUNT(*) FILTER (WHERE t.transaction_type = 'credit')                               AS credit_rows,
           COUNT(*) FILTER (WHERE t.transaction_type = 'debit')                                AS debit_rows,
           COUNT(*)                                                                            AS row_count
    ${TX_JOIN}
    ${whereClause(conditions)}`;

  const [row] = await query<{
    inflow: string;
    outflow: string;
    net: string;
    credit_rows: string;
    debit_rows: string;
    row_count: string;
  }>(sql, params.values);

  return {
    inflow: row?.inflow ?? '0',
    outflow: row?.outflow ?? '0',
    net: row?.net ?? '0',
    creditRows: Number(row?.credit_rows ?? 0),
    debitRows: Number(row?.debit_rows ?? 0),
    rowCount: Number(row?.row_count ?? 0)
  };
}

export interface CompareResult {
  current: FlowResult;
  compare: FlowResult;
  outflowChange: string;
  inflowChange: string;
  netChange: string;
  debitCountChange: number;
}

/** Both windows and their deltas in a single round trip. */
export async function comparePeriods(
  slots: Slots,
  current: DateRange,
  compare: DateRange
): Promise<CompareResult> {
  const params = new Params();

  const currentFrom = params.next(current.from);
  const currentTo = params.next(current.to);
  const compareFrom = params.next(compare.from);
  const compareTo = params.next(compare.to);

  const inCurrent = `t.transaction_date >= ${currentFrom}::timestamp AND t.transaction_date < (${currentTo}::date + 1)`;
  const inCompare = `t.transaction_date >= ${compareFrom}::timestamp AND t.transaction_date < (${compareTo}::date + 1)`;

  const conditions = txConditions(params, slots, { ignoreType: true, ignoreDates: true });
  const counterparty = counterpartyCondition(params, slots);
  if (counterparty) conditions.push(counterparty);
  conditions.push(`((${inCurrent}) OR (${inCompare}))`);

  const sql = `
    WITH scoped AS (
      SELECT t.transaction_type AS tx_type,
             t.transaction_amount AS amt,
             CASE WHEN ${inCurrent} THEN 'current' ELSE 'compare' END AS win
      ${TX_JOIN}
      ${whereClause(conditions)}
    )
    SELECT
      COALESCE(SUM(amt) FILTER (WHERE win = 'current' AND tx_type = 'credit'), 0) AS cur_inflow,
      COALESCE(SUM(amt) FILTER (WHERE win = 'current' AND tx_type = 'debit'),  0) AS cur_outflow,
      COALESCE(SUM(CASE WHEN win = 'current'
                        THEN CASE WHEN tx_type = 'credit' THEN amt ELSE -amt END
                        ELSE 0 END), 0)                                           AS cur_net,
      COUNT(*) FILTER (WHERE win = 'current' AND tx_type = 'credit')              AS cur_credit_rows,
      COUNT(*) FILTER (WHERE win = 'current' AND tx_type = 'debit')               AS cur_debit_rows,
      COUNT(*) FILTER (WHERE win = 'current')                                     AS cur_rows,
      COALESCE(SUM(amt) FILTER (WHERE win = 'compare' AND tx_type = 'credit'), 0) AS cmp_inflow,
      COALESCE(SUM(amt) FILTER (WHERE win = 'compare' AND tx_type = 'debit'),  0) AS cmp_outflow,
      COALESCE(SUM(CASE WHEN win = 'compare'
                        THEN CASE WHEN tx_type = 'credit' THEN amt ELSE -amt END
                        ELSE 0 END), 0)                                           AS cmp_net,
      COUNT(*) FILTER (WHERE win = 'compare' AND tx_type = 'credit')              AS cmp_credit_rows,
      COUNT(*) FILTER (WHERE win = 'compare' AND tx_type = 'debit')               AS cmp_debit_rows,
      COUNT(*) FILTER (WHERE win = 'compare')                                     AS cmp_rows,
      COALESCE(SUM(amt) FILTER (WHERE win = 'current' AND tx_type = 'debit'), 0)
        - COALESCE(SUM(amt) FILTER (WHERE win = 'compare' AND tx_type = 'debit'), 0)  AS outflow_change,
      COALESCE(SUM(amt) FILTER (WHERE win = 'current' AND tx_type = 'credit'), 0)
        - COALESCE(SUM(amt) FILTER (WHERE win = 'compare' AND tx_type = 'credit'), 0) AS inflow_change,
      COALESCE(SUM(CASE WHEN win = 'current'
                        THEN CASE WHEN tx_type = 'credit' THEN amt ELSE -amt END
                        ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN win = 'compare'
                        THEN CASE WHEN tx_type = 'credit' THEN amt ELSE -amt END
                        ELSE 0 END), 0)                                               AS net_change
    FROM scoped`;

  const [row] = await query<Record<string, string>>(sql, params.values);

  const empty: FlowResult = { inflow: '0', outflow: '0', net: '0', creditRows: 0, debitRows: 0, rowCount: 0 };
  if (!row) {
    return {
      current: empty,
      compare: empty,
      outflowChange: '0',
      inflowChange: '0',
      netChange: '0',
      debitCountChange: 0
    };
  }

  return {
    current: {
      inflow: row.cur_inflow,
      outflow: row.cur_outflow,
      net: row.cur_net,
      creditRows: Number(row.cur_credit_rows),
      debitRows: Number(row.cur_debit_rows),
      rowCount: Number(row.cur_rows)
    },
    compare: {
      inflow: row.cmp_inflow,
      outflow: row.cmp_outflow,
      net: row.cmp_net,
      creditRows: Number(row.cmp_credit_rows),
      debitRows: Number(row.cmp_debit_rows),
      rowCount: Number(row.cmp_rows)
    },
    outflowChange: row.outflow_change,
    inflowChange: row.inflow_change,
    netChange: row.net_change,
    debitCountChange: Number(row.cur_debit_rows) - Number(row.cmp_debit_rows)
  };
}
