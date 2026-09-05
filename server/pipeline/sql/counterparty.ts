/**
 * Counterparty grouping over `description`.
 *
 * Powers both "who are we paying the most" and the "which Selection did you
 * mean" clarification. Alias patterns are bound parameters; only the CASE
 * skeleton is generated, and it comes from the fixed catalog, never from user
 * text.
 */
import { query } from '../../db/pool.js';
import { ALIASES, type CounterpartyAlias } from '../resolve/aliases.js';
import { Params, TX_JOIN, txConditions, whereClause, type DateRange } from './common.js';
import type { Slots } from '../types.js';

export interface AliasTotal {
  key: string;
  label: string;
  total: string;
  rowCount: number;
}

export interface AliasTotalsResult {
  /** Per-alias rows with at least one transaction, largest first. */
  aliases: AliasTotal[];
  /** Sum across the aliases considered. */
  matchedTotal: string;
  matchedRows: number;
  /** Sum across every transaction in the window, matched or not. */
  grandTotal: string;
  grandRows: number;
}

/**
 * Totals per alias for the current filters. Aliases with no rows in the window
 * are dropped, so a clarification only offers counterparties that actually
 * traded in that period.
 */
export async function aliasTotals(
  slots: Slots,
  aliases: CounterpartyAlias[] = ALIASES,
  range?: DateRange
): Promise<AliasTotalsResult> {
  const params = new Params();
  const conditions = txConditions(params, slots, { range });

  const branches = aliases
    // The ::text cast is required: Postgres cannot infer a bare parameter's
    // type inside a CASE result and would reject the statement.
    .map((alias) => `WHEN t.description ILIKE ${params.next(`%${alias.pattern}%`)} THEN ${params.next(alias.key)}::text`)
    .join('\n               ');

  const caseExpression = branches ? `CASE ${branches} ELSE NULL END` : 'NULL::text';

  const sql = `
    WITH scoped AS (
      SELECT t.transaction_amount AS amt,
             ${caseExpression} AS alias_key
      ${TX_JOIN}
      ${whereClause(conditions)}
    )
    SELECT alias_key                     AS key,
           COALESCE(SUM(amt), 0)         AS total,
           COUNT(*)                      AS row_count,
           0                             AS section
      FROM scoped
     WHERE alias_key IS NOT NULL
     GROUP BY alias_key
    UNION ALL
    SELECT 'ALL_MATCHED', COALESCE(SUM(amt), 0), COUNT(*), 1
      FROM scoped
     WHERE alias_key IS NOT NULL
    UNION ALL
    SELECT 'GRAND', COALESCE(SUM(amt), 0), COUNT(*), 2
      FROM scoped
     ORDER BY section, total DESC`;

  const rows = await query<{ key: string; total: string; row_count: string; section: number }>(
    sql,
    params.values
  );

  const labelFor = (key: string) => aliases.find((a) => a.key === key)?.label ?? key;

  const aliasRows = rows
    .filter((row) => row.section === 0)
    .map((row) => ({
      key: row.key,
      label: labelFor(row.key),
      total: row.total,
      rowCount: Number(row.row_count)
    }));

  const matched = rows.find((row) => row.section === 1);
  const grand = rows.find((row) => row.section === 2);

  return {
    aliases: aliasRows,
    matchedTotal: matched?.total ?? '0',
    matchedRows: Number(matched?.row_count ?? 0),
    grandTotal: grand?.total ?? '0',
    grandRows: Number(grand?.row_count ?? 0)
  };
}
