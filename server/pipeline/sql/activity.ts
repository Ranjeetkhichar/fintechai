/**
 * Nearest window that actually has data.
 *
 * When a question lands on an empty window, Swiss Cheese states the window is empty and
 * offers a computed alternative rather than quietly answering a different
 * question. The alternative is itself a query result, so it stays grounded.
 */
import { query } from '../../db/pool.js';
import { fyQuarter, fyStartYear, monthPeriod, quarterPeriod } from '../resolve/dates.js';
import { Params, TX_JOIN, txConditions, whereClause } from './common.js';
import type { Period, Slots } from '../types.js';

export interface ActivityWindow {
  period: Period;
  total: string;
  rowCount: number;
}

/**
 * Most recent month or fiscal quarter containing rows for the current filters,
 * ignoring the window the user asked about.
 */
export async function latestPeriodWithData(
  slots: Slots,
  granularity: 'month' | 'quarter' = 'month'
): Promise<ActivityWindow | null> {
  const params = new Params();
  const conditions = txConditions(params, slots, { ignoreDates: true });

  // Indian FY quarters start in April, so shift back three months, truncate on
  // the calendar quarter, then shift forward again.
  const bucket =
    granularity === 'quarter'
      ? `date_trunc('quarter', t.transaction_date - interval '3 months') + interval '3 months'`
      : `date_trunc('month', t.transaction_date)`;

  const sql = `
    SELECT ${bucket}                              AS bucket,
           COALESCE(SUM(t.transaction_amount), 0) AS total,
           COUNT(*)                               AS row_count
    ${TX_JOIN}
    ${whereClause(conditions)}
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT 1`;

  const [row] = await query<{ bucket: string; total: string; row_count: string }>(sql, params.values);
  if (!row) return null;

  const bucketDate = new Date(`${String(row.bucket).replace(' ', 'T').slice(0, 19)}Z`);
  const period =
    granularity === 'quarter'
      ? quarterPeriod(fyStartYear(bucketDate), fyQuarter(bucketDate))
      : monthPeriod(bucketDate.getUTCFullYear(), bucketDate.getUTCMonth() + 1);

  return { period, total: row.total, rowCount: Number(row.row_count) };
}
