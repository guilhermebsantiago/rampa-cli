import type { Locale } from '../../i18n.ts'
import { type CogaAnimation, type CogaCarousel, type CogaData, type CogaElement, type CogaImage, type CogaVideo, OBSERVE_VARIANT, REDUCE_VARIANT } from '../../probes/cognitive-kit.ts'
import type { InPageRect } from '../../probes/kit.ts'
import type { AdvisoryCheck, AdvisoryHit } from '../check.ts'
import { cogaBasis } from '../coga.ts'
import { am, amPlural } from '../messages.ts'
import { GAIA_G09, MAX_PER_CHECK, elementFacts, experimental, htmlOf, observedLoad, rectText, seconds } from '../observed.ts'
import type { Basis, Impact } from '../types.ts'

/**
 * COGA o8p01 Let Users Control When the Content Moves or Changes
 * (https://www.w3.org/WAI/WCAG2/supplemental/patterns/o8p01-motion/), Avoid: "Content that changes without the user
 * having control". Its What to Do asks for "an easily available mechanism", one that "can be set one time with as a
 * wide a scope as possible (such as using the standards of the Operating System (OS)…)": the operating system's
 * setting to reduce motion, which pages read as `prefers-reduced-motion: reduce`. GAIA G09 asks to offer ways to turn
 * off animations. Not WCAG: 2.2.2 is the motion probe's (--probe motion), and 2.3.3 (AAA) is beyond the target.
 *
 * Facts from the cognitive observation (probes/cognitive.ts): the page loaded with `reduce` and, at the same time,
 * with `no-preference`. What keeps moving under `reduce`:
 * - a CSS, script or SVG animation that repeats with no end, or lasts more than 5 s (the line WCAG 2.2.2 draws: what
 *   ends sooner is over before a person could stop it), on a visible element of at least 8×8 px; color-only
 *   animations are left out (no movement, no blinking);
 * - a video that plays on its own and loops, streams live or lasts more than 5 s;
 * - an animated GIF, APNG or WebP on show;
 * - a carousel that moves to another slide on its own after the first second past the load event (sliders that set
 *   themselves up while the page loads are left out).
 * Each says whether it ran the same way without the setting ("ignores the setting") or only with it. One that never
 * stops is a hurdle; one that ends, or shows only under the setting, a suggestion.
 */

/** Motion that ends within this time is over before a person could stop it (the five seconds of WCAG 2.2.2). */
export const LASTS_MS = 5000
/** Smaller than this, a moving element is a dot or a caret, not content that moves. */
export const MIN_SIDE = 8
/** Carousel changes in the first second after the load event are the slider setting itself up. */
export const SETUP_MS = 1000
/** Changes closer than this are one move seen mid-way. */
const SAME_MOVE_MS = 600

export type MotionKind = 'animation' | 'video' | 'image' | 'carousel'

export interface Motion {
  kind: MotionKind
  el: CogaElement
  box: InPageRect
  /** It never stops on its own. */
  endless: boolean
  /** same: it runs without the setting too; only-reduce: Rampa saw it only with the setting; unknown: no other load to compare. */
  without: 'same' | 'only-reduce' | 'unknown'
  animation?: { kind: string; names: string[]; durationMs: number; iterations: number; endMs: number; properties: string[] } | undefined
  /** Other elements with the same animation: one advisory for a row of cards that pulse alike. */
  others?: CogaElement[] | undefined
  video?: { loop: boolean; durationMs: number; muted: boolean } | undefined
  image?: { format: string; loops: number | null; src: string } | undefined
  carousel?: { changes: number[] } | undefined
}

const area = (box: InPageRect) => box.width * box.height
const sameElement = (a: CogaElement, b: CogaElement) => (a.ref !== undefined && a.ref === b.ref) || (a.ref === undefined && a.tag === b.tag && a.label === b.label)

/** The changes of a carousel that count: after it set itself up, one per move. */
export function carouselMoves(carousel: CogaCarousel, data: CogaData): number[] {
  const moves: number[] = []
  for (const at of carousel.changes) {
    if (at < data.loadMs + SETUP_MS) continue
    const last = moves[moves.length - 1]
    if (last === undefined || at - last >= SAME_MOVE_MS) moves.push(at)
  }
  return moves
}

/** Animations that keep moving: endless or longer than LASTS_MS, visible, larger than MIN_SIDE, not color only. */
function lasting(animation: CogaAnimation): boolean {
  return animation.visible && !animation.colorOnly && animation.box.width >= MIN_SIDE && animation.box.height >= MIN_SIDE && (animation.infinite || animation.endMs > LASTS_MS)
}

/** An animation, and the element of its nearest animated ancestor in the same inventory. */
interface Entry {
  animation: CogaAnimation
  parent?: CogaElement | undefined
}

/** Both inventories of one load, one entry per element and animation, the later one first. */
function animationsOf(data: CogaData): Entry[] {
  const out: Entry[] = []
  for (const list of [data.animations.last, data.animations.first]) {
    for (const item of list) {
      if (out.some((known) => known.animation.kind === item.kind && known.animation.name === item.name && sameElement(known.animation.el, item.el))) continue
      out.push({ animation: item, parent: list[item.ancestor]?.el })
    }
  }
  return out
}

const elementKey = (el: CogaElement) => el.ref ?? `${el.tag}|${el.label}`

/**
 * The motion that keeps running with `prefers-reduced-motion: reduce`, compared with the load without it. Pure: the
 * thresholds above, applied to the two records.
 */
export function reducedMotions(reduce: CogaData, observe: CogaData | undefined): Motion[] {
  const motions: Motion[] = []
  const compare = (found: boolean): Motion['without'] => (observe ? (found ? 'same' : 'only-reduce') : 'unknown')

  const carousels = reduce.carousels.filter((carousel) => carouselMoves(carousel, reduce).length > 0)
  const inMoving = (index: number) => index >= 0 && carousels.includes(reduce.carousels[index] as CogaCarousel)
  for (const carousel of carousels) {
    const other = observe?.carousels.find((candidate) => sameElement(candidate.el, carousel.el))
    motions.push({ kind: 'carousel', el: carousel.el, box: carousel.box, endless: true, without: compare(Boolean(other && observe && carouselMoves(other, observe).length > 0)), carousel: { changes: carouselMoves(carousel, reduce) } })
  }

  const kept = animationsOf(reduce).filter((entry) => lasting(entry.animation) && !inMoving(entry.animation.carousel))
  const before = observe ? animationsOf(observe).filter((entry) => lasting(entry.animation)) : []
  // One motion per element, and an element whose animated ancestor also keeps moving is part of it: a spinner of
  // three rings is one motion.
  const byElement = new Map<string, Entry[]>()
  for (const entry of kept) byElement.set(elementKey(entry.animation.el), [...(byElement.get(elementKey(entry.animation.el)) ?? []), entry])
  const topOf = (key: string): string => {
    let top = key
    for (let guard = 0, parent = byElement.get(top)?.[0]?.parent; parent && guard < 20; guard++, parent = byElement.get(top)?.[0]?.parent) {
      const up = elementKey(parent)
      if (!byElement.has(up) || up === top) break
      top = up
    }
    return top
  }
  const folded = new Map<string, Entry[]>()
  for (const key of byElement.keys()) folded.set(topOf(key), [...(folded.get(topOf(key)) ?? []), ...(byElement.get(key) ?? [])])
  const animated: Motion[] = []
  for (const [key, entries] of folded) {
    const own = byElement.get(key) ?? entries
    const top = (own[0] ?? entries[0] as Entry).animation
    const all = entries.map((entry) => entry.animation)
    const names = [...new Set(all.map((animation) => animation.name).filter(Boolean))].slice(0, 3)
    const endless = all.some((animation) => animation.infinite)
    const found = before.some((entry) => sameElement(entry.animation.el, top.el) && names.includes(entry.animation.name))
    animated.push({
      kind: 'animation',
      el: top.el,
      box: top.box,
      endless,
      without: compare(found),
      animation: {
        kind: top.kind,
        names,
        durationMs: top.durationMs,
        iterations: endless ? -1 : Math.max(...all.map((animation) => animation.iterations)),
        endMs: endless ? -1 : Math.max(...all.map((animation) => animation.endMs)),
        properties: top.properties,
      },
    })
  }
  // The same animation on several elements (a row of cards that pulse alike) is one motion, cited with the others.
  const alike = new Map<string, Motion[]>()
  for (const motion of animated) {
    const key = `${motion.animation?.kind}|${[...(motion.animation?.names ?? [])].sort().join(',')}|${motion.endless}|${motion.without}`
    alike.set(key, [...(alike.get(key) ?? []), motion])
  }
  for (const group of alike.values()) {
    const [first, ...rest] = [...group].sort((a, b) => area(b.box) - area(a.box))
    if (first) motions.push(rest.length > 0 ? { ...first, others: rest.map((motion) => motion.el) } : first)
  }

  for (const video of reduce.videos) {
    if (!video.playing || video.playing.samples < 2 || !video.visible || video.box.width < 32 || video.box.height < 32 || inMoving(video.carousel)) continue
    if (!(video.loop || video.durationMs === -1 || video.durationMs > LASTS_MS)) continue
    const other: CogaVideo | undefined = observe?.videos.find((candidate) => sameElement(candidate.el, video.el))
    motions.push({
      kind: 'video',
      el: video.el,
      box: video.box,
      endless: video.loop || video.durationMs === -1,
      without: compare(Boolean(other?.playing)),
      video: { loop: video.loop, durationMs: video.durationMs, muted: video.muted },
    })
  }

  for (const image of reduce.images) {
    if (image.animated !== true) continue
    const other: CogaImage | undefined = observe?.images.find((candidate) => sameElement(candidate.el, image.el))
    motions.push({
      kind: 'image',
      el: image.el,
      box: image.box,
      endless: image.loops === -1,
      // An image whose bytes the other load could not read leaves the comparison open.
      without: other && other.animated === null ? 'unknown' : compare(other?.animated === true),
      image: { format: image.format ?? 'image', loops: image.loops, src: image.src },
    })
  }

  // Endless first, then what also runs without the setting, then the largest.
  return motions.sort((a, b) => Number(b.endless) - Number(a.endless) || Number(b.without === 'same') - Number(a.without === 'same') || area(b.box) - area(a.box))
}

export function motionImpact(motion: Motion): Impact {
  return motion.endless && motion.without !== 'only-reduce' ? 'hurdle' : 'suggestion'
}

function formatName(format: string): string {
  return format === 'image/png' ? 'APNG' : format === 'image/webp' ? 'WebP' : format === 'image/gif' ? 'GIF' : format
}

function describeMotion(motion: Motion, reduce: CogaData, locale: Locale): string {
  const setting = am(locale, 'rmSetting')
  if (motion.kind === 'carousel' && motion.carousel) {
    const count = motion.carousel.changes.length
    return am(locale, 'rmCarousel', { setting, count: amPlural(locale, 'rmTimes', count), seconds: seconds(reduce.windowMs - SETUP_MS, locale) })
  }
  if (motion.kind === 'video' && motion.video) {
    const loop = motion.video.loop
      ? am(locale, 'rmVideoLoop')
      : motion.video.durationMs === -1
        ? am(locale, 'rmVideoLive')
        : am(locale, 'rmVideoLasts', { total: seconds(motion.video.durationMs, locale) })
    return am(locale, 'rmVideo', { setting, loop })
  }
  if (motion.kind === 'image' && motion.image) {
    return am(locale, 'rmImage', { setting, format: formatName(motion.image.format), loop: motion.image.loops === -1 ? am(locale, 'rmImageLoop') : '' })
  }
  const animation = motion.animation
  const many = (animation?.names.length ?? 0) > 1
  const family = animation?.kind === 'css-transition' || animation?.kind === 'script' || animation?.kind === 'smil' ? animation.kind : 'css-animation'
  const kind = am(locale, many ? `rmKinds_${family}` : `rmKind_${family}`)
  const names = (animation?.names ?? []).map((name) => `"${name}"`).join(', ')
  const timing = motion.endless
    ? am(locale, many ? 'rmEndlessMany' : 'rmEndless', { duration: seconds(animation?.durationMs ?? 0, locale) })
    : am(locale, many ? 'rmLastsMany' : 'rmLasts', { total: seconds(animation?.endMs ?? 0, locale) })
  const others = motion.others?.length ? ` ${amPlural(locale, 'rmMore', motion.others.length)}` : ''
  return `${am(locale, many ? 'rmAnimations' : 'rmAnimation', { setting, kind, names, timing })}${others}`
}

export const reducedMotion: AdvisoryCheck = {
  id: 'coga/reduced-motion',
  version: '1',
  maturity: 'experimental',
  pattern: 'o8p01',
  surfaces: ['web'],
  observes: true,

  run({ page, locale, coga }) {
    const reduce = observedLoad(page.snapshot, REDUCE_VARIANT, locale, coga)
    if (!reduce.data) return { ran: false, reason: reduce.reason, candidates: 0, hits: [] }
    const observe = observedLoad(page.snapshot, OBSERVE_VARIANT, locale, coga).data
    const basis = cogaBasis('o8p01', 'avoid', 'Content that changes without the user having control.')
    const beyond: Basis = { framework: 'wcag', id: '2.3.3', level: 'AAA', version: '2.2', outside: 'aaa', url: 'https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html' }
    const motions = reducedMotions(reduce.data, observe)
    const hits: AdvisoryHit[] = motions.slice(0, MAX_PER_CHECK).map((motion) => {
      const without = motion.without === 'same' ? am(locale, 'rmIgnores') : motion.without === 'only-reduce' ? am(locale, 'rmOnlyReduce') : ''
      const message = [describeMotion(motion, reduce.data as CogaData, locale), without, am(locale, 'rmRecommend'), experimental(reduce.data as CogaData, locale)].filter(Boolean).join(' ')
      const facts: Record<string, string | number | boolean> = {
        motion: motion.kind,
        endless: motion.endless,
        withoutSetting: motion.without,
        box: rectText(motion.box),
        ...elementFacts(motion.el),
      }
      if (motion.animation) {
        Object.assign(facts, {
          animationKind: motion.animation.kind,
          names: motion.animation.names.join(', '),
          cycleMs: motion.animation.durationMs,
          iterations: motion.animation.iterations,
          endMs: motion.animation.endMs,
          properties: motion.animation.properties.join(', '),
        })
      }
      if (motion.video) Object.assign(facts, { loop: motion.video.loop, durationMs: motion.video.durationMs, muted: motion.video.muted })
      if (motion.image) Object.assign(facts, { format: motion.image.format, loops: motion.image.loops ?? 'unknown', src: motion.image.src.slice(0, 200) })
      if (motion.carousel) Object.assign(facts, { moves: motion.carousel.changes.length, movesAtMs: motion.carousel.changes.join(', ') })
      if (motion.others?.length) Object.assign(facts, { sameOn: motion.others.length, sameOnRefs: motion.others.map((el) => el.ref ?? el.tag).slice(0, 8).join(' | ') })
      const subject = motion.animation ? `animation:${motion.animation.names.join(',')}` : motion.image ? `image:${motion.image.src.split(/[?#]/)[0]?.split('/').pop() ?? ''}` : motion.kind
      return {
        kind: 'advisory',
        basis,
        related: [beyond, GAIA_G09],
        impact: motionImpact(motion),
        source: 'rule',
        ref: motion.el.ref,
        html: htmlOf(page, motion.el),
        message,
        evidence: evidenceOf(motion),
        subject,
        facts,
        confidence: 'high',
      } satisfies AdvisoryHit
    })
    return { ran: true, candidates: motions.length, hits, notes: hits.length > 0 ? [am(locale, 'rmBeyond')] : [] }
  },
}

function evidenceOf(motion: Motion): string {
  if (motion.animation) {
    const runs = motion.endless ? 'infinite iterations' : `${motion.animation.iterations} iteration(s), ends at ${motion.animation.endMs} ms`
    return `${motion.animation.kind} ${motion.animation.names.join(', ')}: ${runs}, cycle ${motion.animation.durationMs} ms, ${motion.animation.properties.join(', ')}`
  }
  if (motion.video) return `<video${motion.video.loop ? ' loop' : ''}${motion.video.muted ? ' muted' : ''}> ${motion.video.durationMs === -1 ? 'live' : `${motion.video.durationMs} ms`}`
  if (motion.image) return `${motion.image.format}, ${motion.image.loops === -1 ? 'loops with no end' : motion.image.loops === null ? 'loop count unknown' : `plays ${motion.image.loops} time(s)`}: ${motion.image.src.slice(0, 120)}`
  if (motion.carousel) return `moved at ${motion.carousel.changes.map((ms) => `${ms} ms`).join(', ')} from the start of navigation`
  return ''
}
