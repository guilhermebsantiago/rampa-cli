import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { EngineOutcome, EngineResults, EngineRuleResult } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { InPageResult } from '../surfaces/in-page.ts'
import { criterionFromAxeTag } from '../wcag.ts'

const require = createRequire(import.meta.url)

/** WCAG 2.0 and 2.1, levels A and AA. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * Experimental axe-core rules for 1.3.1 that a tag run leaves out. They run in the same axe-core run,
 * and what they report is needs review only: below the threshold, never a failure on its own.
 * p-as-heading, which the plan also named, is left out: on real pages it flagged verdict words and
 * statistics, never a heading (docs/rules.md).
 */
export const AXE_REVIEW_RULES = ['td-has-header', 'table-fake-caption']

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
