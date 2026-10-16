import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { providerIdentity } from '../src/providers/ai-sdk.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { noEngine, testDictionaries } from './coga-helpers.ts'
import { node } from './helpers.ts'

// End to end through the real CLI: the cognitive profile's checks that a model decides, with no model at all
// (--no-llm), and replayed from a judgment cache written beforehand by a stub that answers as a model would (--offline,
// so the CLI never calls one). No browser, no network.
const CLI = resolve('src/cli.ts')
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('RAMPA_')))

function rampa(cwd: string, ...args: string[]) {
  // The locale and the model are pinned, so the run reads the same on any machine.
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' } })
  return { code: run.status, out: run.stdout, err: run.stderr }
}

function snapshot(): A11ySnapshot {
  const button = node({ ref: 'button', role: 'button', name: 'Get the ball rolling', text: 'Get the ball rolling', native: { tag: 'button', attributes: { type: 'submit' }, html: '<button type="submit">' } })
  const heading = node({ ref: 'h1', role: 'heading', text: 'Set up your account', native: { tag: 'h1', attributes: {}, html: '<h1>' } })
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'test://setup',
    title: 'Set up your account',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-15T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    // Cut by the collector, so the abbreviation check stops before it would download a dictionary: no network here.
    truncated: true,
    root: node({ ref: 'html', role: 'document', lang: 'en', native: { tag: 'html' }, children: [node({ ref: 'body', native: { tag: 'body' }, children: [heading, button] as A11yNode[] })] }),
  }
}

describe('rampa check --profile cognitive, with the checks a model decides', { timeout: 120_000 }, () => {
  it('says they did not run with --no-llm, and reports their suggestions without changing the exit code, even under --fail-on advisory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rampa-coga-model-'))
    await writeFile(join(dir, 'setup.snapshot.json'), JSON.stringify(snapshot()))
    await writeFile(join(dir, 'setup.engine.json'), JSON.stringify(noEngine))
    await writeFile(join(dir, 'package.json'), '{"type":"module"}\n')

    const off = rampa(dir, 'check', 'setup.snapshot.json', '--no-llm', '--profile', 'cognitive', '-f', 'json')
    expect(off.code).toBe(0)
    const plain = JSON.parse(off.out) as Report
    for (const check of ['coga/literal-language', 'coga/long-text-summary', 'coga/error-wording']) {
      expect(plain.advisory?.checks.find((summary) => summary.check === check)).toMatchObject({ ran: false, reason: 'this check needs a model, and --no-llm turned the model off' })
    }
    expect(rampa(dir, 'check', 'setup.snapshot.json', '--no-llm', '--profile', 'cognitive').out).toContain(
      'o3p04 idioms and metaphors in interface text, read by a model, o4p04 whether error messages say how to put the problem right, read by a model, o3p08 a summary at the start of long text, read by a model (this check needs a model, and --no-llm turned the model off)',
    )

    // The cache the CLI reads by default, written as a run with this model would write it.
    const model = {
      ...providerIdentity('ollama:gemma4:12b'),
      async judge<T>(request: { user: string; schema: { parse(value: unknown): T } }) {
        const text = /<text>([\s\S]*?)<\/text>/.exec(request.user)?.[1] ?? ''
        const idiom = text === 'Get the ball rolling'
        const output = idiom
          ? { kind: 'idiom', expression: 'Get the ball rolling', meaning: 'Start', verdict: 'fail', evidence: text, confidence: 'high' }
          : { kind: 'literal', expression: '', meaning: '', verdict: 'pass', evidence: text, confidence: 'high' }
        return { output: request.schema.parse(output), inputTokens: 10, outputTokens: 5, latencyMs: 1, modelId: 'gemma4:12b' }
      },
    }
    await checkSnapshot(snapshot(), noEngine, {
      criteria: [],
      llm: true,
      provider: model,
      runs: 1,
      cache: fileCache(join(dir, '.rampa/cache')),
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 2,
      profiles: ['cognitive'],
      coga: { dictionaries: testDictionaries },
    })

    const replay = ['check', 'setup.snapshot.json', '--offline', '--model', 'ollama:gemma4:12b', '--criteria', '1.4.5', '--profile', 'cognitive']
    for (const policy of ['confirmed', 'any', 'AA', 'advisory']) expect({ policy, code: rampa(dir, ...replay, '--fail-on', policy, '-f', 'json').code }).toEqual({ policy, code: 0 })
    const report = JSON.parse(rampa(dir, ...replay, '--fail-on', 'advisory', '-f', 'json').out) as Report
    expect(report.advisory?.results).toMatchObject([
      { check: 'coga/literal-language', ref: 'button', subject: 'Get the ball rolling', impact: 'suggestion', review: true, source: 'judgment', model: 'ollama:gemma4:12b', facts: { expression: 'Get the ball rolling', meaning: 'Start' } },
    ])
    const pretty = rampa(dir, ...replay, '--fail-on', 'advisory')
    expect(pretty.code).toBe(0)
    expect(pretty.out).toContain('◇ Advisory · COGA o3p04 Use Literal Language (not a WCAG requirement) · suggestion')
    expect(pretty.out).toContain("a model's suggestion to review (ollama:gemma4:12b), its quote checked on the page; it never changes the exit code")
    const sarif = JSON.parse(rampa(dir, ...replay, '--fail-on', 'advisory', '-f', 'sarif').out) as { runs: Array<{ results: Array<{ level: string; properties: Record<string, unknown> }> }> }
    expect(sarif.runs[0]?.results.map((result) => [result.level, result.properties.review])).toEqual([['note', true]])
  })
})
