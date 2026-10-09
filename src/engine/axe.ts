import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { EngineOutcome, EngineResults, EngineRuleResult } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { InPageResult } from '../surfaces/in-page.ts'
import { DEFAULT_WCAG, type WcagVersion, criterionFromAxeTag } from '../wcag.ts'

const require = createRequire(import.meta.url)

/** WCAG 2.0 and 2.1, levels A and AA. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * The axe-core tags for a WCAG version. 2.2 adds `wcag22aa`; in axe-core 4.14 the only rule it brings
 * is target-size (2.5.8), and no rule carries `wcag22a`. `wcag2a-obsolete` (4.1.1) is never run.
 */
export function axeTags(version: WcagVersion = DEFAULT_WCAG): string[] {
  return version === '2.1' ? [...AXE_TAGS] : [...AXE_TAGS, 'wcag22aa']
}

/**
 * Rules new to Rampa that have not passed the evaluation gate (docs/plans/wcag-coverage.md, 4.9): their
 * findings are reported at low confidence, below the default threshold, until they do.
 */
export const EXPERIMENTAL_RULES: ReadonlySet<string> = new Set(['target-size'])

/**
 * axe-core 4.14 rules that never return a violation: their checks return incomplete instead of a
 * failure (th-has-data-cells, video-caption, form-field-multiple-labels), or the rule turns its
 * failures into incompletes (reviewOnFail: bypass, no-autoplay-audio, duplicate-id-aria). A criterion
 * they alone touched needs review; it was not checked.
 */
export const REVIEW_ONLY_RULES: ReadonlySet<string> = new Set([
  'th-has-data-cells',
  'video-caption',
  'form-field-multiple-labels',
  'bypass',
  'no-autoplay-audio',
  'duplicate-id-aria',
])

let source: Promise<string> | undefined

export function axeSource(): Promise<string> {
  source ??= readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
  return source
}

export async function axeLocale(locale: Locale): Promise<unknown> {
  if (locale !== 'pt-BR') return undefined
  try {
    return JSON.parse(await readFile(require.resolve('axe-core/locales/pt_BR.json'), 'utf8'))
  } catch {
    return undefined
  }
}

export function engineFromAxe(axe: NonNullable<InPageResult['axe']>): EngineResults {
  const rules: EngineRuleResult[] = []
  const groups: Array<[EngineOutcome, typeof axe.violations]> = [
    ['violation', axe.violations],
    ['incomplete', axe.incomplete],
    ['pass', axe.passes],
    ['inapplicable', axe.inapplicable],
  ]
  for (const [outcome, list] of groups) {
    for (const rule of list) {
      rules.push({
        ruleId: rule.id,
        outcome,
        criteria: [...new Set(rule.tags.flatMap((tag) => criterionFromAxeTag(tag) ?? []))],
        help: rule.help,
        helpUrl: rule.helpUrl,
        impact: rule.impact,
        nodes: rule.nodes,
      })
    }
  }
  return { engine: { name: 'axe-core', version: axe.version }, rules }
}

export function emptyEngine(name = 'none'): EngineResults {
  return { engine: { name, version: '0' }, rules: [] }
}
