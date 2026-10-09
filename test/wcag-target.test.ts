import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import type { EngineResults, Report } from '../src/core/types.ts'
import { exitCode } from '../src/cli/exit-code.ts'
import { AXE_TAGS, axeTags } from '../src/engine/axe.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { renderMarkdown } from '../src/report/markdown.ts'
import { WCAG21_A_AA, WCAG22_A_AA, WCAG_CRITERIA, beyondTarget, criteriaFor, criterionFromAxeTag, parseWcagVersion, successCriterion } from '../src/wcag.ts'
import { travelSnapshot } from './helpers.ts'

const NEW_IN_22 = ['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8']

function options(extra: Partial<CheckOptions> = {}): CheckOptions {
  return { criteria: [], llm: false, provider: undefined, runs: 1, cache: memoryCache(), offline: false, locale: 'en', minConfidence: 'medium', concurrency: 1, ...extra }
}

/** One passing rule per criterion family, plus a target-size violation on the two links of the travel page. */
function engine(): EngineResults {
  return {
    engine: { name: 'axe-core', version: 'test' },
    rules: [
      { ruleId: 'valid-lang', outcome: 'pass', criteria: ['3.1.2'], help: 'lang must be valid', nodes: [{ ref: 'blockquote', target: '["blockquote"]', html: '<blockquote lang="es">' }] },
      {
        ruleId: 'target-size',
        outcome: 'violation',
        criteria: ['2.5.8'],
        help: 'All touch targets must be 24px large, or leave sufficient space',
        nodes: [{ ref: 'p.sign', target: '["p.sign"]', html: '<p class="sign">', confidence: 'high' }],
      },
    ],
  }
}

describe('the WCAG criteria table', () => {
  it('lists 50 criteria for WCAG 2.1, with 4.1.1, and 55 for WCAG 2.2, without it', () => {
    expect(WCAG_CRITERIA).toHaveLength(56)
    expect(criteriaFor('2.1')).toBe(WCAG21_A_AA)
    expect(WCAG21_A_AA).toHaveLength(50)
    expect(WCAG22_A_AA).toHaveLength(55)
    expect(WCAG21_A_AA.map((sc) => sc.id)).toContain('4.1.1')
    expect(WCAG22_A_AA.map((sc) => sc.id)).not.toContain('4.1.1')
    expect(WCAG_CRITERIA.filter((sc) => sc.since === '2.2').map((sc) => sc.id)).toEqual(NEW_IN_22)
    for (const id of NEW_IN_22) {
      expect(WCAG21_A_AA.some((sc) => sc.id === id)).toBe(false)
      expect(beyondTarget(id, '2.1')).toBe(true)
      expect(beyondTarget(id, '2.2')).toBe(false)
    }
    expect(successCriterion('2.5.8')).toMatchObject({ level: 'AA', name: { en: 'Target Size (Minimum)', 'pt-BR': 'Tamanho do alvo (mínimo)' } })
    expect(successCriterion('3.2.6')?.level).toBe('A')
  })

  it('names every criterion and what stays manual in English and Portuguese', () => {
    for (const sc of WCAG_CRITERIA) {
      expect(sc.name.en.length, sc.id).toBeGreaterThan(3)
      expect(sc.name['pt-BR'].length, sc.id).toBeGreaterThan(3)
      expect(sc.manual.en.length, sc.id).toBeGreaterThan(10)
      expect(sc.manual['pt-BR'].length, sc.id).toBeGreaterThan(10)
    }
    expect(new Set(WCAG_CRITERIA.map((sc) => sc.id)).size).toBe(56)
  })

  it('reads the version from --wcag and the config', () => {
    expect(parseWcagVersion('2.2')).toBe('2.2')
    expect(parseWcagVersion('2.1')).toBe('2.1')
    expect(parseWcagVersion('wcag22-aa')).toBe('2.2')
    expect(parseWcagVersion('21')).toBe('2.1')
    expect(parseWcagVersion('2.0')).toBeUndefined()
    expect(parseWcagVersion(undefined)).toBeUndefined()
  })
})

describe('axe-core tags by version', () => {
  const axe = createRequire(import.meta.url)('axe-core') as { getRules(tags?: string[]): Array<{ ruleId: string; tags: string[] }> }
  const enabled = (tags: string[]) => {
    // getRules lists deprecated and experimental rules too; a tag run leaves those out, as axe.run does.
    return axe.getRules(tags).filter((rule) => !rule.tags.includes('deprecated') && !rule.tags.includes('experimental'))
  }

  it('adds wcag22aa only under 2.2, never the obsolete 4.1.1 tag', () => {
    expect(axeTags('2.1')).toEqual(AXE_TAGS)
    expect(axeTags('2.2')).toEqual([...AXE_TAGS, 'wcag22aa'])
    expect(axeTags()).toEqual(axeTags('2.2'))
    for (const version of ['2.1', '2.2'] as const) expect(axeTags(version)).not.toContain('wcag2a-obsolete')
  })

  it('brings in only target-size with wcag22aa, and no rule carries wcag22a', () => {
    const added = enabled(['wcag22aa']).map((rule) => rule.ruleId)
    expect(added).toEqual(['target-size'])
    expect(enabled(['wcag22a'])).toEqual([])
  })

  it('runs no rule that maps to 4.1.1 under either version', () => {
    for (const version of ['2.1', '2.2'] as const) {
      const criteria = enabled(axeTags(version)).flatMap((rule) => rule.tags.flatMap((tag) => criterionFromAxeTag(tag) ?? []))
      expect(criteria).not.toContain('4.1.1')
    }
  })
})

describe('the target of a report', () => {
  it('states coverage against 55 criteria by default and 50 under --wcag 2.1, never counting 4.1.1', async () => {
    const latest = await checkSnapshot(travelSnapshot(), engine(), options())
    expect(latest.wcagTarget).toBe('wcag22-aa')
    expect(latest.coverage.notChecked).not.toContain('4.1.1')
    expect(latest.coverage.notChecked).toContain('2.4.11')
    expect(latest.coverage.engine).toEqual(['2.5.8', '3.1.2'])
    expect(latest.coverage.engine.length + latest.coverage.notChecked.length).toBe(55)

    const older = await checkSnapshot(travelSnapshot(), engine(), options({ wcag: '2.1' }))
    expect(older.wcagTarget).toBe('wcag21-aa')
    expect(older.coverage.notChecked).not.toContain('4.1.1')
    expect(older.coverage.notChecked).not.toContain('2.4.11')
    expect(older.coverage.engine).toEqual(['3.1.2'])
    // 4.1.1 is in the denominator, satisfied by definition, and in none of the lists.
    expect(older.coverage.engine.length + older.coverage.notChecked.length).toBe(49)
  })

  it('reports a WCAG 2.2 finding beyond a 2.1 target, out of the findings and the exit code', async () => {
    const older = await checkSnapshot(travelSnapshot(), engine(), options({ wcag: '2.1', minConfidence: 'low' }))
    expect(older.findings).toEqual([])
    expect(older.belowThreshold).toEqual([])
    expect(older.beyondTarget?.map((f) => f.criterion)).toEqual(['2.5.8'])
    expect(exitCode([older], 'any')).toBe(0)
    const text = renderReport(older, { verbose: false, paint: paint(false) })
    expect(text).toContain("1 finding(s) on WCAG 2.2 criteria beyond this run's WCAG 2.1 target, not counted: 2.5.8 (1).")

    const latest = await checkSnapshot(travelSnapshot(), engine(), options({ minConfidence: 'low' }))
    expect(latest.beyondTarget).toBeUndefined()
    expect(latest.findings.map((f) => [f.criterion, f.level])).toEqual([['2.5.8', 'AA']])
  })

  it('words the target and 4.1.1 in each version and language', async () => {
    const render = (report: Report) => renderReport(report, { verbose: false, paint: paint(false) })
    const cases: Array<[CheckOptions['wcag'], CheckOptions['locale'], string[]]> = [
      ['2.2', 'en', ['WCAG 2.2 A/AA', 'of 55 WCAG 2.2 A/AA criteria', '4.1.1 Parsing is not listed: WCAG 2.2 removed it.']],
      ['2.1', 'en', ['WCAG 2.1 A/AA', 'of 50 WCAG 2.1 A/AA criteria', '4.1.1 Parsing is satisfied by definition for HTML and XML (WCAG 2.1, Note 1)']],
      ['2.2', 'pt-BR', ['de 55 critérios WCAG 2.2 A/AA', '4.1.1 Análise sintática não é listado: a WCAG 2.2 o removeu.']],
      ['2.1', 'pt-BR', ['de 50 critérios WCAG 2.1 A/AA', '4.1.1 Análise sintática é satisfeito por definição']],
    ]
    for (const [wcag, locale, expected] of cases) {
      const report = await checkSnapshot(travelSnapshot(), engine(), options({ wcag, locale }))
      const text = render(report)
      for (const line of expected) expect(text, `${wcag} ${locale}`).toContain(line)
      expect(text).toContain(locale === 'en' ? 'This report does not declare the page accessible.' : 'Este relatório não declara a página acessível.')
      const markdown = renderMarkdown([report])
      expect(markdown).toContain(`WCAG ${wcag} A/AA`)
    }
  })
})

describe('rampa check --wcag', { timeout: 60_000 }, () => {
  const recorded = ['demo/recorded/examples-store-before.snapshot.json', '--offline', '--cache-dir', 'demo/recorded/cache', '--model', 'ollama:gemma4:12b']
  const rampa = (...args: string[]) =>
    spawnSync(process.execPath, ['src/cli.ts', 'check', ...recorded, '--format', 'json', ...args], {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', RAMPA_LOCALE: 'en', RAMPA_MODEL: '' },
    })

  it('records the target in the report, 2.2 unless asked for 2.1, and rejects other versions', () => {
    const latest = JSON.parse(rampa().stdout) as Report
    expect(latest.wcagTarget).toBe('wcag22-aa')
    const older = JSON.parse(rampa('--wcag', '2.1').stdout) as Report
    expect(older.wcagTarget).toBe('wcag21-aa')
    // The six 2.2-only criteria leave the list; 4.1.1 was never on it.
    expect(older.coverage.notChecked.length).toBe(latest.coverage.notChecked.length - 6)
    const wrong = rampa('--wcag', '3.0')
    expect(wrong.status).not.toBe(0)
    expect(wrong.stderr).toContain('--wcag')
  })
})
