/**
 * Pipeline orchestration.
 *
 * `runPipeline` is the deterministic half: refusal pre-check, slot resolution,
 * policy, SQL. The eval harness calls it directly so a scored run and a live
 * answer take exactly the same path.
 *
 * `ask` wraps it with the two model calls.
 */
import { detectRefusal } from './refusals.js';
import { resolveSlots, type ResolveIssue } from './resolve/slots.js';
import { decide } from './policy.js';
import { fallbackSentence } from './verbalize.js';
import type { ChatModel, ModelCallStats } from './model.js';
import type { AnswerPayload, ModelSlots, Slots } from './types.js';

export interface PipelineResult {
  slots: Slots;
  issue?: ResolveIssue;
  payload: AnswerPayload;
}

/**
 * Deterministic path from raw model slots to a finished payload.
 *
 * The refusal pre-check runs first and overrides the model. A question about
 * reconciliation or budget cannot be argued into producing a total, whatever
 * intent the model guessed.
 */
export async function runPipeline(
  question: string,
  modelSlots: ModelSlots,
  previous?: Slots | null
): Promise<PipelineResult> {
  const forcedRefusal = detectRefusal(question);
  const effective: ModelSlots = forcedRefusal
    ? { ...modelSlots, intent: 'refuse', refuseTopic: forcedRefusal }
    : modelSlots;

  const { slots, issue } = await resolveSlots(question, effective, previous);
  const payload = await decide(slots, issue);

  return { slots, issue, payload };
}

export interface AskOptions {
  model: ChatModel;
  previous?: Slots | null;
  persona?: string;
  /** Skip the phrasing call and use the deterministic sentence. */
  skipVerbalize?: boolean;
}

export interface AskResult extends PipelineResult {
  sentence: string;
  modelSlots: ModelSlots;
  stats: {
    slots: ModelCallStats;
    verbalize?: ModelCallStats;
    verbalizeFailed?: boolean;
  };
}

/** Full question-to-answer path, including both model calls. */
export async function ask(question: string, options: AskOptions): Promise<AskResult> {
  const { model, previous = null, persona, skipVerbalize } = options;

  const slotCall = await model.fillSlots(question, previous);
  const result = await runPipeline(question, slotCall.slots, previous);

  if (skipVerbalize) {
    return {
      ...result,
      sentence: fallbackSentence(result.payload),
      modelSlots: slotCall.slots,
      stats: { slots: slotCall.stats }
    };
  }

  // A failed phrasing call must not cost the user their answer: the table and
  // the trail are already computed, so fall back to the deterministic sentence.
  try {
    const spoken = await model.verbalize(result.payload, persona);
    return {
      ...result,
      sentence: spoken.text || fallbackSentence(result.payload),
      modelSlots: slotCall.slots,
      stats: { slots: slotCall.stats, verbalize: spoken.stats }
    };
  } catch {
    return {
      ...result,
      sentence: fallbackSentence(result.payload),
      modelSlots: slotCall.slots,
      stats: { slots: slotCall.stats, verbalizeFailed: true }
    };
  }
}
