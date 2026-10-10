import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RampaError, errorMessage, sha256 } from '../core/util.ts'

export const ACT_TESTCASES_URL = 'https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases.json'

export type ActOutcome = 'passed' | 'failed' | 'inapplicable'

export interface ActTestcase {
  ruleId: string
  ruleName: string
  testcaseId: string
  testcaseTitle: string
  expected: ActOutcome
  url: string
}

/**
 * ACT rules used as gold data per criterion. Syntax rules measure the engine;
 * semantic rules measure the judgment layer. The passed cases of the `pairs` rules
 * (the semantic rules when not set) are the intact half of the corrupted pairs.
 */
export const ACT_RULES: Record<string, { syntax: string[]; semantic: string[]; pairs?: string[] }> = {
  // e88epe: an image hidden from assistive technology is decorative. 1.1.1 asks it as its own question, so its
  // cases are scored by that question's judgments, and 23a2a8's and qt1vmo's by the alternative's (Criterion.actFor).
  '1.1.1': { syntax: ['23a2a8'], semantic: ['qt1vmo', 'e88epe'] },
  // No ACT rule judges whether a field that has no token should have one; the fields of 73f2c2's
  // passing cases, each with a valid token for what it asks, become pairs when the token goes.
  '1.3.5': { syntax: ['73f2c2'], semantic: [], pairs: ['73f2c2'] },
  '1.4.5': { syntax: [], semantic: ['0va7u6'] },
  '2.4.2': { syntax: ['2779a5'], semantic: ['c4a8a4'] },
  // fd3a94 compares links with identical names and context: Rampa states, as a fact, where each one leads.
  '2.4.4': { syntax: ['c487ae'], semantic: ['5effbb', 'fd3a94'] },
  '2.4.6': { syntax: [], semantic: ['b49b2e', 'cc0f0a'] },
  '3.1.1': { syntax: ['b5c3f8', 'bf051a'], semantic: ['ucwvc8'] },
  '3.1.2': { syntax: ['de46e4'], semantic: ['off6ek'] },
  // No ACT rule covers 3.3.2. cc0f0a's passing pages have visible labels; with each label moved
  // into aria-label, screen readers still get the name but nothing on screen says what to enter.
  '3.3.2': { syntax: [], semantic: [], pairs: ['cc0f0a'] },
  // 36b590 (proposed) judges error messages a form already shows: does each let a person tell which field is in error and what is wrong?
  '3.3.1': { syntax: [], semantic: ['36b590'] },
}

export interface ActDataset {
  testcases: ActTestcase[]
  sha256: string
  path: string
}

/** The file is downloaded at run time, never redistributed; its hash goes into every run. */
export async function loadActTestcases(dir: string, refresh: boolean): Promise<ActDataset> {
  const path = join(dir, 'testcases.json')
  let text: string | undefined
  if (!refresh) text = await readFile(path, 'utf8').catch(() => undefined)
  if (text === undefined) {
    try {
      const response = await fetch(ACT_TESTCASES_URL, { signal: AbortSignal.timeout(60_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      text = await response.text()
    } catch (error) {
      throw new RampaError('act-download', `Could not download the ACT test cases from ${ACT_TESTCASES_URL}: ${errorMessage(error)}`)
    }
    await mkdir(dir, { recursive: true })
    await writeFile(path, text, 'utf8')
  }
  const data = JSON.parse(text) as { testcases: ActTestcase[] }
  return { testcases: data.testcases, sha256: sha256(text), path }
}

/**
 * The test cases of ACT rules a Rampa rule (src/rules) lists, for the eval path with no model.
 * ACT publishes some pages twice, under WCAG 2.1 and 2.2 copies of a rule: each URL is kept once.
 * A rule for a stricter requirement (`passedOnly`, such as 09o5cg's 7:1 for a 4.5:1 rule) lends only the
 * pages it does not fail: its failed examples may meet the weaker requirement.
 */
export function selectRuleTestcases(dataset: ActDataset, actRules: readonly string[], passedOnly: readonly string[] = []): ActTestcase[] {
  const seen = new Set<string>()
  return dataset.testcases.filter((tc) => {
    if (!actRules.includes(tc.ruleId) || !/\.html?$/i.test(tc.url) || seen.has(tc.url)) return false
    if (passedOnly.includes(tc.ruleId) && tc.expected === 'failed') return false
    seen.add(tc.url)
    return true
  })
}

export function selectTestcases(dataset: ActDataset, criterion: string): ActTestcase[] {
  const rules = ACT_RULES[criterion]
  if (!rules) return []
  const wanted = new Set([...rules.syntax, ...rules.semantic, ...(rules.pairs ?? [])])
  return dataset.testcases.filter((tc) => wanted.has(tc.ruleId) && /\.html?$/i.test(tc.url))
}
