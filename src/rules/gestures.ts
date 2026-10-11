import type { Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { DEVICE_MOTION_VARIANT, DEVICE_MOTION_VERSION, type DeviceMotionData, type MotionControl, type MotionPattern } from '../probes/device-motion.ts'
import { GESTURES_VARIANT, GESTURES_VERSION, type GestureAlternative, type GestureName, type GestureTarget, type GesturesData, STRONG_CHANGES } from '../probes/gestures.ts'
import { matchNode } from '../probes/identity.ts'
import type { A11yNode, A11ySnapshot, ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, probeFinding, say } from './probes.ts'

export const GESTURE_ALTERNATIVES_RULE = 'rampa/gesture-alternatives'
export const MOTION_ACTUATION_RULE = 'rampa/motion-actuation'

export function gesturesData(record: ProbeRecord): Partial<GesturesData> {
  return asRecord(record.data) as Partial<GesturesData>
}

export function deviceMotionData(record: ProbeRecord): Partial<DeviceMotionData> {
  return asRecord(record.data) as Partial<DeviceMotionData>
}

/** The gestures probe's record of a variant, when it ran (not skipped): the pointer probe's 2.5.1 list and C17's 2.5.4 note step aside for it. */
export function gesturesRecord(snapshot: A11ySnapshot, variant: string): ProbeRecord | undefined {
  return (snapshot.observations?.probes ?? []).find((record) => record.kind === 'gestures' && record.conditions.variant === variant && record.status !== 'skipped')
}

const short = (text: string | undefined, n = 60) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}

function nameOf(element: { tag: string; label?: string | undefined }): string {
  return `<${element.tag}>${element.label ? ` "${short(element.label, 50)}"` : ''}`
}

function viewportText(data: { viewport?: unknown }): string {
  const viewport = asRecord(data.viewport)
  return `${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`
}

const GESTURE_TEXT: Record<GestureName, [string, string]> = {
  'swipe-left': ['a swipe to the left', 'um deslize para a esquerda'],
  'swipe-right': ['a swipe to the right', 'um deslize para a direita'],
  'pinch-out': ['a two-finger pinch that spreads', 'uma pinça de dois dedos que se abre'],
}

const KIND_TEXT: Record<string, [string, string]> = {
  carousel: ['a carousel', 'um carrossel'],
  map: ['a map', 'um mapa'],
  viewer: ['an image viewer', 'um visualizador de imagens'],
  touch: ['an element with touch listeners', 'um elemento com ouvintes de toque'],
  drawing: ['a drawing area', 'uma área de desenho'],
}

const SUGGESTION: Record<string, [string, string]> = {
  carousel: ['Add previous and next buttons, or dots that each go to a slide, that do what the swipe does.', 'Adicione botões de anterior e próximo, ou pontos que levem cada um a um slide, que façam o que o deslize faz.'],
  map: ['Add zoom in and zoom out buttons that do what the pinch does.', 'Adicione botões de aproximar e afastar que façam o que a pinça faz.'],
  viewer: ['Add zoom in and zoom out buttons that do what the pinch does.', 'Adicione botões de aproximar e afastar que façam o que a pinça faz.'],
}

export interface GestureVerdict {
  target: GestureTarget
  node: A11yNode
  result: 'failure' | 'review' | 'pass'
  why: 'alternative' | 'none-found' | 'none-worked' | 'essential' | 'context' | 'pixels' | 'once' | 'unconfirmed'
}

export interface GestureVerdicts {
  verdicts: GestureVerdict[]
  /** Elements gestured on whose facts match the snapshot. */
  applicable: number
  unmatched: number
  /** Gestured on, and nothing changed. */
  noEffect: number
  notExercised: number
  notTried: number
}

/**
 * 2.5.1's reading of the gestures: a gesture that changed what an element shows, where no control around it did the
 * same when clicked once, again on a second load, fails; a control that did the same clears it. A drawing area (the
 * path is the point), a gesture that made the page navigate, a change seen only in pixels, controls that did something
 * else, and a change seen on one load of two go to a person.
 */
export function gestureVerdicts(data: Partial<GesturesData>, index: ProbeRuleContext['index']): GestureVerdicts {
  const result: GestureVerdicts = { verdicts: [], applicable: 0, unmatched: 0, noEffect: 0, notExercised: 0, notTried: 0 }
  for (const target of asArray<GestureTarget>(data.targets)) {
    if (!target) continue
    if (target.outcome === 'not-tried') {
      result.notTried++
      continue
    }
    if (target.outcome) {
      if (target.outcome === 'unmatched') result.unmatched++
      else result.notExercised++
      continue
    }
    const node = matchNode(index, target.ref, target.id)
    if (!node) {
      result.unmatched++
      continue
    }
    result.applicable++
    const effect = target.effect
    if (!effect) {
      result.noEffect++
      continue
    }
    const alternatives = asArray<GestureAlternative>(target.alternatives)
    const verdict = (result_: GestureVerdict['result'], why: GestureVerdict['why']) => result.verdicts.push({ target, node, result: result_, why })
    if (alternatives.some((a) => a.reproduced)) verdict('pass', 'alternative')
    else if (target.essential) verdict('review', 'essential')
    else if (effect.context) verdict('review', 'context')
    else if (!asArray<string>(effect.changed).some((kind) => STRONG_CHANGES.includes(kind))) verdict('review', 'pixels')
    else if (alternatives.length > 0) verdict('review', 'none-worked')
    else if (target.confirmed === true) verdict('failure', 'none-found')
    else verdict('review', target.confirmed === false ? 'once' : 'unconfirmed')
  }
  return result
}

const UNNAMED: Record<string, [string, string]> = {
  next: ['a next control with no name', 'um controle de próximo sem nome'],
  previous: ['a previous control with no name', 'um controle de anterior sem nome'],
  dot: ['a dot with no name', 'um ponto sem nome'],
  'zoom-in': ['a zoom-in control with no name', 'um controle de aproximar sem nome'],
  'zoom-out': ['a zoom-out control with no name', 'um controle de afastar sem nome'],
}

function alternativesText(alternatives: GestureAlternative[], locale: Locale): string {
  return alternatives
    .map((a) => {
      const how = a.skipped ? say(locale, `not tried: ${a.skipped}`, `não tentado: ${a.skipped}`) : a.changed && a.changed.length > 0 ? say(locale, 'did something else', 'fez outra coisa') : say(locale, 'no change', 'sem mudança')
      const name = a.label?.trim() ? `"${short(a.label, 30)}"` : say(locale, ...(UNNAMED[a.kind] ?? ['a control with no name', 'um controle sem nome']))
      return `${name} (${how})`
    })
    .join(', ')
}

function gestureMessage(verdict: GestureVerdict, locale: Locale): string {
  const { target } = verdict
  const element = nameOf(target)
  const kind = say(locale, ...(KIND_TEXT[target.kind] ?? [target.kind, target.kind]))
  const gesture = say(locale, ...(GESTURE_TEXT[target.effect?.gesture ?? 'swipe-left'] ?? ['a gesture', 'um gesto']))
  const effect = short(target.effect?.detail, 90)
  const waive = say(
    locale,
    ' A single-pointer way elsewhere (a list of the same pictures, another view) satisfies the criterion, and an essential gesture is exempt: then waive the finding (rampa waive).',
    ' Um jeito com ponteiro simples em outro lugar (uma lista das mesmas imagens, outra visão) satisfaz o critério, e um gesto essencial é exceção: então dispense o achado (rampa waive).',
  )
  if (verdict.result === 'failure') {
    const fix = say(locale, ...(SUGGESTION[target.kind] ?? ['Add a control that does what the gesture does with a single tap or click.', 'Adicione um controle que faça o que o gesto faz com um toque ou clique simples.']))
    return say(
      locale,
      `${element} is ${kind}: ${gesture} changes it (${effect}), and Rampa found no control around it that does the same with a single pointer, on two loads (WCAG 2.5.1). People who cannot make path-based or multipoint gestures (a tremor, a head pointer, one finger) need one. ${fix}${waive}`,
      `${element} é ${kind}: ${gesture} o muda (${effect}), e o Rampa não achou controle ao redor que faça o mesmo com um ponteiro simples, em duas cargas (WCAG 2.5.1). Quem não consegue fazer gestos de trajetória ou multiponto (um tremor, um ponteiro de cabeça, um só dedo) precisa de um. ${fix}${waive}`,
    )
  }
  const lead = say(locale, `${element} is ${kind}: ${gesture} changes it (${effect}).`, `${element} é ${kind}: ${gesture} o muda (${effect}).`)
  switch (verdict.why) {
    case 'essential':
      return say(
        locale,
        `${element} looks like ${target.essential}: ${gesture} drew on it. Where the path itself is the input (a signature, freehand drawing), the gesture is essential and 2.5.1 allows it: check that nothing else there needs a gesture, and that another way is offered where one can be (typing a name instead of signing) (WCAG 2.5.1).`,
        `${element} parece ${target.essential === 'a signature pad' ? 'um campo de assinatura' : 'uma área de desenho'}: ${gesture} desenhou nele. Quando o próprio trajeto é a entrada (uma assinatura, desenho livre), o gesto é essencial e o 2.5.1 o permite: confira se nada mais ali exige um gesto, e se outra forma é oferecida onde for possível (digitar o nome em vez de assinar) (WCAG 2.5.1).`,
      )
    case 'context':
      return say(
        locale,
        `${element} is ${kind}: ${gesture} on it made the page ${effect.startsWith('navigation') ? 'go to another address' : 'open a window or a dialog'} (${effect}). Check that a link or a button does the same with a single pointer (WCAG 2.5.1).`,
        `${element} é ${kind}: ${gesture} nele fez a página ${effect.startsWith('navigation') ? 'ir para outro endereço' : 'abrir uma janela ou um diálogo'} (${effect}). Confira se um link ou botão faz o mesmo com um ponteiro simples (WCAG 2.5.1).`,
      )
    case 'pixels':
      return say(
        locale,
        `${lead} Only its pixels changed, nothing in its markup: check whether the gesture does something a single pointer cannot (WCAG 2.5.1).`,
        `${lead} Só os pixels mudaram, nada na marcação: confira se o gesto faz algo que um ponteiro simples não consegue (WCAG 2.5.1).`,
      )
    case 'none-worked': {
      const list = alternativesText(asArray<GestureAlternative>(target.alternatives), locale)
      return say(
        locale,
        `${lead} The controls around it (${list}) did not do the same when clicked once: check that a single pointer can do everything the gesture does (WCAG 2.5.1).`,
        `${lead} Os controles ao redor (${list}) não fizeram o mesmo ao serem clicados uma vez: confira se um ponteiro simples consegue fazer tudo o que o gesto faz (WCAG 2.5.1).`,
      )
    }
    default:
      return say(
        locale,
        `${lead} Rampa found no control around it that does the same, but ${verdict.why === 'once' ? 'the gesture did not change it again on a second load' : 'the gesture was not tried again on a second load'}: check by hand that a single pointer can do what the gesture does (WCAG 2.5.1).`,
        `${lead} O Rampa não achou controle ao redor que faça o mesmo, mas ${verdict.why === 'once' ? 'o gesto não o mudou de novo numa segunda carga' : 'o gesto não foi tentado de novo numa segunda carga'}: confira à mão se um ponteiro simples faz o que o gesto faz (WCAG 2.5.1).`,
      )
  }
}

function gestureEvidence(verdict: GestureVerdict, locale: Locale): string {
  const { target } = verdict
  const alternatives = asArray<GestureAlternative>(target.alternatives)
  return [
    target.why,
    target.effect ? say(locale, `${target.effect.gesture}: ${target.effect.detail}`, `${target.effect.gesture}: ${target.effect.detail}`) : '',
    target.autoplay ? say(locale, 'it turns on its own: the gesture came right after a turn', 'ele gira sozinho: o gesto veio logo depois de um giro') : '',
    alternatives.length > 0 ? say(locale, `tried: ${alternativesText(alternatives, locale)}`, `tentado: ${alternativesText(alternatives, locale)}`) : say(locale, 'no previous, next, dot or zoom control around it', 'nenhum controle de anterior, próximo, ponto ou zoom ao redor'),
    target.confirmed === true ? say(locale, 'again on a second fresh load', 'de novo numa segunda carga nova') : target.confirmed === false ? say(locale, 'not again on a second fresh load', 'não de novo numa segunda carga nova') : '',
  ]
    .filter(Boolean)
    .join('; ')
}

/**
 * 2.5.1 Pointer Gestures, over the gestures probe. Carousels, maps, image viewers and elements with touch listeners
 * swiped and pinched with touch events: a gesture that changed what the element shows (its slide, its text, its zoom,
 * its layout), with no control around it that did the same when clicked once, again on a second load, fails. A control
 * that did the same clears it. Drawing areas, gestures that navigate, changes seen only in pixels, controls that did
 * something else, and a change seen on one load of two are for review. The model may only clear a failure, quoting the
 * page (judgment/2.5.1, src/criteria/pointer-gestures.ts).
 */
export const gestureAlternativesRule: ProbeRule = {
  id: GESTURE_ALTERNATIVES_RULE,
  kind: 'gestures',
  variant: GESTURES_VARIANT,
  versions: [GESTURES_VERSION],
  criteria: ['2.5.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = gesturesData(record)
    const loc = ctx.locale
    const read = gestureVerdicts(data, ctx.index)
    const findings: Finding[] = []
    const review: Finding[] = []
    for (const verdict of read.verdicts) {
      if (verdict.result === 'pass') continue
      const finding = probeFinding({
        criterion: '2.5.1',
        rule: this.id,
        node: verdict.node,
        message: gestureMessage(verdict, loc),
        evidence: gestureEvidence(verdict, loc),
        confidence: verdict.result === 'failure' ? 'medium' : 'low',
        subject: `${verdict.target.kind}|${verdict.target.effect?.gesture ?? ''}|${verdict.why}`,
      })
      ;(verdict.result === 'failure' ? findings : review).push(finding)
    }
    const targets = asArray<GestureTarget>(data.targets)
    const passed = read.verdicts.filter((v) => v.result === 'pass')
    const turning = targets.filter((t) => t.autoplay).length
    const notes = [
      targets.length > 0
        ? say(loc, `${read.applicable} element(s) swiped or pinched with touch events`, `${read.applicable} elemento(s) deslizado(s) ou pinçado(s) com eventos de toque`)
        : say(loc, 'no carousel, map, image viewer or touch listener found; gestures with no sign in the markup are not seen', 'nenhum carrossel, mapa, visualizador ou ouvinte de toque encontrado; gestos sem sinal na marcação não são vistos'),
      read.noEffect > 0 ? say(loc, `${read.noEffect} did not change`, `${read.noEffect} não mudou(aram)`) : '',
      passed.length > 0
        ? say(
            loc,
            `with a single-pointer alternative: ${passed.map((v) => `${nameOf(v.target)} ("${short(asArray<GestureAlternative>(v.target.alternatives).find((a) => a.reproduced)?.label, 30)}")`).join(', ')}`,
            `com alternativa de ponteiro simples: ${passed.map((v) => `${nameOf(v.target)} ("${short(asArray<GestureAlternative>(v.target.alternatives).find((a) => a.reproduced)?.label, 30)}")`).join(', ')}`,
          )
        : '',
      turning > 0 ? say(loc, `${turning} turn(s) on their own: gestured right after a turn`, `${turning} gira(m) sozinho(s): gesto logo depois de um giro`) : '',
      read.notExercised > 0 ? say(loc, `${read.notExercised} not exercised (covered or not showing)`, `${read.notExercised} não exercitado(s) (coberto ou escondido)`) : '',
      read.notTried > 0 ? say(loc, `${read.notTried} not tried (${data.end === 'time' ? 'time budget' : 'budget'})`, `${read.notTried} não tentado(s) (${data.end === 'time' ? 'limite de tempo' : 'limite'})`) : '',
      say(loc, 'synthetic touch, not real touch hardware; two-finger rotation and longer paths are not tried', 'toque sintético, não hardware de toque real; rotação com dois dedos e trajetos mais longos não são tentados'),
    ].filter(Boolean)
    const status: ProbeCoverage['status'] = findings.length > 0 ? 'failures' : review.length > 0 ? 'needs-review' : read.applicable > 0 || targets.length === 0 ? 'no-failure-found' : 'not-checked'
    return {
      findings,
      review,
      coverage: [
        {
          criterion: '2.5.1',
          method: `probe/gestures@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(loc, `swipes and pinches as touch events, then the controls around clicked on fresh loads, at ${viewportText(data)}`, `deslizes e pinças como eventos de toque, depois os controles ao redor clicados em cargas novas, em ${viewportText(data)}`)),
          status,
          applicable: read.applicable,
          failures: findings.length,
          review: review.length,
          unmatched: read.unmatched,
          note: notes.join('; '),
          maturity: 'experimental',
        },
      ],
    }
  },
}

const PATTERN_TEXT: Record<MotionPattern, [string, string]> = {
  shake: ['Shaking the device', 'Sacudir o aparelho'],
  'tilt-sideways': ['Tilting the device to the side', 'Inclinar o aparelho para o lado'],
  'tilt-forward': ['Tilting the device forward', 'Inclinar o aparelho para a frente'],
}

const EFFECT_TEXT: Record<string, [string, string]> = {
  navigation: ['makes the page go elsewhere', 'faz a página ir para outro lugar'],
  dialog: ['opens a dialog', 'abre um diálogo'],
  content: ['changes the page', 'muda a página'],
  scroll: ['scrolls', 'rola'],
  style: ['moves things on the page', 'move coisas na página'],
}

export interface MotionVerdict {
  result: 'failure' | 'review' | 'pass' | 'none'
  why: 'no-listener' | 'unreached' | 'nothing' | 'style' | 'once' | 'unconfirmed' | 'alternatives-differ' | 'no-alternative' | 'switch-unclear' | 'no-switch' | 'pass'
}

/**
 * 2.5.4's reading of the device-motion part: a motion that did something (not only styles), again on a second load,
 * fails when no control does the same (ACT c249d5) or, with one, when no switch on the page turned the response off
 * (7677a9). The browser's scrolling stands in for a motion that scrolled what a person can scroll. Controls or a switch
 * that did not do what was asked, a change on one load of two, styles alone (parallax), and listeners that nothing
 * answered go to a person.
 */
export function motionVerdict(data: Partial<DeviceMotionData>): MotionVerdict {
  const listeners = asArray<unknown>(data.listeners)
  if (listeners.length === 0) return { result: 'none', why: 'no-listener' }
  const effect = data.effect
  if (!effect) {
    const reached = asArray<{ events?: { motion?: number; orientation?: number } }>(data.tries).some((t) => (Number(t.events?.motion) || 0) + (Number(t.events?.orientation) || 0) > 0)
    return { result: 'review', why: reached ? 'nothing' : 'unreached' }
  }
  if (effect.effect?.kind === 'style') return { result: 'review', why: 'style' }
  if (data.confirmed !== true) return { result: 'review', why: data.confirmed === false ? 'once' : 'unconfirmed' }
  const controls = asArray<MotionControl>(data.controls)
  const alternatives = controls.filter((c) => c.role === 'alternative')
  const switches = controls.filter((c) => c.role === 'switch')
  const alternative = data.scrolls === true || alternatives.some((c) => c.reproduced)
  if (!alternative) return alternatives.length > 0 ? { result: 'review', why: 'alternatives-differ' } : { result: 'failure', why: 'no-alternative' }
  if (!switches.some((c) => c.stopped)) return switches.length > 0 ? { result: 'review', why: 'switch-unclear' } : { result: 'failure', why: 'no-switch' }
  return { result: 'pass', why: 'pass' }
}

function listenerText(data: Partial<DeviceMotionData>): string {
  const where = (script: string, line?: number) => {
    if (!script) return `inline${line ? `:${line}` : ''}`
    try {
      const url = new URL(script)
      return `${url.hostname}/…/${url.pathname.split('/').filter(Boolean).at(-1) ?? ''}${line ? `:${line}` : ''}`
    } catch {
      return `${short(script, 40)}${line ? `:${line}` : ''}`
    }
  }
  return asArray<{ type: string; script: string; line?: number }>(data.listeners)
    .slice(0, 3)
    .map((l) => `${l.type} (${where(l.script, l.line)})`)
    .join(', ')
}

function controlsText(controls: MotionControl[], locale: Locale): string {
  return controls
    .map((c) => {
      const how = c.skipped
        ? say(locale, `not tried: ${c.skipped}`, `não tentado: ${c.skipped}`)
        : c.role === 'switch'
          ? c.stopped
            ? say(locale, 'turned motion off', 'desligou o movimento')
            : say(locale, 'motion still acted', 'o movimento ainda agiu')
          : c.reproduced
            ? say(locale, 'did the same', 'fez o mesmo')
            : c.did
              ? say(locale, `did something else: ${short(c.did, 50)}`, `fez outra coisa: ${short(c.did, 50)}`)
              : say(locale, 'no change', 'sem mudança')
      return `"${short(c.label, 30)}" (${how})`
    })
    .join(', ')
}

function motionMessage(verdict: MotionVerdict, data: Partial<DeviceMotionData>, locale: Locale): string {
  const effect = data.effect
  const pattern = say(locale, ...(PATTERN_TEXT[effect?.pattern ?? 'shake'] ?? ['Moving the device', 'Mover o aparelho']))
  const does = say(locale, ...(EFFECT_TEXT[effect?.effect.kind ?? 'content'] ?? ['changes the page', 'muda a página']))
  const detail = short(effect?.effect.detail, 100)
  const via = data.sensors ? say(locale, "the browser's virtual sensors", 'os sensores virtuais do navegador') : say(locale, 'synthetic events', 'eventos sintéticos')
  const listeners = listenerText(data)
  const controls = asArray<MotionControl>(data.controls)
  const alternatives = controls.filter((c) => c.role === 'alternative')
  const switches = controls.filter((c) => c.role === 'switch')
  const essential = say(locale, ' If the motion is essential (a pedometer, a spirit level), the criterion allows it: waive the finding (rampa waive).', ' Se o movimento é essencial (um pedômetro, um nível), o critério permite: dispense o achado (rampa waive).')
  switch (verdict.why) {
    case 'no-alternative':
      return say(
        locale,
        `${pattern} ${does} (${detail}), on two loads, and Rampa found no control on the page that does the same (WCAG 2.5.4, ACT c249d5). People who cannot move a device, or whose device is mounted, need a control on the screen for it, and a way to turn the response to motion off. Add both.${essential}`,
        `${pattern} ${does} (${detail}), em duas cargas, e o Rampa não achou controle na página que faça o mesmo (WCAG 2.5.4, ACT c249d5). Quem não consegue mover o aparelho, ou o tem fixo, precisa de um controle na tela para isso, e de um jeito de desligar a resposta ao movimento. Adicione os dois.${essential}`,
      )
    case 'no-switch': {
      const alternative = data.scrolls ? say(locale, "The browser's own scrolling does the same", 'A própria rolagem do navegador faz o mesmo') : say(locale, `"${short(alternatives.find((c) => c.reproduced)?.label, 30)}" does the same`, `"${short(alternatives.find((c) => c.reproduced)?.label, 30)}" faz o mesmo`)
      return say(
        locale,
        `${pattern} ${does} (${detail}), on two loads. ${alternative}, but Rampa found no way on the page to turn the response to motion off (WCAG 2.5.4, ACT 7677a9): someone whose hands shake, or whose phone is mounted on a wheelchair, sets it off by accident. Add a setting that turns it off. A setting elsewhere (another page, the app's settings) satisfies the criterion, and essential motion (a pedometer, a spirit level) is exempt: then waive the finding (rampa waive).`,
        `${pattern} ${does} (${detail}), em duas cargas. ${alternative}, mas o Rampa não achou na página um jeito de desligar a resposta ao movimento (WCAG 2.5.4, ACT 7677a9): quem tem tremor nas mãos, ou o celular preso a uma cadeira de rodas, o aciona sem querer. Adicione uma configuração que o desligue. Uma configuração em outro lugar (outra página, as configurações do app) satisfaz o critério, e movimento essencial (um pedômetro, um nível) é exceção: então dispense o achado (rampa waive).`,
      )
    }
    case 'alternatives-differ':
      return say(
        locale,
        `${pattern} ${does} (${detail}). The controls Rampa tried (${controlsText(alternatives, locale)}) did not do the same: check that a control on the screen does what the motion does, and that motion can be turned off (WCAG 2.5.4).`,
        `${pattern} ${does} (${detail}). Os controles que o Rampa tentou (${controlsText(alternatives, locale)}) não fizeram o mesmo: confira se um controle na tela faz o que o movimento faz, e se o movimento pode ser desligado (WCAG 2.5.4).`,
      )
    case 'switch-unclear':
      return say(
        locale,
        `${pattern} ${does} (${detail}), and a control does the same, but the switches Rampa toggled (${controlsText(switches, locale)}) did not stop the motion from acting: check that the response to motion can be turned off (WCAG 2.5.4).`,
        `${pattern} ${does} (${detail}), e um controle faz o mesmo, mas as chaves que o Rampa alternou (${controlsText(switches, locale)}) não impediram o movimento de agir: confira se a resposta ao movimento pode ser desligada (WCAG 2.5.4).`,
      )
    case 'once':
    case 'unconfirmed':
      return say(
        locale,
        `${pattern} ${does} (${detail}), but ${verdict.why === 'once' ? 'not again on a second load' : 'it was not tried again on a second load'}: check by hand that a control does the same and that motion can be turned off (WCAG 2.5.4).`,
        `${pattern} ${does} (${detail}), mas ${verdict.why === 'once' ? 'não de novo numa segunda carga' : 'não foi tentado de novo numa segunda carga'}: confira à mão se um controle faz o mesmo e se o movimento pode ser desligado (WCAG 2.5.4).`,
      )
    case 'style':
      return say(
        locale,
        `${pattern} ${does} (${detail}), but changes no content: decorative motion (a parallax) operates nothing, and 2.5.4 does not apply to it. Check that moving the device does not operate a function (WCAG 2.5.4); if it does, a control must do the same and motion must be possible to turn off.`,
        `${pattern} ${does} (${detail}), mas não muda conteúdo: movimento decorativo (um parallax) não aciona nada, e o 2.5.4 não se aplica a ele. Confira se mover o aparelho não aciona uma função (WCAG 2.5.4); se acionar, um controle precisa fazer o mesmo e o movimento precisa poder ser desligado.`,
      )
    case 'unreached':
      return say(
        locale,
        `2.5.4 applies here: the page listens to the device's motion (${listeners}), but the motion Rampa made (${via}) did not reach its listeners. Check by hand that whatever moving the device does can also be done with a control on the screen, and that motion can be turned off (WCAG 2.5.4).`,
        `O 2.5.4 se aplica aqui: a página escuta o movimento do aparelho (${listeners}), mas o movimento que o Rampa fez (${via}) não chegou aos ouvintes. Confira à mão se o que mover o aparelho faz também pode ser feito com um controle na tela, e se o movimento pode ser desligado (WCAG 2.5.4).`,
      )
    default:
      return say(
        locale,
        `2.5.4 applies here: the page listens to the device's motion (${listeners}). Rampa shook the device and tilted it to the side and forward (${via}), and nothing on the page changed. Check whether moving the device operates anything after an interaction (a tap, a permission), and if so, that a control does the same and motion can be turned off (WCAG 2.5.4). If the script only collects data (analytics, fraud checks), 2.5.4 does not apply.`,
        `O 2.5.4 se aplica aqui: a página escuta o movimento do aparelho (${listeners}). O Rampa sacudiu o aparelho e o inclinou para o lado e para a frente (${via}), e nada na página mudou. Confira se mover o aparelho aciona algo depois de uma interação (um toque, uma permissão) e, se acionar, se um controle faz o mesmo e o movimento pode ser desligado (WCAG 2.5.4). Se o script só coleta dados (análise, antifraude), o 2.5.4 não se aplica.`,
      )
  }
}

function motionEvidence(data: Partial<DeviceMotionData>, locale: Locale): string {
  const tries = asArray<{ pattern: string; via: string; events?: { motion?: number; orientation?: number }; effect?: { kind: string } }>(data.tries)
  const controls = asArray<MotionControl>(data.controls)
  return [
    say(locale, `listeners: ${listenerText(data)}`, `ouvintes: ${listenerText(data)}`),
    tries.length > 0
      ? tries.map((t) => `${t.pattern} (${t.via}, ${Number(t.events?.motion) || 0}+${Number(t.events?.orientation) || 0} ${say(locale, 'events', 'eventos')}): ${t.effect?.kind ?? say(locale, 'nothing', 'nada')}`).join('; ')
      : '',
    data.effect ? short(data.effect.effect.detail, 120) : '',
    data.confirmed === true ? say(locale, 'again on a second fresh load', 'de novo numa segunda carga nova') : data.confirmed === false ? say(locale, 'not again on a second fresh load', 'não de novo numa segunda carga nova') : '',
    data.scrolls ? say(locale, "the browser's scrolling does the same", 'a rolagem do navegador faz o mesmo') : '',
    controls.length > 0 ? say(locale, `tried: ${controlsText(controls, locale)}`, `tentado: ${controlsText(controls, locale)}`) : data.effect && data.effect.effect.kind !== 'style' ? say(locale, 'no control or switch found for it', 'nenhum controle ou chave encontrado para isso') : '',
  ]
    .filter(Boolean)
    .join('; ')
}

/**
 * 2.5.4 Motion Actuation, over the gestures probe's device-motion part (ACT c249d5 and 7677a9). One item per page, on
 * the document: a failure when a motion operates something, again on a second load, and no control does the same, or
 * no switch on the page turns motion off; an item to review otherwise, whenever the page listens to motion. With no
 * listener, nothing applies, and the coverage says so.
 */
export const motionActuationRule: ProbeRule = {
  id: MOTION_ACTUATION_RULE,
  kind: 'gestures',
  variant: DEVICE_MOTION_VARIANT,
  versions: [DEVICE_MOTION_VERSION],
  criteria: ['2.5.4'],
  act: ['c249d5', '7677a9'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = deviceMotionData(record)
    const loc = ctx.locale
    const verdict = motionVerdict(data)
    const findings: Finding[] = []
    const review: Finding[] = []
    if (verdict.result === 'failure' || verdict.result === 'review') {
      const finding = probeFinding({
        criterion: '2.5.4',
        rule: this.id,
        node: ctx.snapshot.root,
        message: motionMessage(verdict, data, loc),
        evidence: motionEvidence(data, loc),
        confidence: verdict.result === 'failure' ? 'medium' : 'low',
        subject: `motion|${verdict.why}`,
      })
      ;(verdict.result === 'failure' ? findings : review).push(finding)
    }
    const listeners = asArray<unknown>(data.listeners).length
    const note = [
      listeners === 0
        ? say(loc, 'no devicemotion or deviceorientation listener on the page once loaded; listeners a page adds after a tap are not reached', 'nenhum ouvinte de devicemotion ou deviceorientation na página carregada; ouvintes que a página adiciona depois de um toque não são alcançados')
        : say(loc, `listeners: ${listenerText(data)}`, `ouvintes: ${listenerText(data)}`),
      verdict.result === 'pass' ? say(loc, `a control does what the motion did, and a switch turns it off: ${controlsText(asArray<MotionControl>(data.controls), loc)}`, `um controle faz o que o movimento fez, e uma chave o desliga: ${controlsText(asArray<MotionControl>(data.controls), loc)}`) : '',
      listeners > 0 ? say(loc, `${data.sensors ? "the browser's virtual sensors" : 'synthetic events'}, not real sensors; camera and body gestures are not tried`, `${data.sensors ? 'sensores virtuais do navegador' : 'eventos sintéticos'}, não sensores reais; gestos de câmera e do corpo não são tentados`) : '',
    ]
      .filter(Boolean)
      .join('; ')
    const status: ProbeCoverage['status'] = findings.length > 0 ? 'failures' : review.length > 0 ? 'needs-review' : 'no-failure-found'
    const viewport = record.conditions.viewport
    return {
      findings,
      review,
      coverage: [
        {
          criterion: '2.5.4',
          method: `probe/gestures@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(loc, `the device shaken and tilted, at ${viewport.width}×${viewport.height}`, `o aparelho sacudido e inclinado, em ${viewport.width}×${viewport.height}`)),
          status,
          applicable: listeners > 0 ? 1 : 0,
          failures: findings.length,
          review: review.length,
          unmatched: 0,
          note,
          maturity: 'experimental',
        },
      ],
    }
  },
}

export const GESTURE_RULES: readonly ProbeRule[] = [gestureAlternativesRule, motionActuationRule]
