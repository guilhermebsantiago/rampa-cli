import type { Finding, FindingGroup, Report } from './types.ts'
import { sha256 } from './util.ts'

/**
 * Bursts of near-identical findings on one page, reported as one group to review together (docs/output-formats.md,
 * "Groups of near-identical findings"). On real pages almost every false finding came from one page repeating one claim
 * dozens of times: 50 "shared by N links" findings from one hidden menu. One mistaken pattern should be one item a person
 * reviews, not fifty; one right pattern, such as eight images with a file name for an alternative, one item to fix.
 *
 * A group is a reading aid over the report's lists, never a filter: its members stay in `findings` (or `belowThreshold`)
 * as they are, and everything that counts findings counts each of them.
 *
 * The definition is fixed in advance, and the studies count by it too: on one page and in one list, findings with the
 * same criterion (`Finding.criterion`), the same check (`checkOf`) and the same claim kind (`Finding.claim`, set from
 * `claimOf`) form a group when there are more than GROUP_THRESHOLD of them.
 */

/** A group has more than this many members: six or more. */
export const GROUP_THRESHOLD = 5

/** The fields of a model's answer that name its kind of claim, in the order they are read. */
const CLAIM_FIELDS = ['problem', 'relation'] as const

/**
 * The kind of claim a judgment's answer makes: its `problem` (1.1.1's question about an alternative, 2.4.2, 2.4.4,
 * 2.4.6, 3.3.1, 3.3.2) or its `relation` (1.3.2), when it names one other than `none`. Undefined for the answers that
 * name none (3.1.1, 3.1.2, 1.1.1's question about a hidden image and the rest), whose criterion's check makes one claim.
 */
export function claimOf(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined
  for (const field of CLAIM_FIELDS) {
    const value = (output as Record<string, unknown>)[field]
    if (typeof value === 'string' && value !== '' && value !== 'none') return value
  }
  return undefined
}

/** The check behind a finding: its rule's id for an engine, Rampa or probe finding; `judgment/<criterion>` for a model's judgment. */
export function checkOf(finding: Pick<Finding, 'source' | 'criterion' | 'ruleId'>): string {
  return finding.source === 'judgment' ? `judgment/${finding.criterion}` : (finding.ruleId ?? finding.source)
}

/** A group with its members as the report holds them, for the formats that show it. */
export interface GroupOf {
  group: FindingGroup
  members: Finding[]
}

/** The groups of one list of a page, in the order of their first members. */
export function groupList(findings: readonly Finding[], list: FindingGroup['list']): GroupOf[] {
  const byKey = new Map<string, Finding[]>()
  for (const finding of findings) {
    const key = [finding.criterion, checkOf(finding), finding.claim ?? ''].join('\u0000')
    const members = byKey.get(key)
    if (members) members.push(finding)
    else byKey.set(key, [finding])
  }
  const groups: GroupOf[] = []
  for (const members of byKey.values()) {
    const [first] = members
    if (!first || members.length <= GROUP_THRESHOLD) continue
    const check = checkOf(first)
    groups.push({
      group: {
        id: groupId(list, first.criterion, check, first.claim),
        list,
        criterion: first.criterion,
        level: first.level,
        source: first.source,
        check,
        ...(first.claim ? { claim: first.claim } : {}),
        count: members.length,
        members: members.map((member) => member.fingerprint),
        example: first.fingerprint,
      },
      members,
    })
  }
  return groups
}

/** The groups of a page: those of its findings, then those below the confidence threshold. */
export function reportGroups(report: Pick<Report, 'findings' | 'belowThreshold'>): GroupOf[] {
  return [...groupList(report.findings, 'findings'), ...groupList(report.belowThreshold, 'belowThreshold')]
}

/** The groups as JSON reports carry them. */
export function findingGroups(report: Pick<Report, 'findings' | 'belowThreshold'>): FindingGroup[] {
  return reportGroups(report).map((entry) => entry.group)
}

/**
 * The report with the groups its lists hold now: a baseline or a filter applied after the check changes the lists, so
 * the JSON written out recomputes them. Without groups, the report has no `groups` field.
 */
export function withGroups<R extends Report>(report: R): R {
  const groups = findingGroups(report)
  if (groups.length > 0) return { ...report, groups }
  if (report.groups === undefined) return report
  const { groups: _stale, ...rest } = report
  return rest as R
}

function groupId(list: FindingGroup['list'], criterion: string, check: string, claim: string | undefined): string {
  return `g-${sha256(['group', list, criterion, check, claim ?? ''].join('|')).slice(0, 12)}`
}
