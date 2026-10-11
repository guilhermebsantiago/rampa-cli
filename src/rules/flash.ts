import type { Finding } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import { FLASH, FLASH_AREA_LIMIT, type FlashMeasure } from '../pixels/flash.ts'
import { FLASH_VARIANT, type FlashData, type FlashSource } from '../probes/flash.ts'
import { matchNode, nameOf } from '../probes/identity.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, type ProbeRuleResult, asArray, asRecord, conditionsText, coverageStatus, moreNotListed, probeFinding, say } from './probes.ts'

/**
 * 2.3.1 Three Flashes or Below Threshold, from the flash probe's measurements (probes/flash.ts, pixels/flash.ts).
 * Content fails when, in one second, an area of it makes more than three general flashes or more than three red
 * flashes (seven transitions or more), and that area is over 25% of a 10° visual field: 21,824 CSS px² of a
 * 341 × 256 field. Measured failures only, with the frames and the second they happened in; content the probe could
 * not read is named in the coverage note, never failed. Never a pass: "no failure found" holds for what was read, for
 * the seconds read. No vision model and no certification claim (the plan's section 6).
 */

const MAX_REPORTED = 10

/** The flash probe's data read back from a record: a snapshot is input, so every list is checked. */
export function flashData(record: ProbeRecord): FlashData {
  const data = asRecord(record.data)
  const found = asRecord(data.found)
  const viewport = asRecord(data.viewport)
  const number = (value: unknown) => Number(value) || 0
  return {
    viewport: { width: number(viewport.width), height: number(viewport.height) },
    definitions: { ...FLASH, field: { ...FLASH.field } },
    found: { animations: number(found.animations), canvases: number(found.canvases), svgs: number(found.svgs), videos: number(found.videos), images: number(found.images), animated: number(found.animated), below: number(found.below) },
    sources: asArray<FlashSource>(data.sources).filter((s) => s && typeof s.kind === 'string' && s.box && typeof s.status === 'string'),
    end: data.end === 'time' ? 'time' : 'complete',
  }
}

const KIND: Record<Locale, Record<'general' | 'red', string>> = {
  en: { general: 'flashes', red: 'red flashes (a saturated red that comes and goes)' },
  'pt-BR': { general: 'flashes', red: 'flashes vermelhos (um vermelho saturado que aparece e some)' },
}

const SOURCE: Record<Locale, (source: FlashSource) => string> = {
  en: (s) => (s.kind === 'image' ? 'This animated image' : s.kind === 'video' ? 'This video' : 'Content on this part of the page'),
  'pt-BR': (s) => (s.kind === 'image' ? 'Esta imagem animada' : s.kind === 'video' ? 'Este vídeo' : 'Conteúdo nesta parte da página'),
}

const seconds = (ms: number, locale: Locale) => {
  const text = (Math.round(ms / 100) / 10).toFixed(1)
  return locale === 'pt-BR' ? text.replace('.', ',') : text
}
const px2 = (value: number, locale: Locale) => Math.round(value).toLocaleString(locale === 'pt-BR' ? 'pt-BR' : 'en-US')

function measured(source: FlashSource, locale: Locale): string {
  const what =
    source.kind === 'image'
      ? say(locale, `animated image ${source.format ?? ''} ${source.url ?? ''}, shown at ${source.box.width}×${source.box.height} px: ${source.frames} frames over ${source.durationMs} ms${source.loop ? ', analyzed while looping' : ''}`, `imagem animada ${source.format ?? ''} ${source.url ?? ''}, exibida em ${source.box.width}×${source.box.height} px: ${source.frames} quadros em ${source.durationMs} ms${source.loop ? ', analisada em loop' : ''}`)
      : source.kind === 'video'
        ? say(locale, `video ${source.url ?? ''}, shown at ${source.box.width}×${source.box.height} px, played muted: ${source.frames} frames over ${source.durationMs} ms${source.gaps ? `, ${source.gaps} frame(s) missed` : ''}`, `vídeo ${source.url ?? ''}, exibido em ${source.box.width}×${source.box.height} px, tocado sem som: ${source.frames} quadros em ${source.durationMs} ms${source.gaps ? `, ${source.gaps} quadro(s) perdido(s)` : ''}`)
        : say(locale, `the window at y ${source.box.y}, captured ${source.frames} times every ${source.stepMs} ms of the page's time`, `a janela em y ${source.box.y}, capturada ${source.frames} vezes a cada ${source.stepMs} ms do tempo da página`)
  return what.replace(/\s+/g, ' ').trim()
}

function measureText(m: FlashMeasure, kind: 'general' | 'red', locale: Locale, scale?: { width: number; height: number }): string {
  const w = m.window
  const field = `${FLASH.field.width}×${FLASH.field.height}`
  const share = Math.round((m.area / (FLASH.field.width * FLASH.field.height)) * 100)
  const box = m.box ? say(locale, ` at x ${Math.round(m.box.x)}, y ${Math.round(m.box.y)}, ${Math.round(m.box.width)}×${Math.round(m.box.height)} px`, ` em x ${Math.round(m.box.x)}, y ${Math.round(m.box.y)}, ${Math.round(m.box.width)}×${Math.round(m.box.height)} px`) : ''
  const at = scale ? say(locale, ` at full screen (${scale.width}×${scale.height} px)`, ` em tela cheia (${scale.width}×${scale.height} px)`) : ''
  return say(
    locale,
    `${kind === 'red' ? 'red' : 'general'} flashes${at}: ${w?.transitions ?? m.maxTransitions} transitions between ${seconds(w?.start ?? 0, locale)} s and ${seconds(w?.end ?? 0, locale)} s (frames ${w?.first ?? 0} to ${w?.last ?? 0}), over ${px2(m.area, locale)} px² of one ${field} field (${share}%, the threshold is 25%)${box}`,
    `flashes ${kind === 'red' ? 'vermelhos' : 'gerais'}${at}: ${w?.transitions ?? m.maxTransitions} transições entre ${seconds(w?.start ?? 0, locale)} s e ${seconds(w?.end ?? 0, locale)} s (quadros ${w?.first ?? 0} a ${w?.last ?? 0}), sobre ${px2(m.area, locale)} px² de um campo de ${field} (${share}%, o limite é 25%)${box}`,
  )
}

const fails = (m: FlashMeasure | undefined) => !!m && m.maxTransitions >= FLASH.transitions && m.area > FLASH_AREA_LIMIT

const UNREAD: Record<string, [string, string]> = {
  'cross-origin': ['from another origin without CORS', 'de outra origem sem CORS'],
  'did-not-play': ['did not play', 'não tocou'],
  'no-frames': ['gave no frames', 'não deu quadros'],
  'not-fetched': ['could not be fetched again', 'não pôde ser baixada de novo'],
  'too-large': ['too large to read', 'grande demais para ler'],
  'no-decoder': ['no decoder in this browser', 'sem decodificador neste navegador'],
  limit: ['past the limit of images', 'além do limite de imagens'],
}

export const flashRule: ProbeRule = {
  id: 'rampa/three-flashes',
  kind: 'flash',
  variant: FLASH_VARIANT,
  versions: ['1'],
  criteria: ['2.3.1'],
  run(record: ProbeRecord, ctx: ProbeRuleContext): ProbeRuleResult {
    const data = flashData(record)
    const findings: Finding[] = []
    let failures = 0
    let applicable = 0
    let unmatched = 0
    const unread: string[] = []
    const body = ctx.index.get('html > body')?.node
    for (const source of data.sources) {
      if (source.status !== 'analyzed') {
        if (source.status === 'unreadable' || source.status === 'time') {
          const why = UNREAD[source.reason ?? ''] ?? [source.reason ?? 'unread', source.reason ?? 'não lido']
          unread.push(say(ctx.locale, `${source.kind} ${source.url ?? ''} (${why[0]})`, `${source.kind === 'image' ? 'imagem' : source.kind === 'video' ? 'vídeo' : 'janela'} ${source.url ?? ''} (${why[1]})`).replace(/\s+/g, ' '))
        }
        continue
      }
      applicable++
      const own = source.el ? matchNode(ctx.index, source.el.ref, source.el.id) : undefined
      if (!own && source.kind !== 'screen') {
        unmatched++
        continue
      }
      const kinds = (['general', 'red'] as const).filter((kind) => fails(source[kind]))
      const full = source.fullScreen && kinds.length === 0 ? (['general', 'red'] as const).filter((kind) => fails(source.fullScreen?.[kind])) : []
      for (const kind of kinds.length > 0 ? kinds : full) {
        failures++
        if (findings.length >= MAX_REPORTED) continue
        const atFull = kinds.length === 0
        const m = (atFull ? source.fullScreen?.[kind] : source[kind]) as FlashMeasure
        // What flashes in a window capture: the element at the middle of the area, when the snapshot holds it; else the page.
        const middle = source.at?.[kind]
        const hit = middle ? matchNode(ctx.index, middle.ref, middle.id) : undefined
        const node = own ?? hit ?? body
        if (!node) {
          unmatched++
          continue
        }
        const flashes = Math.floor((m.window?.transitions ?? m.maxTransitions) / 2)
        const transitions = m.window?.transitions ?? m.maxTransitions
        const lead = SOURCE[ctx.locale](source)
        const message = say(
          ctx.locale,
          `${lead} makes ${flashes} ${KIND.en[kind]} in one second (${transitions} transitions)${atFull ? ' when shown full screen' : ''}, over ${px2(m.area, ctx.locale)} px² of a 341×256 field, which stands for 10° of vision: more than three flashes, over more than the 25% of that field WCAG 2.3.1 allows. Flashing like this can cause seizures. Flash three times a second or less, make the flashing area smaller, or lower its contrast; this was measured from the frames, never judged by eye.`,
          `${lead} faz ${flashes} ${KIND['pt-BR'][kind]} em um segundo (${transitions} transições)${atFull ? ' quando exibido em tela cheia' : ''}, sobre ${px2(m.area, ctx.locale)} px² de um campo de 341×256, que representa 10° da visão: mais de três flashes, sobre mais dos 25% desse campo que a WCAG 2.3.1 permite. Flashes assim podem causar convulsões. Pisque três vezes por segundo ou menos, diminua a área que pisca ou reduza o contraste; isto foi medido nos quadros, nunca julgado a olho.`,
        )
        const evidence = `${measured(source, ctx.locale)}; ${measureText(m, kind, ctx.locale, atFull ? source.fullScreen : undefined)}${middle ? say(ctx.locale, `; at its middle: ${nameOf(hit, middle)}`, `; no meio: ${nameOf(hit, middle)}`) : ''}`
        findings.push(
          probeFinding({
            criterion: '2.3.1',
            rule: this.id,
            node,
            message,
            evidence,
            // A video is sampled while it plays, so a busy machine may miss frames; full screen is a projection.
            confidence: atFull || (source.kind === 'video' && (source.gaps ?? 0) > 0) ? 'medium' : 'high',
            subject: `${source.kind}|${kind}|${source.url ?? source.box.y}${atFull ? '|full' : ''}`,
          }),
        )
      }
    }
    const screens = data.sources.filter((s) => s.kind === 'screen' && s.status === 'analyzed')
    const notes = [
      moreNotListed(ctx.locale, failures - findings.length),
      say(
        ctx.locale,
        `${screens.length} window(s) of ${data.viewport.width}×${data.viewport.height} captured for ${screens.map((s) => seconds(s.durationMs ?? 0, ctx.locale)).join(', ')} s; ${data.sources.filter((s) => s.kind === 'image' && s.status === 'analyzed').length} animated image(s) and ${data.sources.filter((s) => s.kind === 'video' && s.status === 'analyzed').length} video(s) read`,
        `${screens.length} janela(s) de ${data.viewport.width}×${data.viewport.height} capturada(s) por ${screens.map((s) => seconds(s.durationMs ?? 0, ctx.locale)).join(', ')} s; ${data.sources.filter((s) => s.kind === 'image' && s.status === 'analyzed').length} imagem(ns) animada(s) e ${data.sources.filter((s) => s.kind === 'video' && s.status === 'analyzed').length} vídeo(s) lido(s)`,
      ),
      unread.length > 0 ? say(ctx.locale, `not read: ${unread.slice(0, 4).join('; ')}${unread.length > 4 ? '; …' : ''}`, `não lido(s): ${unread.slice(0, 4).join('; ')}${unread.length > 4 ? '; …' : ''}`) : '',
      data.found.below > 0 ? say(ctx.locale, `${data.found.below} canvas(es) or animation(s) further down the page were not captured`, `${data.found.below} canvas ou animação(ões) mais abaixo na página não foram capturados`) : '',
      data.end === 'time' ? say(ctx.locale, 'the time budget ran out', 'o tempo acabou') : '',
    ].filter(Boolean)
    return {
      findings,
      review: [],
      coverage: [
        {
          criterion: '2.3.1',
          method: `probe/flash@${record.version}`,
          rule: this.id,
          conditions: conditionsText(record, say(ctx.locale, `general and red flashes on frames of the window, animated images and video at ${data.viewport.width}×${data.viewport.height}`, `flashes gerais e vermelhos em quadros da janela, de imagens animadas e de vídeo em ${data.viewport.width}×${data.viewport.height}`)),
          status: applicable === 0 ? 'not-checked' : coverageStatus(failures, 0),
          applicable,
          failures,
          review: 0,
          unmatched,
          ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
          maturity: 'experimental',
        },
      ],
    }
  },
}
