/**
 * The frozen gold set: the 12 conversations in docs/EXAMPLES.md.
 *
 * `goldSlots` is what a perfect NLU would produce. Running with those isolates
 * the SQL engine; running with model slots tests the NLU. Every `expectAmounts`
 * entry is a figure that must appear in the payload exactly.
 */
import type { Intent, ModelSlots, PayloadKind } from '../server/pipeline/types.js';

export interface GoldCase {
  id: string;
  /** Conversation turn order. Turns sharing a thread run in sequence. */
  thread?: string;
  question: string;
  goldSlots: ModelSlots;
  expectIntent: Intent;
  expectKind: PayloadKind;
  /** Formatted amounts that must appear somewhere in the payload. */
  expectAmounts?: string[];
  expectRowCount?: number;
  /** Substrings that must appear, e.g. a refusal reason or a period label. */
  expectContains?: string[];
  notes?: string;
}

export const GOLD_CASES: GoldCase[] = [
  {
    id: '01-cash-position',
    question: 'What is our cash position across banks right now?',
    goldSlots: { intent: 'cash_position', confidence: 1 },
    expectIntent: 'cash_position',
    expectKind: 'answer',
    expectAmounts: ['-8,12,29,672.84', '23,16,80,596.77', '-25,23,02,939.33'],
    expectRowCount: 10,
    notes: 'Snapshot on account rows, not a sum of transactions.'
  },
  {
    id: '02-empty-last-month',
    question: 'How much did we spend last month?',
    goldSlots: { intent: 'period_spend', datePhrase: 'last month', txType: 'debit', confidence: 1 },
    expectIntent: 'period_spend',
    expectKind: 'empty',
    expectContains: ['August 2026', 'June 2026'],
    expectRowCount: 0,
    notes: 'August 2026 has no rows. The alternative is computed, not guessed.'
  },
  {
    id: '03a-june-spend',
    thread: 'compare',
    question: 'How much did we spend in June?',
    goldSlots: { intent: 'period_spend', datePhrase: 'june', txType: 'debit', confidence: 1 },
    expectIntent: 'period_spend',
    expectKind: 'answer',
    expectAmounts: ['1,69,299.00'],
    expectRowCount: 4
  },
  {
    id: '03b-compare-month-before',
    thread: 'compare',
    question: 'How does that compare to the month before?',
    goldSlots: { intent: 'compare_period', comparePhrase: 'the month before', confidence: 1 },
    expectIntent: 'compare_period',
    expectKind: 'answer',
    expectAmounts: ['1,69,299.00', '71,156.00', '98,143.00'],
    notes: 'Reuses the June window from the previous turn.'
  },
  {
    id: '04-vendor-spend',
    question: 'How much did we pay Selection Mobile in June?',
    goldSlots: {
      intent: 'period_spend',
      datePhrase: 'june',
      counterparty: 'Selection Mobile',
      txType: 'debit',
      confidence: 1
    },
    expectIntent: 'period_spend',
    expectKind: 'answer',
    expectAmounts: ['1,46,474.00', '66,899.00', '79,575.00'],
    expectRowCount: 2,
    expectContains: ['86.5%']
  },
  {
    id: '05-ambiguous-vendor',
    question: 'How much did we pay Selection last quarter?',
    goldSlots: {
      intent: 'period_spend',
      datePhrase: 'last quarter',
      counterparty: 'Selection',
      txType: 'debit',
      confidence: 0.6
    },
    expectIntent: 'clarify_counterparty',
    expectKind: 'clarify',
    expectAmounts: ['1,46,474.00', '50,000.00', '2,19,299.00'],
    expectContains: ['Selection Mobile', 'Navyug Selection'],
    notes: 'Q1 FY26-27. Four counterparties traded; no single total is returned.'
  },
  {
    id: '06-brand-in-description',
    question: 'What did we spend on Reliance Digital this year?',
    goldSlots: {
      intent: 'period_spend',
      datePhrase: 'ytd',
      counterparty: 'Reliance Digital',
      txType: 'debit',
      confidence: 1
    },
    expectIntent: 'period_spend',
    expectKind: 'answer',
    expectAmounts: ['21,156.00'],
    expectRowCount: 1
  },
  {
    id: '07-reference-lookup',
    question: 'Pull up ref HDFCH01078329532. Who did we pay?',
    goldSlots: { intent: 'lookup_reference', reference: 'HDFCH01078329532', confidence: 1 },
    expectIntent: 'lookup_reference',
    expectKind: 'answer',
    expectAmounts: ['7,959.00'],
    expectRowCount: 1,
    expectContains: ['HDFC 5020****9069', 'present, masked']
  },
  {
    id: '08-empty-quarter',
    question: 'Give me inflow vs outflow for this quarter.',
    goldSlots: { intent: 'inflow_outflow', datePhrase: 'this quarter', confidence: 1 },
    expectIntent: 'inflow_outflow',
    expectKind: 'empty',
    expectContains: ['Q2 FY26-27', 'Q1 FY26-27'],
    expectRowCount: 0
  },
  {
    id: '09-top-counterparties',
    question: 'Who are we paying the most, year to date?',
    goldSlots: { intent: 'counterparty_breakdown', datePhrase: 'ytd', txType: 'debit', confidence: 1 },
    expectIntent: 'counterparty_breakdown',
    expectKind: 'answer',
    expectAmounts: ['2,40,455.00', '1,46,474.00', '50,000.00', '21,156.00'],
    expectRowCount: 6,
    expectContains: ['60.9%']
  },
  {
    id: '10-reconciliation-refuse',
    question: 'Which transactions are still unreconciled?',
    goldSlots: { intent: 'refuse', refuseTopic: 'reconciliation', confidence: 1 },
    expectIntent: 'refuse',
    expectKind: 'refuse',
    expectAmounts: ['110.00'],
    expectContains: ['no reconciliation status', 'proxy'],
    notes: 'Refuses the status question, then offers the missing-reference proxy.'
  },
  {
    id: '11-historical-cash-refuse',
    question: 'What was our cash position last Friday?',
    goldSlots: { intent: 'refuse', refuseTopic: 'cash_as_of', confidence: 1 },
    expectIntent: 'refuse',
    expectKind: 'refuse',
    expectContains: ['current snapshot']
  },
  {
    id: '12-budget-refuse',
    question: 'How are we tracking against budget on vendor payouts this quarter?',
    goldSlots: { intent: 'refuse', refuseTopic: 'budget', confidence: 1 },
    expectIntent: 'refuse',
    expectKind: 'refuse',
    expectContains: ['no budget']
  }
];

/** Raw account numbers and UTR fragments that must never appear in a payload. */
export const SENSITIVE_STRINGS = [
  '50200013729069',
  '50200099284137',
  '39208809622308',
  '30123456789012',
  '40100556677889',
  '60100112233445',
  '70100334455667',
  '80100123456789',
  '90100987654321',
  '20100556677889',
  'jhI5nAdyb1qOEjmcB3JvW'
];
