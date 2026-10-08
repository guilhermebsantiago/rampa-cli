import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { passingEngine, scriptedProvider, travelSnapshot } from './helpers.ts'

const dutchFail = { verdict: 'fail', detectedLanguage: 'nl', evidence: 'Het weer is vandaag mooi', exception: 'none', confidence: 'high' }
const portuguesePass = { verdict: 'pass', detectedLanguage: 'pt', evidence: 'Bem-vindo à feira', exception: 'none', confidence: 'high' }

async function judgedReport() {
  const provider = scriptedProvider({ blockquote: [dutchFail], 'p.sign': [portuguesePass] })
  return checkSnapshot(travelSnapshot(), passingEngine(), {
    criteria: [languageOfParts],
    llm: true,
    provider,
    runs: 1,
    cache: memoryCache(),
    offline: false,
    locale: 'en',
    minConfidence: 'medium',
    concurrency: 1,
  })
}

describe('pretty report', () => {
  it('says what the judgment took: calls, tokens and the estimated price', async () => {
    const report = await judgedReport()
    const text = (model: string, locale: 'en' | 'pt-BR', usage = report.usage) =>
      renderReport({ ...report, model, locale, usage }, { verbose: false, paint: paint(false) })

    expect(text('openai:gpt-6-luna', 'en')).toContain('Model calls: 2 new, 0 from cache · 0.2k in / 0.0k out tokens · < US$ 0.0001')
    const page = { ...report.usage, inputTokens: 3900, outputTokens: 600 }
    expect(text('openai:gpt-6-luna', 'pt-BR', page)).toContain('Chamadas ao modelo: 2 novas, 0 do cache · 3,9 mil tokens de entrada / 0,6 mil de saída · ≈ US$ 0,0007')
    expect(text('ollama:gemma4:12b', 'en')).toContain('· local model, no API cost')
    expect(text('someone:unknown-model', 'en')).toMatch(/0\.0k out tokens\n/)
  })

  it('leaves the line out when no model was called', async () => {
    const report = await judgedReport()
    const usage = { calls: 0, cachedCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }
    expect(renderReport({ ...report, usage }, { verbose: false, paint: paint(false) })).not.toContain('Model calls')
  })
})
