/**
 * The model boundary.
 *
 * Swiss Cheese talks to a language model exactly twice per question: once to fill
 * slots, once to phrase a computed payload. Everything else is SQL. Swapping
 * models therefore changes two prompts and no numbers, which is the whole
 * model-efficiency argument.
 */
import { ResilientLLM, type LLMMessage, type LLMUsage } from 'resilient-llm';
import { configureLlmProvider, DEFAULT_LLM_TIMEOUT_MS, llmBaseUrl, llmTimeoutMs } from '../llmProviders.js';
import { buildSlotMessages, normalizeModelSlots } from './nlu.js';
import { buildVerbalizerMessages } from './verbalize.js';
import type { AnswerPayload, ModelSlots, Slots } from './types.js';

export interface ModelCallStats {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs: number;
}

export interface SlotCall {
  slots: ModelSlots;
  stats: ModelCallStats;
  raw: string;
}

export interface VerbalizeCall {
  text: string;
  stats: ModelCallStats;
}

export interface ChatModel {
  readonly name: string;
  fillSlots(question: string, context: Slots | null): Promise<SlotCall>;
  verbalize(payload: AnswerPayload, persona?: string): Promise<VerbalizeCall>;
}

export interface ModelConfig {
  service?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/** Pulls the first JSON object out of a model response, fences and all. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`model did not return a JSON object: ${text.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}

function asText(content: unknown): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(content ?? '');
}

/** ChatModel backed by resilient-llm, which already handles retries and the shared gateway. */
export class ResilientChatModel implements ChatModel {
  readonly name: string;
  private readonly llm: ResilientLLM;
  private readonly options: ModelConfig;

  constructor(config: ModelConfig = {}) {
    const service = config.service ?? process.env.AI_SERVICE ?? 'ollama';
    const model = config.model ?? process.env.AI_MODEL ?? 'qwen3.8:27b';
    const baseUrl = config.baseUrl ?? (service === 'ollama' || service === 'openrouter' ? undefined : llmBaseUrl());
    const timeout = Math.max(llmTimeoutMs(config.timeout), service === 'ollama' ? 0 : DEFAULT_LLM_TIMEOUT_MS);
    configureLlmProvider(service, baseUrl);

    this.name = `${service}:${model}`;
    this.options = { ...config, service, model, baseUrl, timeout };
    this.llm = new ResilientLLM({
      aiService: service,
      model,
      temperature: config.temperature ?? 0,
      maxTokens: config.maxTokens ?? 800,
      timeout,
      retries: 2
    });
  }

  private async call(messages: LLMMessage[], json: boolean): Promise<{ text: string; stats: ModelCallStats }> {
    const started = Date.now();
    const result = await this.llm.chat(messages, {
      aiService: this.options.service,
      model: this.options.model,
      ...(this.options.apiKey ? { apiKey: this.options.apiKey } : {}),
      temperature: this.options.temperature ?? 0,
      ...(json ? { responseFormat: { type: 'json_object' } } : {})
    });

    const usage: LLMUsage = result.metadata?.usage ?? {};
    return {
      text: asText(result.content),
      stats: {
        promptTokens: numeric(usage.promptTokens ?? usage.prompt_tokens),
        completionTokens: numeric(usage.completionTokens ?? usage.completion_tokens),
        totalTokens: numeric(usage.totalTokens ?? usage.total_tokens),
        durationMs: Date.now() - started
      }
    };
  }

  async fillSlots(question: string, context: Slots | null): Promise<SlotCall> {
    const { text, stats } = await this.call(buildSlotMessages(question, context), true);
    return { slots: normalizeModelSlots(parseJsonObject(text)), stats, raw: text };
  }

  async verbalize(payload: AnswerPayload, persona?: string): Promise<VerbalizeCall> {
    const { text, stats } = await this.call(buildVerbalizerMessages(payload, persona), false);
    return { text: text.trim(), stats };
  }
}

/** Fixed responses for tests and for gold-slot eval runs. */
export class StubChatModel implements ChatModel {
  readonly name = 'stub';

  constructor(
    private readonly slots: ModelSlots,
    private readonly sentence = 'Here is what the data shows.'
  ) {}

  async fillSlots(): Promise<SlotCall> {
    return { slots: this.slots, stats: { durationMs: 0 }, raw: JSON.stringify(this.slots) };
  }

  async verbalize(): Promise<VerbalizeCall> {
    return { text: this.sentence, stats: { durationMs: 0 } };
  }
}

function numeric(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
