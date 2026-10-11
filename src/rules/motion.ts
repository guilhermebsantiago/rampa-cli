import type { Confidence, EngineResults, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { MOTION_VARIANT, MOTION_VERSION, type MotionControl, type MotionData, type MotionItem, type MotionKind } from '../probes/motion.ts'
import { matchNode } from '../probes/identity.ts'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, moreNotListed, probeFinding, say } from './probes.ts'

/**
 * 2.2.2 Pause, Stop, Hide, from the motion probe's facts (probes/motion.ts). Content that moves, blinks or scrolls on
 * its own for more than five seconds, or text that updates on its own (ACT efbfc7), shown next to other content, fails
 * when the page offers no way to pause, stop or hide it: no control near it named for that, or controls the probe
 * pressed that did not stop it. A control that did stop or hide it, or a video's own controls, is a mechanism (never a
 * pass: whether it is easy to find and works from the keyboard stays with a person). What the probe could not decide
 * goes to review: a control it could not press (the skip list, another layer over it, the budget), a control that
 * sets the frequency (never set), motion seen on one load only, and animations that only change colors. Essential
 * motion is the person's call: the message says to waive it. No model is asked (the plan's section 6).
 */

export const PAUSE_STOP_HIDE_RULE = 'rampa/pause-stop-hide'
const MAX_REPORTED = 10

/** The motion probe's 2.2.2 record, when it is one the rule reads. */
export function motionRecord(records: readonly ProbeRecord[] | undefined): ProbeRecord | undefined {
  return records?.find((r) => r.kind === 'motion' && r.conditions.variant === MOTION_VARIANT && r.version === MOTION_VERSION && r.status !== 'skipped')
}

/** The probe's data read back from a record: a snapshot is input, so every list is checked. */
export function motionData(record: ProbeRecord): MotionData {
  const data = asRecord(record.data) as Partial<MotionData>
  const found = asRecord(data.found)
  const number = (value: unknown) => Number(value) || 0
  return {
    viewport: { width: number(asRecord(data.viewport).width), height: number(asRecord(data.viewport).height) },
    stepMs: number(data.stepMs),
    seriesMs: number(data.seriesMs),
    extendedMs: number(data.extendedMs),
    scenes: asArray(data.scenes),
    found: {
      animations: number(found.animations),
      short: number(found.short),
      smil: number(found.smil),
      videos: number(found.videos),
      images: number(found.images),
      animated: number(found.animated),
      unread: number(found.unread),
      canvases: number(found.canvases),
      marquees: number(found.marquees),
      texts: number(found.texts),
      alone: number(found.alone),
      regions: number(found.regions),
      lasting: number(found.lasting),
      brief: number(found.brief),
      below: number(found.below),
      tracked: number(found.tracked),
    },
    items: asArray<MotionItem>(data.items).filter((item) => item && typeof item.key === 'string' && item.el && Array.isArray(item.kinds)),
    controls: asArray<MotionControl>(data.controls).filter((control) => control && typeof control.key === 'string' && control.el),
    loads: number(data.loads),
    actions: asArray(data.actions),
    end: data.end === 'time' || data.end === 'budget' ? data.end : 'complete',
  }
}

export type MotionWhy =
  | 'none'
  | 'kept-moving'
  | 'untried'
  | 'frequency'
  | 'once'
  | 'unconfirmed'
  | 'unknown'
  | 'colors'

export interface MotionVerdict {
  item: MotionItem
  node: A11yNode
  result: 'failure' | 'review'
  why: MotionWhy
  confidence: Confidence
  /** Controls pressed that left it moving, those not pressed (and why), and those that set the frequency. */
  kept: MotionControl[]
  untried: MotionControl[]
  frequency: MotionControl[]
}

export interface MotionVerdicts {
  verdicts: MotionVerdict[]
  /** Items in parallel with other content, matched to the snapshot, not left to axe-core. */
  applicable: number
  unmatched: number
  /** Content alone on the page, not shown in parallel with anything: not applicable. */
  alone: number
  /** Left to axe-core, which already fails it (marquee, blink). */
  axe: number
  /** Stopped or hidden by a control the probe pressed, and the controls; videos with their own controls. */
  stopped: Array<{ item: MotionItem; control?: MotionControl | undefined }>
  native: number
}

const ENGINE_RULES: Partial<Record<MotionKind, string>> = { marquee: 'marquee' }

/** axe-core already failed the element (marquee, blink): its finding is axe-core's. */
function failedByAxe(item: MotionItem, engine: EngineResults | undefined): boolean {
  if (!engine) return false
  const rules = new Set(['blink', ...item.kinds.flatMap((kind) => (ENGINE_RULES[kind] ? [ENGINE_RULES[kind] as string] : []))])
  return engine.rules.some((rule) => rule.outcome === 'violation' && rules.has(rule.ruleId) && rule.nodes.some((node) => (node.ref ?? node.target) === item.el.ref || item.members?.includes(node.ref ?? node.target)))
}

const TRIABLE = new Set(['pause', 'stop', 'hide', 'close', 'setting'])

/** 2.2.2's reading of the motion probe's facts. */
export function motionVerdicts(data: MotionData, index: TreeIndex, engine?: EngineResults): MotionVerdicts {
  const out: MotionVerdicts = { verdicts: [], applicable: 0, unmatched: 0, alone: 0, axe: 0, stopped: [], native: 0 }
  const control = (key: string) => data.controls.find((c) => c.key === key)
  for (const item of data.items) {
    const node = matchNode(index, item.el.ref, item.el.id)
    if (!node) {
      out.unmatched++
      continue
    }
    if (!item.parallel) {
      out.alone++
      continue
    }
    if (failedByAxe(item, engine)) {
      out.axe++
      continue
    }
    out.applicable++
    if (item.nativeControls) {
      out.native++
      out.stopped.push({ item })
      continue
    }
    if (item.stoppedBy) {
      out.stopped.push({ item, control: control(item.stoppedBy) })
      continue
    }
    const near = asArray<string>(item.controls).map(control).filter((c): c is MotionControl => !!c)
    const candidates = near.filter((c) => TRIABLE.has(c.kind))
    const kept = candidates.filter((c) => c.trial?.outcome === 'tried' && c.trial.results?.some((r) => r.item === item.key && r.before === 'moving' && r.after === 'moving'))
    const unknown = candidates.filter((c) => c.trial?.outcome === 'tried' && !c.trial.results?.some((r) => r.item === item.key && r.before === 'moving' && r.after !== 'unknown'))
    const untried = candidates.filter((c) => c.skip || !c.trial || c.trial.outcome !== 'tried')
    const frequency = near.filter((c) => c.kind === 'frequency')
    const verdict = (result: MotionVerdict['result'], why: MotionWhy, confidence: Confidence): MotionVerdict => ({ item, node, result, why, confidence, kept, untried, frequency })
    const colorsOnly = !!item.animation?.colorOnly && item.kinds.every((kind) => kind === 'animation' || kind === 'pixels')
    if (colorsOnly) out.verdicts.push(verdict('review', 'colors', 'low'))
    else if (untried.length > 0) out.verdicts.push(verdict('review', 'untried', 'low'))
    else if (kept.length > 0) out.verdicts.push(verdict('failure', 'kept-moving', 'medium'))
    else if (unknown.length > 0) out.verdicts.push(verdict('review', 'unknown', 'low'))
    else if (frequency.length > 0) out.verdicts.push(verdict('review', 'frequency', 'low'))
    else if (item.confirmed === false) out.verdicts.push(verdict('review', 'once', 'low'))
    else if (item.confirmed === undefined) out.verdicts.push(verdict('review', 'unconfirmed', 'low'))
    else out.verdicts.push(verdict('failure', 'none', item.kinds.every((kind) => kind === 'pixels') ? 'medium' : 'high'))
  }
  return out
}

const short = (text: string | undefined, n = 60) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}
const seconds = (ms: number, locale: Locale) => {
  const text = (Math.round(ms / 100) / 10).toFixed(1)
  return locale === 'pt-BR' ? text.replace('.', ',') : text
}

/** "This animation", "Text that updates by itself"… */
function what(item: MotionItem, locale: Locale): string {
  const kinds = item.kinds
  if (kinds.includes('video')) return say(locale, 'This video', 'Este vídeo')
  if (kinds.includes('image')) return say(locale, 'This animated image', 'Esta imagem animada')
  if (kinds.includes('marquee')) return say(locale, 'This scrolling text', 'Este texto que rola')
  if (kinds.includes('text') && !kinds.includes('animation')) {
    const values = (item.text?.values ?? []).slice(0, 3).map((v) => `"${short(v, 30)}"`).join(', ')
    return say(locale, `Text that updates by itself${values ? ` (${values}…)` : ''}`, `Um texto que se atualiza sozinho${values ? ` (${values}…)` : ''}`)
  }
  if (kinds.includes('animation')) return say(locale, `This animation${item.animation?.names.length ? ` (${item.animation.names.slice(0, 2).join(', ')})` : ''}`, `Esta animação${item.animation?.names.length ? ` (${item.animation.names.slice(0, 2).join(', ')})` : ''}`)
  if (kinds.includes('smil')) return say(locale, 'This SVG animation', 'Esta animação SVG')
  return say(locale, 'This content', 'Este conteúdo')
}

function controlText(control: MotionControl): string {
  return `<${control.el.tag}> "${short(control.name, 40)}"`
}

const NOT_TRIED: Record<string, [string, string]> = {
  destructive: ['skip list', 'lista de exclusão'],
  submit: ['submits a form', 'envia um formulário'],
  'sensitive-form': ['in a form with password, payment or file fields', 'em formulário com senha, pagamento ou arquivo'],
  'other-origin': ['another origin', 'outra origem'],
  'new-window': ['opens a new window', 'abre nova janela'],
  download: ['a download', 'um download'],
  disabled: ['disabled', 'desabilitado'],
  budget: ['control budget', 'limite de controles'],
  time: ['time budget', 'limite de tempo'],
}

function untriedText(control: MotionControl, locale: Locale): string {
  const why: [string, string] = control.skip
    ? (NOT_TRIED[control.skip.reason] ?? [control.skip.reason, control.skip.reason])
    : control.trial?.cover
      ? [`under <${control.trial.cover.tag}> "${short(control.trial.cover.text, 30)}"`, `sob <${control.trial.cover.tag}> "${short(control.trial.cover.text, 30)}"`]
      : control.trial?.outcome === 'not-tried'
        ? (NOT_TRIED[control.trial.reason ?? ''] ?? ['not tried', 'não tentado'])
        : !control.shows
          ? ['does not show, and nothing found shows it', 'não aparece, e nada encontrado o mostra']
          : [control.trial?.reason ?? control.trial?.outcome ?? 'not tried', control.trial?.reason ?? control.trial?.outcome ?? 'não tentado']
  return `${controlText(control)} (${say(locale, why[0], why[1])})`
}

/** What the probe measured about an item, in a few clauses. */
export function motionEvidence(item: MotionItem, locale: Locale): string {
  const parts: string[] = []
  if (item.text) {
    parts.push(
      say(
        locale,
        `its text changed ${item.text.changes} times with no input, from ${seconds(item.text.firstMs, locale)} s to ${seconds(item.text.lastMs, locale)} s of the page's time, about every ${seconds(item.text.intervalMs, locale)} s: ${item.text.values.map((v) => `"${short(v, 30)}"`).join(', ')}`,
        `seu texto mudou ${item.text.changes} vezes sem entrada, de ${seconds(item.text.firstMs, locale)} s a ${seconds(item.text.lastMs, locale)} s do tempo da página, a cada ${seconds(item.text.intervalMs, locale)} s mais ou menos: ${item.text.values.map((v) => `"${short(v, 30)}"`).join(', ')}`,
      ),
    )
  }
  if (item.animation) {
    const runs = item.animation.infinite ? say(locale, 'with no end', 'sem fim') : say(locale, `for ${seconds(item.animation.endMs, locale)} s`, `por ${seconds(item.animation.endMs, locale)} s`)
    parts.push(say(locale, `animation ${item.animation.names.join(', ')} on ${item.animation.properties.join(', ') || 'its style'}, ${runs}`, `animação ${item.animation.names.join(', ')} em ${item.animation.properties.join(', ') || 'seu estilo'}, ${runs}`))
  }
  if (item.smil) parts.push(say(locale, `${item.smil.count} SVG animation(s)${item.smil.infinite ? ', repeating with no end' : ''}`, `${item.smil.count} animação(ões) SVG${item.smil.infinite ? ', repetindo sem fim' : ''}`))
  if (item.video) {
    const length = item.video.durationMs === -1 ? say(locale, 'live', 'ao vivo') : `${seconds(item.video.durationMs, locale)} s`
    parts.push(say(locale, `video ${short(item.video.url, 80)}, ${length}${item.video.loop ? ', looping' : ''}${item.video.muted ? ', muted' : ''}, playing on load${item.video.controls ? ', with controls' : ', no controls'}`, `vídeo ${short(item.video.url, 80)}, ${length}${item.video.loop ? ', em loop' : ''}${item.video.muted ? ', sem som' : ''}, tocando ao carregar${item.video.controls ? ', com controles' : ', sem controles'}`))
  }
  if (item.image) parts.push(say(locale, `animated ${item.image.format.replace('image/', '').toUpperCase()} ${short(item.image.url, 80)}, ${item.image.frames} frames, ${seconds(item.image.loopMs, locale)} s per loop${item.image.loop ? ', looping' : ''}`, `${item.image.format.replace('image/', '').toUpperCase()} animado ${short(item.image.url, 80)}, ${item.image.frames} quadros, ${seconds(item.image.loopMs, locale)} s por ciclo${item.image.loop ? ', em loop' : ''}`))
  if (item.kinds.includes('marquee')) parts.push(say(locale, 'a marquee element', 'um elemento marquee'))
  if (item.pixels) {
    parts.push(
      say(
        locale,
        `the window showed it change from ${seconds(item.pixels.firstMs, locale)} s to ${seconds(item.pixels.lastMs, locale)} s of the page's time, over ${Math.round(item.pixels.area).toLocaleString('en-US')} px²`,
        `a janela mostrou mudanças de ${seconds(item.pixels.firstMs, locale)} s a ${seconds(item.pixels.lastMs, locale)} s do tempo da página, sobre ${Math.round(item.pixels.area).toLocaleString('pt-BR')} px²`,
      ),
    )
  }
  return parts.join('; ')
}

export function motionMessage(verdict: MotionVerdict, locale: Locale): string {
  const lead = what(verdict.item, locale)
  const text = verdict.item.kinds.includes('text') && !verdict.item.kinds.some((k) => k === 'animation' || k === 'video' || k === 'image' || k === 'marquee')
  const doing = text
    ? say(locale, 'updates by itself next to other content', 'se atualiza sozinho ao lado de outro conteúdo')
    : verdict.item.kinds.includes('video')
      ? say(locale, 'plays by itself for more than 5 seconds next to other content', 'toca sozinho por mais de 5 segundos ao lado de outro conteúdo')
      : say(locale, 'moves by itself for more than 5 seconds next to other content', 'se move sozinho por mais de 5 segundos ao lado de outro conteúdo')
  const technique = verdict.item.kinds.includes('image') ? 'G152' : text ? 'G186' : 'G4'
  const act = text ? say(locale, '; ACT efbfc7', '; ACT efbfc7') : ''
  const fix = text
    ? say(locale, 'Add a control to pause or stop the updates, or to set how often they come (G186), or let people hide it.', 'Adicione um controle para pausar ou parar as atualizações, ou para definir a frequência delas (G186), ou deixe a pessoa ocultá-lo.')
    : verdict.item.kinds.includes('image')
      ? say(locale, 'Make it stop within 5 seconds (G152), or add a visible control that pauses or hides it.', 'Faça-a parar em até 5 segundos (G152), ou adicione um controle visível que a pause ou oculte.')
      : say(locale, 'Add a visible control next to it that pauses or stops it (G4), stop it within 5 seconds (G11), or let people hide it.', 'Adicione ao lado um controle visível que o pause ou pare (G4), pare-o em até 5 segundos (G11), ou deixe a pessoa ocultá-lo.')
  const essential = say(locale, 'If the motion is essential to what the page does, waive this finding (rampa waive).', 'Se o movimento é essencial ao que a página faz, dispense este achado (rampa waive).')
  switch (verdict.why) {
    case 'none':
      return say(
        locale,
        `${lead} ${doing}, and the page has no control near it to pause, stop or hide it (WCAG 2.2.2${act}). ${fix} ${essential}`,
        `${lead} ${doing}, e a página não tem um controle perto dele para pausar, parar ou ocultar (WCAG 2.2.2${act}). ${fix} ${essential}`,
      ).replace(/ +/g, ' ')
    case 'kept-moving':
      return say(
        locale,
        `${lead} ${doing}, and the page's ${verdict.kept.map(controlText).join(', ')} did not stop or hide it: pressed on a fresh load, it kept ${text ? 'updating' : 'moving'} (WCAG 2.2.2${act}). Make the control stop it (${technique}), or add one that does. ${essential}`,
        `${lead} ${doing}, e ${verdict.kept.map(controlText).join(', ')} da página não o parou nem ocultou: pressionado numa carga nova, continuou ${text ? 'se atualizando' : 'se movendo'} (WCAG 2.2.2${act}). Faça o controle pará-lo (${technique}), ou adicione um que pare. ${essential}`,
      ).replace(/ +/g, ' ')
    case 'untried':
      return say(
        locale,
        `${lead} ${doing}. Controls near it may pause, stop or hide it, but Rampa did not press them: ${verdict.untried.map((c) => untriedText(c, 'en')).join(', ')}${verdict.frequency.length > 0 ? `; and ${verdict.frequency.map(controlText).join(', ')} may set how often it changes, which Rampa never sets` : ''}. Check by hand that one of them stops it (WCAG 2.2.2).`,
        `${lead} ${doing}. Controles perto dele podem pausá-lo, pará-lo ou ocultá-lo, mas o Rampa não os pressionou: ${verdict.untried.map((c) => untriedText(c, 'pt-BR')).join(', ')}${verdict.frequency.length > 0 ? `; e ${verdict.frequency.map(controlText).join(', ')} pode definir a frequência, que o Rampa nunca ajusta` : ''}. Verifique à mão que um deles o para (WCAG 2.2.2).`,
      ).replace(/ +/g, ' ')
    case 'frequency':
      return say(
        locale,
        `${lead} ${doing}. ${verdict.frequency.map(controlText).join(', ')} may set how often it changes, which meets WCAG 2.2.2; Rampa never sets it. Check by hand.`,
        `${lead} ${doing}. ${verdict.frequency.map(controlText).join(', ')} pode definir a frequência das mudanças, o que atende à WCAG 2.2.2; o Rampa nunca o ajusta. Verifique à mão.`,
      ).replace(/ +/g, ' ')
    case 'unknown':
      return say(
        locale,
        `${lead} ${doing}. Rampa pressed ${verdict.item.controls.length > 0 ? 'a control near it' : 'controls'} but could not tell whether it stopped (it did not move on that load before the press, or could not be captured). Check by hand (WCAG 2.2.2).`,
        `${lead} ${doing}. O Rampa pressionou um controle perto dele, mas não conseguiu saber se parou (não se moveu nessa carga antes do clique, ou não pôde ser capturado). Verifique à mão (WCAG 2.2.2).`,
      ).replace(/ +/g, ' ')
    case 'once':
      return say(
        locale,
        `${lead} ${doing} on one load, but not on a second one with no input. Check whether it moves by itself, and whether it can be paused (WCAG 2.2.2).`,
        `${lead} ${doing} numa carga, mas não numa segunda sem entrada. Verifique se ele se move sozinho, e se pode ser pausado (WCAG 2.2.2).`,
      ).replace(/ +/g, ' ')
    case 'unconfirmed':
      return say(
        locale,
        `${lead} ${doing}; Rampa did not watch it on a second load (time budget), and found no control near it. Check by hand (WCAG 2.2.2).`,
        `${lead} ${doing}; o Rampa não o observou numa segunda carga (limite de tempo), e não achou controle perto dele. Verifique à mão (WCAG 2.2.2).`,
      ).replace(/ +/g, ' ')
    case 'colors':
      return say(
        locale,
        `${lead} only changes colors, with no end. Whether that is blinking that draws attention, and whether something on the page stops it (WCAG 2.2.2), needs a person.`,
        `${lead} só muda de cor, sem fim. Se isso é um piscar que chama a atenção, e se algo na página o para (WCAG 2.2.2), precisa de uma pessoa.`,
      ).replace(/ +/g, ' ')
  }
}

function evidenceOf(verdict: MotionVerdict, locale: Locale): string {
  const item = verdict.item
  const controls =
    verdict.kept.length > 0
      ? say(locale, `pressed on a fresh load, it kept moving: ${verdict.kept.map(controlText).join(', ')}`, `pressionado numa carga nova, continuou: ${verdict.kept.map(controlText).join(', ')}`)
      : verdict.untried.length > 0
        ? say(locale, `not pressed: ${verdict.untried.map((c) => untriedText(c, 'en')).join(', ')}`, `não pressionado(s): ${verdict.untried.map((c) => untriedText(c, 'pt-BR')).join(', ')}`)
        : verdict.frequency.length > 0
          ? say(locale, `a control for the frequency, not set: ${verdict.frequency.map(controlText).join(', ')}`, `um controle de frequência, não ajustado: ${verdict.frequency.map(controlText).join(', ')}`)
          : say(locale, 'no control near it named to pause, stop or hide it', 'nenhum controle perto dele com nome de pausar, parar ou ocultar')
  const again =
    item.confirmed === true
      ? say(locale, 'it moved again on a second fresh load', 'moveu-se de novo numa segunda carga nova')
      : item.confirmed === false
        ? say(locale, 'it did not move again on a second fresh load', 'não se moveu de novo numa segunda carga nova')
        : ''
  return [motionEvidence(item, locale), controls, again].filter(Boolean).join('; ')
}

export const pauseStopHideRule: ProbeRule = {
  id: PAUSE_STOP_HIDE_RULE,
  kind: 'motion',
  variant: MOTION_VARIANT,
  versions: [MOTION_VERSION],
  criteria: ['2.2.2'],
  act: ['efbfc7'],
  undecidedReview: true,
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = motionData(record)
    const loc = ctx.locale
    const result = motionVerdicts(data, ctx.index, ctx.engine)
    const findings: Finding[] = []
    const review: Finding[] = []
    let failures = 0
    for (const verdict of result.verdicts) {
      const finding = probeFinding({
        criterion: '2.2.2',
        rule: PAUSE_STOP_HIDE_RULE,
        node: verdict.node,
        message: motionMessage(verdict, loc),
        evidence: evidenceOf(verdict, loc),
        confidence: verdict.confidence,
        subject: `${verdict.item.kinds.join('+')}|${verdict.why === 'none' || verdict.why === 'kept-moving' ? 'fail' : verdict.why}`,
      })
      if (verdict.result === 'failure') {
        failures++
        if (findings.length < MAX_REPORTED) findings.push(finding)
      } else if (review.length < MAX_REPORTED) review.push(finding)
    }
    const f = data.found
    const stopped = result.stopped.filter((s) => s.control)
    const notes = [
      moreNotListed(loc, failures - findings.length),
      data.items.length === 0
        ? say(loc, 'nothing seen moving, blinking, scrolling or updating on its own for more than 5 s', 'nada visto se movendo, piscando, rolando ou se atualizando sozinho por mais de 5 s')
        : say(
            loc,
            `${data.items.length} thing(s) seen moving or updating on their own for more than 5 s (of ${f.animations} long animation(s), ${f.smil} SVG animation(s), ${f.videos} video(s), ${f.animated} animated image(s), ${f.texts} text(s) that changed and ${f.lasting} part(s) of the window that kept changing)`,
            `${data.items.length} coisa(s) vista(s) se movendo ou se atualizando sozinha(s) por mais de 5 s (de ${f.animations} animação(ões) longa(s), ${f.smil} animação(ões) SVG, ${f.videos} vídeo(s), ${f.animated} imagem(ns) animada(s), ${f.texts} texto(s) que mudaram e ${f.lasting} parte(s) da janela que continuaram mudando)`,
          ),
      stopped.length > 0
        ? say(
            loc,
            `stopped or hidden by a control the probe pressed: ${stopped.map((s) => `${s.control ? controlText(s.control) : ''}`).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`,
            `parado(s) ou ocultado(s) por um controle que a sonda pressionou: ${stopped.map((s) => `${s.control ? controlText(s.control) : ''}`).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`,
          )
        : '',
      result.native > 0 ? say(loc, `${result.native} video(s) with the browser's own controls`, `${result.native} vídeo(s) com os controles do próprio navegador`) : '',
      result.alone > 0 || f.alone > 0 ? say(loc, `${result.alone + f.alone} not shown next to other content (not applicable)`, `${result.alone + f.alone} não mostrado(s) ao lado de outro conteúdo (não se aplica)`) : '',
      result.axe > 0 ? say(loc, `${result.axe} left to axe-core (marquee, blink)`, `${result.axe} deixado(s) ao axe-core (marquee, blink)`) : '',
      f.brief + f.short > 0 ? say(loc, `${f.brief + f.short} that moved for 5 s or less, not counted`, `${f.brief + f.short} que se moveu(ram) por 5 s ou menos, não contado(s)`) : '',
      f.below > 0 ? say(loc, `${f.below} animation(s) further down the page not captured`, `${f.below} animação(ões) mais abaixo na página não capturada(s)`) : '',
      f.unread > 0 ? say(loc, `${f.unread} image(s) that may be animated could not be read again`, `${f.unread} imagem(ns) que pode(m) ser animada(s) não pôde(puderam) ser lida(s) de novo`) : '',
      data.end === 'time' ? say(loc, 'the time budget ran out', 'o tempo acabou') : data.end === 'budget' ? say(loc, 'the control budget ran out', 'o limite de controles acabou') : '',
      say(loc, 'only controls named to pause, stop or hide were pressed; nothing was submitted', 'só controles com nome de pausar, parar ou ocultar foram pressionados; nada foi enviado'),
    ].filter(Boolean)
    const coverage: ProbeCoverage = {
      criterion: '2.2.2',
      method: `probe/motion@${record.version}`,
      rule: PAUSE_STOP_HIDE_RULE,
      conditions: conditionsText(
        record,
        say(
          loc,
          `the window over ${seconds(data.seriesMs, loc)} s of the page's time and its top over ${seconds(data.extendedMs, loc)} s, text read at each step, at ${data.viewport.width}×${data.viewport.height}; pause, stop and hide controls pressed on fresh loads`,
          `a janela durante ${seconds(data.seriesMs, loc)} s do tempo da página e o topo durante ${seconds(data.extendedMs, loc)} s, texto lido a cada passo, em ${data.viewport.width}×${data.viewport.height}; controles de pausar, parar e ocultar pressionados em cargas novas`,
        ),
      ),
      status: failures > 0 ? 'failures' : review.length > 0 ? 'needs-review' : 'no-failure-found',
      applicable: result.applicable,
      failures,
      review: review.length,
      unmatched: result.unmatched,
      note: notes.join('; '),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}
