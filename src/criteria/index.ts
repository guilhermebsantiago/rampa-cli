import type { AnyCriterion } from '../core/types.ts'
import { RampaError } from '../core/util.ts'
import { headingsAndLabels } from './headings-and-labels.ts'
import { languageOfPage } from './language-of-page.ts'
import { languageOfParts } from './language-of-parts.ts'
import { linkPurpose } from './link-purpose.ts'
import { nonTextContent } from './non-text-content.ts'
import { pageTitled } from './page-titled.ts'

/** Criteria with a judgment module. Others are covered only by the engine for now. */
export const CRITERIA: ReadonlyMap<string, AnyCriterion> = new Map<string, AnyCriterion>([
  [nonTextContent.id, nonTextContent],
  [pageTitled.id, pageTitled],
  [linkPurpose.id, linkPurpose],
  [headingsAndLabels.id, headingsAndLabels],
  [languageOfPage.id, languageOfPage],
  [languageOfParts.id, languageOfParts],
])

export const DEFAULT_CRITERIA = ['1.1.1', '2.4.2', '2.4.4', '2.4.6', '3.1.1', '3.1.2']

/** Each criterion once, in the order first asked for: a repeated id would be judged, counted and reported twice. */
export function resolveCriteria(ids: readonly string[]): AnyCriterion[] {
  return [...new Set(ids.map((id) => id.trim()))].map((id) => {
    const criterion = CRITERIA.get(id)
    if (!criterion) {
      throw new RampaError('unknown-criterion', `No judgment module for WCAG ${id}. Available: ${[...CRITERIA.keys()].join(', ')}`)
    }
    return criterion
  })
}
