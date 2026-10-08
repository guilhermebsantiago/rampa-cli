import type { AnyCriterion } from '../core/types.ts'
import { RampaError } from '../core/util.ts'
import { languageOfParts } from './language-of-parts.ts'
import { nonTextContent } from './non-text-content.ts'

/** Criteria with a judgment module. Others are covered only by the engine for now. */
export const CRITERIA: ReadonlyMap<string, AnyCriterion> = new Map<string, AnyCriterion>([
  [nonTextContent.id, nonTextContent],
  [languageOfParts.id, languageOfParts],
])

export const DEFAULT_CRITERIA = ['1.1.1', '3.1.2']

export function resolveCriteria(ids: readonly string[]): AnyCriterion[] {
  return ids.map((id) => {
    const criterion = CRITERIA.get(id.trim())
    if (!criterion) {
      throw new RampaError('unknown-criterion', `No judgment module for WCAG ${id}. Available: ${[...CRITERIA.keys()].join(', ')}`)
    }
    return criterion
  })
}
