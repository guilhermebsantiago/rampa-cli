// The test cases: W3C ACT test cases mapped to WCAG 2.2 A/AA criteria, and Rampa's corrupted pairs.
// Everything about the ACT file, the pairs and the WCAG list comes from Rampa's own build (dist/eval/index.mjs),
// so the benchmark reads the same cases `rampa eval` reads.
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, compareIds } from './env.mjs'

export async function rampaEval() {
  const path = join(ROOT, 'dist', 'eval', 'index.mjs')
  if (!existsSync(path)) throw new Error(`${path} is missing: run pnpm install and pnpm build at the repository root first`)
  return import(pathToFileURL(path).href)
}

/**
 * Rules left out although they map to an A/AA criterion: their test cases need a step no tool here can take.
 * Each reason is printed in the results and in docs/benchmark.md.
 */
export const SKIPPED_RULES = {
  c249d5: 'Device motion (2.5.4): the outcome depends on moving or shaking the device; a desktop browser has no motion sensor, and no tool here fires DeviceMotion or DeviceOrientation events.',
  '7677a9': 'Device motion (2.5.4): the outcome depends on moving or shaking the device; a desktop browser has no motion sensor, and no tool here fires DeviceMotion or DeviceOrientation events.',
}

/** Criteria of a rule that a failed test case fails for conformance: `forConformance` WCAG 2.x requirements at A or AA. */
function conformanceCriteria(testcase, inScope) {
  const ids = new Set()
  for (const [key, value] of Object.entries(testcase.ruleAccessibilityRequirements ?? {})) {
    const match = /^wcag2\d?:(\d+\.\d+\.\d+)$/.exec(key)
    if (match && value?.forConformance && inScope.has(match[1])) ids.add(match[1])
  }
  return [...ids].sort(compareIds)
}

export async function loadCases({ refresh = false } = {}) {
  const ev = await rampaEval()
  const dataset = await ev.loadActTestcases(join(ROOT, '.rampa', 'act'), refresh)
  const raw = JSON.parse(await readFile(dataset.path, 'utf8'))
  const inScope = new Set(ev.WCAG22_A_AA.map((sc) => sc.id))
  const levels = Object.fromEntries(ev.WCAG22_A_AA.map((sc) => [sc.id, sc.level]))
  const names = Object.fromEntries(ev.WCAG22_A_AA.map((sc) => [sc.id, sc.name.en]))

  const rules = new Map()
  for (const testcase of raw.testcases) {
    const rule = rules.get(testcase.ruleId) ?? {
      ruleId: testcase.ruleId,
      ruleName: testcase.ruleName,
      criteria: conformanceCriteria(testcase, inScope),
      otherRequirements: Object.keys(testcase.ruleAccessibilityRequirements ?? {}),
      cases: [],
    }
    rules.set(testcase.ruleId, rule)
    rule.cases.push(testcase)
  }

  const cases = []
  const excluded = { noCriterion: [], skipped: [], notHtml: 0 }
  for (const rule of rules.values()) {
    if (rule.criteria.length === 0) {
      excluded.noCriterion.push({ ruleId: rule.ruleId, ruleName: rule.ruleName, requirements: rule.otherRequirements, cases: rule.cases.length })
      continue
    }
    if (SKIPPED_RULES[rule.ruleId]) {
      excluded.skipped.push({ ruleId: rule.ruleId, ruleName: rule.ruleName, criteria: rule.criteria, cases: rule.cases.length, reason: SKIPPED_RULES[rule.ruleId] })
      continue
    }
    for (const testcase of rule.cases) {
      // Rampa's eval loads only HTML documents; the few SVG and XML cases are left out for every tool alike.
      if (!/\.html?$/i.test(testcase.url)) {
        excluded.notHtml++
        continue
      }
      cases.push({
        // A test case id is a hash of its content: the same page can be a test case of two rules, at two URLs.
        id: `act:${rule.ruleId}:${testcase.testcaseId}`,
        testcaseId: testcase.testcaseId,
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        title: testcase.testcaseTitle,
        // The published outcome, for every tool. Rampa's own eval scores one 0va7u6 case by the rule's proposed
        // version (PROPOSED_OUTCOMES); the benchmark does not, and docs/benchmark.md says so.
        expected: testcase.expected,
        url: testcase.url,
        criteria: rule.criteria,
      })
    }
  }

  return {
    dataset: { sha256: dataset.sha256, path: dataset.path, url: ev.ACT_TESTCASES_URL, testcases: raw.testcases.length, rules: rules.size },
    rampaVersion: ev.VERSION,
    levels,
    names,
    wcag22: ev.WCAG22_A_AA.map((sc) => sc.id),
    rules: [...rules.values()].filter((rule) => rule.criteria.length > 0 && !SKIPPED_RULES[rule.ruleId]).map((rule) => ({ ruleId: rule.ruleId, ruleName: rule.ruleName, criteria: rule.criteria })),
    cases,
    excluded,
    proposedOutcomes: ev.PROPOSED_OUTCOMES,
  }
}

/**
 * Rampa's corrupted pairs, chosen exactly as `rampa eval` chooses them (src/cli/commands/eval.ts), for every
 * criterion that has corruptors, not only the default ones: a passed test case of the criterion's pair rules,
 * and each corruptor that applies to its rule.
 */
export async function pairSpecs() {
  const ev = await rampaEval()
  const dataset = await ev.loadActTestcases(join(ROOT, '.rampa', 'act'), false)
  const defaults = new Set(ev.DEFAULT_CRITERIA.map((criterion) => (typeof criterion === 'string' ? criterion : criterion.id)))
  const specs = []
  for (const [criterion, rules] of Object.entries(ev.ACT_RULES)) {
    const corruptors = ev.CORRUPTORS[criterion] ?? []
    if (corruptors.length === 0) continue
    for (const testcase of ev.selectTestcases(dataset, criterion)) {
      if (testcase.expected !== 'passed') continue
      for (const corruptor of corruptors) {
        const applies = corruptor.rules ? corruptor.rules.includes(testcase.ruleId) : (rules.pairs ?? rules.semantic).includes(testcase.ruleId)
        if (!applies) continue
        specs.push({
          criterion,
          rampaDefault: defaults.has(criterion),
          corruptor: corruptor.id,
          testcaseId: testcase.testcaseId,
          ruleId: testcase.ruleId,
          title: testcase.testcaseTitle,
          url: testcase.url,
        })
      }
    }
  }
  return { specs, corruptors: ev.CORRUPTORS }
}

/**
 * ACT rules Rampa was built or tuned against: every rule id its source or tests mention (the judged criteria's
 * ACT sets, the ACT rules its own rules and probes cite, the fixtures modeled on them). A conservative reading of
 * "home advantage": on those rules, Rampa's prompts, rules or thresholds were adjusted while reading these cases.
 */
export async function homeRules(ruleIds) {
  const texts = []
  for (const dir of ['src', 'test']) {
    for (const file of await walk(join(ROOT, dir))) texts.push(await readFile(file, 'utf8'))
  }
  const all = texts.join('\n')
  return ruleIds.filter((id) => new RegExp(`\\b${id}\\b`).test(all)).sort()
}

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(path)))
    else if (['.ts', '.mjs', '.js', '.html', '.json', '.md', '.txt', '.svg'].includes(extname(entry.name))) out.push(path)
  }
  return out
}
