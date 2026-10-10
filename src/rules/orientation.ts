import type { Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import type { Orientation, OrientationCover, OrientationData, OrientationLoad, OrientationState, RotatedElement } from '../probes/orientation.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, coverageStatus, probeFinding, say } from './probes.ts'

/** How far from a quarter turn (90° or 270°) a change of rotation still counts as one. */
export const QUARTER_TOLERANCE = 5
/** The other orientation must show at least this much text for its absence to mean anything. */
const MIN_TEXT = 20
/** Content is "gone" when a reader sees at most this share of what the other orientation shows. */
const GONE_SHARE = 0.25
/** Below MIN_TEXT characters (a canvas game), the capture's ink stands for the content. */
const MIN_INK = 0.02
const MAX_REPORTED = 10

/** Words of a "turn your device" message, in English, Portuguese, Spanish, French and German. */
// "Turn on your phone's notifications" is not a turn message: turn on, turn off and turn up are left out.
const TURN = /\b(rotate|rotating|turn(?!\s+(?:on|off|up|down|in|into)\b)|flip|gire|girar|gira|vire|virar|rotacione|rotacionar|voltea|voltear|rota|tournez|tourner|drehen|drehe)\b/i
const ORIENTATION_WORDS = /\b(landscape|portrait|orientation|paisagem|retrato|orienta[cç][aã]o|horizontal|vertical|orientaci[oó]n|apaisad[oa]|paysage|querformat|hochformat)\b/i
const DEVICE = /\b(device|phone|screen|tablet|mobile|celular|aparelho|dispositivo|tela|telefone|smartphone|m[oó]vil|pantalla|tel[eé]fono|t[eé]l[eé]phone|[eé]cran|appareil|ger[aä]t|handy)\b/i

/** Text that asks the reader to turn the device or names the orientation the page wants. */
export function isTurnMessage(text: string): boolean {
  if (!text) return false
  return (TURN.test(text) && (DEVICE.test(text) || ORIENTATION_WORDS.test(text))) || (ORIENTATION_WORDS.test(text) && DEVICE.test(text)) || /best viewed in (landscape|portrait)/i.test(text)
}

/** The change of rotation between two angles, in [0, 360). */
export function relativeTurn(a: number, b: number): number {
  const value = (((b - a) % 360) + 360) % 360
  return Math.round(value * 10) / 10
}

export function isQuarterTurn(a: number, b: number): boolean {
  const turn = relativeTurn(a, b)
  return Math.abs(turn - 90) <= QUARTER_TOLERANCE || Math.abs(turn - 270) <= QUARTER_TOLERANCE
}

/** The turn between the two states, as the smaller angle: 90°, not 270°. */
const quarterOf = (r: Pick<RotatedElement, 'a' | 'b'>) => {
  const turn = relativeTurn(r.a, r.b)
  return Math.round(Math.min(turn, 360 - turn) * 10) / 10
}

const other = (orientation: Orientation): Orientation => (orientation === 'portrait' ? 'landscape' : 'portrait')

const TEXT: Record<
  Locale,
  {
    rotated: string
    rotatedSmall: string
    goneMessage: string
    gone: string
    messageOnly: string
    orientation: Record<Orientation, string>
  }
> = {
  en: {
    rotated:
      'This content turns by a quarter turn between portrait and landscape, so it reads upright only in {upright}: its display is restricted to {upright} orientation (WCAG 1.3.4; ACT b33eff). Remove the rotation the orientation media query applies, unless that orientation is essential.',
    rotatedSmall:
      'An element with text or images turns by a quarter turn between portrait and landscape, so it reads upright only in {upright}. Check that this does not restrict its content to one orientation (WCAG 1.3.4; ACT b33eff counts any such element).',
    goneMessage:
      'In {gone} orientation, the page hides its content and asks to turn the device: it works only in {upright} (WCAG 1.3.4). Let the content show in both orientations, unless one is essential, such as a piano keyboard or a bank check.',
    gone: 'In {gone} orientation, most of the text the page shows in {upright} is gone, with no message saying why. Check whether the page restricts its display to {upright} orientation (WCAG 1.3.4).',
    messageOnly: 'In {gone} orientation, the page shows a message about turning the device, while its content still shows. Check that nothing is restricted in {gone} orientation (WCAG 1.3.4).',
    orientation: { portrait: 'portrait', landscape: 'landscape' },
  },
  'pt-BR': {
    rotated:
      'Este conteúdo gira um quarto de volta entre retrato e paisagem, e fica em pé só em {upright}: a exibição fica restrita à orientação {upright} (WCAG 1.3.4; ACT b33eff). Remova a rotação aplicada pela media query de orientação, a menos que essa orientação seja essencial.',
    rotatedSmall:
      'Um elemento com texto ou imagens gira um quarto de volta entre retrato e paisagem, e fica em pé só em {upright}. Confira se isso não restringe o conteúdo a uma orientação (WCAG 1.3.4; o ACT b33eff conta qualquer elemento assim).',
    goneMessage:
      'Na orientação {gone}, a página esconde o conteúdo e pede para girar o aparelho: ela só funciona em {upright} (WCAG 1.3.4). Deixe o conteúdo aparecer nas duas orientações, a menos que uma seja essencial, como um teclado de piano ou um cheque.',
    gone: 'Na orientação {gone}, a maior parte do texto que a página mostra em {upright} some, sem mensagem explicando. Confira se a página restringe a exibição à orientação {upright} (WCAG 1.3.4).',
    messageOnly: 'Na orientação {gone}, a página mostra uma mensagem sobre girar o aparelho, mas o conteúdo continua visível. Confira se nada fica restrito na orientação {gone} (WCAG 1.3.4).',
    orientation: { portrait: 'retrato', landscape: 'paisagem' },
  },
}

const r0 = (value: number) => Math.round(value)

function pairText(data: OrientationData, name: string, orientation: Orientation): string {
  const pair = data.pairs.find((p) => p.name === name)
  if (!pair) return name
  const size = orientation === 'portrait' ? pair.portrait : pair.landscape
  return `${size.width}×${size.height}`
}

function pairsText(data: OrientationData, names: readonly string[], locale: Locale): string {
  const list = [...new Set(names)].map((name) => {
    const pair = data.pairs.find((p) => p.name === name)
    return pair?.mobile ? say(locale, `${name.replace('x', '×')} (phone)`, `${name.replace('x', '×')} (celular)`) : name.replace('x', '×')
  })
  return list.join(say(locale, ' and ', ' e '))
}

/** The page as a whole: the body, or the root. */
function pageNode(snapshot: A11ySnapshot): A11yNode {
  return snapshot.root.children.find((child) => child.native.tag === 'body') ?? snapshot.root
}

interface Comparison {
  pair: string
  /** The state where content may be gone, and the state it is compared with. */
  x: OrientationState
  y: OrientationState
  /** Both states on one page, the device turned between them; false for two separate loads. */
  samePage: boolean
}

/** What a reader sees of a state's text: only the cover's, when an opaque layer that the other state lacks covers the window. */
function coverOf(x: OrientationState, y: OrientationState): OrientationCover | undefined {
  const cover = x.cover
  if (!cover) return undefined
  // A layer that covers the window in both states (a cookie wall, an app shell) is the page itself.
  if (y.cover && y.cover.ref === cover.ref) return undefined
  return cover
}

function readerChars(state: OrientationState, cover: OrientationCover | undefined): number {
  return cover?.opaque ? cover.chars : state.chars
}

interface Gone {
  gone: boolean
  /** Measured from the captures, for pages with little text. */
  byInk: boolean
  seen: number
  shown: number
}

function contentGone(c: Comparison): Gone {
  const rx = readerChars(c.x, coverOf(c.x, c.y))
  const ry = readerChars(c.y, coverOf(c.y, c.x))
  if (ry >= MIN_TEXT) return { gone: rx <= GONE_SHARE * ry, byInk: false, seen: rx, shown: ry }
  const ix = c.x.shot?.ink
  const iy = c.y.shot?.ink
  if (ix !== undefined && iy !== undefined && iy >= MIN_INK && c.x.chars < MIN_TEXT && c.y.chars < MIN_TEXT) return { gone: ix <= GONE_SHARE * iy, byInk: true, seen: ix, shown: iy }
  return { gone: false, byInk: false, seen: rx, shown: ry }
}

interface Message {
  text: string
  /** The element that shows it, when it is an element of its own (an overlay, a paragraph), not a pseudo-element. */
  el?: { ref: string; id: unknown; tag: string; label: string } | undefined
}

/** A "turn your device" message the state shows and the other does not. */
function messageIn(c: Comparison): Message | undefined {
  const cover = coverOf(c.x, c.y)
  if (cover && isTurnMessage(cover.text)) return { text: cover.text, el: cover }
  if (c.samePage) for (const shown of c.x.only) if (isTurnMessage(shown.text)) return { text: shown.text, el: shown }
  for (const pseudo of c.x.pseudo) {
    if (!isTurnMessage(pseudo.text)) continue
    if (c.y.pseudo.some((p) => p.ref === pseudo.ref && p.which === pseudo.which && p.text === pseudo.text)) continue
    return { text: `${pseudo.text}`, el: { ref: pseudo.ref, id: pseudo.id, tag: pseudo.tag, label: pseudo.label } }
  }
  return undefined
}

/** Every comparison of a portrait state with a landscape one: within each load, and the two loads of a pair as loaded. */
function comparisons(loads: readonly OrientationLoad[]): Comparison[] {
  const out: Comparison[] = []
  const usable = loads.filter((load) => load.states.length === 2 && load.states.every((s) => s.ok))
  for (const load of usable) {
    const [a, b] = load.states as [OrientationState, OrientationState]
    out.push({ pair: load.pair, x: a, y: b, samePage: true }, { pair: load.pair, x: b, y: a, samePage: true })
  }
  for (const pair of new Set(usable.map((load) => load.pair))) {
    const upright = usable.find((load) => load.pair === pair && load.loaded === 'portrait')?.states[0]
    const sideways = usable.find((load) => load.pair === pair && load.loaded === 'landscape')?.states[0]
    if (upright && sideways) out.push({ pair, x: upright, y: sideways, samePage: false }, { pair, x: sideways, y: upright, samePage: false })
  }
  return out
}

function quote(text: string): string {
  const short = text.length > 120 ? `${text.slice(0, 119)}…` : text
  return `"${short}"`
}

function rotationText(transform: string, angle: number, locale: Locale): string {
  return transform ? `${transform} (${r0(angle)}°)` : say(locale, 'no rotation (0°)', 'sem rotação (0°)')
}

/**
 * 1.3.4 Orientation, over the orientation probe. Failure (high): content that turns by a quarter turn between portrait
 * and landscape, html, body or most of the text (ACT b33eff); content gone in one orientation behind a "turn your
 * device" message. Review: a smaller element with text or images that turns a quarter; content gone with no message
 * (seen in two comparisons); a turn message while the content still shows. Locks and the manifest are notes, and
 * axe-core's css-orientation-lock only corroborates.
 */
export const orientationRule: ProbeRule = {
  id: 'rampa/orientation',
  kind: 'orientation',
  variant: 'orientation',
  versions: ['1'],
  criteria: ['1.3.4'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const raw = asRecord(record.data)
    const data: OrientationData = {
      pairs: asArray<OrientationData['pairs'][number]>(raw.pairs),
      loads: asArray<OrientationLoad>(raw.loads).filter((load) => load && Array.isArray(load.states) && Array.isArray(load.rotations)),
      locks: asArray<OrientationData['locks'][number]>(raw.locks),
      manifest: raw.manifest as OrientationData['manifest'],
      axe: raw.axe as OrientationData['axe'],
      end: raw.end === 'time' ? 'time' : 'complete',
    }
    const text = TEXT[ctx.locale]
    const name = (o: Orientation) => text.orientation[o]
    const findings: Finding[] = []
    const review: Finding[] = []
    let unmatched = 0
    const decorative = new Set<string>()
    const axeRefs = new Set(
      data.axe?.outcome === 'violation'
        ? data.axe.nodes.flatMap((node) => [node.ref, ...asArray<{ ref?: string }>(node.related).map((r) => r.ref)].filter((ref): ref is string => typeof ref === 'string'))
        : [],
    )
    let corroborated = false

    // Rotations: elements whose own rotation changes by a quarter turn between the two states of a load.
    const turned = new Map<string, { r: RotatedElement; load: OrientationLoad; pairs: string[]; main: boolean }>()
    for (const load of data.loads) {
      const after = load.states[1]
      if (!after || !load.states.every((s) => s.ok)) continue
      for (const r of load.rotations) {
        if (!isQuarterTurn(r.a, r.b)) continue
        if (r.chars <= 0 && !r.media) {
          decorative.add(r.ref)
          continue
        }
        const main = r.tag === 'html' || r.tag === 'body' || r.chars >= 0.5 * after.chars || r.area >= 0.5
        const seen = turned.get(r.ref)
        if (seen) {
          seen.pairs.push(load.pair)
          seen.main ||= main
        } else turned.set(r.ref, { r, load, pairs: [load.pair], main })
      }
    }
    const failedRefs = new Set<string>()
    for (const { r, load, pairs, main } of turned.values()) {
      const node = matchNode(ctx.index, r.ref, r.id)
      if (!node) {
        unmatched++
        continue
      }
      const [first, second] = load.states as [OrientationState, OrientationState]
      // The orientation in which it is drawn sideways is the one where its rotation is nearer a quarter turn.
      const sidewaysFirst = Math.abs(Math.abs(r.a) - 90) < Math.abs(Math.abs(r.b) - 90)
      const upright = sidewaysFirst ? second.orientation : first.orientation
      const corroborates = axeRefs.has(r.ref)
      if (corroborates) corroborated = true
      const evidence = say(
        ctx.locale,
        `${nameOf(node, r)} at ${pairText(data, load.pair, first.orientation)} (${name(first.orientation)}): ${rotationText(r.ta, r.a, ctx.locale)}; turned to ${pairText(data, load.pair, second.orientation)} (${name(second.orientation)}): ${rotationText(r.tb, r.b, ctx.locale)}: ${quarterOf(r)}° between the two, with ${r.chars} character(s) of text inside; seen at ${pairsText(data, pairs, ctx.locale)}${corroborates ? "; axe-core's experimental css-orientation-lock flags it too" : ''}`,
        `${nameOf(node, r)} em ${pairText(data, load.pair, first.orientation)} (${name(first.orientation)}): ${rotationText(r.ta, r.a, ctx.locale)}; girado para ${pairText(data, load.pair, second.orientation)} (${name(second.orientation)}): ${rotationText(r.tb, r.b, ctx.locale)}: ${quarterOf(r)}° entre os dois, com ${r.chars} caractere(s) de texto dentro; visto em ${pairsText(data, pairs, ctx.locale)}${corroborates ? '; a regra experimental css-orientation-lock do axe-core também o aponta' : ''}`,
      )
      const finding = probeFinding({
        criterion: '1.3.4',
        rule: this.id,
        node,
        message: (main ? text.rotated : text.rotatedSmall).replaceAll('{upright}', name(upright)),
        evidence,
        confidence: main ? 'high' : 'medium',
        subject: `rotation|${upright}`,
      })
      if (main) {
        failedRefs.add(r.ref)
        if (findings.length < MAX_REPORTED) findings.push(finding)
      } else if (review.length < MAX_REPORTED) review.push(finding)
    }

    // Content gone in one orientation, and "turn your device" messages.
    const all = comparisons(data.loads)
    type Kind = 'goneMessage' | 'gone' | 'messageOnly'
    const found = new Map<string, { kind: Kind; c: Comparison; message?: Message | undefined; gone: Gone; count: number; pairs: string[] }>()
    for (const c of all) {
      const gone = contentGone(c)
      const message = messageIn(c)
      const kind: Kind | undefined = gone.gone ? (message ? 'goneMessage' : 'gone') : message ? 'messageOnly' : undefined
      if (!kind) continue
      const key = `${kind}|${c.x.orientation}`
      const seen = found.get(key)
      if (seen) {
        seen.count++
        seen.pairs.push(c.pair)
      } else found.set(key, { kind, c, message, gone, count: 1, pairs: [c.pair] })
    }
    let goneOnce = 0
    for (const { kind, c, message, gone, count, pairs } of found.values()) {
      // Content gone with nothing to say why may be a page still loading: it must show in two comparisons.
      if (kind === 'gone' && count < 2) {
        goneOnce++
        continue
      }
      // A message that some other comparison shows with the content gone is the failure, reported once.
      if (kind === 'messageOnly' && found.has(`goneMessage|${c.x.orientation}`)) continue
      if (kind === 'gone' && found.has(`goneMessage|${c.x.orientation}`)) continue
      // A message element the snapshot does not hold (a script added it on this load only) leaves the finding on the page.
      const node = (message?.el ? matchNode(ctx.index, message.el.ref, message.el.id) : undefined) ?? pageNode(ctx.snapshot)
      const upright = other(c.x.orientation)
      const amount = gone.byInk
        ? say(ctx.locale, `${Math.round(gone.seen * 1000) / 10}% of the window drawn, against ${Math.round(gone.shown * 1000) / 10}%`, `${Math.round(gone.seen * 1000) / 10}% da janela desenhada, contra ${Math.round(gone.shown * 1000) / 10}%`)
        : say(ctx.locale, `${gone.seen} character(s) of text a reader can see, against ${gone.shown}`, `${gone.seen} caractere(s) de texto visíveis para quem lê, contra ${gone.shown}`)
      const cover = coverOf(c.x, c.y)
      const coverText = cover
        ? say(ctx.locale, `; a ${cover.position} layer covers ${Math.round(cover.share * 100)}% of the window${cover.opaque ? '' : ', letting the page show through'}`, `; uma camada ${cover.position} cobre ${Math.round(cover.share * 100)}% da janela${cover.opaque ? '' : ', deixando a página aparecer por baixo'}`)
        : ''
      const evidence = say(
        ctx.locale,
        `at ${pairText(data, c.pair, c.x.orientation)} (${name(c.x.orientation)}), ${amount} at ${pairText(data, c.pair, c.y.orientation)} (${name(c.y.orientation)})${coverText}${message ? `; it says ${quote(message.text)}` : ''}; seen in ${count} comparison(s) at ${pairsText(data, pairs, ctx.locale)}`,
        `em ${pairText(data, c.pair, c.x.orientation)} (${name(c.x.orientation)}), ${amount} em ${pairText(data, c.pair, c.y.orientation)} (${name(c.y.orientation)})${coverText}${message ? `; diz ${quote(message.text)}` : ''}; visto em ${count} comparação(ões) em ${pairsText(data, pairs, ctx.locale)}`,
      )
      const finding = probeFinding({
        criterion: '1.3.4',
        rule: this.id,
        node,
        message: text[kind].replaceAll('{gone}', name(c.x.orientation)).replaceAll('{upright}', name(upright)),
        evidence,
        confidence: kind === 'goneMessage' ? 'high' : 'medium',
        subject: `${kind}|${c.x.orientation}`,
      })
      if (kind === 'goneMessage') {
        if (!failedRefs.has(node.ref) && findings.length < MAX_REPORTED) findings.push(finding)
      } else if (review.length < MAX_REPORTED) review.push(finding)
    }

    // Notes: what the probe could not decide, and what only corroborates.
    const compared = data.loads.filter((load) => load.states.length === 2 && load.states.every((s) => s.ok)).length
    const notSet = data.loads.reduce((sum, load) => sum + load.states.filter((s) => !s.ok).length, 0)
    const errors = data.loads.filter((load) => load.error).length
    const locks = [...new Set(data.locks.map((lock) => lock.orientation))]
    const axe = data.axe
    const axeNote =
      axe?.outcome === 'violation'
        ? corroborated
          ? say(ctx.locale, `axe-core's experimental css-orientation-lock agrees`, 'a regra experimental css-orientation-lock do axe-core concorda')
          : say(
              ctx.locale,
              `axe-core's experimental css-orientation-lock flags ${axe.nodes.flatMap((n) => (n.related?.length ? n.related.map((r) => r.target) : [n.target])).slice(0, 3).join(', ')}, which the probe did not see turn`,
              `a regra experimental css-orientation-lock do axe-core aponta ${axe.nodes.flatMap((n) => (n.related?.length ? n.related.map((r) => r.target) : [n.target])).slice(0, 3).join(', ')}, que a sonda não viu girar`,
            )
        : ''
    const notes = [
      say(ctx.locale, `${compared} load(s) compared, upright and sideways, each loaded and then turned`, `${compared} carregamento(s) comparado(s), em pé e deitado, cada um carregado e depois girado`),
      locks.length > 0
        ? say(ctx.locale, `the page calls screen.orientation.lock(${locks.map((l) => `"${l}"`).join(', ')}), which browsers honor only in full screen or installed apps`, `a página chama screen.orientation.lock(${locks.map((l) => `"${l}"`).join(', ')}), que os navegadores só atendem em tela cheia ou em apps instalados`)
        : '',
      data.manifest?.orientation && !['any', 'natural'].includes(data.manifest.orientation)
        ? say(ctx.locale, `the web app manifest sets orientation "${data.manifest.orientation}", which applies once the app is installed`, `o manifesto do app web define orientation "${data.manifest.orientation}", que vale quando o app é instalado`)
        : '',
      axeNote,
      decorative.size > 0
        ? say(ctx.locale, `${decorative.size} element(s) with no text or images turn a quarter, not reported`, `${decorative.size} elemento(s) sem texto nem imagens giram um quarto de volta, não relatado(s)`)
        : '',
      goneOnce > 0 ? say(ctx.locale, 'content differed in one comparison only (maybe still loading), not reported', 'o conteúdo diferiu em uma só comparação (talvez ainda carregando), não relatado') : '',
      notSet > 0 ? say(ctx.locale, `the orientation could not be set in ${notSet} state(s)`, `a orientação não pôde ser definida em ${notSet} estado(s)`) : '',
      errors > 0 ? say(ctx.locale, `${errors} load(s) could not be measured`, `${errors} carregamento(s) não puderam ser medidos`) : '',
      data.end === 'time' ? say(ctx.locale, 'time budget reached', 'limite de tempo atingido') : '',
    ].filter(Boolean)
    const failures = findings.length
    const coverage: ProbeCoverage = {
      criterion: '1.3.4',
      method: `probe/orientation@${record.version}`,
      rule: this.id,
      conditions: conditionsText(
        record,
        say(ctx.locale, `portrait and landscape at ${pairsText(data, data.pairs.map((p) => p.name), ctx.locale)}`, `retrato e paisagem em ${pairsText(data, data.pairs.map((p) => p.name), ctx.locale)}`),
      ),
      status: coverageStatus(failures, review.length),
      // Elements with visible text, in the state that showed the most: what the comparisons were about.
      applicable: compared > 0 ? Math.max(0, ...data.loads.filter((load) => load.states.every((s) => s.ok)).flatMap((load) => load.states.map((s) => s.elements))) : 0,
      failures,
      review: review.length,
      unmatched,
      note: notes.join('; '),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}
