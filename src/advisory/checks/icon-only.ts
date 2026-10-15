import { shownText } from '../../criteria/labels-or-instructions.ts'
import type { A11yNode, IconControlFacts } from '../../snapshot/schema.ts'
import type { AdvisoryCheck, AdvisoryHit, CheckRun } from '../check.ts'
import { cogaBasis } from '../coga.ts'
import { gaiaReference, webaimReference } from '../guides.ts'
import { am } from '../messages.ts'
import { type Page, parentOf, tagOf } from '../page.ts'
import { MAX_CONTROL_GROUPS, capGroups, groupBy, leftOutNote, nodeOf, notMeasured, presentationOf, quotedList, regionOf } from '../presentation.ts'

/**
 * COGA o4p06 Use Clear Visible Labels (https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p06-clear-labels/), How it
 * Helps: "Some controls do not have visual labels. A caregiver shows them what the control is for and they can use the
 * application. The next day they try to use it again, but cannot remember what the control is for." With COGA o1p07
 * ("Provide common icons next to key texts"), GAIA G14 ("Símbolos, pictogramas e ícones devem apresentar um equivalente
 * textual próximo") and WebAIM ("Pair icons or graphics with text").
 *
 * A rule over the facts the collector measured: a link, button, menu item or tab whose accessible name has words but
 * which shows none, only an svg, an image, an icon font, a CSS icon, a symbol or a CSS background. A control with no
 * name is a WCAG failure already (axe-core button-name, link-name) and is left to it. Controls in one region (a row of
 * social icons, a toolbar, a footer) make one result.
 *
 * Exempt, by name: search and home, the two the Nielsen Norman Group found nearly universally recognized as icons
 * (Harley, "Icon Usability", 2014: "The icons for home, print, and the magnifying glass for search are such
 * instances"), and close, which acts on the dialog or banner it sits on, so nothing is lost when the × is misread. The
 * hamburger menu is not exempt: the same study calls it an icon "striving to become universally known". A control with
 * its name shown right next to it (a visible label beside the icon) is not reported either.
 */

/** Names of the exempt controls, in English, Portuguese and Spanish: what the control does, at the start of its name. */
export const EXEMPT_NAMES =
  /^(?:close|dismiss|fechar|cerrar|search|buscar|pesquisar|procurar|busca|búsqueda|home|home page|homepage|início|inicio|página inicial|pagina inicial)(?:\s|$)/iu

const ROLES = new Set(['link', 'button', 'menuitem', 'tab'])
const O4P06 = cogaBasis(
  'o4p06',
  'how-it-helps',
  'Some controls do not have visual labels. A caregiver shows them what the control is for and they can use the application. The next day they try to use it again, but cannot remember what the control is for.',
)
const O1P07 = cogaBasis('o1p07', 'getting-started', 'Provide common icons next to key texts, headings, media sections, “contact us” buttons, and "help" buttons.')

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The name assistive technology gets: the browser's, else what the presentation facts computed, else the collector's. */
export function controlName(node: A11yNode, fact?: IconControlFacts): string {
  return (node.ax?.name ?? fact?.name ?? node.name ?? '').replace(/\s+/g, ' ').trim()
}

/** Whether a name has words: two letters or a digit, not a lone glyph. */
function hasWords(name: string): boolean {
  return (name.match(/\p{L}/gu)?.length ?? 0) >= 2 || /\p{N}/u.test(name)
}

/** The control's name shown right next to it, as the text of its previous or next sibling: a visible label beside the icon. */
function labelledBeside(page: Page, node: A11yNode, name: string): boolean {
  const parent = parentOf(page, node)
  if (!parent) return false
  const index = parent.children.indexOf(node)
  const wanted = normalize(name)
  for (const sibling of [parent.children[index - 1], parent.children[index + 1]]) {
    if (!sibling) continue
    const text = normalize(shownText(sibling))
    if (text.length >= 3 && text.length <= 60 && (text.includes(wanted) || wanted.includes(text))) return true
  }
  return false
}

interface Entry {
  fact: IconControlFacts
  node: A11yNode
  name: string
}

export const iconOnlyControl: AdvisoryCheck = {
  id: 'coga/icon-only-control',
  version: '1',
  maturity: 'experimental',
  pattern: 'o4p06',
  gaia: ['G14'],
  surfaces: ['web'],

  run({ page, locale }): CheckRun {
    const facts = presentationOf(page)
    if (!facts) return notMeasured(page)
    const entries: Entry[] = []
    let candidates = 0
    for (const fact of facts.controls) {
      const node = nodeOf(page, fact.ref)
      if (!node || node.ax?.ignored) continue
      const name = controlName(node, fact)
      // No name: a WCAG failure (button-name, link-name) that axe-core reports; a name that is only a glyph, 4.1.2 in browser-tree.ts.
      if (!hasWords(name)) continue
      candidates++
      if (EXEMPT_NAMES.test(normalize(name)) || labelledBeside(page, node, name)) continue
      entries.push({ fact, node, name })
    }
    const notes: string[] = []
    const hits: AdvisoryHit[] = []
    const groups = groupBy(entries, (entry) => regionOf(page, entry.node)?.ref ?? entry.node.ref)
    for (const group of capGroups(groups, MAX_CONTROL_GROUPS, 'coga/icon-only-control', locale, notes)) {
      const first = group[0] as Entry
      const picture = group.some((entry) => entry.fact.icon === 'img' || entry.fact.icon === 'background')
      const icon = am(locale, `icon_${first.fact.icon}`, { glyph: first.fact.glyph ?? '' })
      const role = ROLES.has(first.node.role) ? first.node.role : tagOf(first.node) === 'a' ? 'link' : 'button'
      const parts =
        group.length === 1
          ? [am(locale, 'iconOne', { this: am(locale, `this_${role as 'link'}`), icon, name: first.name })]
          : [am(locale, 'iconMany', { count: group.length, names: quotedList(group.map((entry) => entry.name)) })]
      parts.push(am(locale, 'iconRecommend'))
      if (picture) parts.push(am(locale, 'iconPicture'))
      hits.push({
        kind: 'advisory',
        basis: O4P06,
        related: [O1P07, gaiaReference('G14'), webaimReference('Use images to enhance content')],
        impact: 'hurdle',
        source: 'rule',
        ref: first.node.ref,
        html: typeof first.node.native.html === 'string' ? first.node.native.html : undefined,
        message: parts.join(' '),
        evidence: typeof first.node.native.html === 'string' ? first.node.native.html : undefined,
        subject: group.length === 1 ? first.name : (regionOf(page, first.node)?.ref ?? first.node.ref),
        facts: {
          controls: group.length,
          names: group.map((entry) => entry.name).join(' | '),
          icon: [...new Set(group.map((entry) => entry.fact.icon))].join(', '),
          refs: group
            .slice(0, 5)
            .map((entry) => entry.node.ref)
            .join(' | '),
          ...(first.fact.glyph ? { glyph: first.fact.glyph } : {}),
          ...(first.fact.hint ? { hint: first.fact.hint } : {}),
        },
        // A picture may have words drawn in it, which Rampa does not read.
        confidence: picture ? 'medium' : 'high',
      })
    }
    const note = leftOutNote(facts, 'controls', locale)
    if (note) notes.push(note)
    return { ran: true, candidates, hits, notes }
  },
}
