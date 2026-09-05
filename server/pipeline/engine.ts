/**
 * Intent execution. One function per intent, each returning a finished payload.
 *
 * Everything numeric here comes back from Postgres as a decimal string and is
 * only ever formatted, never recomputed. The verbalizer sees the result of this
 * file and nothing else.
 */
import { ALIASES, aliasByKey } from './resolve/aliases.js';
import { formatDay } from './resolve/dates.js';
import { formatInr, formatShare, formatTimestamp, inr, maskAccount, tidyDescription, utrDisplay } from './mask.js';
import { buildPayload } from './payload.js';
import { refusalFor } from './refusals.js';
import { cashPosition } from './sql/cashPosition.js';
import { periodSpend, spendTotals } from './sql/spend.js';
import { comparePeriods, inflowOutflow } from './sql/flows.js';
import { aliasTotals } from './sql/counterparty.js';
import { lookupReference, missingReference } from './sql/reference.js';
import { latestPeriodWithData } from './sql/activity.js';
import type { TxRow } from './sql/common.js';
import type { AnswerPayload, Slots } from './types.js';

const TX_COLUMNS = ['Date', 'Bank / account', 'Counterparty (from description)', 'Amount (INR)', 'Ref'];

function txTableRows(rows: TxRow[]): string[][] {
  return rows.map((row) => [
    formatTimestamp(row.transaction_date),
    maskAccount(row.bank_code, row.account_number),
    tidyDescription(row.description),
    formatInr(row.transaction_amount),
    row.transaction_reference_id ?? 'missing'
  ]);
}

function periodOf(slots: Slots): string {
  return slots.periodLabel ?? (slots.dateFrom && slots.dateTo
    ? `${formatDay(slots.dateFrom)} to ${formatDay(slots.dateTo)}`
    : 'all dates');
}

/**
 * Flags a row that dwarfs its peers in the same window. Ratios are display
 * only; the amounts quoted are still the SQL values.
 */
function anomalyNote(rows: TxRow[]): string | null {
  if (rows.length < 3) return null;
  const amounts = rows.map((row) => Number(row.transaction_amount)).filter(Number.isFinite);
  if (amounts.length < 3) return null;

  const max = Math.max(...amounts);
  const others = amounts.filter((value) => value !== max);
  const mean = others.reduce((sum, value) => sum + value, 0) / others.length;
  if (mean <= 0 || max < mean * 3) return null;

  const row = rows.find((candidate) => Number(candidate.transaction_amount) === max);
  if (!row) return null;

  return `${inr(row.transaction_amount)} on ${formatTimestamp(row.transaction_date)} is more than three times the average of the other rows in this window.`;
}

/** Cash across banks, from the balance snapshot. */
export async function runCashPosition(slots: Slots): Promise<AnswerPayload> {
  const result = await cashPosition(slots);

  const rows = result.rows.map((row) => [row.bank_name ?? '', String(row.accounts), formatInr(row.balance)]);
  rows.push(['Total', String(result.accountCount), formatInr(result.total)]);

  return buildPayload({
    kind: result.accountCount === 0 ? 'empty' : 'answer',
    intent: 'cash_position',
    template: 'cash_position',
    slots,
    rowCount: result.accountCount,
    headline: [
      { label: 'Net available cash', value: inr(result.total) },
      { label: 'Accounts', value: String(result.accountCount) }
    ],
    table: { columns: ['Bank', 'Accounts', 'Available balance (INR)'], rows, numericColumns: [1, 2] },
    notes: [
      'This is the live snapshot on the account rows, not a sum of transactions.'
    ]
  });
}

/** Spend or receipts for a window, with the rows behind the total. */
export async function runPeriodSpend(slots: Slots): Promise<AnswerPayload> {
  const result = await periodSpend(slots);
  const isCredit = slots.txType === 'credit';
  const label = isCredit ? 'Inflow' : 'Outflow';

  if (result.rowCount === 0) return emptyWindowPayload(slots, 'period_spend', label);

  const rows = txTableRows(result.rows);
  rows.push(['Total', '', '', formatInr(result.total), '']);

  const notes: string[] = [];
  const anomaly = anomalyNote(result.rows);
  if (anomaly) notes.push(anomaly);

  const headline = [
    { label: `${label} in ${periodOf(slots)}`, value: inr(result.total) },
    { label: 'Transactions', value: String(result.rowCount) }
  ];

  // Share of the window's total, so a counterparty answer carries context.
  if (slots.counterpartyKey) {
    const windowTotal = await spendTotals({ ...slots, counterpartyKey: undefined, counterpartyLabel: undefined });
    if (Number(windowTotal.total) > 0) {
      headline.push({
        label: `Share of ${periodOf(slots)} ${label.toLowerCase()}`,
        value: formatShare(result.total, windowTotal.total)
      });
      notes.push(
        `${inr(result.total)} of ${inr(windowTotal.total)} total ${label.toLowerCase()} in ${periodOf(slots)}.`
      );
    }
  }

  if (result.rowCount > result.rows.length) {
    notes.push(`Showing the first ${result.rows.length} of ${result.rowCount} rows. The total covers all of them.`);
  }

  return buildPayload({
    kind: 'answer',
    intent: 'period_spend',
    template: 'period_spend',
    slots,
    rowCount: result.rowCount,
    headline,
    table: { columns: TX_COLUMNS, rows, numericColumns: [3] },
    notes
  });
}

/** Credits versus debits for a window. */
export async function runInflowOutflow(slots: Slots): Promise<AnswerPayload> {
  const result = await inflowOutflow(slots);

  if (result.rowCount === 0) return emptyWindowPayload(slots, 'inflow_outflow', 'Movement');

  return buildPayload({
    kind: 'answer',
    intent: 'inflow_outflow',
    template: 'inflow_outflow',
    slots,
    rowCount: result.rowCount,
    headline: [
      { label: 'Inflow', value: inr(result.inflow) },
      { label: 'Outflow', value: inr(result.outflow) },
      { label: 'Net movement', value: inr(result.net) }
    ],
    table: {
      columns: ['Measure', 'INR', 'Rows'],
      rows: [
        ['Inflow (credits)', formatInr(result.inflow), String(result.creditRows)],
        ['Outflow (debits)', formatInr(result.outflow), String(result.debitRows)],
        ['Net movement', formatInr(result.net), String(result.rowCount)]
      ],
      numericColumns: [1, 2]
    },
    notes: ['Net movement is credits minus debits. It is not a change in available cash.']
  });
}

/** Ranked counterparties for a window, with concentration. */
export async function runCounterpartyBreakdown(slots: Slots): Promise<AnswerPayload> {
  const result = await aliasTotals(slots);

  if (result.grandRows === 0) return emptyWindowPayload(slots, 'counterparty_breakdown', 'Outflow');

  const rows = result.aliases.map((alias, index) => [
    String(index + 1),
    alias.label,
    String(alias.rowCount),
    formatInr(alias.total),
    formatShare(alias.total, result.grandTotal)
  ]);

  const notes: string[] = ['Counterparty names are parsed from transaction descriptions, not from a vendor master.'];

  if (result.aliases.length >= 2) {
    const topTwo = Number(result.aliases[0].total) + Number(result.aliases[1].total);
    notes.push(
      `The top two counterparties are ${formatShare(String(topTwo), result.grandTotal)} of the window's total.`
    );
  }

  if (Number(result.matchedTotal) < Number(result.grandTotal)) {
    notes.push(
      `${inr(result.grandTotal)} moved in total; ${inr(result.matchedTotal)} matched a known counterparty alias.`
    );
  }

  return buildPayload({
    kind: 'answer',
    intent: 'counterparty_breakdown',
    template: 'counterparty_breakdown',
    slots,
    rowCount: result.grandRows,
    headline: [
      { label: `Total in ${periodOf(slots)}`, value: inr(result.grandTotal) },
      { label: 'Counterparties', value: String(result.aliases.length) }
    ],
    table: {
      columns: ['Rank', 'Counterparty', 'Transactions', 'Amount (INR)', 'Share'],
      rows,
      numericColumns: [2, 3, 4]
    },
    notes
  });
}

/** Two windows side by side, with deltas computed in SQL. */
export async function runComparePeriod(slots: Slots): Promise<AnswerPayload> {
  if (!slots.dateFrom || !slots.dateTo || !slots.compareFrom || !slots.compareTo) {
    return runPeriodSpend(slots);
  }

  const result = await comparePeriods(
    slots,
    { from: slots.dateFrom, to: slots.dateTo },
    { from: slots.compareFrom, to: slots.compareTo }
  );

  const currentLabel = slots.periodLabel ?? `${formatDay(slots.dateFrom)} to ${formatDay(slots.dateTo)}`;
  const compareLabel = slots.compareLabel ?? `${formatDay(slots.compareFrom)} to ${formatDay(slots.compareTo)}`;

  const rows = [
    [
      compareLabel,
      String(result.compare.debitRows),
      formatInr(result.compare.outflow),
      formatInr(result.compare.inflow),
      formatInr(result.compare.net)
    ],
    [
      currentLabel,
      String(result.current.debitRows),
      formatInr(result.current.outflow),
      formatInr(result.current.inflow),
      formatInr(result.current.net)
    ],
    [
      'Change',
      `${result.debitCountChange >= 0 ? '+' : ''}${result.debitCountChange}`,
      signed(result.outflowChange),
      signed(result.inflowChange),
      signed(result.netChange)
    ]
  ];

  const direction = Number(result.outflowChange) >= 0 ? 'higher' : 'lower';

  return buildPayload({
    kind: 'answer',
    intent: 'compare_period',
    template: 'compare_period',
    slots,
    rowCount: result.current.rowCount + result.compare.rowCount,
    headline: [
      { label: `${currentLabel} outflow`, value: inr(result.current.outflow) },
      { label: `${compareLabel} outflow`, value: inr(result.compare.outflow) },
      { label: 'Change', value: `${inr(abs(result.outflowChange))} ${direction}` }
    ],
    table: {
      columns: ['Period', 'Debits', 'Outflow (INR)', 'Inflow (INR)', 'Net movement (INR)'],
      rows,
      numericColumns: [1, 2, 3, 4]
    },
    notes: [
      'These are period movements, not changes in available balance.',
      `${result.compare.rowCount} rows in ${compareLabel} and ${result.current.rowCount} in ${currentLabel}; ask to list either window.`
    ]
  });
}

/** Single transaction by reference number. */
export async function runLookupReference(slots: Slots): Promise<AnswerPayload> {
  const reference = slots.reference ?? '';
  const field = slots.refField ?? 'reference_id';
  const row = await lookupReference(reference, field);

  if (!row) {
    const notes =
      field === 'utr'
        ? ['UTR is stored as a sensitive value. If it is encrypted at rest, an exact match cannot find it without decrypting rows first.']
        : [];

    return buildPayload({
      kind: 'empty',
      intent: 'lookup_reference',
      template: 'lookup_reference',
      slots,
      rowCount: 0,
      headline: [{ label: 'Reference', value: reference }],
      alternatives: ['Search the plaintext reference number instead', 'List transactions for a date window'],
      notes
    });
  }

  const rows = [
    ['Amount', `${inr(row.transaction_amount)} ${row.transaction_type}`],
    ['When', formatTimestamp(row.transaction_date)],
    ['Account', maskAccount(row.bank_code, row.account_number)],
    ['Program', String(row.program_id)],
    ['Description', tidyDescription(row.description, 160)],
    ['Reference', row.transaction_reference_id ?? 'missing'],
    ['UTR', utrDisplay(row.has_utr)]
  ];

  return buildPayload({
    kind: 'answer',
    intent: 'lookup_reference',
    template: 'lookup_reference',
    slots,
    rowCount: 1,
    headline: [
      { label: 'Amount', value: inr(row.transaction_amount) },
      { label: 'Type', value: row.transaction_type },
      { label: 'Account', value: maskAccount(row.bank_code, row.account_number) }
    ],
    table: { columns: ['Field', 'Value'], rows },
    notes: ['UTR was not searched and is not shown.']
  });
}

/** Missing-reference proxy. Never presented as reconciliation status. */
export async function runMissingReference(slots: Slots): Promise<AnswerPayload> {
  const result = await missingReference(slots);

  return buildPayload({
    kind: result.rowCount === 0 ? 'empty' : 'answer',
    intent: 'missing_reference',
    template: 'missing_reference',
    slots,
    rowCount: result.rowCount,
    headline: [{ label: 'Transactions with no reference', value: String(result.rowCount) }],
    table: { columns: TX_COLUMNS, rows: txTableRows(result.rows), numericColumns: [3] },
    notes: [
      'A missing reference is not the same as unreconciled. This dataset has no reconciliation status.',
      `${result.missingUtrCount} further rows have a reference but no UTR; those are not counted here.`
    ]
  });
}

/** Candidate counterparties for an ambiguous name. Returns no single total. */
export async function runClarifyCounterparty(slots: Slots): Promise<AnswerPayload> {
  const candidateKeys = slots.counterpartyCandidates ?? [];
  const candidates = candidateKeys
    .map((key) => aliasByKey(key))
    .filter((alias): alias is (typeof ALIASES)[number] => Boolean(alias));

  const result = await aliasTotals(slots, candidates);

  const rows = result.aliases.map((alias) => [
    alias.label,
    String(alias.rowCount),
    formatInr(alias.total),
    formatShare(alias.total, result.grandTotal)
  ]);

  if (result.aliases.length > 1) {
    rows.push([
      'If you mean all of the above',
      String(result.matchedRows),
      formatInr(result.matchedTotal),
      formatShare(result.matchedTotal, result.grandTotal)
    ]);
  }

  const named = slots.counterpartyQuery ?? 'that name';

  return buildPayload({
    kind: 'clarify',
    intent: 'clarify_counterparty',
    template: 'clarify_counterparty',
    slots,
    rowCount: result.matchedRows,
    headline: [
      { label: 'Matching counterparties', value: String(result.aliases.length) },
      { label: `Total in ${periodOf(slots)}`, value: inr(result.grandTotal) }
    ],
    table: {
      columns: ['Counterparty', 'Transactions', 'Amount (INR)', 'Share of window'],
      rows,
      numericColumns: [1, 2, 3]
    },
    alternatives: result.aliases.map((alias) => alias.label),
    notes: [`"${named}" matches more than one counterparty in this window, so no single total was returned.`],
    extraFilters: { counterparty_query: named }
  });
}

/** Out-of-schema question. Reconciliation additionally gets a labelled proxy. */
export async function runRefuse(slots: Slots): Promise<AnswerPayload> {
  const refusal = refusalFor(slots.refuseTopic);

  if (refusal.topic === 'reconciliation') {
    const proxy = await missingReference({ ...slots, txType: undefined });
    return buildPayload({
      kind: 'refuse',
      intent: 'refuse',
      template: 'refuse:reconciliation',
      slots,
      rowCount: proxy.rowCount,
      headline: [{ label: 'Answerable from this schema', value: 'No' }],
      table: { columns: TX_COLUMNS, rows: txTableRows(proxy.rows), numericColumns: [3] },
      alternatives: refusal.alternatives,
      notes: [
        refusal.reason,
        'The table below is a proxy only: transactions with no reference number. It is not reconciliation status.'
      ]
    });
  }

  return buildPayload({
    kind: 'refuse',
    intent: 'refuse',
    template: `refuse:${refusal.topic}`,
    slots,
    rowCount: 0,
    headline: [{ label: 'Answerable from this schema', value: 'No' }],
    alternatives: refusal.alternatives,
    notes: [refusal.reason]
  });
}

/**
 * An empty window is stated as empty. The alternative offered is itself a query
 * result, so Swiss Cheese never fills the silence with a plausible number.
 */
async function emptyWindowPayload(slots: Slots, intent: Slots['intent'], measure: string): Promise<AnswerPayload> {
  const granularity = slots.periodGranularity === 'quarter' ? 'quarter' : 'month';
  const latest = await latestPeriodWithData(slots, granularity);

  const alternatives: string[] = [];
  const rows: string[][] = [];

  if (latest) {
    alternatives.push(
      `${latest.period.label} has ${latest.rowCount} rows totalling ${inr(latest.total)}`
    );
    rows.push([latest.period.label, String(latest.rowCount), formatInr(latest.total)]);
  }

  return buildPayload({
    kind: 'empty',
    intent,
    template: `${intent}:empty`,
    slots,
    rowCount: 0,
    headline: [{ label: `${measure} in ${periodOf(slots)}`, value: 'no rows' }],
    table: rows.length
      ? { columns: ['Nearest window with data', 'Transactions', 'Amount (INR)'], rows, numericColumns: [1, 2] }
      : { columns: [], rows: [] },
    alternatives,
    notes: [`There are no transactions in ${periodOf(slots)} for these filters.`]
  });
}

function abs(value: string): string {
  return value.startsWith('-') ? value.slice(1) : value;
}

function signed(value: string): string {
  return value.startsWith('-') ? formatInr(value) : `+${formatInr(value)}`;
}
