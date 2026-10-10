import type { Finding, Patch } from '../core/types.ts'
import { labelsOf, shownText as labelText } from '../criteria/labels-or-instructions.ts'
import { attributesOf, isHidden } from '../criteria/shared.ts'
import type { Locale } from '../i18n.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { indexTree, walkTree } from '../snapshot/tree.ts'
import type { Hit, RuleCheck } from './types.ts'

/**
 * 2.5.3 Label in Name. axe-core's label-content-name-mismatch fails a control when its visible text is
 * not in its accessible name, comparing letters exactly: "E-mail" against "Email address", or "Info"
 * against "Information about shipping". Speech recognition matches those, or may: whether it does is
 * for a person to try. Such failures move below the threshold, as needs review, with the reason; every
 * other mismatch stays as axe reported it.
 */

export const LABEL_IN_NAME_RULE = 'label-content-name-mismatch'

const HYPHENS = /[-­‐‑‒–]/g

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKC')
    .replace(HYPHENS, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')

/** How the visible text and the name differ when only hyphenation or a shortened word does, or undefined. */
export function nearMatch(visible: string, name: string): 'hyphenation' | 'abbreviation' | undefined {
  const label = wordsOf(visible)
  const named = wordsOf(name)
  if (label.length === 0 || named.length < label.length) return undefined
  const joined = ` ${named.join(' ')} `
  if (joined.includes(` ${label.join(' ')} `)) return 'hyphenation'
  // "Info" for "Information": every visible word starts a word of the name, in order, and none is a single letter.
  for (let start = 0; start + label.length <= named.length; start++) {
    const window = named.slice(start, start + label.length)
    const prefixes = label.every((word, i) => word.length >= 3 && window[i]?.startsWith(word) === true)
    if (prefixes && label.some((word, i) => word !== window[i])) return 'abbreviation'
  }
  return undefined
}

const NOTES: Record<'hyphenation' | 'abbreviation', Record<Locale, string>> = {
  hyphenation: {
    en: 'Only hyphenation differs between the visible label and the accessible name: needs review, try it with speech input.',
    'pt-BR': 'Só o hífen difere entre o rótulo visível e o nome acessível: precisa de revisão, teste com comando de voz.',
  },
  abbreviation: {
    en: 'The visible label is a shortened form of words in the accessible name: needs review, try it with speech input.',
    'pt-BR': 'O rótulo visível é uma forma abreviada de palavras do nome acessível: precisa de revisão, teste com comando de voz.',
  },
}

/**
 * The text a person sees in the control. Text hidden only from assistive technology (aria-hidden) is still
 * on screen and part of the visible label: "Download <span aria-hidden>gizmo</span> specification" shows
 * three words (ACT 2ee8b8, Failed Example 16).
 */
function shownText(node: A11yNode): string {
  const parts: string[] = []
  const visit = (current: A11yNode): void => {
    if (current.states.includes('hidden')) return
    if (current.text) parts.push(current.text)
    for (const child of current.children) visit(child)
  }
  visit(node)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function reviewLabelInName(findings: Finding[], snapshot: A11ySnapshot, locale: Locale): Finding[] {
  if (!findings.some((finding) => finding.ruleId === LABEL_IN_NAME_RULE)) return findings
  const index = indexTree(snapshot.root)
  return findings.map((finding) => {
    if (finding.source !== 'engine' || finding.ruleId !== LABEL_IN_NAME_RULE || !finding.ref) return finding
    const node = index.get(finding.ref)?.node
    const name = node?.name?.trim()
    if (!node || !name) return finding
    const visible = shownText(node)
    const kind = nearMatch(visible, name)
    if (!kind) return finding
    return { ...finding, confidence: 'low', message: `${finding.message} ${NOTES[kind][locale]}`, evidence: `"${visible}" / "${name}"` }
  })
}

/** Inputs whose name is their own value or caption, not a label: buttons and the like. */
const NAMED_BY_VALUE = new Set(['hidden', 'submit', 'button', 'reset', 'image'])
/** "(required)" and "(optional)" marks a label carries and a name may leave out, like the asterisk. */
const MARKS = /\((?:required|optional|obrigat[óo]rio|opcional|obligatorio)\)/giu

/**
 * 2.5.3 for form fields: a field with a label on screen whose aria-label or aria-labelledby names it
 * otherwise ("CPF*" on screen, "document" read out). axe-core's label-content-name-mismatch looks only
 * at controls named by their content, so a text field with a <label> is never checked; the real-page
 * study (docs/studies) found one on sosma.org.br that no criterion reported.
 */
export const fieldLabelInNameRule: RuleCheck = {
  id: 'rampa/field-label-in-name',
  version: '1',
  criteria: ['2.5.3'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: [LABEL_IN_NAME_RULE],
  help: {
    en: "A field's accessible name must contain the label people see",
    'pt-BR': 'O nome acessível de um campo precisa conter o rótulo que as pessoas veem',
  },
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html',
  run(snapshot) {
    const ordered = [...walkTree(snapshot.root)]
    const hits: Hit[] = []
    let applicable = 0
    for (const field of ordered) {
      const tag = typeof field.native.tag === 'string' ? field.native.tag : ''
      const attributes = attributesOf(field)
      if ((tag !== 'input' && tag !== 'select' && tag !== 'textarea') || isHidden(field)) continue
      if (tag === 'input' && NAMED_BY_VALUE.has((attributes.type ?? '').toLowerCase())) continue
      // Only a name set over the label can differ from it: without aria-label or aria-labelledby, the label is the name.
      if (!attributes['aria-label']?.trim() && !attributes['aria-labelledby']?.trim()) continue
      const name = field.name?.trim()
      const labelled = labelsOf(field, ordered)
        .map((label) => labelText(label, field))
        .filter(Boolean)
        .join(' ')
        .replace(MARKS, ' ')
        .trim()
      // Without a label on screen, the placeholder may be the label people see ("CPF*"): whether it is, a person decides.
      const placeholder = labelled ? '' : (attributes.placeholder ?? '').replace(MARKS, ' ').trim()
      const visible = labelled || placeholder
      if (!name || wordsOf(visible).length === 0) continue
      applicable++
      const label = wordsOf(visible)
      if (` ${wordsOf(name).join(' ')} `.includes(` ${label.join(' ')} `)) continue
      const near = nearMatch(visible, name)
      const html = typeof field.native.html === 'string' ? field.native.html : ''
      hits.push({
        ref: field.ref,
        outcome: near || placeholder ? 'review' : 'fail',
        subject: `${visible} / ${name}`,
        evidence: `"${visible}" / "${name}"`,
        facts: {
          visible,
          name,
          near: near ?? '',
          shown: placeholder ? 'placeholder' : 'label',
          startTag: tag === 'input' ? html : '',
          source: attributes['aria-labelledby']?.trim() ? 'aria-labelledby' : 'aria-label',
        },
        html,
      })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const { visible, name, near, source } = hit.facts
    if (hit.facts.shown === 'placeholder') {
      return locale === 'pt-BR'
        ? `O campo mostra só o placeholder "${visible}" e se chama "${name}" (${source}): precisa de revisão. Se o placeholder é o rótulo que as pessoas veem, quem usa comando de voz diz esse texto, e o campo não responde.`
        : `The field shows only its placeholder, "${visible}", and is named "${name}" (${source}): needs review. If the placeholder is the label people see, people using speech input say it, and the field does not answer to it.`
    }
    if (near === 'hyphenation' || near === 'abbreviation') {
      const note = NOTES[near][locale]
      return locale === 'pt-BR' ? `O campo mostra "${visible}" e se chama "${name}". ${note}` : `The field shows "${visible}" and is named "${name}". ${note}`
    }
    return locale === 'pt-BR'
      ? `O rótulo visível "${visible}" não está no nome acessível do campo, "${name}", que vem do ${source}: quem usa comando de voz diz o que vê, e o campo não responde.`
      : `The visible label "${visible}" is not in the field's accessible name, "${name}", which comes from ${source}: people using speech input say what they see, and the field does not answer to it.`
  },
  patch(hit): Patch | undefined {
    // An input's start tag is the whole element: without aria-label, its <label> names it.
    const startTag = String(hit.facts.startTag)
    if (hit.outcome !== 'fail' || hit.facts.source !== 'aria-label' || !startTag) return undefined
    const after = startTag.replace(/\s+aria-label\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '')
    return after === startTag ? undefined : { ref: hit.ref, kind: 'replace-element', to: String(hit.facts.visible), before: startTag, after }
  },
}
