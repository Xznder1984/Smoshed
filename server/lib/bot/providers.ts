import { env } from '../env.js'
import { PROVIDERS, type BotConfig, type ProviderId } from './config.js'

/** Turns the model may use. The system role is reserved for our own prompt. */
export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type CompletionResult = {
  text: string
  provider: ProviderId
  model: string
}

export class ProviderError extends Error {
  readonly provider: ProviderId
  readonly status: number
  constructor(provider: ProviderId, status: number, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.provider = provider
    this.status = status
  }
}

function apiKeyFor(provider: ProviderId): string | undefined {
  if (provider === 'groq') return env.groqApiKey
  if (provider === 'nvidia') return env.nvidiaApiKey
  if (provider === 'ollama') return env.ollamaApiKey
  return env.keenableApiKey
}

const TIMEOUT_MS = 20_000

/**
 * Calls one provider's OpenAI-compatible chat endpoint.
 *
 * The key is read from the environment inside this function and is only ever
 * placed in a request header. It is never logged, never returned, and never
 * included in an error message.
 */
async function callProvider(
  provider: ProviderId,
  config: BotConfig,
  messages: ChatMessage[],
  systemPrompt: string,
): Promise<CompletionResult> {
  const spec = PROVIDERS[provider]
  const key = apiKeyFor(provider)
  if (!key) {
    throw new ProviderError(provider, 0, 'no API key configured for this provider')
  }

  const model = config.models[provider] || spec.defaultModel
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${spec.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        // The system turn is set here and nowhere else, so no user-controlled
        // string can occupy the system role.
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    // A network or timeout failure never includes the key.
    const reason = err instanceof Error ? err.name : 'network error'
    throw new ProviderError(provider, 0, `request failed (${reason})`)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new ProviderError(provider, response.status, `provider responded ${response.status}`)
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = payload.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string') {
    throw new ProviderError(provider, response.status, 'provider returned no content')
  }
  return { text, provider, model }
}

/**
 * Tries each provider in the configured order and returns the first success.
 * If every provider fails, the last error is thrown so the caller can record
 * the failure without posting anything.
 */
export async function complete(
  config: BotConfig,
  userContent: string,
  systemPromptOverride?: string,
): Promise<CompletionResult> {
  const messages: ChatMessage[] = [{ role: 'user', content: userContent }]
  const systemPrompt = systemPromptOverride ?? config.systemPrompt

  const errors: string[] = []
  for (const provider of config.providerOrder) {
    try {
      return await callProvider(provider, config, messages, systemPrompt)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      // Provider id and status only. No key, no response body.
      errors.push(`${provider}: ${message}`)
    }
  }
  throw new ProviderError(
    config.providerOrder[config.providerOrder.length - 1] ?? 'groq',
    0,
    `all providers failed (${errors.join('; ')})`,
  )
}

