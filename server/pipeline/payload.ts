/**
 * The only place an AnswerPayload is constructed.
 *
 * Routing every answer through here means masking and the trail cannot be
 * skipped by a new intent, and the verbalizer always receives the same shape.
 */
import { formatDay } from './resolve/dates.js';
import type {
  AnswerPayload,
  Intent,
  PayloadKind,
  PayloadStat,
  PayloadTable,
  Slots
} from './types.js';

export const EMPTY_TABLE: PayloadTable = { columns: [], rows: [] };

/** Human-readable filters for the trail, built from resolved slots. */
export function filtersFromSlots(slots: Slots): Record<string, string> {
  const filters: Record<string, string> = {};

  if (slots.dateFrom && slots.dateTo) {
    filters.dates = `${formatDay(slots.dateFrom)} to ${formatDay(slots.dateTo)}`;
  }
  if (slots.periodLabel) filters.period = slots.periodLabel;
  if (slots.compareFrom && slots.compareTo) {
    filters.comparedWith = `${formatDay(slots.compareFrom)} to ${formatDay(slots.compareTo)}`;
  }
  if (slots.txType) filters.transaction_type = slots.txType;
  if (slots.bankCode) filters.bank = slots.bankCode;
  if (slots.programId !== undefined) filters.program_id = String(slots.programId);
  if (slots.counterpartyLabel) filters.counterparty = slots.counterpartyLabel;
  if (slots.reference) {
    filters[slots.refField === 'utr' ? 'utr' : 'reference_id'] = slots.reference;
  }
  if (slots.amountMin) filters.amount_min = slots.amountMin;
  if (slots.amountMax) filters.amount_max = slots.amountMax;

  return filters;
}

export interface BuildOptions {
  kind: PayloadKind;
  intent: Intent;
  template: string;
  slots: Slots;
  headline?: PayloadStat[];
  table?: PayloadTable;
  rowCount: number;
  alternatives?: string[];
  notes?: string[];
  extraFilters?: Record<string, string>;
}

/** Assembles a payload. Every field the verbalizer sees originates here. */
export function buildPayload(options: BuildOptions): AnswerPayload {
  const {
    kind,
    intent,
    template,
    slots,
    headline = [],
    table = EMPTY_TABLE,
    rowCount,
    alternatives,
    notes,
    extraFilters
  } = options;

  const payload: AnswerPayload = {
    kind,
    intent,
    headline,
    table,
    trail: {
      template,
      filters: { ...filtersFromSlots(slots), ...(extraFilters ?? {}) },
      rowCount
    }
  };

  if (alternatives?.length) payload.alternatives = alternatives;

  const allNotes = [...(slots.notes ?? []), ...(notes ?? [])];
  if (allNotes.length) payload.notes = allNotes;

  return payload;
}
