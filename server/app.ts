import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ResilientLLM, ProviderRegistry } from 'resilient-llm';
import { getLibraryInfo } from './devutility.js';
import { configureAllLlmProviders, configureLlmProvider, llmBaseUrl } from './llmProviders.js';
import askRouter from './routes/ask.js';
import { installPoolShutdown } from './db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Middleware
app.use(express.json());

// Serve static files from client directory
app.use(express.static(join(__dirname, '../client')));

// Every provider chats and lists models through the same gateway.
configureAllLlmProviders();

// Initialize ResilientLLM
const llm = new ResilientLLM({
    aiService: process.env.AI_SERVICE || 'ollama',
    model: process.env.AI_MODEL || 'qwen3.8:27b',
    maxTokens: parseInt(process.env.MAX_TOKENS || '2048'),
    temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
    rateLimitConfig: {
        requestsPerMinute: parseInt(process.env.REQUESTS_PER_MINUTE || '60'),
        llmTokensPerMinute: parseInt(process.env.LLM_TOKENS_PER_MINUTE || '90000')
    },
    retries: parseInt(process.env.RETRIES || '3'),
    backoffFactor: parseFloat(process.env.BACKOFF_FACTOR || '2')
});

// The grounded treasury assistant. Every figure it returns came from SQL.
app.use('/api/cheese', askRouter);

/**
 * Ungrounded passthrough chat. Retained for the playground only.
 * The treasury assistant uses POST /api/cheese/ask, which never lets the model
 * produce a figure of its own.
 */
app.post('/api/chat', async (req: Request, res: Response) => {
    try {
        const { conversationHistory, llmOptions } = req.body;

        if (!conversationHistory || !Array.isArray(conversationHistory)) {
            res.status(400).json({
                error: 'conversationHistory is required and must be an array'
            });
            return;
        }

        const { content, toolCalls, metadata } = await llm.chat(conversationHistory, llmOptions || {});

        res.json({
            success: true,
            content,
            ...(toolCalls !== undefined ? { toolCalls } : {}),
            metadata
        });
    } catch (error: any) {
        console.error('Error in chat endpoint:', error);
        const isAborted =
            error?.name === 'AbortError'
            || error?.code === 'ABORTED'
            || /aborted|cancelled/i.test(error?.message || '');
        res.status(isAborted ? 499 : 500).json({
            error: isAborted
                ? 'Request aborted'
                : (error.message || 'An error occurred while processing your request'),
            success: false,
            aborted: isAborted,
            ...(error.metadata && { metadata: error.metadata })
        });
    }
});

/** Cancel the in-flight ResilientLLM request (if any). */
app.post('/api/abort', (_req: Request, res: Response) => {
    try {
        llm.abort();
        res.json({ success: true, aborted: true });
    } catch (error: any) {
        console.error('Error in abort endpoint:', error);
        res.status(500).json({
            error: error.message || 'Failed to abort request',
            success: false
        });
    }
});

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

// Library info endpoint
app.get('/api/library-info', (_req: Request, res: Response) => {
    res.json(getLibraryInfo());
});

// LLM configuration endpoint - returns current values from the llm instance
app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
        aiService: llm.aiService,
        model: llm.model,
        maxTokens: llm.maxTokens,
        temperature: llm.temperature,
        topP: llm.topP,
        responseFormat: llm.responseFormat,
        retries: llm.retries,
        backoffFactor: llm.backoffFactor,
        timeout: llm.timeout,
        rateLimitConfig: llm.rateLimitConfig,
        circuitBreakerConfig: llm.circuitBreakerConfig,
        maxConcurrent: llm.maxConcurrent
    });
});

// Models endpoint - returns available models for a service
app.get('/api/models', async (req: Request, res: Response) => {
    try {
        const { service, apiKey, baseUrl } = req.query as Record<string, string | undefined>;

        if (!service) {
            res.status(400).json({
                error: 'service query parameter is required'
            });
            return;
        }

        const normalizedService = service === 'local' ? 'ollama' : service;
        configureLlmProvider(
            normalizedService,
            normalizedService === 'ollama' ? baseUrl : llmBaseUrl(baseUrl)
        );

        const models = await ProviderRegistry.getModels(normalizedService, apiKey || null);

        res.json({ models, success: true });
    } catch (error: any) {
        console.error('Error fetching models:', error);
        res.status(500).json({
            error: error.message || 'An error occurred while fetching models',
            success: false
        });
    }
});

installPoolShutdown();

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    const providers = ProviderRegistry.list();
    const hasAnyApiKey = providers.some(provider => ProviderRegistry.hasApiKey(provider?.name));

    if (!hasAnyApiKey) {
        console.log(`Make sure to set your API key in environment variables:`);
        providers.forEach(provider => {
            if (provider.name !== 'ollama' && provider.envVarNames?.length) {
                console.log(`  - ${provider.envVarNames.join(' or ')} (for ${provider.displayName})`);
            }
        });
    }
});
