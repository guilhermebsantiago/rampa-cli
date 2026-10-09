import type { Patch } from '../../core/types.ts'
import { inputType } from '../../criteria/autofill.ts'
import { shown, shownText, visibleLabelOf } from '../../criteria/labels-or-instructions.ts'
import { attributesOf, startTagOf, withAttribute } from '../../criteria/shared.ts'
import type { A11yNode } from '../../snapshot/schema.ts'
import { walkTree } from '../../snapshot/tree.ts'
import type { AdvisoryCheck, AdvisoryHit } from '../check.ts'
import { cogaBasis } from '../coga.ts'
import {
  type CompiledPattern,
  type FormatPurpose,
  IDENTIFIERS,
  compilePattern,
  examplesIn,
  exampleWithSeparators,
  purposeOf,
  regionOf,
  variantsFor,
} from '../formats.ts'
import { am } from '../messages.ts'
import { type Page, formOf, languageOf, parentOf, tagOf, usable } from '../page.ts'
import type { CogaStatement } from '../types.ts'

/**
 * COGA o4p08 Accept Different Input Formats (https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p08-input-formats/).
 * Avoid: "Restricting entries to arbitrary lengths"; "Insisting on specific separator characters if they are
 * not required and can be ignored"; "A credit number field that requires no spaces even though cards have
 * numbers printed with spaces"; "Telephone number field will not accept + codes or brackets". Claim (d)
 * also maps to o4p07 Use Clear Step-by-step Instructions.
 *
 * A rule, no model, over the field's attributes; all of it can be recomputed from the snapshot:
 * (a) type="number" on an identifier (postal code, phone, card, CPF, CNPJ, account number);
 * (b) the pattern, compiled as browsers do, refuses a common way to write the value;
 * (c) maxlength is shorter than a common way to write it;
 * (d) an example shown with the field is refused by the field's own pattern or maxlength.
 * (b) to (d) are skipped when the form has novalidate or its submit button formnovalidate: such forms are
 * validated by script, often with a mask that reformats what is typed. For the same reason they are medium
 * confidence: Rampa does not type into the field (wave 2 adds a typing probe).
 */

/** Text fields where an identifier is typed; email, url, password and search have formats of their own. */
const FIELD_TYPES = new Set(['text', 'tel', 'number'])

type Claim =
  | { kind: 'number'; variant: string }
  | { kind: 'pattern'; refused: string[] }
  | { kind: 'length'; variant: string; maxlength: number }
  | { kind: 'example'; example: string; constraint: 'pattern' | 'maxlength' }

export const inputFormats: AdvisoryCheck = {
  id: 'coga/input-formats',
  version: '1',
  maturity: 'experimental',
  pattern: 'o4p08',
  surfaces: ['web'],

  run({ page, locale }) {
    const hits: AdvisoryHit[] = []
    const notes: string[] = []
    let candidates = 0
    for (const node of page.ordered) {
      if (tagOf(node) !== 'input' || !usable(node)) continue
      const attributes = attributesOf(node)
      const control = inputType('input', attributes.type)
      if (!FIELD_TYPES.has(control)) continue
      const label = visibleLabelOf(node, page.ordered, page.byId)
      const placeholder = attributes.placeholder?.trim() || undefined
      const language = languageOf(page, node)
      const purpose = purposeOf({
        autocomplete: attributes.autocomplete,
        type: control,
        inputmode: attributes.inputmode,
        words: [attributes.name, attributes.id, node.name, label, placeholder].filter((word): word is string => Boolean(word)),
        language,
      })
      if (!purpose) continue
      candidates++
      const region = regionOf(language, page.snapshot.target)
      const claims: Claim[] = []
      const facts: Record<string, string | number | boolean> = {
        purpose: purpose.purpose,
        purposeFrom: purpose.from,
        purposeEvidence: purpose.evidence,
        type: control,
        region: region ?? 'unknown',
      }
      let compiled: CompiledPattern | undefined

      if (control === 'number') {
        // A number field ignores pattern and maxlength: only (a) applies.
        if (IDENTIFIERS.has(purpose.purpose)) claims.push({ kind: 'number', variant: exampleWithSeparators(purpose.purpose, region) })
      } else if (validatesByScript(page, node)) {
        facts.novalidate = true
      } else {
        const variants = variantsFor(purpose.purpose, region)
        const pattern = attributes.pattern
        if (pattern !== undefined && pattern !== '') {
          compiled = compilePattern(pattern)
          facts.pattern = pattern
          facts.compiled = compiled.source
          if (!compiled.ok) notes.push(am(locale, 'formatsInvalidPattern', { ref: node.ref }))
        }
        if (compiled?.ok && variants.length > 0) {
          const regex = compiled.regex
          facts.variants = variants.map((variant) => `${variant} ${regex.test(variant) ? '✓' : '✗'}`).join('; ')
          const refused = variants.filter((variant) => !regex.test(variant))
          if (refused.length > 0) claims.push({ kind: 'pattern', refused })
        }
        const maxlength = Number.parseInt(attributes.maxlength ?? '', 10)
        if (Number.isFinite(maxlength) && maxlength > 0) {
          facts.maxlength = maxlength
          const tooLong = variants.find((variant) => variant.length > maxlength)
          if (tooLong) claims.push({ kind: 'length', variant: tooLong, maxlength })
        }
        // The field's own hints only: its label, its description, its tooltip and the text right after it. A hint
        // further away may belong to the next field, and its example is not this field's to refuse.
        const hints = (attributes['aria-describedby'] ?? '')
          .split(/\s+/)
          .map((id) => page.byId.get(id))
          .filter((hint): hint is A11yNode => hint !== undefined)
          .map((hint) => shownText(hint))
        const examples = examplesIn([label, ...hints, attributes.title, textRightAfter(page, node)], placeholder, purpose.purpose)
        if (examples.length > 0) facts.examples = examples.join('; ')
        for (const example of examples) {
          if (compiled?.ok && !compiled.regex.test(example)) {
            claims.push({ kind: 'example', example, constraint: 'pattern' })
            break
          }
          if (Number.isFinite(maxlength) && maxlength > 0 && example.length > maxlength) {
            claims.push({ kind: 'example', example, constraint: 'maxlength' })
            break
          }
        }
      }
      if (claims.length === 0) continue

      const purposeName = am(locale, `purpose_${purpose.purpose}`)
      const sentences = claims.map((claim) => {
        switch (claim.kind) {
          case 'number':
            return am(locale, 'formatsNumber', { purpose: purposeName, variant: claim.variant, separators: am(locale, `separators_${purpose.purpose}`) })
          case 'pattern':
            return am(locale, 'formatsPattern', { purpose: purposeName, variants: claim.refused.map((value) => `"${value}"`).join(', ') })
          case 'length':
            return am(locale, 'formatsLength', { purpose: purposeName, maxlength: claim.maxlength, variant: claim.variant, length: claim.variant.length })
          case 'example':
            return am(locale, 'formatsExample', { example: claim.example, constraint: claim.constraint })
        }
      })
      const number = claims.some((claim) => claim.kind === 'number')
      sentences.push(am(locale, number ? 'formatsRecommendNumber' : 'formatsRecommend'))
      if (!number) sentences.push(am(locale, 'formatsMask'))
      const startTag = startTagOf(node)
      const [statement, quote] = quoteFor(claims[0] as Claim, purpose.purpose)
      hits.push({
        kind: 'advisory',
        basis: cogaBasis('o4p08', statement, quote),
        related: claims.some((claim) => claim.kind === 'example')
          ? [cogaBasis('o4p07', 'what-to-do', 'available with examples or illustrations that make it easy to understand what to do')]
          : undefined,
        impact: 'barrier',
        source: 'rule',
        ref: node.ref,
        html: typeof node.native.html === 'string' ? node.native.html : undefined,
        message: sentences.join(' '),
        evidence: startTag,
        subject: purpose.purpose,
        facts: { ...facts, claims: claims.map((claim) => claim.kind).join(', ') },
        patch: number ? numberPatch(node.ref, startTag, purpose.purpose) : undefined,
        confidence: number ? 'high' : 'medium',
      })
    }
    return { ran: true, candidates, hits, notes }
  },
}

/** The sentence of the pattern each claim rests on. */
function quoteFor(claim: Claim, purpose: FormatPurpose): [CogaStatement, string] {
  if (claim.kind === 'length') return ['avoid', 'Restricting entries to arbitrary lengths.']
  if (purpose === 'phone') return ['avoid', 'Telephone number field will not accept + codes or brackets.']
  if (purpose === 'card') return ['avoid', 'A credit number field that requires no spaces even though cards have numbers printed with spaces.']
  if (claim.kind === 'number') return ['avoid', 'Input fields that do not accept the format that the user may use.']
  return ['avoid', 'Insisting on specific separator characters if they are not required and can be ignored.']
}

/** The text of the field's next sibling on screen, when that sibling is text and not another control. */
function textRightAfter(page: Page, node: A11yNode): string | undefined {
  const parent = parentOf(page, node)
  if (!parent) return undefined
  const siblings = parent.children.filter((child) => child === node || shown(child))
  const next = siblings[siblings.indexOf(node) + 1]
  if (!next || [next, ...walkTree(next)].some((child) => tagOf(child) === 'input' || tagOf(child) === 'select' || tagOf(child) === 'textarea')) return undefined
  return shownText(next) || undefined
}

/** novalidate on the form, or formnovalidate on a submit button in it: the browser never checks the pattern. */
function validatesByScript(page: Page, node: A11yNode): boolean {
  const form = formOf(page, node)
  if (!form) return false
  if (attributesOf(form).novalidate !== undefined) return true
  return page.ordered.some((other) => attributesOf(other).formnovalidate !== undefined && formOf(page, other) === form)
}

/**
 * type="text" with a numeric keypad, as the GOV.UK Design System does for identifiers; a phone number
 * keeps type="tel", whose keypad has + and brackets. min, max and step mean nothing on a text field.
 */
function numberPatch(ref: string, startTag: string, purpose: FormatPurpose): Patch {
  let after = withAttribute(startTag, 'type', purpose === 'phone' ? 'tel' : 'text')
  if (purpose !== 'phone') after = withAttribute(after, 'inputmode', 'numeric')
  for (const name of ['min', 'max', 'step']) after = after.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>]+)`, 'i'), '')
  return { ref, kind: 'replace-element', to: purpose === 'phone' ? 'type="tel"' : 'type="text" inputmode="numeric"', before: startTag, after }
}

