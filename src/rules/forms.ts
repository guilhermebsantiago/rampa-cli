import type { Patch } from '../core/types.ts'
import { escapeHtml, isHidden } from '../criteria/shared.ts'
import { labelsOrInstructions } from '../criteria/labels-or-instructions.ts'
import type { A11yNode } from '../snapshot/schema.ts'
import { indexTree, walkTree } from '../snapshot/tree.ts'
import type { Hit, RuleCheck } from './types.ts'

/**
 * 3.3.2: a field nothing on screen names. The candidates are the 3.3.2 module's own, so the rule sees
 * exactly what the model would: a field whose name comes only from aria-label, title or a hidden label,
 * with no visible label and no placeholder. The rule reports only the clear case the model is not needed
 * for: no visible text, button, legend or picture anywhere near the field. Search fields are left to
 * judgment, since their magnifier icon is often drawn in CSS, which the snapshot does not see.
 */

const SOURCES: Record<string, { en: string; 'pt-BR': string }> = {
  'aria-label': { en: 'its name is in aria-label, which only screen readers get', 'pt-BR': 'o nome está no aria-label, que só leitores de tela recebem' },
  title: { en: 'its name is in the title attribute, shown only as a tooltip', 'pt-BR': 'o nome está no atributo title, que só aparece como dica ao passar o mouse' },
  'hidden-label': { en: 'its label is hidden from view', 'pt-BR': 'o rótulo está escondido da tela' },
}

const PICTURE = (node: A11yNode) =>
  !isHidden(node) && (node.native.tag === 'img' || node.native.tag === 'svg' || node.role === 'img' || typeof node.native.backgroundImage === 'string')

export const noVisibleLabelRule: RuleCheck = {
  id: 'rampa/no-visible-label',
  version: '1',
  criteria: ['3.3.2'],
  maturity: 'experimental',
  surfaces: ['web'],
  act: [],
  engineRules: ['label', 'select-name', 'form-field-multiple-labels'],
  help: {
    en: 'A field needs a label people can see, not only a name for screen readers',
    'pt-BR': 'Um campo precisa de um rótulo que as pessoas vejam, não só de um nome para leitores de tela',
  },
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html',
  run(snapshot, engine) {
    const candidates = labelsOrInstructions.candidates(snapshot, engine)
    const index = indexTree(snapshot.root)
    const hits: Hit[] = []
    for (const candidate of candidates) {
      const c = candidate.context
      if (!c.hiddenSource || c.visibleLabel || c.placeholder || c.around.trim() !== '' || /^In the group:/m.test(c.facts)) continue
      const field = index.get(candidate.ref)
      if (!field || field.node.role === 'searchbox' || /type="search"/i.test(c.startTag) || PICTURE(field.node)) continue
      // A picture next to the field, up to its grandparent, may be the label people see (a magnifier, an envelope).
      let container = field.parentRef ? index.get(field.parentRef) : undefined
      if (container?.parentRef && container.node.children.length === 1) container = index.get(container.parentRef)
      if (container && [...walkTree(container.node)].some((node) => node !== field.node && PICTURE(node))) continue
      hits.push({
        ref: candidate.ref,
        outcome: 'fail',
        subject: c.name,
        evidence: c.startTag,
        facts: { name: c.name, source: c.hiddenSource, startTag: c.startTag, isInput: c.isInput, id: c.id ?? '' },
        html: c.startTag,
      })
    }
    return { hits, applicable: candidates.length }
  },
  message(hit, locale) {
    const source = SOURCES[String(hit.facts.source)]?.[locale] ?? ''
    return locale === 'pt-BR'
      ? `Nada na tela diz o que preencher neste campo: ${source} ("${hit.facts.name}"), e não há texto, botão nem legenda perto dele.`
      : `Nothing on screen says what to enter in this field: ${source} ("${hit.facts.name}"), and no text, button or legend sits near it.`
  },
  patch(hit): Patch | undefined {
    // Only an input's start tag is the whole element, so only an input can be rewritten in place.
    if (hit.facts.isInput !== true) return undefined
    const startTag = String(hit.facts.startTag)
    const label = escapeHtml(String(hit.facts.name))
    const id = String(hit.facts.id)
    const after = id ? `<label for="${escapeHtml(id)}">${label}</label> ${startTag}` : `<label>${label} ${startTag}</label>`
    return { ref: hit.ref, kind: 'replace-element', to: String(hit.facts.name), before: startTag, after }
  },
}
