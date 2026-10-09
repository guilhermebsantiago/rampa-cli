import type { Confidence, EngineNode, EngineResults, EngineRuleResult } from '../core/types.ts'
import { truncate } from '../core/util.ts'
import type { Locale } from '../i18n.ts'
import { type ContrastReason, formatRatio, measureTextContrast } from '../pixels/contrast.ts'
import type { RgbaImage } from '../pixels/png.ts'
import type { A11yNode, A11ySnapshot } from '../snapshot/schema.ts'
import { indexTree, walkTree } from '../snapshot/tree.ts'
import { isImageLike, nameFromContent, toPixels } from '../surfaces/native.ts'
import { VERSION } from '../version.ts'

/**
 * The deterministic engine for surfaces without axe-core: rules over the normalized tree
 * (Android, iOS and other native snapshots) and text contrast measured from the
 * screenshot. Like axe-core on the web, a violation goes straight to the report, with no
 * model involved; what a rule cannot decide is reported as incomplete, never as a failure.
 */

export const RULES_ENGINE = 'rampa-rules'

type Text = Record<Locale, string>

interface RuleSpec {
  criteria: string[]
  help: Text
  helpUrl: string
}

const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG21/Understanding/'

export const NATIVE_RULES: Record<string, RuleSpec> = {
  'control-name': {
    criteria: ['4.1.2'],
    help: { en: 'Controls must have a name that assistive technology can read', 'pt-BR': 'Controles precisam de um nome que a tecnologia assistiva consiga ler' },
    helpUrl: `${UNDERSTANDING}name-role-value.html`,
  },
  'image-control-name': {
    criteria: ['1.1.1', '4.1.2'],
    help: { en: 'Image buttons must have a text alternative', 'pt-BR': 'Botões de imagem precisam de um texto alternativo' },
    helpUrl: `${UNDERSTANDING}non-text-content.html`,
  },
  'image-name': {
    criteria: ['1.1.1'],
    help: {
      en: 'Images must have a text alternative or be hidden from assistive technology',
      'pt-BR': 'Imagens precisam de um texto alternativo ou ficar ocultas da tecnologia assistiva',
    },
    helpUrl: `${UNDERSTANDING}non-text-content.html`,
  },
  'field-name': {
    criteria: ['4.1.2'],
    help: { en: 'Text fields must have a name', 'pt-BR': 'Campos de texto precisam de um nome' },
    helpUrl: `${UNDERSTANDING}name-role-value.html`,
  },
  'text-contrast': {
    criteria: ['1.4.3'],
    help: {
      en: 'Text must have a contrast of at least 4.5:1 with its background (3:1 for large text)',
      'pt-BR': 'Texto precisa de contraste de pelo menos 4,5:1 com o fundo (3:1 para texto grande)',
    },
    helpUrl: `${UNDERSTANDING}contrast-minimum.html`,
  },
}

/** How the report names a control in English; Portuguese says "controle" for all, which keeps the grammar simple. */
const ROLE_WORDS: Record<string, string> = {
  generic: 'clickable element',
  radio: 'radio button',
  menuitem: 'menu item',
  spinbutton: 'stepper',
  combobox: 'drop-down',
  listitem: 'list item',
  text: 'clickable text',
}

const CONTROL_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'slider', 'spinbutton', 'combobox'])
const FIELD_ROLES = new Set(['textbox', 'searchbox'])
/** Containers that are clickable to pick one of their items; UI Automator leaves them out of its own check too. */
const SELECTION_CONTAINERS = /(GridView|GridLayout|ListView|TableLayout)$/
const PASS_LIMIT = 200
const CONTRAST_LIMIT = 300

export interface RuleOptions {
  locale: Locale
  /** The screen as captured with the tree; without it, contrast is not measured. */
  screenshot?: RgbaImage | undefined
  /** The model that located the nodes, when they come from an image instead of a tree. */
  locatedBy?: string | undefined
}

/** Runs the rules that apply to the snapshot's surface. */
export function runRules(snapshot: A11ySnapshot, options: RuleOptions): EngineResults {
  const results: EngineRuleResult[] = []
  const add = (ruleId: string, violations: EngineNode[], incomplete: EngineNode[], passes: EngineNode[]) => {
    const spec = NATIVE_RULES[ruleId]
    if (!spec) return
    const base = { ruleId, criteria: spec.criteria, help: spec.help[options.locale], helpUrl: spec.helpUrl }
    if (violations.length > 0) results.push({ ...base, outcome: 'violation', nodes: violations })
    if (incomplete.length > 0) results.push({ ...base, outcome: 'incomplete', nodes: incomplete })
    if (passes.length > 0) results.push({ ...base, outcome: 'pass', nodes: passes.slice(0, PASS_LIMIT) })
    if (violations.length + incomplete.length + passes.length === 0) results.push({ ...base, outcome: 'inapplicable', nodes: [] })
  }
  const ctx: Context = { snapshot, locale: options.locale, index: indexTree(snapshot.root), locatedBy: options.locatedBy }

  // An image has no tree: the only nodes are text a model located, so only pixels can be checked.
  if (snapshot.surface !== 'image') {
    add('control-name', ...controlNames(ctx, false))
    add('image-control-name', ...controlNames(ctx, true))
    add('image-name', ...imageNames(ctx))
    add('field-name', ...fieldNames(ctx))
  }
  if (options.screenshot) add('text-contrast', ...textContrast(ctx, options.screenshot))
  return { engine: { name: RULES_ENGINE, version: VERSION }, rules: results }
}

interface Context {
  snapshot: A11ySnapshot
  locale: Locale
  index: ReturnType<typeof indexTree>
  locatedBy: string | undefined
}

type Outcomes = [EngineNode[], EngineNode[], EngineNode[]]

function engineNode(node: A11yNode, extra: Partial<EngineNode> = {}): EngineNode {
  const source = typeof node.native.source === 'string' ? node.native.source : ''
  return { ref: node.ref, target: node.ref, html: source, ...extra }
}

function hidden(node: A11yNode): boolean {
  return node.states.includes('hidden') || node.states.includes('aria-hidden')
}

/**
 * Disabled, inside something disabled, or in a window behind the active one. WCAG exempts
 * inactive components from contrast, and a window behind another is not what the
 * screenshot shows. Names have no such exemption: a disabled control is still announced.
 */
function inactive(ctx: Context, node: A11yNode): boolean {
  let current: A11yNode | undefined = node
  while (current) {
    if (current.states.includes('disabled') || current.states.includes('inactive')) return true
    const parentRef: string | undefined = ctx.index.get(current.ref)?.parentRef
    current = parentRef ? ctx.index.get(parentRef)?.node : undefined
  }
  return false
}

function isControl(node: A11yNode): boolean {
  if (FIELD_ROLES.has(node.role) || node.role === 'list' || node.role === 'listbox' || node.role === 'grid') return false
  if (SELECTION_CONTAINERS.test(String(node.native.class ?? ''))) return false
  return CONTROL_ROLES.has(node.role) || node.states.includes('clickable') || node.states.includes('long-clickable') || node.states.includes('checkable')
}

function hasImageInside(node: A11yNode): boolean {
  return [...walkTree(node)].some((inner) => inner !== node && isImageLike(inner) && !hidden(inner))
}

const PLATFORM = {
  android: { name: 'contentDescription', reader: 'TalkBack' },
  ios: { name: 'accessibilityLabel', reader: 'VoiceOver' },
} as const

function platformOf(ctx: Context): { name: string; reader: string } | undefined {
  const surface = ctx.snapshot.surface
  return surface === 'android' || surface === 'ios' ? PLATFORM[surface] : undefined
}

/** Controls without a name: image buttons (1.1.1 and 4.1.2) apart from other controls (4.1.2). */
function controlNames(ctx: Context, images: boolean): Outcomes {
  const violations: EngineNode[] = []
  const passes: EngineNode[] = []
  const platform = platformOf(ctx)
  for (const node of walkTree(ctx.snapshot.root)) {
    if (node === ctx.snapshot.root || !isControl(node) || hidden(node)) continue
    const named = Boolean(node.name?.trim() || nameFromContent(node))
    const image = isImageLike(node) || (!named && hasImageInside(node))
    if (image !== images) continue
    if (named) {
      passes.push(engineNode(node))
      continue
    }
    const what = images
      ? { en: 'This image button', 'pt-BR': 'Este botão de imagem' }
      : { en: `This ${ROLE_WORDS[node.role] ?? node.role}`, 'pt-BR': 'Este controle' }
    const detail: Text = platform
      ? {
          en: `${what.en} has no text and no ${platform.name}, so ${platform.reader} cannot say what it does.`,
          'pt-BR': `${what['pt-BR']} não tem texto nem ${platform.name}, então o ${platform.reader} não consegue dizer para que serve.`,
        }
      : {
          en: `${what.en} has no name, so a screen reader cannot say what it does.`,
          'pt-BR': `${what['pt-BR']} não tem nome, então o leitor de tela não consegue dizer para que serve.`,
        }
    violations.push(engineNode(node, { detail: detail[ctx.locale] }))
  }
  return [violations, [], passes]
}

/** Images outside controls: a missing name may be a missing description or a decorative image; only a person can say which. */
function imageNames(ctx: Context): Outcomes {
  const incomplete: EngineNode[] = []
  const passes: EngineNode[] = []
  const platform = platformOf(ctx)
  for (const node of walkTree(ctx.snapshot.root)) {
    if (node.role !== 'img' || isControl(node) || hidden(node) || node.states.includes('not-important')) continue
    if (node.name?.trim()) {
      passes.push(engineNode(node))
      continue
    }
    const detail: Text =
      ctx.snapshot.surface === 'android'
        ? {
            en: 'This image has no contentDescription. UI Automator cannot tell a missing one from contentDescription="@null": hide it with importantForAccessibility="no" if it is decorative, describe it if it conveys something.',
            'pt-BR': 'Esta imagem não tem contentDescription. O UI Automator não distingue a falta dele de contentDescription="@null": oculte-a com importantForAccessibility="no" se for decorativa, descreva-a se transmitir algo.',
          }
        : {
            en: `This image has no ${platform?.name ?? 'name'}: hide it if it is decorative, describe it if it conveys something.`,
            'pt-BR': `Esta imagem não tem ${platform?.name ?? 'nome'}: oculte-a se for decorativa, descreva-a se transmitir algo.`,
          }
    incomplete.push(engineNode(node, { detail: detail[ctx.locale] }))
  }
  return [[], incomplete, passes]
}

/**
 * Text fields without a name. On iOS nothing else can name a field, so it fails; on
 * Android a label can point at it with labelFor, which UI Automator does not show.
 */
function fieldNames(ctx: Context): Outcomes {
  const violations: EngineNode[] = []
  const incomplete: EngineNode[] = []
  const passes: EngineNode[] = []
  for (const node of walkTree(ctx.snapshot.root)) {
    if (!FIELD_ROLES.has(node.role) || hidden(node)) continue
    if (node.name?.trim()) {
      passes.push(engineNode(node))
      continue
    }
    if (ctx.snapshot.surface === 'ios') {
      const detail: Text = {
        en: 'This text field has no accessibilityLabel and no placeholder, so VoiceOver cannot say what to enter.',
        'pt-BR': 'Este campo de texto não tem accessibilityLabel nem placeholder, então o VoiceOver não consegue dizer o que preencher.',
      }
      violations.push(engineNode(node, { detail: detail[ctx.locale] }))
    } else {
      const detail: Text = {
        en: 'This field has no contentDescription and no hint. A label can still name it with labelFor, which UI Automator does not show: check it by hand.',
        'pt-BR': 'Este campo não tem contentDescription nem hint. Um rótulo ainda pode nomeá-lo com labelFor, que o UI Automator não mostra: confira manualmente.',
      }
      incomplete.push(engineNode(node, { detail: detail[ctx.locale] }))
    }
  }
  return [violations, incomplete, passes]
}

const REASONS: Record<ContrastReason, Text> = {
  outside: { en: 'its box is off the screenshot', 'pt-BR': 'a caixa dele está fora da captura' },
  'too-small': { en: 'its box is too small to measure', 'pt-BR': 'a caixa dele é pequena demais para medir' },
  'busy-background': { en: 'its background is an image or a gradient', 'pt-BR': 'o fundo dele é uma imagem ou um degradê' },
  'no-text-pixels': { en: 'no text pixels were found in its box', 'pt-BR': 'nenhum pixel de texto foi encontrado na caixa dele' },
  'thin-text': { en: 'its strokes are too thin at this resolution to read their color', 'pt-BR': 'os traços são finos demais nesta resolução para ler a cor' },
}

/** The text a node draws, as the collector recorded it; only leaves are measured, so a box holds one text. */
function renderedText(node: A11yNode): string | undefined {
  const text = node.native.renderedText
  return typeof text === 'string' && /[\p{L}\p{N}]/u.test(text) ? text.trim() : undefined
}

function textContrast(ctx: Context, screenshot: RgbaImage): Outcomes {
  const violations: EngineNode[] = []
  const incomplete: EngineNode[] = []
  const passes: EngineNode[] = []
  const scale = ctx.snapshot.viewport.scale || 1
  const fromImage = ctx.snapshot.surface === 'image'
  const confidence: Confidence | undefined = ctx.locatedBy ? 'medium' : undefined
  let measured = 0
  for (const node of walkTree(ctx.snapshot.root)) {
    if (measured >= CONTRAST_LIMIT) break
    const text = renderedText(node)
    // Text scrolled off the screen is not in the screenshot.
    if (!text || !node.bounds || hidden(node) || node.states.includes('offscreen') || inactive(ctx, node)) continue
    if ([...walkTree(node)].some((inner) => inner !== node && renderedText(inner))) continue
    // Logotypes have no contrast requirement; a model marks them when it locates text in an image.
    if (node.native.kind === 'logo' || node.native.kind === 'disabled') continue
    measured++
    const quoted = truncate(text, 60)
    const extra: Partial<EngineNode> = { confidence, locatedBy: ctx.locatedBy }
    const result = measureTextContrast(screenshot, toPixels(node.bounds, scale))
    if (!result.ok) {
      const reason = REASONS[result.reason][ctx.locale]
      const detail: Text = {
        en: `The contrast of "${quoted}" could not be measured: ${reason}.`,
        'pt-BR': `O contraste de "${quoted}" não pôde ser medido: ${reason}.`,
      }
      incomplete.push(engineNode(node, { ...extra, detail: detail[ctx.locale] }))
      continue
    }
    const { ratio, foreground, background } = result.measure
    const value = formatRatio(ratio)
    const evidence = ctx.locale === 'pt-BR' ? `${foreground} sobre ${background} = ${value.replace('.', ',')}` : `${foreground} on ${background} = ${value}`
    const where = fromImage ? { en: 'the image', 'pt-BR': 'na imagem' } : { en: 'the screenshot', 'pt-BR': 'na captura de tela' }
    if (ratio < 3) {
      const detail: Text = {
        en: `The text "${quoted}" has a contrast of ${value} against its background (${foreground} on ${background}), measured from ${where.en}. WCAG 1.4.3 asks for 4.5:1, or 3:1 for large text.`,
        'pt-BR': `O texto "${quoted}" tem contraste de ${value.replace('.', ',')} com o fundo (${foreground} sobre ${background}), medido ${where['pt-BR']}. O WCAG 1.4.3 pede 4,5:1, ou 3:1 para texto grande.`,
      }
      violations.push(engineNode(node, { ...extra, detail: detail[ctx.locale], evidence }))
    } else if (ratio < 4.5) {
      // Enough only for large text, and pixels do not say the size in points.
      const detail: Text = {
        en: `The text "${quoted}" has a contrast of ${value} (${foreground} on ${background}): enough only if it is large text (18 pt, or 14 pt bold), and its size is not known.`,
        'pt-BR': `O texto "${quoted}" tem contraste de ${value.replace('.', ',')} (${foreground} sobre ${background}): suficiente só se for texto grande (18 pt, ou 14 pt em negrito), e o tamanho não é conhecido.`,
      }
      incomplete.push(engineNode(node, { ...extra, detail: detail[ctx.locale], evidence }))
    } else passes.push(engineNode(node, { ...extra, evidence }))
  }
  return [violations, incomplete, passes]
}

/** What the rules left for a person, in a sentence each, for the report's notes. */
export function rulesNotes(engine: EngineResults, locale: Locale): string[] {
  if (engine.engine.name !== RULES_ENGINE) return []
  const incomplete = (ruleId: string) =>
    engine.rules.filter((rule) => rule.ruleId === ruleId && rule.outcome === 'incomplete').flatMap((rule) => rule.nodes)
  const notes: string[] = []
  const contrast = incomplete('text-contrast')
  const between = contrast.filter((node) => node.evidence).length
  const unmeasured = contrast.length - between
  if (between > 0) {
    notes.push(
      locale === 'pt-BR'
        ? `${between} texto(s) com contraste entre 3:1 e 4,5:1: só basta para texto grande, e o tamanho não é conhecido; confira manualmente.`
        : `${between} text(s) have a contrast between 3:1 and 4.5:1: enough only for large text, and their size is not known; check them by hand.`,
    )
  }
  if (unmeasured > 0) {
    notes.push(
      locale === 'pt-BR'
        ? `${unmeasured} texto(s) sem contraste medido (fundo com imagem ou degradê, ou traços finos demais nesta resolução).`
        : `${unmeasured} text(s) could not be measured for contrast (an image or gradient behind them, or strokes too thin at this resolution).`,
    )
  }
  const images = incomplete('image-name').length
  if (images > 0) {
    notes.push(
      locale === 'pt-BR'
        ? `${images} imagem(ns) sem descrição: decida se cada uma é decorativa (oculte) ou precisa de uma.`
        : `${images} image(s) have no description: decide whether each is decorative (hide it) or needs one.`,
    )
  }
  const fields = incomplete('field-name').length
  if (fields > 0) {
    notes.push(
      locale === 'pt-BR'
        ? `${fields} campo(s) sem contentDescription nem hint; o UI Automator não mostra labelFor, então confira os rótulos manualmente.`
        : `${fields} field(s) have no contentDescription or hint; UI Automator does not show labelFor, so check their labels by hand.`,
    )
  }
  return notes
}
