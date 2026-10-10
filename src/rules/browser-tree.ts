import { truncate } from '../core/util.ts'
import { attributesOf, isHidden, startTagOf, subtreeText } from '../criteria/shared.ts'
import type { Locale } from '../i18n.ts'
import { exposed, exposedName, exposedRole, liveRegions, nameSource } from '../snapshot/ax.ts'
import type { A11yNode } from '../snapshot/schema.ts'
import { walkTree } from '../snapshot/tree.ts'
import { nearMatch } from './label-in-name.ts'
import type { Hit, RuleCheck } from './types.ts'

/**
 * Rules over the browser's own accessibility tree (wave B2 of docs/plans/wcag-coverage.md): what Chromium exposes
 * for each element, read over CDP and recorded on the node (`node.ax`, surfaces/ax-tree.ts). They report only what
 * axe-core leaves out: names for roles its rules do not select, controls the browser exposes with no role, states a
 * widget never exposes, and a visible label an aria-label replaces where axe-core does not look. On a snapshot
 * without the browser's tree (another browser, an older snapshot) they find nothing to apply to and say nothing.
 */

const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/'

const visible = (node: A11yNode) => !isHidden(node)

// 4.1.2: a control the browser exposes with a role that needs a name, and computes none.

/**
 * Roles of controls that need a name (WAI-ARIA 1.2, "Accessible Name Required"). axe-core's rules select most of
 * them by element or by an explicit role attribute, and an element axe-core failed is left to it. What is left: tree
 * items, which no WCAG-tagged axe-core rule names (aria-treeitem-name is best practice), and controls axe-core's own
 * name computation passed or its selectors miss where the browser computes no name.
 */
const NAMED_CONTROLS = new Set([
  'button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'radio',
  'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem',
  // Links of the digital publishing roles, and the date, time and color fields Chromium names in its own words.
  'doc-backlink', 'doc-biblioref', 'doc-glossref', 'doc-noteref', 'Date', 'DateTime', 'InputTime', 'ColorWell',
])

/** Chromium's own words for some fields, as a message says them. */
const ROLE_WORDS: Record<string, string> = { Date: 'date field', DateTime: 'date and time field', InputTime: 'time field', ColorWell: 'color field' }

/** A name made only of icon-font glyphs (Unicode private use characters), which screen readers do not read: CSS content the browser put in the name. */
const GLYPHS_ONLY = /^[\s\p{Co}]+$/u

const codePoints = (text: string) =>
  [...text.trim()]
    .filter((char) => char.trim() !== '')
    .map((char) => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ')

export const widgetNameRule: RuleCheck = {
  id: 'rampa/widget-name',
  version: '1',
  criteria: ['4.1.2'],
  maturity: 'experimental',
  surfaces: ['web'],
  narrow: true,
  act: ['e086e5', '97a4e1', 'm6b1q3', 'c487ae', '59796f', '2t702h'],
  engineRules: [
    'button-name', 'input-button-name', 'aria-command-name', 'link-name', 'aria-input-field-name', 'aria-toggle-field-name', 'label', 'select-name',
    'summary-name', 'input-image-alt', 'area-alt', 'aria-tooltip-name', 'aria-treeitem-name', 'svg-img-alt', 'role-img-alt',
  ],
  help: {
    en: 'A control the browser exposes must have an accessible name',
    'pt-BR': 'Um controle que o navegador expõe precisa ter um nome acessível',
  },
  helpUrl: `${UNDERSTANDING}name-role-value.html`,
  run(snapshot) {
    const hits: Hit[] = []
    let applicable = 0
    // A combobox's popup takes its context from the combobox, and needs no name of its own (axe-core leaves it out too).
    const popups = new Set<string>()
    for (const node of walkTree(snapshot.root)) {
      if (exposedRole(node) === 'combobox') for (const ref of [...(node.ax?.relations?.controls ?? []), ...(node.ax?.relations?.owns ?? [])]) popups.add(ref)
    }
    for (const node of walkTree(snapshot.root)) {
      const role = exposedRole(node)
      if (role === 'listbox' && popups.has(node.ref)) continue
      // What the browser exposes decides, not what the collector saw as hidden: an image map's area has no box of its
      // own, and the browser still exposes it as a link. Content not rendered has no node in the browser's tree.
      if (!role || !NAMED_CONTROLS.has(role) || !exposed(node) || node.states.includes('aria-hidden')) continue
      applicable++
      const name = (exposedName(node) ?? '').trim()
      const glyphs = name !== '' && GLYPHS_ONLY.test(name)
      if (name !== '' && !glyphs) continue
      const text = truncate(subtreeText(node), 60)
      const description = node.ax?.description ?? ''
      const said = ROLE_WORDS[role] ?? role
      // A name of glyphs only says nothing, but a description (a title) may still be read out: a person decides.
      const outcome = glyphs && description ? 'review' : 'fail'
      const evidence = glyphs ? `role ${role} · name ${codePoints(name)}${description ? ` · description "${truncate(description, 60)}"` : ''}` : `role ${role} · name ""`
      hits.push({ ref: node.ref, outcome, subject: role, evidence, facts: { role: said, text, glyphs: glyphs ? codePoints(name) : '', description: truncate(description, 60) }, html: startTagOf(node) })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    if (hit.facts.glyphs) {
      const description = hit.facts.description ? (locale === 'pt-BR' ? ` A descrição "${hit.facts.description}" pode ser lida depois; precisa de revisão.` : ` Its description, "${hit.facts.description}", may be read after it; needs review.`) : ''
      return locale === 'pt-BR'
        ? `O nome que o navegador calcula para este ${hit.facts.role} é só um ícone de fonte (${hit.facts.glyphs}, um caractere de uso privado vindo do CSS), que o leitor de tela não lê.${description} Dê a ele um nome em texto (aria-label ou texto escondido visualmente) e esconda o ícone (aria-hidden).`
        : `The name the browser computes for this ${hit.facts.role} is only an icon-font glyph (${hit.facts.glyphs}, a private use character from CSS), which screen readers do not read.${description} Give it a text name (aria-label or visually hidden text) and hide the icon (aria-hidden).`
    }
    return locale === 'pt-BR'
      ? `O navegador expõe este elemento como ${hit.facts.role}, mas não calcula nome nenhum para ele: o leitor de tela anuncia só "${hit.facts.role}", sem dizer para que serve. Dê um nome a ele (texto visível, aria-labelledby ou aria-label).`
      : `The browser exposes this element as a ${hit.facts.role} but computes no name for it: a screen reader announces only "${hit.facts.role}", not what it is for. Give it a name (visible text, aria-labelledby or aria-label).`
  },
}

// 4.1.2 (F59): an element that works as a control, which the browser exposes with no control role.

/** Roles of controls and of the widgets that hold them: an element inside one of them is part of a widget. */
const CONTROL_ROLES = new Set([...NAMED_CONTROLS, 'option', 'gridcell', 'columnheader', 'rowheader', 'menu', 'menubar', 'tablist', 'tree', 'treegrid', 'grid', 'radiogroup', 'listbox', 'toolbar', 'dialog', 'alertdialog', 'application'])
const NATIVE_CONTROLS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'iframe', 'video', 'audio'])

function holdsControl(node: A11yNode): boolean {
  return [...walkTree(node)].some(
    (inner) => inner !== node && !isHidden(inner) && (CONTROL_ROLES.has(exposedRole(inner) ?? inner.role) || NATIVE_CONTROLS.has(String(inner.native.tag)) || inner.states.includes('focusable')),
  )
}

export const customControlRule: RuleCheck = {
  id: 'rampa/custom-control',
  version: '1',
  criteria: ['4.1.2'],
  maturity: 'experimental',
  surfaces: ['web'],
  narrow: true,
  act: [],
  engineRules: ['aria-allowed-role', 'nested-interactive'],
  help: {
    en: 'An element that works as a control must expose a control role (F59)',
    'pt-BR': 'Um elemento que funciona como controle precisa expor um papel de controle (F59)',
  },
  helpUrl: 'https://www.w3.org/WAI/WCAG22/Techniques/failures/F59',
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    let applicable = 0
    for (const node of walkTree(snapshot.root)) {
      const events = node.ax?.listeners
      // Only elements the collector asked the browser about: focusable by tabindex, or with an inline handler.
      if (!node.ax || node.ax.ignored || events === undefined || CONTROL_ROLES.has(exposedRole(node) ?? '')) continue
      if (!visible(node) || !node.bounds || node.bounds.width < 1 || node.bounds.height < 1) continue
      applicable++
      if (events.length === 0 || node.ax.scrollable || holdsControl(node)) continue
      // Inside a widget (a grid cell, a menu), the widget's own role and keys may already cover it.
      let parentRef = ctx.index.get(node.ref)?.parentRef
      let inWidget = false
      while (parentRef && !inWidget) {
        const parent = ctx.index.get(parentRef)?.node
        inWidget = parent !== undefined && CONTROL_ROLES.has(exposedRole(parent) ?? '')
        parentRef = ctx.index.get(parentRef)?.parentRef
      }
      if (inWidget) continue
      const role = exposedRole(node) ?? node.role
      const text = truncate(exposedName(node) || subtreeText(node), 60)
      hits.push({
        ref: node.ref,
        outcome: 'fail',
        subject: `${role} ${events.join(',')}`,
        evidence: `role ${role} · ${events.join(', ')}${text ? ` · "${text}"` : ''}`,
        facts: { role, events: events.join(', '), text, focusable: node.states.includes('focusable') },
        html: startTagOf(node),
      })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const what = hit.facts.text ? ` ("${hit.facts.text}")` : ''
    if (locale === 'pt-BR') {
      const how = hit.facts.focusable === true ? 'recebe foco pelo teclado e responde a' : 'responde a'
      return `Este elemento${what} ${how} ${hit.facts.events}, então funciona como um controle, mas o navegador o expõe como ${hit.facts.role}, sem papel de controle: o leitor de tela não anuncia que é um botão ou link (F59). Use o elemento nativo (button, a) ou dê a ele o papel do controle que ele é.`
    }
    const how = hit.facts.focusable === true ? 'takes keyboard focus and listens to' : 'listens to'
    return `This element${what} ${how} ${hit.facts.events}, so it works as a control, but the browser exposes it as ${hit.facts.role}, with no control role: a screen reader does not announce it as a button or a link (F59). Use the native element (button, a) or give it the role of the control it is.`
  },
}

// 4.1.2: a tab list where no tab is exposed as the selected one.

export const tabStateRule: RuleCheck = {
  id: 'rampa/tab-state',
  version: '1',
  criteria: ['4.1.2'],
  maturity: 'experimental',
  surfaces: ['web'],
  narrow: true,
  act: [],
  engineRules: ['aria-required-attr', 'aria-required-children'],
  help: {
    en: 'In a tab list, the selected tab must be exposed as selected (aria-selected)',
    'pt-BR': 'Numa lista de abas, a aba selecionada precisa ser exposta como selecionada (aria-selected)',
  },
  helpUrl: `${UNDERSTANDING}name-role-value.html`,
  run(snapshot) {
    const hits: Hit[] = []
    let applicable = 0
    for (const list of walkTree(snapshot.root)) {
      if (exposedRole(list) !== 'tablist' || !exposed(list) || !visible(list)) continue
      const tabs: A11yNode[] = []
      const visit = (node: A11yNode): void => {
        for (const child of node.children) {
          // A tab list nested in this one holds its own tabs.
          if (exposedRole(child) === 'tablist') continue
          if (exposedRole(child) === 'tab' && exposed(child) && visible(child)) tabs.push(child)
          else visit(child)
        }
      }
      visit(list)
      if (tabs.length < 2) continue
      applicable++
      if (tabs.some((tab) => tab.ax?.props?.selected === true)) continue
      const names = tabs.map((tab) => truncate(exposedName(tab) ?? '', 30)).filter(Boolean)
      hits.push({
        ref: list.ref,
        outcome: 'fail',
        subject: names.join(' | ') || `${tabs.length} tabs`,
        evidence: `${tabs.length} tabs, none selected${names.length > 0 ? `: ${names.slice(0, 4).join(', ')}` : ''}`,
        facts: { count: tabs.length, names: names.slice(0, 4).join(', ') },
        html: startTagOf(list),
      })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    return locale === 'pt-BR'
      ? `Nenhuma das ${hit.facts.count} abas desta lista é exposta como selecionada: o leitor de tela não diz qual painel está aberto. Marque a aba atual com aria-selected="true" (e as outras com "false").`
      : `None of the ${hit.facts.count} tabs in this list is exposed as selected: a screen reader does not say which panel is open. Mark the current tab with aria-selected="true" (and the others with "false").`
  },
}

// 4.1.2: a button that shows and hides content and exposes no expanded state. Review: a person decides.

export const disclosureStateRule: RuleCheck = {
  id: 'rampa/disclosure-state',
  version: '1',
  criteria: ['4.1.2'],
  maturity: 'experimental',
  surfaces: ['web'],
  narrow: true,
  act: [],
  engineRules: [],
  help: {
    en: 'A button that shows and hides content should expose whether it is expanded (aria-expanded)',
    'pt-BR': 'Um botão que mostra e esconde conteúdo deve expor se está expandido (aria-expanded)',
  },
  helpUrl: `${UNDERSTANDING}name-role-value.html`,
  run(snapshot, _engine, ctx) {
    const hits: Hit[] = []
    let applicable = 0
    for (const node of walkTree(snapshot.root)) {
      const controls = node.ax?.relations?.controls
      if (exposedRole(node) !== 'button' || !controls || !exposed(node) || !visible(node)) continue
      const props = node.ax?.props ?? {}
      // A popup button (a menu, a dialog) need not say it is expanded while closed.
      if (props.hasPopup !== undefined) continue
      const controlled = controls.map((ref) => ctx.index.get(ref)?.node).filter((target): target is A11yNode => target !== undefined)
      if (controlled.length === 0 || !controlled.every((target) => target.states.includes('hidden'))) continue
      if (controlled.some((target) => target.native.tag === 'dialog' || ['dialog', 'alertdialog'].includes(attributesOf(target).role ?? ''))) continue
      applicable++
      if (props.expanded !== undefined || props.pressed !== undefined) continue
      const name = truncate(exposedName(node) ?? '', 60)
      hits.push({
        ref: node.ref,
        outcome: 'review',
        subject: name || controls.join(' '),
        evidence: `aria-controls → ${controlled.map((target) => target.ref).join(', ')} (hidden) · no aria-expanded`,
        facts: { name },
        html: startTagOf(node),
      })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    const name = hit.facts.name ? ` "${hit.facts.name}"` : ''
    return locale === 'pt-BR'
      ? `O botão${name} controla conteúdo escondido (aria-controls), mas não expõe se está expandido: se ele mostra e esconde esse conteúdo, o leitor de tela não diz se está aberto. Precisa de revisão; se é uma divulgação, use aria-expanded="false" e "true".`
      : `The button${name} controls hidden content (aria-controls) but exposes no expanded state: if it shows and hides that content, a screen reader does not say whether it is open. Needs review; if it is a disclosure, use aria-expanded="false" and "true".`
  },
}

// 2.5.3: an input button whose aria-label replaces the words on it.

const INPUT_BUTTONS = new Set(['submit', 'button', 'reset'])

/** An attribute of a start tag as written, or undefined. */
function attributeIn(startTag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(startTag)
  if (!match) return undefined
  return (match[2] ?? match[3] ?? match[4] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[-­‐‑‒–]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')

export const buttonLabelInNameRule: RuleCheck = {
  id: 'rampa/button-label-in-name',
  version: '1',
  criteria: ['2.5.3'],
  maturity: 'experimental',
  surfaces: ['web'],
  narrow: true,
  act: ['2ee8b8'],
  engineRules: ['label-content-name-mismatch'],
  help: {
    en: "An input button's accessible name must contain the words shown on it",
    'pt-BR': 'O nome acessível de um botão input precisa conter as palavras que aparecem nele',
  },
  helpUrl: `${UNDERSTANDING}label-in-name.html`,
  run(snapshot) {
    const hits: Hit[] = []
    let applicable = 0
    for (const node of walkTree(snapshot.root)) {
      if (node.native.tag !== 'input' || !INPUT_BUTTONS.has((attributesOf(node).type ?? '').toLowerCase()) || !exposed(node) || !visible(node)) continue
      const from = nameSource(node)
      // The browser named it from its value: the words on it are its name.
      if (from !== 'aria-label' && from !== 'aria-labelledby') continue
      const html = startTagOf(node)
      const shown = (attributeIn(html, 'value') ?? '').trim()
      const name = (exposedName(node) ?? '').trim()
      if (!shown || !name || wordsOf(shown).length === 0) continue
      applicable++
      if (` ${wordsOf(name).join(' ')} `.includes(` ${wordsOf(shown).join(' ')} `)) continue
      const near = nearMatch(shown, name)
      hits.push({
        ref: node.ref,
        outcome: near ? 'review' : 'fail',
        subject: `${shown} / ${name}`,
        evidence: `"${shown}" / "${name}"`,
        facts: { shown, name, source: from, near: near ?? '' },
        html,
      })
    }
    return { hits, applicable }
  },
  message(hit, locale) {
    if (hit.facts.near) {
      return locale === 'pt-BR'
        ? `O botão mostra "${hit.facts.shown}" e se chama "${hit.facts.name}" (${hit.facts.source}): a diferença é só ${hit.facts.near === 'hyphenation' ? 'de hífen' : 'de abreviação'}. Precisa de revisão; teste com comando de voz.`
        : `The button shows "${hit.facts.shown}" and is named "${hit.facts.name}" (${hit.facts.source}): only ${hit.facts.near} differs. Needs review; try it with speech input.`
    }
    return locale === 'pt-BR'
      ? `O botão mostra "${hit.facts.shown}", mas o ${hit.facts.source} o renomeia para "${hit.facts.name}": quem usa comando de voz diz o que vê, e o botão não responde.`
      : `The button shows "${hit.facts.shown}", but its ${hit.facts.source} renames it "${hit.facts.name}": people using speech input say what they see, and the button does not answer to it.`
  },
}

// 4.1.3: the live regions the browser exposes, as an inventory for a person. It never fails or passes anything.

const MAX_LISTED = 5

function regionText(node: A11yNode, locale: Locale): string {
  const role = exposedRole(node) ?? node.role
  const live = node.ax?.props?.live
  const text = truncate(subtreeText(node), 40)
  const parts = [role, typeof live === 'string' ? live : 'off', node.ax?.props?.atomic === true ? 'atomic' : undefined, text ? `"${text}"` : locale === 'pt-BR' ? 'vazia' : 'empty']
  return `${node.ref} (${parts.filter(Boolean).join(', ')})`
}

export const liveRegionsRule: RuleCheck = {
  id: 'rampa/live-regions',
  version: '1',
  criteria: ['4.1.3'],
  maturity: 'experimental',
  surfaces: ['web'],
  narrow: true,
  inventory: true,
  act: [],
  engineRules: [],
  help: {
    en: 'Live regions the browser exposes, where status messages can be announced',
    'pt-BR': 'Regiões ao vivo que o navegador expõe, onde mensagens de status podem ser anunciadas',
  },
  helpUrl: `${UNDERSTANDING}status-messages.html`,
  run(snapshot, _engine, ctx) {
    const regions = liveRegions(snapshot.root).filter(visibleOrEmpty)
    if (regions.length === 0) return { hits: [], applicable: 0 }
    const shown = regions.slice(0, MAX_LISTED).map((node) => regionText(node, ctx.locale))
    const more = regions.length - shown.length
    const list = `${shown.join('; ')}${more > 0 ? ` +${more}` : ''}`
    const note =
      ctx.locale === 'pt-BR'
        ? `${regions.length} região(ões) ao vivo: ${list}. Se as mensagens de status chegam a elas só se verifica com a página em uso`
        : `${regions.length} live region(s): ${list}. Whether status messages reach them only shows with the page in use`
    return { hits: [], applicable: regions.length, note }
  },
  message() {
    return ''
  },
}

/** A live region counts when the browser exposes it, even empty: an empty status container is how most start. */
function visibleOrEmpty(node: A11yNode): boolean {
  return exposed(node) && !node.states.includes('aria-hidden')
}

export const BROWSER_TREE_RULES: readonly RuleCheck[] = [widgetNameRule, customControlRule, tabStateRule, disclosureStateRule, buttonLabelInNameRule, liveRegionsRule]
