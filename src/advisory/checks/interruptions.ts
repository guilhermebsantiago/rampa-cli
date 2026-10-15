import type { Confidence } from '../../core/types.ts'
import type { Locale } from '../../i18n.ts'
import { type CogaData, type CogaElement, type CogaLayer, OBSERVE_VARIANT, REDUCE_VARIANT } from '../../probes/cognitive-kit.ts'
import type { AdvisoryCheck, AdvisoryHit } from '../check.ts'
import { cogaBasis } from '../coga.ts'
import { type AdvisoryMessageKey, am, amPlural } from '../messages.ts'
import { GAIA_G09, GAIA_G18, MAX_PER_CHECK, elementFacts, experimental, htmlOf, observedLoad, percent, quote, seconds, when } from '../observed.ts'
import type { Impact } from '../types.ts'
import { SETUP_MS, carouselMoves } from './reduced-motion.ts'

/**
 * COGA o5p01 Limit Interruptions (https://www.w3.org/WAI/WCAG2/supplemental/patterns/o5p01-minimal-interruptions/),
 * Avoid: "Content that interrupts the user from completing their task", with the Note's example "A pop up suggesting
 * the user subscribers to the site. The pop up must be closed for the user to continue."; How it Helps:
 * "Interruptions can include sounds, content that visually appears or changes". GAIA G09 (distractions) and G18
 * (disturbing sounds).
 *
 * Facts from the observe load of the cognitive observation: what the page did with no input in the window after its
 * load event. Reported:
 * - a dialog (role=dialog or alertdialog, an open <dialog>, aria-modal) that is modal, covers a quarter of the window
 *   or more, or floats over page content; a fixed or sticky layer over a quarter of the window or more with page
 *   content under it (an app's own full-screen shell has none). A quarter is the activate-class harness's line for
 *   a layer that covers the page. Shown for at least two samples (300 ms apart);
 * - a cookie consent banner, apart and at a lower impact, only when it is modal or covers a quarter of the window:
 *   consent is often required by law (LGPD, GDPR), and a small bar is left out on purpose;
 * - a message that floats over the page and appears after the load event (a toast, a chat greeting, a slide-in
 *   offer), with 10 characters of text or more outside its buttons;
 * - an alert, confirm or prompt box, and a new window the page tries to open;
 * - a permission request (notifications, location, camera, microphone, clipboard) made while the page had no user
 *   activation (Rampa never gives it any);
 * - audio or video that starts with sound, or tries to and is stopped by the browser's autoplay policy;
 * - a carousel that moves on its own, when it stops under prefers-reduced-motion (one that keeps moving there is
 *   coga/reduced-motion's, and is not reported twice).
 */

/** A layer over this share of the window covers the page (the harness's line in activate.ts). */
export const COVER_SHARE = 0.25
/** Shown in at least this many samples, 300 ms apart: a flash while the page builds itself is not an interruption. */
export const MIN_SAMPLES = 2
/** A floating message with fewer characters of its own text is a launcher or a badge. */
export const MIN_PROSE = 10

export type InterruptionKind = 'dialog' | 'overlay' | 'consent' | 'toast' | 'alert' | 'window' | 'permission' | 'sound' | 'carousel'

export interface Interruption {
  kind: InterruptionKind
  atMs: number
  el?: CogaElement | undefined
  text?: string | undefined
  impact: Impact
  confidence: Confidence
  layer?: CogaLayer | undefined
  detail?: Record<string, string | number | boolean> | undefined
}

const sameElement = (a: CogaElement, b: CogaElement) => (a.ref !== undefined && a.ref === b.ref) || (a.ref === undefined && a.tag === b.tag && a.label === b.label)

/** What interrupted the page with no input. Pure: the thresholds above, applied to the observe record. */
export function interruptionsOf(observe: CogaData, reduce: CogaData | undefined): Interruption[] {
  const found: Interruption[] = []
  const layers = observe.layers.filter((layer) => layer.samples >= MIN_SAMPLES)
  // A dialog inside a layer stands for it: one interruption, with the layer's reach.
  const merged = new Set<number>()
  for (const layer of layers) if (layer.dialog && layer.within >= 0) merged.add(layer.within)
  for (const [index, layer] of observe.layers.entries()) {
    if (!layers.includes(layer) || merged.has(index)) continue
    const holder = layer.within >= 0 ? observe.layers[layer.within] : undefined
    const cover = Math.max(layer.cover, holder?.cover ?? 0)
    const coversContent = layer.coversContent || Boolean(holder?.coversContent)
    const big = cover >= COVER_SHARE && coversContent
    const modal = layer.modal || Boolean(holder?.modal)
    const consent = layer.consent || Boolean(holder?.consent)
    const reach = { ...layer, cover, coversContent, modal }
    if (consent) {
      if (big || modal) found.push({ kind: 'consent', atMs: layer.firstMs, el: layer.el, text: layer.text, impact: 'suggestion', confidence: 'high', layer: reach })
      continue
    }
    if (layer.dialog && (modal || big || (coversContent && (layer.position === 'fixed' || layer.position === 'sticky')))) {
      found.push({ kind: 'dialog', atMs: layer.firstMs, el: layer.el, text: layer.text, impact: 'hurdle', confidence: 'high', layer: reach })
      continue
    }
    if (big) {
      found.push({ kind: 'overlay', atMs: layer.firstMs, el: layer.el, text: layer.text, impact: 'hurdle', confidence: 'high', layer: reach })
      continue
    }
    if (layer.firstMs >= observe.loadMs && layer.prose >= MIN_PROSE && cover < COVER_SHARE) {
      found.push({ kind: 'toast', atMs: layer.firstMs, el: layer.el, text: layer.text, impact: 'suggestion', confidence: 'medium', layer: reach })
    }
  }
  for (const alert of observe.alerts) found.push({ kind: 'alert', atMs: alert.atMs, text: alert.message, impact: 'hurdle', confidence: 'high', detail: { type: alert.type } })
  for (const opened of observe.windows.slice(0, 2)) found.push({ kind: 'window', atMs: opened.atMs, text: opened.url, impact: 'hurdle', confidence: 'high', detail: { url: opened.url } })
  const apis = new Set<string>()
  for (const permission of observe.permissions) {
    // Asked after some activation (a --wait-for that clicked, say): not "with no input".
    if (permission.activated === true || apis.has(permission.api)) continue
    apis.add(permission.api)
    found.push({ kind: 'permission', atMs: permission.atMs, impact: 'hurdle', confidence: permission.activated === false ? 'high' : 'medium', detail: { api: permission.api, activated: permission.activated ?? 'unknown' } })
  }
  const sounds = new Set<string>()
  for (const play of observe.plays) {
    if (play.muted || play.volume <= 0 || play.activated === true || play.audible === false) continue
    const key = play.el.ref ?? play.src
    if (sounds.has(key)) continue
    const played = play.outcome === 'playing'
    const stopped = play.outcome === 'blocked' || play.outcome === 'pending'
    if (!played && !stopped) continue
    sounds.add(key)
    const video = play.tag === 'video'
    found.push({
      kind: 'sound',
      atMs: play.atMs,
      el: play.el,
      impact: 'hurdle',
      // A video stopped before any sound was decoded may have no sound track at all.
      confidence: played ? (play.audible ? 'high' : 'medium') : video ? 'low' : 'high',
      detail: { media: play.tag, outcome: play.outcome, how: play.how, src: play.src.slice(0, 200), audible: play.audible ?? 'unknown' },
    })
  }
  for (const carousel of observe.carousels) {
    const moves = carouselMoves(carousel, observe)
    if (moves.length === 0) continue
    const underReduce = reduce?.carousels.find((other) => sameElement(other.el, carousel.el))
    if (underReduce && reduce && carouselMoves(underReduce, reduce).length > 0) continue
    found.push({ kind: 'carousel', atMs: moves[0] ?? observe.loadMs, el: carousel.el, impact: 'suggestion', confidence: 'high', detail: { moves: moves.length, movesAtMs: moves.join(', ') } })
  }
  const rank: Record<Impact, number> = { barrier: 0, hurdle: 1, suggestion: 2 }
  return found.sort((a, b) => rank[a.impact] - rank[b.impact] || a.atMs - b.atMs)
}

function messageOf(item: Interruption, data: CogaData, locale: Locale): string {
  const at = when(item.atMs, data, locale)
  const text = quote(item.text ?? '')
  switch (item.kind) {
    case 'dialog':
    case 'overlay': {
      const what = item.kind === 'overlay' ? am(locale, 'intLayer', { cover: percent(item.layer?.cover ?? 0, locale) }) : am(locale, item.layer?.modal ? 'intModal' : 'intDialog')
      return `${am(locale, 'intAppeared', { what, when: at, text })} ${am(locale, 'intPopupRecommend')}`
    }
    case 'consent':
      return `${am(locale, 'intConsent', { cover: percent(item.layer?.cover ?? 0, locale), text })} ${am(locale, 'intConsentRecommend')}`
    case 'toast':
      return `${am(locale, 'intToast', { when: at, text })} ${am(locale, 'intRecommend')}`
    case 'alert':
      return `${am(locale, 'intAlert', { type: String(item.detail?.type ?? 'alert'), when: at, text })} ${am(locale, 'intPopupRecommend')}`
    case 'window':
      return `${am(locale, 'intWindow', { when: at, url: text ? am(locale, 'intWindowUrl', { url: quote(text, 80) }) : '' })} ${am(locale, 'intRecommend')}`
    case 'permission':
      return `${am(locale, 'intPermission', { what: am(locale, `perm_${String(item.detail?.api)}` as AdvisoryMessageKey), when: at })} ${am(locale, 'intRecommend')}`
    case 'sound': {
      const media = am(locale, item.detail?.media === 'video' ? 'media_video' : 'media_audio')
      const played = item.detail?.outcome === 'playing'
      const unknown = !played && item.detail?.media === 'video' ? ` ${am(locale, 'intSoundUnknown')}` : ''
      return `${am(locale, played ? 'intSound' : 'intSoundBlocked', { media, when: at })}${unknown} ${am(locale, 'intSoundRecommend')}`
    }
    case 'carousel': {
      const moves = Number(item.detail?.moves ?? 0)
      return `${am(locale, 'intCarousel', { count: amPlural(locale, 'rmTimes', moves), seconds: seconds(data.windowMs - SETUP_MS, locale) })} ${am(locale, 'intRecommend')}`
    }
  }
}

export const interruptions: AdvisoryCheck = {
  id: 'coga/interruptions',
  version: '1',
  maturity: 'experimental',
  pattern: 'o5p01',
  surfaces: ['web'],
  observes: true,

  run({ page, locale, coga }) {
    const observe = observedLoad(page.snapshot, OBSERVE_VARIANT, locale, coga)
    if (!observe.data) return { ran: false, reason: observe.reason, candidates: 0, hits: [] }
    const data = observe.data
    const reduce = observedLoad(page.snapshot, REDUCE_VARIANT, locale, coga).data
    const basis = cogaBasis('o5p01', 'avoid', 'Content that interrupts the user from completing their task.')
    const popup = cogaBasis('o5p01', 'avoid', 'A pop up suggesting the user subscribers to the site. The pop up must be closed for the user to continue.')
    const changes = cogaBasis('o8p01', 'how-it-helps', 'The automatic launching of new windows or pop-ups.')
    const items = interruptionsOf(data, reduce)
    const hits: AdvisoryHit[] = items.slice(0, MAX_PER_CHECK).map((item) => {
      const facts: Record<string, string | number | boolean> = { interruption: item.kind, atMs: item.atMs, loadMs: data.loadMs, ...elementFacts(item.el), ...(item.detail ?? {}) }
      if (item.text) facts.sample = quote(item.text, 160)
      if (item.layer) Object.assign(facts, { modal: item.layer.modal, cover: Math.round(item.layer.cover * 100) / 100, coversContent: item.layer.coversContent, position: item.layer.position, shownMs: item.layer.lastMs - item.layer.firstMs })
      const related = item.kind === 'sound' ? [GAIA_G09, GAIA_G18] : item.kind === 'dialog' || item.kind === 'overlay' || item.kind === 'alert' || item.kind === 'window' ? [popup, changes, GAIA_G09] : [GAIA_G09]
      const subject = item.kind === 'permission' ? `permission:${String(item.detail?.api)}` : item.kind === 'alert' ? `alert:${quote(item.text ?? '', 60)}` : item.kind === 'window' ? `window:${quote(item.text ?? '', 80)}` : item.kind
      return {
        kind: 'advisory',
        basis,
        related,
        impact: item.impact,
        source: 'rule',
        ref: item.el?.ref,
        html: item.el ? htmlOf(page, item.el) : undefined,
        message: `${messageOf(item, data, locale)} ${experimental(data, locale)}`,
        evidence: item.text ? quote(item.text, 160) : undefined,
        subject,
        pageLevel: !item.el?.ref,
        facts,
        confidence: item.confidence,
      } satisfies AdvisoryHit
    })
    return { ran: true, candidates: items.length, hits }
  },
}
