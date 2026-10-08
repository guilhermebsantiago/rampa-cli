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
 * semantic rules measure the judgment layer.
 */
export const ACT_RULES: Record<string, { syntax: string[]; semantic: string[] }> = {
  '1.1.1': { syntax: ['23a2a8'], semantic: ['qt1vmo'] },
  '2.4.4': { syntax: ['c487ae'], semantic: ['5effbb', 'fd3a94'] },
  '3.1.2': { syntax: ['de46e4'], semantic: ['off6ek'] },
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

export function selectTestcases(dataset: ActDataset, criterion: string): ActTestcase[] {
  const rules = ACT_RULES[criterion]
  if (!rules) return []
  const wanted = new Set([...rules.syntax, ...rules.semantic])
  return dataset.testcases.filter((tc) => wanted.has(tc.ruleId) && /\.html?$/i.test(tc.url))
}
