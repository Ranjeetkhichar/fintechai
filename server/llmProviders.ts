/**
 * Routes selected cloud providers through one OpenAI-compatible gateway.
 * Ollama and OpenRouter keep their own APIs so the settings dropdown can
 * list local models and the OpenRouter catalog.
 *
 * Built-in providers already have chatApiUrl set, so ProviderRegistry ignores
 * `baseUrl` on configure. We write the full chat and models URLs instead.
 */
import { ProviderRegistry } from 'resilient-llm';

export const DEFAULT_LLM_BASE_URL = 'https://inference.coralbricks.ai/v1';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_LLM_TIMEOUT_MS = 180_000;

const LOCAL_SERVICES = new Set(['ollama', 'local']);
const NATIVE_CLOUD_SERVICES = new Set(['openrouter']);

const OPENROUTER_URLS = {
  chatApiUrl: 'https://openrouter.ai/api/v1/chat/completions',
  modelsApiUrl: 'https://openrouter.ai/api/v1/models'
};

const OPENAI_STYLE_PARSE = {
  modelsPath: 'data',
  idField: 'id',
  nameField: 'id'
};

const BEARER_AUTH = {
  type: 'header',
  headerName: 'Authorization',
  headerFormat: 'Bearer {key}'
};

/** Shared gateway host, trailing slash stripped. */
export function llmBaseUrl(override?: string): string {
  const raw = override ?? process.env.LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL;
  return raw.replace(/\/$/, '');
}

/** Local Ollama host. Independent of the Coral gateway. */
export function ollamaBaseUrl(override?: string): string {
  const raw = override ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  return raw.replace(/\/$/, '');
}

/** Total chat budget, including retries. Coral often needs more than 60s. */
export function llmTimeoutMs(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return override;
  }
  const fromEnv = Number(process.env.LLM_TIMEOUT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_LLM_TIMEOUT_MS;
}

function isLocalService(service: string): boolean {
  return LOCAL_SERVICES.has(service);
}

function usesNativeCloudApi(service: string): boolean {
  return NATIVE_CLOUD_SERVICES.has(service);
}

function chatApiUrl(service: string, baseUrl: string): string {
  const path = service === 'anthropic' ? 'messages' : 'chat/completions';
  return `${baseUrl}/${path}`;
}

/** Point local Ollama at its own daemon, not the cloud gateway. */
export function configureLocalOllama(baseUrl = ollamaBaseUrl()): void {
  const host = ollamaBaseUrl(baseUrl);
  ProviderRegistry.configure('ollama', {
    chatApiUrl: `${host}/v1/chat/completions`,
    modelsApiUrl: `${host}/v1/models`
  });
}

/** Keep OpenRouter on openrouter.ai so the settings dropdown can list its catalog. */
export function configureNativeOpenRouter(): void {
  ProviderRegistry.configure('openrouter', OPENROUTER_URLS);
}

/** Point one provider at the right host. Ollama and OpenRouter keep their own APIs. */
export function configureLlmProvider(service: string, baseUrl?: string): void {
  if (isLocalService(service)) {
    configureLocalOllama(baseUrl);
    return;
  }

  if (usesNativeCloudApi(service)) {
    configureNativeOpenRouter();
    return;
  }

  baseUrl = llmBaseUrl(baseUrl);

  const listed = ProviderRegistry.list().find((provider) => provider.name === service);
  const envVarNames = ['CORAL_API_KEY', ...(listed?.envVarNames ?? []).filter((name) => name !== 'CORAL_API_KEY')];

  const config: Record<string, unknown> = {
    chatApiUrl: chatApiUrl(service, baseUrl),
    modelsApiUrl: `${baseUrl}/models`,
    envVarNames
  };

  if (service === 'google') {
    // Google's defaults use query-param auth and a Gemini model list shape.
    config.authConfig = BEARER_AUTH;
    config.parseConfig = OPENAI_STYLE_PARSE;
  }

  ProviderRegistry.configure(service, config);
}

/** Apply the shared gateway to Coral-routed providers. Leave Ollama and OpenRouter native. */
export function configureAllLlmProviders(baseUrl = llmBaseUrl()): void {
  configureLocalOllama();
  configureNativeOpenRouter();
  for (const provider of ProviderRegistry.list()) {
    if (provider?.name && !isLocalService(provider.name) && !usesNativeCloudApi(provider.name)) {
      configureLlmProvider(provider.name, baseUrl);
    }
  }
}
