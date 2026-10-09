import { describe, expect, it } from 'vitest'
import { COGA_PATTERNS, cogaBasis } from '../src/advisory/coga.ts'
import { advisoryLabel } from '../src/advisory/label.ts'
import { ADVISORY_MESSAGES, ERROR_LABEL, FAILURE_WORDING } from '../src/advisory/messages.ts'
import type { Advisory } from '../src/advisory/types.ts'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { LOCALES, type Locale } from '../src/i18n.ts'
import { paint } from '../src/report/color.ts'
import { renderReport } from '../src/report/pretty.ts'
import { testDictionaries } from './coga-helpers.ts'
import { cadastroSnapshot } from './coga-snapshot.ts'

/**
 * An advisory must never read as a WCAG failure (docs/plans/cognitive-profile.md §2.4): no "fail",
 * "violation", "does not conform", "falha", "viola", "não conforme", "reprovado", and no "error" or
 * "erro" used as a label. The words checked here are every template, every label and every advisory the
 * checks write, with the page's own text (what sits between quotes) taken out first.
 */

/** A text with the page's words removed: quoted text, guillemets, and the slots of a template. */
function ownWords(text: string): string {
  return text
    .replace(/"[^"]*"/g, '""')
    .replace(/«[^»]*»/g, '«»')
    .replace(/\{\w+\}/g, '')
}

function expectNoFailureWording(text: string, where: string): void {
  const own = ownWords(text)
  expect({ where, match: FAILURE_WORDING.exec(own)?.[0] }).toEqual({ where, match: undefined })
  expect({ where, match: ERROR_LABEL.exec(own)?.[0] }).toEqual({ where, match: undefined })
}

async function reportIn(locale: Locale, target?: string): Promise<Report> {
  return checkSnapshot(cadastroSnapshot(target), { engine: { name: 'axe-core', version: 'test' }, rules: [] }, {
    criteria: [],
    llm: false,
    provider: undefined,
    runs: 1,
    cache: memoryCache(),
    offline: false,
    locale,
    minConfidence: 'low',
    concurrency: 2,
    profiles: ['cognitive'],
    coga: { dictionaries: testDictionaries },
  })
}

describe('advisory wording', () => {
  it('has no failure wording in any template, in English or Portuguese', () => {
    for (const locale of LOCALES) {
      for (const [key, template] of Object.entries(ADVISORY_MESSAGES[locale])) expectNoFailureWording(template, `${locale} ${key}`)
    }
  })

  it('catches the words it bans', () => {
    for (const text of ['This field fails WCAG', 'a violation of', 'does not conform', 'O campo falha', 'viola a regra', 'não conforme', 'reprovado']) {
      expect(FAILURE_WORDING.test(ownWords(text))).toBe(true)
    }
    expect(ERROR_LABEL.test('Error: the field')).toBe(true)
    expect(ERROR_LABEL.test('◇ Advisory · Erro: campo')).toBe(true)
    expect(ERROR_LABEL.test('makes the task harder or more error-prone')).toBe(false)
    // Words quoted from the page are the page's, not Rampa's.
    expect(FAILURE_WORDING.test(ownWords('The option "Falha no pagamento" is checked'))).toBe(false)
  })

  it('labels every pattern as not a WCAG requirement, from code', () => {
    for (const locale of LOCALES) {
      for (const pattern of COGA_PATTERNS) {
        const label = advisoryLabel(cogaBasis(pattern.id, 'use', ''), locale)
        expect(label).toContain(locale === 'en' ? '(not a WCAG requirement)' : '(não é requisito da WCAG)')
        expectNoFailureWording(label, `${locale} ${pattern.id}`)
      }
    }
  })

  it('writes every advisory of the checks without failure wording, and without a WCAG level on a COGA basis', async () => {
    for (const locale of LOCALES) {
      for (const target of ['https://servicos.exemplo.gov.br/cadastro', 'https://loja.exemplo.com/cadastro']) {
        const report = await reportIn(locale, target)
        const advisories: Advisory[] = [...(report.advisory?.results ?? []), ...(report.advisory?.belowThreshold ?? [])]
        expect(advisories.length).toBeGreaterThanOrEqual(5)
        for (const advisory of advisories) {
          expectNoFailureWording(advisory.message, `${locale} ${advisory.check} message`)
          expectNoFailureWording(advisory.label, `${locale} ${advisory.check} label`)
          if (advisory.basis.framework === 'coga') expect('level' in advisory.basis).toBe(false)
        }
        for (const note of report.advisory?.notes ?? []) expectNoFailureWording(note, `${locale} note`)
      }
    }
  })

  it('never marks an advisory with the ✗ of a failure', async () => {
    for (const locale of LOCALES) {
      const pretty = renderReport(await reportIn(locale), { verbose: true, paint: paint(false) })
      expect(pretty).not.toContain('✗')
      expect(pretty).toContain('◇')
    }
  })
})
