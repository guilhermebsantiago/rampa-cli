import type { EngineResults } from '../src/core/types.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'

export function node(partial: Partial<A11yNode> & { ref: string }): A11yNode {
  return { role: 'generic', states: [], native: {}, children: [], ...partial }
}

/** A page in English with a Dutch passage marked as Spanish and a correct Portuguese one. */
export function travelSnapshot(): A11ySnapshot {
  const dutch = 'Welkom in Amsterdam! Het weer is vandaag mooi en zonnig.'
  const portuguese = 'Bem-vindo à feira! Aproveite as frutas da estação.'
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://travel',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-07T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'en',
      children: [
        node({
          ref: 'html > body',
          children: [
            node({
              ref: 'blockquote',
              role: 'blockquote',
              lang: 'es',
              native: { tag: 'blockquote', html: `<blockquote lang="es"><p>${dutch}</p></blockquote>`, langText: dutch },
              children: [node({ ref: 'blockquote > p', role: 'paragraph', text: dutch })],
            }),
            node({
              ref: 'p.sign',
              role: 'paragraph',
              lang: 'pt-BR',
              text: portuguese,
              native: { tag: 'p', html: `<p class="sign" lang="pt-BR">${portuguese}</p>`, langText: portuguese },
            }),
          ],
        }),
      ],
    }),
  }
}

export function passingEngine(): EngineResults {
  return {
    engine: { name: 'axe-core', version: 'test' },
    rules: [
      {
        ruleId: 'valid-lang',
        outcome: 'pass',
        criteria: ['3.1.2'],
        help: 'lang attribute must have a valid value',
        nodes: [
          { ref: 'blockquote', target: '["blockquote"]', html: '<blockquote lang="es">' },
          { ref: 'p.sign', target: '["p.sign"]', html: '<p class="sign" lang="pt-BR">' },
        ],
      },
    ],
  }
}

/** Answers from a script keyed by candidate ref; each call consumes the next answer. */
export function scriptedProvider(script: Record<string, unknown[]>): ModelProvider & { calls: number } {
  const queues = new Map(Object.entries(script).map(([ref, answers]) => [ref, [...answers]]))
  const provider = {
    id: 'test:scripted',
    calls: 0,
    async judge<T>(request: { user: string; schema: { parse(value: unknown): T } }) {
      provider.calls++
      const ref = [...queues.keys()].find((key) => request.user.includes(key === 'blockquote' ? 'lang="es"' : 'lang="pt-BR"'))
      const answer = ref ? queues.get(ref)?.shift() : undefined
      if (answer === undefined) throw new Error('script exhausted')
      return { output: request.schema.parse(answer), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'scripted' }
    },
  }
  return provider
}
