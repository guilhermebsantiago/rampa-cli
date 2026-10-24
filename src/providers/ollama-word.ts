import { ollamaUrl } from './registry.ts'
import type { WordRequest, WordResponse } from './types.ts'

/**
 * A one-word answer from Ollama's native API (`/api/chat`), with the probabilities of the allowed words. Ollama (0.40)
 * returns token probabilities for the first generated token only, so the question is asked so that the answer's first
 * token is the word itself: no JSON, no reasoning (`think: false`), two tokens at most. The first token's
 * `top_logprobs` then hold the alternatives, and the mass on each allowed word, over the mass on all of them, is what
 * the model would have answered among them.
 */

const TOP_LOGPROBS = 10

interface OllamaChatAnswer {
  model?: string
  message?: { content?: string }
  logprobs?: Array<{ token: string; logprob: number; top_logprobs?: Array<{ token: string; logprob: number }> }>
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

/** A token as a word: lower case, letters only ("Fail", " fail" and "fail." are "fail"). */
export function wordOf(token: string): string {
  return token.toLowerCase().replace(/[^\p{L}]/gu, '')
}

/** The first word of a text, as `wordOf` reads it. */
export function firstWordOf(text: string): string {
  return wordOf(text.trim().split(/\s+/)[0] ?? '')
}

/** The probability of each allowed word at the first token, normalized over the allowed words; undefined when none of them is among the alternatives. */
export function probabilitiesOf(top: ReadonlyArray<{ token: string; logprob: number }>, words: readonly string[]): Record<string, number> | undefined {
  const mass: Record<string, number> = {}
  let total = 0
  for (const { token, logprob } of top) {
    const word = wordOf(token)
    if (!words.includes(word)) continue
    const p = Math.exp(logprob)
    mass[word] = (mass[word] ?? 0) + p
    total += p
  }
  if (total === 0) return undefined
  for (const word of Object.keys(mass)) mass[word] = (mass[word] ?? 0) / total
  return mass
}

export async function ollamaWord(modelId: string, request: WordRequest, fetchImpl: typeof fetch = fetch): Promise<WordResponse> {
  const started = performance.now()
  const images = (request.images ?? []).map((image) => Buffer.from(image.data).toString('base64'))
  const body = {
    model: modelId,
    think: false,
    stream: false,
    logprobs: true,
    top_logprobs: TOP_LOGPROBS,
    options: { temperature: 0, num_predict: 2 },
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user, ...(images.length > 0 ? { images } : {}) },
    ],
  }
  const response = await fetchImpl(`${ollamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(request.signal ? { signal: request.signal } : {}),
  })
  if (!response.ok) throw new Error(`Ollama answered HTTP ${response.status} to the one-word question: ${(await response.text()).slice(0, 200)}`)
  const data = (await response.json()) as OllamaChatAnswer
  if (data.error) throw new Error(`Ollama: ${data.error}`)
  const first = data.logprobs?.[0]
  const word = firstWordOf(data.message?.content ?? '') || wordOf(first?.token ?? '')
  const probabilities = first?.top_logprobs ? probabilitiesOf(first.top_logprobs, request.words) : undefined
  return {
    word,
    ...(probabilities ? { probabilities } : {}),
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
    latencyMs: Math.round(performance.now() - started),
    modelId: data.model ?? modelId,
  }
}
