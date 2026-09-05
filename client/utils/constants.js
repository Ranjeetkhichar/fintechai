/**
 * Application constants and configuration
 */
export const STORAGE_KEY = 'cheese_v1';
export const THEME_STORAGE_KEY = 'cheese_theme';
export const API_KEYS_KEY = 'cheese_api_keys';
export const API_URL = '/api/chat';
/** Grounded treasury endpoint. Every figure it returns was computed by SQL. */
export const ASK_API_URL = '/api/cheese/ask';
export const ABORT_API_URL = '/api/abort';
export const HEALTH_API_URL = '/api/health';
export const LIBRARY_INFO_URL = '/api/library-info';
export const MODELS_API_URL = '/api/models';

/** Default prompt name for a new chat. */
export const DEFAULT_PROMPT_NAME = 'Swiss Cheese';

/**
 * Persona override for the verbalizer only.
 *
 * Grounding does not live here. Intent, filters, SQL, masking and refusals are
 * decided on the server, and the model only ever phrases a computed payload.
 * Editing this text changes Swiss Cheese's voice, never its numbers.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are Swiss Cheese, a finance assistant for a corporate treasury team.

Voice: short and plain. Never cute at the cost of a number.

You will be given a JSON payload that was already computed by SQL. Write one sentence about it. Copy figures exactly. Never add, subtract or estimate anything.`;

/** Starter questions that match the gold conversation shapes. */
export const EXAMPLE_QUESTIONS = [
    'What is our cash position across banks right now?',
    'How much did we spend in June?',
    'Who are we paying the most, year to date?'
];

/** Builds the seeded system message for a new Swiss Cheese conversation. */
export function createDefaultSystemMessage() {
    return {
        id: 'system-' + Date.now(),
        text: DEFAULT_SYSTEM_PROMPT,
        role: 'system',
        timestamp: new Date().toISOString()
    };
}
