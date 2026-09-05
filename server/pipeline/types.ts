/**
 * The two contracts that hold Swiss Cheese together.
 *
 * `Slots` is everything the model is allowed to extract from a question.
 * `AnswerPayload` is everything the verbalizer is allowed to see. Amounts in a
 * payload are preformatted strings, so there is nothing left for the model to
 * compute. Changing either type is an architecture decision, not a refactor.
 */

export type Intent =
  | 'cash_position'
  | 'period_spend'
  | 'inflow_outflow'
  | 'counterparty_breakdown'
  | 'compare_period'
  | 'lookup_reference'
  | 'missing_reference'
  | 'clarify_counterparty'
  | 'refuse';

export const INTENTS: readonly Intent[] = [
  'cash_position',
  'period_spend',
  'inflow_outflow',
  'counterparty_breakdown',
  'compare_period',
  'lookup_reference',
  'missing_reference',
  'clarify_counterparty',
  'refuse'
];

export type TxType = 'credit' | 'debit';

/** Which reference column a question should hit. Bare "ref no" is never UTR. */
export type RefField = 'reference_id' | 'utr';

/** Why a question cannot be answered from bank / account / transaction. */
export type RefuseTopic =
  | 'reconciliation'
  | 'budget'
  | 'pnl'
  | 'tax'
  | 'cash_as_of'
  | 'runway'
  | 'forecast'
  | 'invoice'
  | 'out_of_schema';

export type Granularity = 'day' | 'month' | 'quarter' | 'fy' | 'ytd' | 'custom';

/** An inclusive date window plus the label Swiss Cheese shows the user. */
export interface Period {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  label: string;
  granularity: Granularity;
}

/**
 * Raw slot output from the language model. Deliberately shallow: the model
 * reports the words it saw ("last month", "HDFC"), and code turns those into
 * date bounds and bank codes. The model never resolves a date itself.
 */
export interface ModelSlots {
  intent: Intent;
  datePhrase?: string | null;
  comparePhrase?: string | null;
  bank?: string | null;
  programId?: number | null;
  txType?: TxType | null;
  counterparty?: string | null;
  reference?: string | null;
  mentionsUtr?: boolean | null;
  amountMin?: number | null;
  amountMax?: number | null;
  refuseTopic?: RefuseTopic | null;
  confidence?: number | null;
}

/** Resolved slots. Everything here is safe to hand to a SQL template. */
export interface Slots {
  intent: Intent;
  dateFrom?: string;
  dateTo?: string; // inclusive
  periodLabel?: string;
  periodGranularity?: Granularity;
  compareFrom?: string;
  compareTo?: string;
  compareLabel?: string;
  bankCode?: string;
  bankName?: string;
  programId?: number;
  txType?: TxType;
  counterpartyKey?: string;
  counterpartyLabel?: string;
  counterpartyCandidates?: string[];
  counterpartyQuery?: string;
  reference?: string;
  refField?: RefField;
  amountMin?: string;
  amountMax?: string;
  refuseTopic?: RefuseTopic;
  confidence: number;
  notes: string[];
}

export type PayloadKind = 'answer' | 'clarify' | 'refuse' | 'empty';

export interface PayloadStat {
  label: string;
  value: string;
}

export interface PayloadTable {
  columns: string[];
  rows: string[][];
  /** Right-align money columns in the UI without the client parsing values. */
  numericColumns?: number[];
}

export interface PayloadTrail {
  template: string;
  filters: Record<string, string>;
  rowCount: number;
}

export interface AnswerPayload {
  kind: PayloadKind;
  intent: Intent;
  headline: PayloadStat[];
  table: PayloadTable;
  trail: PayloadTrail;
  alternatives?: string[];
  notes?: string[];
}
