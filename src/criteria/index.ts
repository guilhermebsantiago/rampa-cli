import type { AnyCriterion } from '../core/types.ts'
import { RampaError } from '../core/util.ts'
import { headingsAndLabels } from './headings-and-labels.ts'
import { identifyInputPurpose } from './identify-input-purpose.ts'
import { imagesOfText } from './images-of-text.ts'
import { languageOfPage } from './language-of-page.ts'
import { languageOfParts } from './language-of-parts.ts'
import { linkPurpose } from './link-purpose.ts'
import { nonTextContent } from './non-text-content.ts'
import { pageTitled } from './page-titled.ts'

/** Criteria with a judgment module. Others are covered only by the engine for now. */
export const CRITERIA: ReadonlyMap<string, AnyCriterion> = new Map<string, AnyCriterion>([
  [nonTextContent.id, nonTextContent],
  [identifyInputPurpose.id, identifyInputPurpose],
  [imagesOfText.id, imagesOfText],
  [pageTitled.id, pageTitled],
  [linkPurpose.id, linkPurpose],
  [headingsAndLabels.id, headingsAndLabels],
  [languageOfPage.id, languageOfPage],
  [languageOfParts.id, languageOfParts],
])

export const DEFAULT_CRITERIA = ['1.1.1', '2.4.2', '2.4.4', '2.4.6', '3.1.1', '3.1.2']

export function resolveCriteria(ids: readonly string[]): AnyCriterion[] {
  return ids.map((id) => {
    const criterion = CRITERIA.get(id.trim())
    if (!criterion) {
      throw new RampaError('unknown-criterion', `No judgment module for WCAG ${id}. Available: ${[...CRITERIA.keys()].join(', ')}`)
    }
    return criterion
  })
}
