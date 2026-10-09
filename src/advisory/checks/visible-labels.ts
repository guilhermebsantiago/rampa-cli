import { inputType } from '../../criteria/autofill.ts'
import { labelsOf, legendOf, shown, shownText, visibleLabelOf } from '../../criteria/labels-or-instructions.ts'
import { attributesOf, escapeHtml, startTagOf } from '../../criteria/shared.ts'
import type { A11yNode } from '../../snapshot/schema.ts'
import type { AdvisoryCheck, AdvisoryHit } from '../check.ts'
import { cogaBasis } from '../coga.ts'
import { am } from '../messages.ts'
import { type Page, parentOf, tagOf, usable } from '../page.ts'

/**
 * COGA o4p06 Use Clear Visible Labels (https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p06-clear-labels/).
 * What to Do: labels should "be visible and next to the relevant control". How it Helps: "the label
 * disappears when the focus is removed. The user cannot remember what the control is".
 *
 * A rule, no model: a text field whose only text on screen is its placeholder. The 3.3.2 module counts a
 * placeholder as visible text, so this case never is a WCAG 3.3.2 finding and falls to the profile. A
 * field is left alone when anything else on screen may name it: a shown label, aria-labelledby to shown
 * text, a legend or group name, short text right before it, or a button beside it (WCAG technique G167,
 * a search box with a "Buscar" button).
 */

/** Input types that take typed text and show a placeholder; date and time pickers show their own format. */
const TEXT_TYPES = new Set(['text', 'email', 'tel', 'url', 'search', 'password', 'number'])
/** Short text right before a field reads as its label; a paragraph does not. */
const MAX_WORDS_BEFORE = 12

type HiddenSource = 'aria-label' | 'title' | 'hidden-label'

export const visibleLabels: AdvisoryCheck = {
  id: 'coga/visible-labels',
  version: '1',
  maturity: 'experimental',
  pattern: 'o4p06',
  surfaces: ['web'],

  run({ page, locale }) {
    const basis = cogaBasis('o4p06', 'how-it-helps', 'the label disappears when the focus is removed. The user cannot remember what the control is')
    const hits: AdvisoryHit[] = []
    let candidates = 0
    for (const node of page.ordered) {
      const tag = tagOf(node)
      if (tag !== 'input' && tag !== 'textarea') continue
      const attributes = attributesOf(node)
      if (tag === 'input' && !TEXT_TYPES.has(inputType(tag, attributes.type))) continue
      const placeholder = attributes.placeholder?.trim()
      if (!placeholder || !usable(node)) continue
      candidates++
      if (visibleLabelOf(node, page.ordered, page.byId) || legendOf(page.index, node)) continue
      if (buttonBeside(page, node)) continue
      const before = textRightBefore(page, node)
      if (before && before.split(/\s+/).length <= MAX_WORDS_BEFORE) continue

      const hidden = hiddenSourceOf(page, node)
      const readsAsLabel = !/[\d@_#/\\|*]/.test(placeholder) && placeholder.split(/\s+/).length <= 8
      const parts = [am(locale, 'labelsPlaceholderOnly', { placeholder })]
      if (hidden) parts.push(am(locale, `labelsSource_${hidden}`))
      parts.push(am(locale, 'labelsRecommend'))
      if (!readsAsLabel) parts.push(am(locale, 'labelsHint'))
      const startTag = startTagOf(node)
      const label = escapeHtml(placeholder)
      hits.push({
        kind: 'advisory',
        basis,
        impact: 'hurdle',
        source: 'rule',
        ref: node.ref,
        html: typeof node.native.html === 'string' ? node.native.html : undefined,
        message: parts.join(' '),
        evidence: startTag,
        subject: placeholder,
        facts: {
          placeholder,
          labelElement: labelsOf(node, page.ordered).length > 0 ? 'hidden' : 'none',
          ariaLabelledby: attributes['aria-labelledby'] ? 'not shown' : 'none',
          ariaLabel: attributes['aria-label']?.trim() || 'none',
          title: attributes.title?.trim() || 'none',
          legend: 'none',
          textBefore: before || 'none',
          buttonBeside: 'none',
        },
        // A placeholder that reads as a label becomes one; an example stays an example (fix text only).
        patch:
          readsAsLabel && tag === 'input'
            ? {
                ref: node.ref,
                kind: 'replace-element',
                to: placeholder,
                before: startTag,
                after: attributes.id ? `<label for="${escapeHtml(attributes.id)}">${label}</label> ${startTag}` : `<label>${label} ${startTag}</label>`,
              }
            : undefined,
        // COGA: simple text-to-speech tools "often do not read WAI-ARIA or titles", so a hidden name only lowers how sure Rampa is that nobody gets a label.
        confidence: hidden ? 'medium' : 'high',
      })
    }
    return { ran: true, candidates, hits }
  },
}

/** Where a name nobody sees comes from, when the field has one besides its placeholder. */
function hiddenSourceOf(page: Page, node: A11yNode): HiddenSource | undefined {
  const attributes = attributesOf(node)
  if (attributes['aria-labelledby']?.trim() || labelsOf(node, page.ordered).some((label) => !shown(label))) return 'hidden-label'
  if (attributes['aria-label']?.trim()) return 'aria-label'
  if (attributes.title?.trim()) return 'title'
  return undefined
}

const CONTROLS = new Set(['input', 'select', 'textarea', 'button'])

/** The shown siblings of a node, in order, and where the node sits among them. */
function shownSiblings(page: Page, node: A11yNode): { siblings: A11yNode[]; index: number } | undefined {
  const parent = parentOf(page, node)
  if (!parent) return undefined
  const siblings = parent.children.filter((child) => child === node || shown(child))
  return { siblings, index: siblings.indexOf(node) }
}

/**
 * A button right next to the field labels it (WCAG technique G167): a search box and its "Buscar" button,
 * or its magnifying glass named "Pesquisar". Only the field's own neighbours count, also around a wrapper
 * that holds nothing but the field; a submit button at the end of a long form labels none of its fields.
 */
function buttonBeside(page: Page, node: A11yNode): boolean {
  // Beside means on the same line: a button in the next row of a form is not the field's label.
  const sameLine = (candidate: A11yNode, level: number) => {
    const a = candidate.bounds
    const b = node.bounds
    if (!a || !b) return level === 0
    return a.y < b.y + b.height && b.y < a.y + a.height
  }
  const isButton = (candidate: A11yNode | undefined, level: number) =>
    candidate !== undefined && candidate.role === 'button' && Boolean(candidate.name?.trim()) && sameLine(candidate, level)
  let current = node
  for (let level = 0; level < 3; level++) {
    const around = shownSiblings(page, current)
    if (!around) return false
    const neighbours = [around.siblings[around.index - 1], around.siblings[around.index + 1]]
    if (neighbours.some((neighbour) => isButton(neighbour, level) || (neighbour?.children.length === 1 && isButton(neighbour.children[0], level)))) return true
    const parent = parentOf(page, current)
    if (!parent || around.siblings.some((sibling) => sibling !== current && (CONTROLS.has(tagOf(sibling)) || Boolean(sibling.text?.trim())))) return false
    current = parent
  }
  return false
}

/**
 * The text shown right before the field: its previous sibling or, when the field opens a wrapper of its
 * own, the wrapper's previous sibling (two levels up at most). A label for another field, or a block
 * holding another control, belongs to that control.
 */
function textRightBefore(page: Page, node: A11yNode): string | undefined {
  const id = attributesOf(node).id
  let current = node
  for (let level = 0; level < 3; level++) {
    const around = shownSiblings(page, current)
    if (!around) return undefined
    const previous = around.siblings[around.index - 1]
    if (previous) {
      const target = tagOf(previous) === 'label' ? attributesOf(previous).for : undefined
      if ((target && target !== id) || [previous, ...previous.children].some((child) => CONTROLS.has(tagOf(child)))) return undefined
      return shownText(previous) || undefined
    }
    const parent = parentOf(page, current)
    // Only a wrapper that holds this one field passes the question up.
    if (!parent || parent.children.some((child) => child !== current && CONTROLS.has(tagOf(child)))) return undefined
    current = parent
  }
  return undefined
}
