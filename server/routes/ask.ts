/**
 * The grounded endpoint.
 *
 * POST /api/cheese/ask is the only path the treasury assistant uses. It returns
 * the computed payload alongside the sentence, so the client can render the
 * table and the trail even when the phrasing call fails.
 */
import { Router, type Request, type Response } from 'express';
import { ask } from '../pipeline/index.js';
import { ResilientChatModel, type ChatModel, type ModelConfig } from '../pipeline/model.js';
import { forgetSlots, recallSlots, rememberSlots } from '../pipeline/session.js';

const router = Router();

// One model instance per service+model pair, so switching models in the
// settings drawer does not rebuild a client on every keystroke.
const models = new Map<string, ChatModel>();

function modelFor(options: ModelConfig): ChatModel {
  const service = options.service === 'local' ? 'ollama' : options.service ?? process.env.AI_SERVICE ?? 'ollama';
  const name = options.model ?? process.env.AI_MODEL ?? 'qwen3.8:27b';
  const key = `${service}|${name}|${options.baseUrl ?? ''}|${options.timeout ?? ''}`;

  const existing = models.get(key);
  if (existing && !options.apiKey) return existing;

  const created = new ResilientChatModel({ ...options, service, model: name });
  if (!options.apiKey) models.set(key, created);
  return created;
}

router.post('/ask', async (req: Request, res: Response) => {
  const { question, conversationId, llmOptions } = req.body ?? {};

  if (typeof question !== 'string' || !question.trim()) {
    res.status(400).json({ success: false, error: 'question is required' });
    return;
  }

  try {
    const model = modelFor(llmOptions ?? {});
    const previous = recallSlots(conversationId);

    const result = await ask(question.trim(), {
      model,
      previous,
      skipVerbalize: llmOptions?.skipVerbalize === true
    });

    // Only remember windows we could actually resolve; a clarification should
    // not poison the next turn with half-filled filters.
    if (result.payload.kind === 'answer') rememberSlots(conversationId, result.slots);

    res.json({
      success: true,
      sentence: result.sentence,
      payload: result.payload,
      model: model.name,
      stats: result.stats
    });
  } catch (error: any) {
    console.error('cheese ask failed:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Swiss Cheese could not answer that',
      model: llmOptions?.model ?? process.env.AI_MODEL
    });
  }
});

router.post('/reset', (req: Request, res: Response) => {
  forgetSlots(req.body?.conversationId);
  res.json({ success: true });
});

export default router;
