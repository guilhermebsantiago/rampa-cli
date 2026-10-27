import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { GROUP_THRESHOLD, checkOf, claimOf, findingGroups, groupList, reportGroups, withGroups } from '../src/core/groups.ts'
import type { Finding, Report } from '../src/core/types.ts'
import { resolveCriteria } from '../src/criteria/index.ts'
import { formatReports } from '../src/report/formats.ts'
import { paint } from '../src/report/color.ts'
import { engineFinding, judged, readMorePage } from './group-fixtures.ts'
import { stubModel } from './stub-model.ts'

const page = (findings: Finding[], belowThreshold: Finding[] = []): Pick<Report, 'findings' | 'belowThreshold'> => ({ findings, belowThreshold })
const many = (count: number, claim: string | undefined, criterion = '2.4.4', from = 0) => Array.from({ length: count }, (_, index) => judged(criterion, claim, from + index))

describe('groups of near-identical findings', () => {
  it('needs more than five: five stay findings on their own, six make a group', () => {
    expect(GROUP_THRESHOLD).toBe(5)
    expect(findingGroups(page(many(5, 'ambiguous')))).toEqual([])
    const six = many(6, 'ambiguous')
    const [group, ...rest] = findingGroups(page(six))
    expect(rest).toEqual([])
    expect(group).toEqual({
      id: expect.stringMatching(/^g-[0-9a-f]{12}$/),
      list: 'findings',
      criterion: '2.4.4',
      level: 'A',
      source: 'judgment',
      check: 'judgment/2.4.4',
      claim: 'ambiguous',
      count: 6,
      members: six.map((finding) => finding.fingerprint),
      example: six[0]?.fingerprint,
    })
  })

  it('never groups different claims of one check, even when there are many of both', () => {
    expect(findingGroups(page([...many(3, 'ambiguous'), ...many(3, 'generic', '2.4.4', 3)]))).toEqual([])
    const groups = findingGroups(page([...many(6, 'ambiguous'), ...many(7, 'generic', '2.4.4', 6)]))
    expect(groups.map((group) => [group.claim, group.count])).toEqual([
      ['ambiguous', 6],
      ['generic', 7],
    ])
    expect(new Set(groups.map((group) => group.id)).size).toBe(2)
  })

  it('never groups different checks or criteria, nor a claim with no claim', () => {
    const contrast = Array.from({ length: 3 }, (_, index) => engineFinding('1.4.3', 'color-contrast', index))
    const enhanced = Array.from({ length: 3 }, (_, index) => engineFinding('1.4.3', 'color-contrast-enhanced', index))
    expect(findingGroups(page([...contrast, ...enhanced]))).toEqual([])
    expect(findingGroups(page([...many(3, 'generic', '2.4.4'), ...many(3, 'generic', '2.4.6', 3)]))).toEqual([])
    expect(findingGroups(page([...many(3, 'wrong_content', '1.1.1'), ...many(3, undefined, '1.1.1', 3)]))).toEqual([])
    // A rule makes one claim: its id is the check, and the group has no claim.
    const rule = Array.from({ length: 6 }, (_, index) => engineFinding('1.4.3', 'color-contrast', index))
    expect(findingGroups(page(rule))).toMatchObject([{ check: 'color-contrast', source: 'engine', count: 6 }])
    expect(findingGroups(page(rule))[0]).not.toHaveProperty('claim')
  })

  it('never groups across pages: each report is one page', () => {
    const first = page(many(3, 'ambiguous'))
    const second = page(many(3, 'ambiguous', '2.4.4', 3))
    expect([...findingGroups(first), ...findingGroups(second)]).toEqual([])
  })

  it('groups each list on its own: findings below the threshold never join confirmed ones', () => {
    expect(findingGroups(page(many(3, 'ambiguous'), many(3, 'ambiguous', '2.4.4', 3)))).toEqual([])
    const groups = findingGroups(page(many(6, 'ambiguous'), many(6, 'ambiguous', '2.4.4', 6)))
    expect(groups.map((group) => group.list)).toEqual(['findings', 'belowThreshold'])
    expect(groups[0]?.id).not.toBe(groups[1]?.id)
  })

  it('keeps an id from run to run, whichever elements the group holds', () => {
    const one = findingGroups(page(many(6, 'ambiguous')))[0]
    const other = findingGroups(page(many(9, 'ambiguous', '2.4.4', 20)))[0]
    expect(other?.id).toBe(one?.id)
    expect(findingGroups(page(many(6, 'generic')))[0]?.id).not.toBe(one?.id)
  })

  it('references its members and leaves them as they are', () => {
    const findings = many(7, 'ambiguous')
    const before = structuredClone(findings)
    const [entry] = groupList(Object.freeze(findings) as Finding[], 'findings')
    expect(entry?.members).toEqual(findings)
    expect(entry?.members[0]).toBe(findings[0])
    expect(findings).toEqual(before)
  })

  it('reads the claim from the answer: problem, or relation, never none', () => {
    expect(claimOf({ verdict: 'fail', problem: 'ambiguous' })).toBe('ambiguous')
    expect(claimOf({ verdict: 'fail', relation: 'heading' })).toBe('heading')
    expect(claimOf({ verdict: 'pass', problem: 'none' })).toBeUndefined()
    expect(claimOf({ verdict: 'fail', detectedLanguage: 'nl' })).toBeUndefined()
    expect(claimOf(undefined)).toBeUndefined()
    expect(checkOf({ source: 'judgment', criterion: '2.4.4', ruleId: undefined })).toBe('judgment/2.4.4')
    expect(checkOf({ source: 'rule', criterion: '1.1.1', ruleId: 'rampa/placeholder-alt' })).toBe('rampa/placeholder-alt')
  })

  it('recomputes the groups when the lists change, such as after a baseline', () => {
    const findings = many(6, 'ambiguous')
    const report = { findings, belowThreshold: [], groups: findingGroups(page(findings)) } as unknown as Report
    expect(withGroups(report).groups).toHaveLength(1)
    const filtered = withGroups({ ...report, findings: findings.slice(1) })
    expect(filtered).not.toHaveProperty('groups')
    expect(filtered.findings).toHaveLength(5)
  })
})

describe('groups in a check', () => {
  it('sets the claim on each judgment and groups a burst, keeping every finding', async () => {
    const report = await checkSnapshot(readMorePage(8), { engine: { name: 'axe-core', version: 'test' }, rules: [] }, {
      criteria: resolveCriteria(['2.4.4']),
      llm: true,
      provider: stubModel(),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 2,
    })
    expect(report.findings).toHaveLength(8)
    expect(report.findings.every((finding) => finding.claim === 'generic' && finding.source === 'judgment')).toBe(true)
    expect(report.groups).toEqual([expect.objectContaining({ list: 'findings', criterion: '2.4.4', check: 'judgment/2.4.4', claim: 'generic', count: 8 })])
    expect(report.groups?.[0]?.members).toEqual(report.findings.map((finding) => finding.fingerprint))
    // The JSON a run writes holds the same groups and the same findings, one by one.
    const json = JSON.parse(formatReports('json', [report], { verbose: false, paint: paint(false) }))
    expect(json.groups).toEqual(report.groups)
    expect(json.findings).toHaveLength(8)
    expect(reportGroups(report)[0]?.members).toEqual(report.findings)
  })

  it('makes no group of five', async () => {
    const report = await checkSnapshot(readMorePage(5), { engine: { name: 'axe-core', version: 'test' }, rules: [] }, {
      criteria: resolveCriteria(['2.4.4']),
      llm: true,
      provider: stubModel(),
      runs: 1,
      cache: memoryCache(),
      offline: false,
      locale: 'en',
      minConfidence: 'medium',
      concurrency: 2,
    })
    expect(report.findings).toHaveLength(5)
    expect(report).not.toHaveProperty('groups')
    expect(formatReports('json', [report], { verbose: false, paint: paint(false) })).not.toContain('"groups"')
  })
})
