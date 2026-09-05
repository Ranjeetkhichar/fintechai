/**
 * Turns raw model slots into resolved slots a SQL template can trust.
 *
 * Everything ambiguous is reported as an `issue` rather than guessed, so the
 * policy layer can clarify. This is where multi-turn memory is applied too: a
 * follow-up inherits the previous turn's filters instead of asking the user to
 * repeat them.
 */
import { previousPeriod, resolvePeriod } from './dates.js';
import { resolveBank } from './banks.js';
import { resolveCounterparty } from './aliases.js';
import { extractReference, resolveRefField } from './reference.js';
import type { ModelSlots, Period, Slots } from '../types.js';

export type ResolveIssue =
  | { kind: 'vague_date'; detail: string }
  | { kind: 'unknown_bank'; detail: string }
  | { kind: 'ambiguous_counterparty'; detail: string; candidateKeys: string[] }
  | { kind: 'unknown_counterparty'; detail: string }
  | { kind: 'missing_reference'; detail: string };

export interface ResolveResult {
  slots: Slots;
  issue?: ResolveIssue;
}

/** Intents whose default transaction type is a debit ("spend", "paid"). */
const SPEND_INTENTS = new Set(['period_spend', 'counterparty_breakdown', 'compare_period']);

function applyPeriod(slots: Slots, period: Period): void {
  slots.dateFrom = period.from;
  slots.dateTo = period.to;
  slots.periodLabel = period.label;
  slots.periodGranularity = period.granularity;
}

function periodFromSlots(slots: Slots): Period | null {
  if (!slots.dateFrom || !slots.dateTo) return null;
  return {
    from: slots.dateFrom,
    to: slots.dateTo,
    label: slots.periodLabel ?? '',
    granularity: slots.periodGranularity ?? 'custom'
  };
}

export async function resolveSlots(
  question: string,
  model: ModelSlots,
  previous?: Slots | null
): Promise<ResolveResult> {
  const slots: Slots = {
    intent: model.intent,
    confidence: model.confidence ?? 0.5,
    notes: []
  };

  let issue: ResolveIssue | undefined;

  // --- period -------------------------------------------------------------
  if (model.datePhrase) {
    const resolved = resolvePeriod(model.datePhrase);
    if (resolved.ok) {
      applyPeriod(slots, resolved.period);
    } else if (resolved.reason === 'vague') {
      issue = { kind: 'vague_date', detail: model.datePhrase };
    }
  } else if (previous?.dateFrom && previous.dateTo) {
    // Follow-up with no new date: keep the window we were already talking about.
    applyPeriod(slots, periodFromSlots(previous)!);
    slots.notes.push(`Reusing the previous window, ${previous.periodLabel ?? 'same dates'}.`);
  }

  // --- comparison window --------------------------------------------------
  if (model.intent === 'compare_period') {
    const base = periodFromSlots(slots) ?? (previous ? periodFromSlots(previous) : null);
    if (base) {
      if (!slots.dateFrom) applyPeriod(slots, base);
      const wantsYear = /\b(year|yoy|last year|year before)\b/i.test(model.comparePhrase ?? '');
      const compare = wantsYear
        ? shiftByYear(base)
        : previousPeriod(base);
      slots.compareFrom = compare.from;
      slots.compareTo = compare.to;
      slots.compareLabel = compare.label;
    }
  }

  // --- bank ---------------------------------------------------------------
  if (model.bank) {
    const bank = await resolveBank(model.bank);
    if (bank.ok) {
      slots.bankCode = bank.bankCode;
      slots.bankName = bank.bankName;
    } else {
      issue ??= { kind: 'unknown_bank', detail: model.bank };
    }
  } else if (previous?.bankCode && isFollowUp(model)) {
    slots.bankCode = previous.bankCode;
    slots.bankName = previous.bankName;
  }

  // --- program ------------------------------------------------------------
  if (model.programId !== null && model.programId !== undefined) {
    slots.programId = model.programId;
  }

  // --- transaction type ---------------------------------------------------
  if (model.txType) {
    slots.txType = model.txType;
  } else if (SPEND_INTENTS.has(model.intent)) {
    slots.txType = 'debit';
  } else if (model.intent === 'missing_reference') {
    slots.txType = 'debit';
  }

  // --- counterparty -------------------------------------------------------
  if (model.counterparty) {
    slots.counterpartyQuery = model.counterparty;
    const match = resolveCounterparty(model.counterparty);
    if (match.ok) {
      slots.counterpartyKey = match.alias.key;
      slots.counterpartyLabel = match.alias.label;
      if (match.confidence < 1) {
        slots.notes.push(`Matched "${model.counterparty}" to ${match.alias.label} on description text.`);
      }
    } else if (match.reason === 'ambiguous') {
      slots.counterpartyCandidates = match.candidates.map((c) => c.key);
      issue = {
        kind: 'ambiguous_counterparty',
        detail: model.counterparty,
        candidateKeys: match.candidates.map((c) => c.key)
      };
    } else {
      issue ??= { kind: 'unknown_counterparty', detail: model.counterparty };
    }
  } else if (previous?.counterpartyKey && isFollowUp(model)) {
    slots.counterpartyKey = previous.counterpartyKey;
    slots.counterpartyLabel = previous.counterpartyLabel;
  }

  // --- reference ----------------------------------------------------------
  if (model.intent === 'lookup_reference') {
    const token = model.reference?.trim() || extractReference(question);
    if (token) {
      slots.reference = token;
      slots.refField = resolveRefField(question, model.mentionsUtr);
    } else {
      issue ??= { kind: 'missing_reference', detail: question };
    }
  }

  // --- amounts ------------------------------------------------------------
  if (typeof model.amountMin === 'number') slots.amountMin = String(model.amountMin);
  if (typeof model.amountMax === 'number') slots.amountMax = String(model.amountMax);

  if (model.refuseTopic) slots.refuseTopic = model.refuseTopic;

  return issue ? { slots, issue } : { slots };
}

/** A follow-up adds no new filters of its own, so inheriting is safe. */
function isFollowUp(model: ModelSlots): boolean {
  return model.intent === 'compare_period' || model.intent === 'counterparty_breakdown';
}

function shiftByYear(period: Period): Period {
  const shift = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  return {
    from: shift(period.from),
    to: shift(period.to),
    label: `${period.label} a year earlier`,
    granularity: period.granularity
  };
}
