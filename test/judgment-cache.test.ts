import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type CachedJudgment, fileCache, memoryCache } from '../src/core/cache.ts'
import { judgeCandidates } from '../src/core/judge.ts'
import type { Candidate, Criterion, JudgmentBase } from '../src/core/types.ts'
import { createModelProvider, providerIdentity, samplingKey } from '../src/providers/ai-sdk.ts'
import { PROVIDERS } from '../src/providers/registry.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'

const Judgment = z.strictObject({ verdict: z.enum(['pass', 'fail', 'cannot_tell']), evidence: z.string(), confidence: z.enum(['low', 'medium', 'high']) })
const web = { surface: 'web' } as A11ySnapshot

function criterion(changes: Partial<Criterion<{ text: string }, JudgmentBase>> = {}): Criterion<{ text: string }, JudgmentBase> {
  return {
    id: '9.9.9',
    level: 'A',
    version: '1',
    act: [],
    surfaces: ['web'],
    needs: {},
    engineRules: [],
    schema: Judgment,
    candidates: () => [],
    prompt: (candidate) => ({ system: 'Judge one text.', user: `<text>\n${candidate.context.text}\n</text>` }),
    verify: () => ({ ok: true }),
    message: () => '',
    ...changes,
  }
}

function counting(): ModelProvider & { calls: number } {
  const provider = {
    id: 'test:counting',
    settings: 'reasoning=none',
    calls: 0,
    async judge() {
      provider.calls++
      return { output: { verdict: 'pass', evidence: 'x', confidence: 'high' }, inputTokens: 1, outputTokens: 1, latencyMs: 1, modelId: 'counting' }
    },
  }
  return provider as ModelProvider & { calls: number }
}

const text = (value: string, ref = '#x'): Candidate<{ text: string }> => ({ ref, context: { text: value } })

describe('the judgment cache key', () => {
  it('reads a judgment again only for the same criterion version and the same prompt', async () => {
    const cache = memoryCache()
    const provider = counting()
    const judge = (c: Criterion<{ text: string }, JudgmentBase>) => judgeCandidates(c, web, [text('Hello')], { provider, runs: 1, cache, offline: false, concurrency: 1 })
    await judge(criterion())
    expect(provider.calls).toBe(1)
    await judge(criterion())
    expect(provider.calls).toBe(1)
    // A version bump invalidates the criterion's judgments.
    await judge(criterion({ version: '2' }))
    expect(provider.calls).toBe(2)
    // So does an edited prompt, even without a bump: the instructions, or the text a candidate is asked about.
    await judge(criterion({ prompt: () => ({ system: 'Judge one text, strictly.', user: '<text>\nHello\n</text>' }) }))
    expect(provider.calls).toBe(3)
    await judge(criterion({ schema: Judgment.extend({ evidence: z.string().describe('A quote') }) as never }))
    expect(provider.calls).toBe(4)
    // The first ones are still there.
    await judge(criterion())
    await judge(criterion({ version: '2' }))
    expect(provider.calls).toBe(4)
  })

  it('keys a criterion that names a judgment key by the prompt too', async () => {
    // As 1.4.5 does: one key for every copy of a picture, whatever else its prompt says.
    const keyed = criterion({ judgmentKey: () => 'picture:abc' })
    const cache = memoryCache()
    const provider = counting()
    const judge = (candidates: Candidate<{ text: string }>[], c = keyed) => judgeCandidates(c, web, candidates, { provider, runs: 1, cache, offline: false, concurrency: 2 })
    // Two copies asked the same way share one call.
    await judge([text('alt: Summer sale', '#a'), text('alt: Summer sale', '#b')])
    expect(provider.calls).toBe(1)
    // The same key with another prompt is another question.
    await judge([text('alt: Corner Store logo', '#c')])
    expect(provider.calls).toBe(2)
    await judge([text('alt: Summer sale', '#d')], criterion({ judgmentKey: () => 'picture:abc', prompt: () => ({ system: 'Edited.', user: 'alt: Summer sale' }) }))
    expect(provider.calls).toBe(3)
    await judge([text('alt: Summer sale', '#e')])
    expect(provider.calls).toBe(3)
  })
})

describe('the file cache', () => {
  const dirs: string[] = []
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  })
  const entry = (n: number): CachedJudgment => ({ output: { n }, inputTokens: n, outputTokens: n, latencyMs: n, modelId: 'm', createdAt: '2026-10-11T00:00:00.000Z' })

  it('writes each entry whole, through a file renamed into place, and leaves no temporary file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-cache-'))
    dirs.push(dir)
    const cache = fileCache(dir)
    const key = 'ab'.padEnd(64, '0')
    // Writers of the same entry at once: each finishes, and the entry is one of theirs, whole.
    await Promise.all(Array.from({ length: 8 }, (_, n) => cache.set(key, entry(n))))
    const read = await cache.get(key)
    expect(read?.modelId).toBe('m')
    expect(JSON.parse(await readFile(join(dir, 'ab', `${key}.json`), 'utf8'))).toEqual(read)
    await cache.set(key, entry(42))
    expect((await cache.get(key))?.output).toEqual({ n: 42 })
    expect(await readdir(join(dir, 'ab'))).toEqual([`${key}.json`])
  })
})

describe('the provider settings in the key', () => {
  it('stay as they were for what the registry ships', async () => {
    expect(providerIdentity('ollama:gemma4:12b')).toEqual({ id: 'ollama:gemma4:12b', settings: 'reasoning=none' })
    expect(providerIdentity('ollama:gemma4:12b', undefined, { temperature: 0 }).settings).toBe('reasoning=none')
    expect(samplingKey({})).toBe('')
    expect(samplingKey({ providerOptions: { bedrock: { structuredOutputMode: 'jsonTool' } } })).toBe('')
    const ollama = await createModelProvider('ollama:gemma4:12b', { fetch: (() => Promise.reject(new Error('offline'))) as typeof fetch })
    expect(ollama.settings).toBe('reasoning=none')
    // Every provider the registry can create without credentials keys its judgments as before.
    for (const provider of PROVIDERS) {
      const model = await provider.create?.('model', (() => Promise.reject(new Error('offline'))) as typeof fetch).catch(() => undefined)
      if (model) expect(samplingKey(model), provider.id).toBe('')
    }
  })

  it('gain a part for a sampling setting that is not one the registry ships', () => {
    expect(samplingKey({ temperature: 0.7 })).toBe(';temperature=0.7')
    expect(samplingKey({ providerOptions: { openai: { reasoningEffort: 'low' } } })).toBe(';providerOptions={"openai":{"reasoningEffort":"low"}}')
    expect(providerIdentity('ollama:gemma4:12b', undefined, { temperature: 0.7 }).settings).toBe('reasoning=none;temperature=0.7')
  })
})
