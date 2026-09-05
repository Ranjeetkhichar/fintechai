/**
 * Slot filling.
 *
 * The model reports the words it saw and nothing more: it never resolves a
 * date, never picks a bank code, never writes SQL. Keeping the job this small
 * is what lets a lightweight model carry the natural-language load.
 */
import { INTENTS, type Intent, type ModelSlots, type RefuseTopic, type TxType } from './types.js';
import { asOf } from './clock.js';

const REFUSE_TOPICS: RefuseTopic[] = [
  'reconciliation',
  'budget',
  'pnl',
  'tax',
  'cash_as_of',
  'runway',
  'forecast',
  'invoice',
  'out_of_schema'
];

export function slotSystemPrompt(): string {
  return `You extract search filters for a treasury database. You never answer the question and never state a number.

Today is ${asOf()}. Return ONLY a JSON object with these keys:

{
  "intent": one of ${INTENTS.join(' | ')},
  "datePhrase": the date wording exactly as the user said it, or null,
  "comparePhrase": the comparison wording for follow-ups, or null,
  "bank": bank name or code the user mentioned, or null,
  "programId": integer program id, or null,
  "txType": "credit" | "debit" | null,
  "counterparty": the vendor or payee name as the user wrote it, or null,
  "reference": a reference or UTR number, or null,
  "mentionsUtr": true only if the user said UTR,
  "amountMin": number or null,
  "amountMax": number or null,
  "refuseTopic": ${REFUSE_TOPICS.join(' | ')} or null,
  "confidence": 0 to 1
}

Intent guide:
- cash_position: current balance or cash across banks.
- period_spend: how much was spent or received in a window, optionally to one counterparty.
- inflow_outflow: credits versus debits for a window.
- counterparty_breakdown: who we pay the most, spend split by counterparty.
- compare_period: a follow-up comparing to an earlier window.
- lookup_reference: find one transaction by reference or UTR.
- missing_reference: transactions with no reference number.
- refuse: the database cannot answer. Set refuseTopic.

Rules:
- Copy date wording, do not convert it. "last month" stays "last month".
- "spend", "paid", "payout" mean txType "debit". "received", "credits" mean "credit".
- Reconciliation, budget, P&L, margin, tax, runway, forecast, invoices, and cash on a past date are all intent "refuse".
- If the user names no window, set datePhrase to null. Do not invent one.
- Output JSON only. No prose, no code fences.`;
}

/** Compact recap of the previous turn so follow-ups resolve without repetition. */
function contextLine(context: {
  intent?: Intent;
  periodLabel?: string;
  counterpartyLabel?: string;
  bankCode?: string;
} | null): string {
  if (!context) return 'No previous turn.';
  const parts = [
    context.intent ? `intent=${context.intent}` : null,
    context.periodLabel ? `window=${context.periodLabel}` : null,
    context.counterpartyLabel ? `counterparty=${context.counterpartyLabel}` : null,
    context.bankCode ? `bank=${context.bankCode}` : null
  ].filter(Boolean);
  return parts.length ? `Previous turn: ${parts.join(', ')}.` : 'No previous turn.';
}

export function buildSlotMessages(
  question: string,
  context: Parameters<typeof contextLine>[0]
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: slotSystemPrompt() },
    { role: 'user', content: `${contextLine(context)}\n\nQuestion: ${question}` }
  ];
}

function asIntent(value: unknown): Intent {
  return INTENTS.includes(value as Intent) ? (value as Intent) : 'refuse';
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Coerces whatever the model produced into the ModelSlots shape. */
export function normalizeModelSlots(raw: Record<string, unknown>): ModelSlots {
  const txType = asString(raw.txType)?.toLowerCase();
  const refuseTopic = asString(raw.refuseTopic) as RefuseTopic | null;

  return {
    intent: asIntent(raw.intent),
    datePhrase: asString(raw.datePhrase),
    comparePhrase: asString(raw.comparePhrase),
    bank: asString(raw.bank),
    programId: asNumber(raw.programId),
    txType: txType === 'credit' || txType === 'debit' ? (txType as TxType) : null,
    counterparty: asString(raw.counterparty),
    reference: asString(raw.reference),
    mentionsUtr: raw.mentionsUtr === true,
    amountMin: asNumber(raw.amountMin),
    amountMax: asNumber(raw.amountMax),
    refuseTopic: refuseTopic && REFUSE_TOPICS.includes(refuseTopic) ? refuseTopic : null,
    confidence: asNumber(raw.confidence) ?? 0.5
  };
}
