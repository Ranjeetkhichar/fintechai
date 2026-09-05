/**
 * The verbalizer.
 *
 * Its entire input is a computed payload in which every amount is already a
 * formatted string. There is nothing left to calculate, so the worst a weak
 * model can do is phrase the answer badly, not report a wrong number.
 *
 * `fallbackSentence` covers a model timeout: the user still gets a correct
 * sentence, assembled from the same payload.
 */
import type { AnswerPayload } from './types.js';

export const CHEESE_PERSONA = `You are Swiss Cheese, a finance assistant for a corporate treasury team.
Voice: short and plain. Never cute at the cost of a number.`;

export function verbalizerSystemPrompt(persona = CHEESE_PERSONA): string {
  return `${persona}

You are given a JSON payload that was computed by SQL. Write ONE sentence for the user.

Hard rules:
- Use only figures that appear in the payload. Copy them exactly, including commas.
- Never add, subtract, average or estimate anything.
- If kind is "refuse", say plainly that the data cannot answer and why.
- If kind is "empty", say the window has no rows. Do not substitute another number.
- If kind is "clarify", ask which option the user means.
- Do not describe the table; the user can already see it.
- One sentence. No markdown, no bullet points, no preamble.`;
}

export function buildVerbalizerMessages(
  payload: AnswerPayload,
  persona?: string
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: verbalizerSystemPrompt(persona) },
    { role: 'user', content: JSON.stringify(payload) }
  ];
}

/**
 * Deterministic sentence built from the payload. Used when the model is
 * unavailable, and as the floor the model is expected to beat.
 */
export function fallbackSentence(payload: AnswerPayload): string {
  const headline = payload.headline
    .map((stat) => `${stat.label.toLowerCase()} ${stat.value}`)
    .join(', ');

  switch (payload.kind) {
    case 'refuse':
      return payload.notes?.[0] ?? 'This schema cannot answer that.';
    case 'empty':
      return payload.notes?.[0] ?? 'No rows in that window.';
    case 'clarify':
      return payload.notes?.[0] ?? 'Which one do you mean?';
    default:
      return headline ? `${capitalize(headline)}.` : 'Here is the result.';
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
