import { labelsOf, shownText } from '../../criteria/labels-or-instructions.ts'
import { attributesOf, startTagOf, withAttribute } from '../../criteria/shared.ts'
import type { Patch } from '../../core/types.ts'
import type { A11yNode } from '../../snapshot/schema.ts'
import { walkTree } from '../../snapshot/tree.ts'
import type { AdvisoryCheck, AdvisoryHit } from '../check.ts'
import { cogaBasis } from '../coga.ts'
import { am } from '../messages.ts'
import { type Page, parentOf, tagOf, usable } from '../page.ts'

/**
 * COGA o4p03 Notify Users of Fees and Charges (https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p03-declared-charges/),
 * Avoid: "Final transactions that include new charges or hidden fees, that result in higher-than-expected
 * total charges"; and COGA o7p03, Avoid: "Changing items from the original request without warning the user".
 *
 * COGA never names pre-checked options: this is the narrowest reading of those two Avoid examples. A rule,
 * no model: a checkbox or switch checked when the page loads whose own text (its label, its description
 * or the small row around it) names a non-zero price or a recurring commitment. Radio groups are left out
 * (a required choice always has one option selected), and so are consent boxes with no price.
 */

const MONEY = /(?:R\$|US\$|U\$|€|£|\$)\s?(\d[\d.,]*\d|\d)/u
/**
 * A commitment that costs later: a free trial, automatic renewal, a paid plan. "Subscribe" or "por mês"
 * alone are left out: a pre-checked newsletter ("2 e-mails por mês") is consent with no price.
 */
const COMMITMENT =
  /\bgr[aá]tis por \d+ dias|\b\d+ dias gr[aá]tis|\bfree for \d+ days\b|\b\d+[- ]day (?:free )?trial\b|\bfree trial\b|\bper[ií]odo de (?:teste|avalia[çc][ãa]o) gr[aá]tis|\bteste gr[aá]tis|\brenova[çc][ãa]o autom[aá]tica|\bauto-?renew(?:al|s)?\b|\b(?:assinatura|plano)\s+(?:premium|pag[ao]|pro|plus)\b|\b(?:premium|paid|pro|plus)\s+(?:subscription|plan|membership)\b/iu
/** A row stops at these: past them the text is about other things, such as the product a gift-wrap box sits next to. */
const ROW_LIMITS = new Set(['tr', 'table', 'tbody', 'form', 'fieldset', 'ul', 'ol', 'body', 'main', 'section', 'article'])
const CONTROL_TAGS = new Set(['input', 'select', 'textarea', 'button'])
const MAX_ROW_TEXT = 200

export const preselectedCost: AdvisoryCheck = {
  id: 'coga/preselected-cost',
  version: '1',
  maturity: 'experimental',
  pattern: 'o4p03',
  surfaces: ['web'],

  run({ page, locale }) {
    const basis = cogaBasis('o4p03', 'avoid', 'Final transactions that include new charges or hidden fees, that result in higher-than-expected total charges.')
    const related = [cogaBasis('o7p03', 'avoid', 'Changing items from the original request without warning the user.')]
    const hits: AdvisoryHit[] = []
    let candidates = 0
    for (const node of page.ordered) {
      if (node.role !== 'checkbox' && node.role !== 'switch') continue
      if (!node.states.includes('checked') || !usable(node)) continue
      candidates++
      const texts = ownTexts(page, node)
      const found = texts.map((text) => ({ text, cost: costIn(text) })).find((entry) => entry.cost !== undefined)
      if (!found?.cost) continue
      const option = (node.name?.trim() || texts[0] || '').slice(0, 120)
      const cost = found.cost.kind === 'amount' ? am(locale, 'costAmount', { amount: found.cost.match }) : am(locale, 'costRecurring', { phrase: found.cost.match })
      const startTag = startTagOf(node)
      hits.push({
        kind: 'advisory',
        basis,
        related,
        impact: 'barrier',
        source: 'rule',
        ref: node.ref,
        html: typeof node.native.html === 'string' ? node.native.html : undefined,
        message: `${am(locale, 'costChecked', { option, cost })} ${am(locale, 'costRecommend')}`,
        evidence: found.text.replace(found.cost.match, `«${found.cost.match}»`),
        subject: option,
        facts: { checkedAtLoad: true, cost: found.cost.match, costKind: found.cost.kind, text: found.text },
        patch: uncheck(node.ref, startTag),
        confidence: 'high',
      })
    }
    return { ran: true, candidates, hits }
  },
}

/** A non-zero price, or a recurring or trial commitment, in a text. */
export function costIn(text: string): { kind: 'amount' | 'recurring'; match: string } | undefined {
  const money = MONEY.exec(text)
  if (money?.[1] && /[1-9]/.test(money[1])) return { kind: 'amount', match: money[0].trim() }
  const commitment = COMMITMENT.exec(text)
  if (commitment) return { kind: 'recurring', match: commitment[0].trim() }
  return undefined
}

/**
 * The texts that belong to this checkbox alone, closest first: its name, its labels, what aria-describedby
 * points to, and the small row around it, up to where another control or a table row begins.
 */
function ownTexts(page: Page, node: A11yNode): string[] {
  const texts: string[] = []
  const add = (text: string | undefined) => {
    const trimmed = text?.replace(/\s+/g, ' ').trim()
    if (trimmed && !texts.includes(trimmed)) texts.push(trimmed)
  }
  add(node.name)
  for (const label of labelsOf(node, page.ordered)) add(shownText(label, node))
  for (const id of (attributesOf(node)['aria-describedby'] ?? '').split(/\s+/)) {
    const described = id ? page.byId.get(id) : undefined
    if (described) add(shownText(described))
  }
  let container = parentOf(page, node)
  for (let level = 0; container && level < 3 && !ROW_LIMITS.has(tagOf(container)); level++) {
    const holder = container
    const others = [...walkTree(holder)].filter((other) => other !== node && CONTROL_TAGS.has(tagOf(other)) && attributesOf(other).type !== 'hidden')
    if (others.length > 0) break
    const text = shownText(holder)
    if (text.length > MAX_ROW_TEXT) break
    add(text)
    container = parentOf(page, holder)
  }
  return texts
}

/** The start tag without `checked`, or with aria-checked="false"; nothing when the box was checked by a script. */
function uncheck(ref: string, startTag: string): Patch | undefined {
  const checked = /\s+checked(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?(?=[\s/>])/i
  let after: string | undefined
  if (checked.test(startTag)) after = startTag.replace(checked, '')
  else if (/\saria-checked\s*=\s*["']?true/i.test(startTag)) after = withAttribute(startTag, 'aria-checked', 'false')
  if (!after) return undefined
  return { ref, kind: 'replace-element', to: 'unchecked', before: startTag, after }
}
