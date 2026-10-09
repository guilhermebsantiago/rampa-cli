import type { DictionarySource } from '../src/advisory/abbreviations/dictionaries.ts'
import { Hunspell } from '../src/advisory/abbreviations/hunspell.ts'
import type { CogaSettings } from '../src/advisory/check.ts'
import { type ProfileOptions, runProfiles } from '../src/advisory/profile.ts'
import type { AdvisorySection } from '../src/advisory/types.ts'
import { memoryCache } from '../src/core/cache.ts'
import type { EngineResults } from '../src/core/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'

/**
 * Small Hunspell dictionaries in the real format, so the tests never download the real ones: a few words
 * the fixtures write in capitals, a suffix rule (serviço/S gives SERVIÇOS) and an acronym entry (NASA),
 * which must not make its capitals a word.
 */
const PT_AFF = `SET UTF-8
FLAG UTF-8
SFX S Y 2
SFX S 0 s [aeiou]
SFX S ão ões ão
`
const PT_DIC = `10
entrar
enviar
ou
atenção/S
importante/S
serviço/S
buscar
Brasil
NASA
sus
`
const EN_AFF = `SET UTF-8
SFX S Y 1
SFX S 0 s .
`
const EN_DIC = `7
submit
search
apply
now
it
OK
NASA
`

export const testDictionaries: DictionarySource = async (language) => (language === 'pt-BR' ? new Hunspell(PT_AFF, PT_DIC) : new Hunspell(EN_AFF, EN_DIC))

export const noEngine: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

/** The cognitive profile on a snapshot, as checkSnapshot runs it, with the test dictionaries and no model. */
export async function profileOf(snapshot: A11ySnapshot, options: Partial<ProfileOptions> & { coga?: CogaSettings; engine?: EngineResults } = {}): Promise<AdvisorySection> {
  const { section } = await runProfiles(snapshot, options.engine ?? noEngine, {
    profiles: ['cognitive'],
    locale: 'en',
    findings: [],
    llm: false,
    provider: undefined,
    offline: false,
    cache: memoryCache(),
    runs: 1,
    concurrency: 2,
    minConfidence: 'low',
    ...options,
    coga: { dictionaries: testDictionaries, ...options.coga },
  })
  return section
}
