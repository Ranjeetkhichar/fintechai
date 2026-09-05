/**
 * Shared SQL building blocks.
 *
 * Every value reaches Postgres as a bound parameter. No template concatenates a
 * user string into SQL, and no template returns `utr_number` as a value; the
 * most a caller learns is whether one is present.
 */
import type { Slots } from '../types.js';

/** Maximum rows shown in a breakdown table. Totals are never capped. */
export const ROW_CAP = 20;

/** Collects bind parameters so conditions can be composed in any order. */
export class Params {
  readonly values: unknown[] = [];

  next(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export interface DateRange {
  from: string;
  to: string; // inclusive
}

/**
 * Inclusive date window as a half-open SQL predicate, so a timestamp late on
 * the closing day is still counted.
 */
export function dateCondition(params: Params, column: string, range: DateRange): string {
  return `${column} >= ${params.next(range.from)}::timestamp AND ${column} < (${params.next(range.to)}::date + 1)`;
}

export interface TxFilterOptions {
  /** Overrides the window in slots, used by the compare template. */
  range?: DateRange;
  /** Skip the transaction_type predicate (inflow vs outflow needs both). */
  ignoreType?: boolean;
  /** Skip the date predicate. */
  ignoreDates?: boolean;
}

/**
 * Standard transaction predicates from resolved slots. Expects `transaction t`
 * joined to `account a`.
 */
export function txConditions(params: Params, slots: Slots, options: TxFilterOptions = {}): string[] {
  const conditions: string[] = [];

  const range = options.range ?? (slots.dateFrom && slots.dateTo ? { from: slots.dateFrom, to: slots.dateTo } : null);
  if (range && !options.ignoreDates) {
    conditions.push(dateCondition(params, 't.transaction_date', range));
  }

  if (slots.txType && !options.ignoreType) {
    conditions.push(`t.transaction_type = ${params.next(slots.txType)}`);
  }

  if (slots.bankCode) {
    conditions.push(`a.bank_code = ${params.next(slots.bankCode)}`);
  }

  if (slots.programId !== undefined) {
    conditions.push(`a.program_id = ${params.next(slots.programId)}`);
  }

  if (slots.amountMin) {
    conditions.push(`t.transaction_amount >= ${params.next(slots.amountMin)}::numeric`);
  }

  if (slots.amountMax) {
    conditions.push(`t.transaction_amount <= ${params.next(slots.amountMax)}::numeric`);
  }

  return conditions;
}

/** ILIKE fragment for a counterparty alias pattern. */
export function descriptionCondition(params: Params, pattern: string): string {
  return `t.description ILIKE ${params.next(`%${pattern}%`)}`;
}

export function whereClause(conditions: string[]): string {
  return conditions.length ? `WHERE ${conditions.join('\n    AND ')}` : '';
}

/** Columns for a transaction row. `utr_number` is reported as presence only. */
export const TX_ROW_COLUMNS = `
    t.transaction_id,
    t.transaction_date,
    t.transaction_type,
    t.description,
    t.transaction_amount,
    t.transaction_reference_id,
    (t.utr_number IS NOT NULL) AS has_utr,
    a.account_number,
    a.program_id,
    a.bank_code`;

export interface TxRow {
  transaction_id: string;
  transaction_date: string;
  transaction_type: 'credit' | 'debit';
  description: string | null;
  transaction_amount: string;
  transaction_reference_id: string | null;
  has_utr: boolean;
  account_number: string;
  program_id: number;
  bank_code: string;
}

export const TX_JOIN = `FROM transaction t
    JOIN account a ON a.account_id = t.account_id`;
