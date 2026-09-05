/**
 * Minimal ambient types for `resilient-llm`, which ships without declarations.
 * Only the surface Swiss Cheese actually uses is declared here.
 */
declare module 'resilient-llm' {
  export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }

  export interface LLMOptions {
    aiService?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    responseFormat?: { type: string };
    retries?: number;
    backoffFactor?: number;
    timeout?: number;
    enableCache?: boolean;
    rateLimitConfig?: Record<string, number>;
    circuitBreakerConfig?: Record<string, number>;
    maxConcurrent?: number;
  }

  export interface LLMUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    [key: string]: unknown;
  }

  export interface LLMMetadata {
    usage?: LLMUsage;
    durationMs?: number;
    [key: string]: unknown;
  }

  export interface LLMResult {
    content: string | Record<string, unknown>;
    toolCalls?: unknown;
    metadata?: LLMMetadata;
  }

  export class ResilientLLM {
    constructor(options?: LLMOptions);
    aiService: string;
    model: string;
    maxTokens: number;
    temperature: number;
    topP?: number;
    responseFormat?: { type: string };
    retries: number;
    backoffFactor: number;
    timeout: number;
    rateLimitConfig: Record<string, number>;
    circuitBreakerConfig: Record<string, number>;
    maxConcurrent?: number;
    chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResult>;
    abort(): void;
  }

  export const ProviderRegistry: {
    configure(service: string, options: Record<string, unknown>): void;
    getModels(service: string, apiKey?: string | null): Promise<unknown[]>;
    list(): Array<{ name: string; displayName: string; envVarNames?: string[] }>;
    hasApiKey(service?: string): boolean;
  };
}
