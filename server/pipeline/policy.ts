/**
 * The decision layer: answer, clarify, refuse, or report empty.
 *
 * Nothing ambiguous is allowed to become a number. Every branch that cannot
 * safely compute returns a clarify or refuse payload instead of a total.
 */
import { ytdPeriod } from './resolve/dates.js';
import { asOfDate } from './clock.js';
import { loadBanks } from './resolve/banks.js';
import { buildPayload } from './payload.js';
import {
  runCashPosition,
  runClarifyCounterparty,
  runComparePeriod,
  runCounterpartyBreakdown,
  runInflowOutflow,
  runLookupReference,
  runMissingReference,
  runPeriodSpend,
  runRefuse
} from './engine.js';
import type { ResolveIssue } from './resolve/slots.js';
import type { AnswerPayload, Slots } from './types.js';

/** Intents that are meaningless without a window, so they get a stated default. */
const NEEDS_PERIOD = new Set<Slots['intent']>([
  'period_spend',
  'inflow_outflow',
  'counterparty_breakdown',
  'compare_period'
]);

function clarify(slots: Slots, template: string, ask: string, options: string[] = []): AnswerPayload {
  return buildPayload({
    kind: 'clarify',
    intent: slots.intent,
    template,
    slots,
    rowCount: 0,
    headline: [{ label: 'Needs one detail', value: ask }],
    alternatives: options,
    notes: [ask]
  });
}

/** Applies the documented default window and records it in the notes. */
function applyDefaultPeriod(slots: Slots): void {
  const period = ytdPeriod(asOfDate());
  slots.dateFrom = period.from;
  slots.dateTo = period.to;
  slots.periodLabel = period.label;
  slots.periodGranularity = period.granularity;
  slots.notes.push(`No window was given, so this covers ${period.label}.`);
}

/**
 * Routes resolved slots to an outcome. The only entry point the API and the
 * eval harness use.
 */
export async function decide(slots: Slots, issue?: ResolveIssue): Promise<AnswerPayload> {
  if (slots.intent === 'refuse') return runRefuse(slots);

  if (issue) {
    switch (issue.kind) {
      case 'vague_date':
        return clarify(
          slots,
          'clarify:date',
          `"${issue.detail}" does not name a window I can query. Which period do you mean?`,
          ['Last month', 'This quarter', 'FY year to date', 'A named month such as June 2026']
        );

      case 'unknown_bank': {
        const banks = await loadBanks();
        return clarify(
          slots,
          'clarify:bank',
          `I have no bank matching "${issue.detail}" in the data.`,
          banks.map((bank) => bank.bank_name)
        );
      }

      case 'ambiguous_counterparty': {
        const clarifySlots: Slots = {
          ...slots,
          intent: 'clarify_counterparty',
          counterpartyCandidates: issue.candidateKeys
        };
        if (!clarifySlots.dateFrom) applyDefaultPeriod(clarifySlots);
        return runClarifyCounterparty(clarifySlots);
      }

      case 'unknown_counterparty':
        return clarify(
          slots,
          'clarify:counterparty',
          `No counterparty in the transaction descriptions matches "${issue.detail}".`,
          ['Try the name as it appears on the statement', 'Ask for the top counterparties in a period']
        );

      case 'missing_reference':
        return clarify(slots, 'clarify:reference', 'Which reference number should I look up?', [
          'A plaintext reference such as HDFCH01078329532',
          'Say "UTR" explicitly to search the sensitive column'
        ]);
    }
  }

  if (NEEDS_PERIOD.has(slots.intent) && !slots.dateFrom) applyDefaultPeriod(slots);

  switch (slots.intent) {
    case 'cash_position':
      return runCashPosition(slots);
    case 'period_spend':
      return runPeriodSpend(slots);
    case 'inflow_outflow':
      return runInflowOutflow(slots);
    case 'counterparty_breakdown':
      return runCounterpartyBreakdown(slots);
    case 'compare_period':
      return runComparePeriod(slots);
    case 'lookup_reference':
      return runLookupReference(slots);
    case 'missing_reference':
      return runMissingReference(slots);
    case 'clarify_counterparty':
      return runClarifyCounterparty(slots);
    default:
      return runRefuse({ ...slots, refuseTopic: slots.refuseTopic ?? 'out_of_schema' });
  }
}
