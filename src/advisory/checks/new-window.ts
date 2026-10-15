import type { A11yNode, NewWindowFacts } from '../../snapshot/schema.ts'
import type { AdvisoryCheck, AdvisoryHit, CheckRun } from '../check.ts'
import { G201, gaiaBasis } from '../guides.ts'
import { am } from '../messages.ts'
import { MAX_CONTROL_GROUPS, capGroups, groupBy, leftOutNote, nodeOf, notMeasured, presentationOf, quotedList, regionOf } from '../presentation.ts'

/**
 * GAIA G22 Consistência (https://gaia.wiki.br/reconhecimento-e-previsibilidade/): "O alvo dos links deve ser sempre
 * previsível. Por exemplo: links que abrem em uma nova janela ou aba do navegador devem ser claramente indicados através
 * de ícones ou indicativo textual." With WCAG technique G201, advisory for 2.4.4, 2.4.6, 2.4.9 and 3.2.5: opening a new
 * window "can be disorienting ... for some people with cognitive disabilities, if they are not warned in advance", and
 * then "their browser's "back" button will not work". No COGA pattern names it; COGA o8p01 lists "the automatic launching
 * of new windows", which a link a person follows is not.
 *
 * A rule over the facts the collector measured: a link with a target that opens a new browsing context (`_blank`, or a
 * name no frame on the page has), or an inline handler that calls window.open, when nothing it shows, nothing assistive
 * technology reads (its name, visually hidden text, the alternatives of its icons) and nothing in its description says
 * it opens a new window or tab, in English, Portuguese or Spanish. An icon with no text alternative whose classes name an
 * external-link or new-window glyph may say it to people who see it: those links are reported at low confidence, below
 * the default threshold. Links of one region (a footer, a list of partners) make one result.
 */

/** Words that say a link opens a new window or tab: English, Portuguese, Spanish. */
export const NEW_WINDOW_WORDS =
  /\bnew (?:browser )?(?:tab|window)\b|\bopens?\s+(?:in|a|an)\b|\b(?:in|into) (?:a )?(?:new|separate|another) (?:tab|window)\b|\bexternal (?:tab|window)\b|\bpop-?up\b|\bnova (?:aba|janela|guia)\b|\babre(?:-se)? (?:em|numa|noutra|uma)\b|\boutra (?:aba|janela|guia)\b|\bjanela externa\b|\bnueva (?:pestaña|ventana)\b|\b(?:se )?abre en\b|\botra (?:pestaña|ventana)\b/iu

/** Classes or addresses of icons that mean "external link" or "new window": an indication people who see it may get. */
export const NEW_WINDOW_ICON = /external|new-?(?:window|tab)|open-?in-?new|launch|pop-?out|pop-?up|nova-?(?:janela|aba)|arrow-up-right|box-arrow|share-square/i

const G22 = gaiaBasis(
  'G22',
  'O alvo dos links deve ser sempre previsível. Por exemplo: links que abrem em uma nova janela ou aba do navegador devem ser claramente indicados através de ícones ou indicativo textual.',
)

/** Everything that could say it: what the link shows, what is read, its description, and the browser's own name and description. */
export function saysNewWindow(fact: NewWindowFacts, node: A11yNode): boolean {
  const said = [fact.text, fact.hidden, fact.description, node.name, node.ax?.name, node.ax?.description].filter(Boolean).join(' ')
  return NEW_WINDOW_WORDS.test(said)
}

interface Entry {
  fact: NewWindowFacts
  node: A11yNode
  name: string
  /** An icon that may show it, with no text alternative. */
  icon: boolean
}

export const newWindow: AdvisoryCheck = {
  id: 'coga/new-window',
  version: '1',
  maturity: 'experimental',
  gaia: ['G22'],
  surfaces: ['web'],

  run({ page, locale }): CheckRun {
    const facts = presentationOf(page)
    if (!facts) return notMeasured(page)
    const entries: Entry[] = []
    let candidates = 0
    for (const fact of facts.links) {
      const node = nodeOf(page, fact.ref)
      if (!node || node.ax?.ignored) continue
      candidates++
      if (saysNewWindow(fact, node)) continue
      const name = (node.ax?.name ?? node.name ?? fact.text).replace(/\s+/g, ' ').trim() || (typeof node.native.attributes === 'object' ? String((node.native.attributes as Record<string, string>).href ?? '') : '')
      entries.push({ fact, node, name, icon: fact.icon !== undefined && NEW_WINDOW_ICON.test(fact.icon) })
    }
    const notes: string[] = []
    const hits: AdvisoryHit[] = []
    const groups = groupBy(entries, (entry) => `${regionOf(page, entry.node)?.ref ?? entry.node.ref}|${entry.icon}`)
    for (const group of capGroups(groups, MAX_CONTROL_GROUPS, 'coga/new-window', locale, notes)) {
      const first = group[0] as Entry
      const how = first.fact.by === 'target' ? am(locale, 'how_target', { target: first.fact.target ?? '_blank' }) : am(locale, 'how_script')
      const parts =
        group.length === 1
          ? [am(locale, 'newWindowOne', { how, name: first.name })]
          : [am(locale, 'newWindowMany', { count: group.length, how, names: quotedList(group.map((entry) => entry.name)) })]
      parts.push(am(locale, 'newWindowRecommend'))
      if (first.icon) parts.push(am(locale, 'newWindowIcon', { icon: first.fact.icon ?? '' }))
      hits.push({
        kind: 'advisory',
        basis: G22,
        related: [G201],
        impact: 'hurdle',
        source: 'rule',
        ref: first.node.ref,
        html: typeof first.node.native.html === 'string' ? first.node.native.html : undefined,
        message: parts.join(' '),
        evidence: typeof first.node.native.html === 'string' ? first.node.native.html : undefined,
        subject: group.length === 1 ? first.name : `${regionOf(page, first.node)?.ref ?? first.node.ref}|${first.icon}`,
        facts: {
          links: group.length,
          names: group.map((entry) => entry.name).join(' | '),
          opensBy: first.fact.by,
          ...(first.fact.target ? { target: first.fact.target } : {}),
          refs: group
            .slice(0, 5)
            .map((entry) => entry.node.ref)
            .join(' | '),
          searched: 'shown text, accessible name, visually hidden text, icon alternatives, aria-describedby, title',
          ...(first.fact.icon ? { icon: first.fact.icon } : {}),
        },
        confidence: first.icon ? 'low' : 'high',
      })
    }
    const note = leftOutNote(facts, 'links', locale)
    if (note) notes.push(note)
    return { ran: true, candidates, hits, notes }
  },
}
