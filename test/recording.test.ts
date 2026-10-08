import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { providerIdentity } from '../src/providers/ai-sdk.ts'
import { loadEngineFor, recordingName } from '../src/surfaces/targets.ts'

describe('recordings', () => {
  it('names a recording after its target', () => {
    expect(recordingName('examples/store/before.html')).toBe('examples-store-before')
    expect(recordingName('https://example.com/pt/loja/')).toBe('example-com-pt-loja')
  })

  it('finds the engine results recorded next to a snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-'))
    const engine = { engine: { name: 'axe-core', version: '4.14.0' }, rules: [] }
    await writeFile(join(dir, 'page.engine.json'), JSON.stringify(engine))
    expect(await loadEngineFor(join(dir, 'page.snapshot.json'))).toEqual(engine)
    expect(await loadEngineFor(join(dir, 'missing.snapshot.json'))).toBeUndefined()
  })
})

describe('provider identity', () => {
  it('is the same for live and offline runs, so recorded judgments replay', () => {
    expect(providerIdentity('ollama:gemma4:12b')).toEqual({ id: 'ollama:gemma4:12b', settings: 'reasoning=none' })
    expect(providerIdentity('Anthropic:claude-haiku-5-5')).toEqual({ id: 'anthropic:claude-haiku-5-5', settings: 'reasoning=provider-default' })
    expect(providerIdentity('ollama:gemma4:12b', 'low').settings).toBe('reasoning=low')
  })
})
