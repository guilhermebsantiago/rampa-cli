import type { AnyCriterion } from '../core/types.ts'
import { RampaError } from '../core/util.ts'
import { errorIdentification } from './error-messages.ts'
import { headingsAndLabels } from './headings-and-labels.ts'
import { identifyInputPurpose } from './identify-input-purpose.ts'
import { imagesOfText } from './images-of-text.ts'
import { labelsOrInstructions } from './labels-or-instructions.ts'
import { languageOfPage } from './language-of-page.ts'
import { languageOfParts } from './language-of-parts.ts'
import { linkPurpose } from './link-purpose.ts'
import { nonTextContent } from './non-text-content.ts'
import { infoAndRelationships } from './info-and-relationships.ts'
import { pageTitled } from './page-titled.ts'
import { sensoryCharacteristics } from './sensory-characteristics.ts'
import { visibleLabelInName } from './visible-label-in-name.ts'

/** Criteria with a judgment module. Others are covered only by the engine for now. */
export const CRITERIA: ReadonlyMap<string, AnyCriterion> = new Map<string, AnyCriterion>([
  [nonTextContent.id, nonTextContent],
  [infoAndRelationships.id, infoAndRelationships],
  [sensoryCharacteristics.id, sensoryCharacteristics],
  [identifyInputPurpose.id, identifyInputPurpose],
  [imagesOfText.id, imagesOfText],
  [pageTitled.id, pageTitled],
  [linkPurpose.id, linkPurpose],
  [headingsAndLabels.id, headingsAndLabels],
  [visibleLabelInName.id, visibleLabelInName],
  [languageOfPage.id, languageOfPage],
  [languageOfParts.id, languageOfParts],
  [labelsOrInstructions.id, labelsOrInstructions],
  [errorIdentification.id, errorIdentification],
])

/**
 * 1.4.5 is left out until its findings are measured on real pages (the coverage plan's EVAL-1): OCR now
 * keeps most pictures from the model, but a handful of real-page findings is not a precision, and
 * whether a banner with a product photo is an image of text is still a call people disagree on. 3.3.1 is left out
 * while it is experimental: it judges error messages a page already shows (src/criteria/error-messages.ts),
 * and the rules for 3.3.1 and 3.3.3 run without it. 1.3.3 is experimental too, and its failures are rare
 * on real pages (src/criteria/sensory-characteristics.ts); so are 1.3.1 (text styled as a heading,
 * info-and-relationships.ts) and 2.5.3 (a visible label not tied to its field, visible-label-in-name.ts), whose
 * rules run without them. Ask for any of them with --criteria.
 */
export const DEFAULT_CRITERIA = ['1.1.1', '1.3.5', '2.4.2', '2.4.4', '2.4.6', '3.1.1', '3.1.2', '3.3.2']

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
