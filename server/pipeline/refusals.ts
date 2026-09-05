/**
 * The refusal catalog.
 *
 * These questions are not NLU failures, they are schema gaps. Each entry says
 * plainly why the data cannot answer, then points at the nearest grounded
 * question. A deterministic pre-check runs before the model so a high-risk
 * phrase cannot be talked into an answer.
 */
import type { RefuseTopic } from './types.js';

export interface Refusal {
  topic: RefuseTopic;
  reason: string;
  alternatives: string[];
}

export const REFUSALS: Record<RefuseTopic, Refusal> = {
  reconciliation: {
    topic: 'reconciliation',
    reason:
      'This dataset has no reconciliation status, no invoice table, and no matcher against a ledger. Calling a row unreconciled would be an invented status.',
    alternatives: [
      'Transactions with a missing reference number, clearly labelled as a proxy and not as reconciliation status',
      'Spend or receipts for a period'
    ]
  },
  budget: {
    topic: 'budget',
    reason: 'There is no budget and no chart of accounts in this schema, so there is nothing to compare actuals against.',
    alternatives: ['Actual outflow for a period', 'Outflow by counterparty for a period']
  },
  pnl: {
    topic: 'pnl',
    reason:
      'P&L, margin and income statement lines need a general ledger and a chart of accounts. This schema holds bank transactions only.',
    alternatives: ['Inflow versus outflow for a period', 'Actual spend for a period']
  },
  tax: {
    topic: 'tax',
    reason: 'GST, TDS and other tax lines are not present in bank, account or transaction.',
    alternatives: ['Payments matching a counterparty name in the description', 'Period spend']
  },
  cash_as_of: {
    topic: 'cash_as_of',
    reason:
      'available_balance is a current snapshot. There is no running balance history, so a cash position on a past date cannot be reconstructed.',
    alternatives: ['Current cash position by bank', 'Inflow and outflow across a date window']
  },
  runway: {
    topic: 'runway',
    reason: 'Runway needs a burn rate and a forward plan. This schema has neither.',
    alternatives: ['Current cash position by bank', 'Net movement over recent months']
  },
  forecast: {
    topic: 'forecast',
    reason: 'Swiss Cheese reports what the data holds. It does not project forward.',
    alternatives: ['Historical spend by month', 'Comparison between two periods']
  },
  invoice: {
    topic: 'invoice',
    reason: 'There is no invoice table. Bank transactions carry a description and a reference, not an invoice.',
    alternatives: ['Reference number lookup', 'Payments matching a counterparty name']
  },
  out_of_schema: {
    topic: 'out_of_schema',
    reason: 'That needs a column this schema does not have. Swiss Cheese only sees bank, account and transaction.',
    alternatives: ['Current cash position by bank', 'Spend for a period', 'Reference number lookup']
  }
};

interface TopicPattern {
  topic: RefuseTopic;
  patterns: RegExp[];
}

/**
 * Deterministic detection for the highest-risk questions. Runs before the
 * model, so a plausible-sounding total can never be produced for these.
 */
const DETECTORS: TopicPattern[] = [
  { topic: 'reconciliation', patterns: [/\breconcil/i, /\bunreconcil/i, /\bmatched against (the )?ledger\b/i] },
  { topic: 'budget', patterns: [/\bbudget/i, /\bvariance\b/i, /\bagainst plan\b/i] },
  {
    topic: 'pnl',
    patterns: [/\bp\s?&\s?l\b/i, /\bprofit and loss\b/i, /\bincome statement\b/i, /\bgross margin\b/i, /\bmargin\b/i]
  },
  { topic: 'tax', patterns: [/\bgst\b/i, /\btds\b/i, /\bincome tax\b/i, /\btax (liability|paid|credit)\b/i] },
  { topic: 'runway', patterns: [/\brunway\b/i, /\bburn rate\b/i] },
  { topic: 'forecast', patterns: [/\bforecast/i, /\bproject(ion|ed)\b/i, /\bpredict/i, /\bnext (month|quarter|year)\b/i] },
  { topic: 'invoice', patterns: [/\binvoice/i, /\bpurchase order\b/i, /\bpo number\b/i] },
  {
    topic: 'cash_as_of',
    patterns: [
      /\b(what|how much) (was|were)\b[^?]*\b(cash|balance)\b/i,
      /\b(cash|balance)[^?]*\bas of\b/i,
      /\b(cash|balance) position[^?]*\b(last|yesterday|previous)\b/i
    ]
  }
];

/** Returns the refusal topic for a question, or null if it may proceed. */
export function detectRefusal(question: string): RefuseTopic | null {
  for (const detector of DETECTORS) {
    if (detector.patterns.some((pattern) => pattern.test(question))) return detector.topic;
  }
  return null;
}

export function refusalFor(topic: RefuseTopic | undefined): Refusal {
  return REFUSALS[topic ?? 'out_of_schema'] ?? REFUSALS.out_of_schema;
}
