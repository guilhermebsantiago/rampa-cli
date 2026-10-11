import type { ControlFacts } from './activate.ts'
import type { InPageElement, InPageRect, Kit } from './kit.ts'

/**
 * The motion probe's helpers in the page (probes/motion.ts), installed as `window.__rampaMotion` next to the kit and
 * the harness's activate kit. Playwright serializes `installMotionKit` with toString(): it references nothing outside
 * its own body.
 */

export interface AnimationFact {
  el: InPageElement
  /** Page coordinates. */
  box: InPageRect
  /** CSS animation names, or the kind of animation (transition, script). */
  names: string[]
  /** Properties the keyframes change, as `getKeyframes()` names them (`transform`, `opacity`, `backgroundColor`). */
  properties: string[]
  /** Runs with no end (infinite iterations). */
  infinite: boolean
  /** When it ends, from its start: delay plus active duration, in ms; -1 when infinite. */
  endMs: number
  count: number
  /** Only colors change (color, background, shadow, filter): no movement, no blinking of opacity or visibility. */
  colorOnly: boolean
}

export interface SmilFact {
  el: InPageElement
  box: InPageRect
  count: number
  infinite: boolean
  /** The longest animation's active duration, in ms; -1 when indefinite. */
  activeMs: number
}

export interface VideoFact {
  el: InPageElement
  box: InPageRect
  url: string
  paused: boolean
  autoplay: boolean
  loop: boolean
  muted: boolean
  controls: boolean
  /** -1 for a live stream (infinite duration), 0 when unknown. */
  durationMs: number
  currentMs: number
}

export interface MotionInventory {
  animations: AnimationFact[]
  /** Running animations that end within five seconds of their start (entrance effects, transitions). */
  short: number
  smil: SmilFact[]
  videos: VideoFact[]
  images: Array<{ el: InPageElement; box: InPageRect; url: string }>
  canvases: InPageRect[]
  marquees: Array<{ el: InPageElement; box: InPageRect }>
  page: { width: number; height: number }
}

export interface TextTarget {
  el: InPageElement
  box: InPageRect
  changes: number
  firstMs: number
  lastMs: number
  /** The median time between two changes. */
  intervalMs: number
  /** The first few values it showed, cut to 40 characters. */
  values: string[]
  /** ACT efbfc7's "not alone": an ancestor shows other text. */
  alone: boolean
}

export interface RawControl {
  el: InPageElement
  name: string
  kind: 'pause' | 'stop' | 'hide' | 'close' | 'setting' | 'frequency' | 'opener'
  word: string
  shows: boolean
  near: Array<{ item: string; how: 'controls' | 'container' | 'distance' | 'page'; distance: number }>
  facts: ControlFacts
  /** For an opener: the hidden controls it may show, by ref. */
  opens?: string[] | undefined
}

export interface ItemState {
  key: string
  gone: boolean
  visible: boolean
  /** Viewport coordinates. */
  box: InPageRect
  text: string
  running: number
  videoPlaying: boolean
  smilRunning: boolean
  smilTime: number
  src: string
}

export interface MotionKit {
  inventory(maxImages: number): MotionInventory
  textStart(max: number): number
  textStep(t: number): void
  textTargets(args: { lastsMs: number; fineMs: number }): TextTarget[]
  scroll(y: number): { x: number; y: number }
  freeze(): number
  seek(t: number): void
  region(box: InPageRect): { el: InPageElement; box: InPageRect } | null
  contains(pairs: Array<[string, string]>): boolean[]
  parallel(ref: string): boolean
  controls(items: Array<{ key: string; ref: string }>): RawControl[]
  states(items: Array<{ key: string; ref: string; textRef?: string | undefined }>): ItemState[]
  reveal(ref: string): InPageRect | null
}

/** Installs `window.__rampaMotion`; needs the kit (and, for `controls`, the activate kit). */
export function installMotionKit(): void {
  const w = window as unknown as { __rampaKit: Kit; __rampaMotion?: MotionKit; __rampaActivate?: { facts(el: Element): ControlFacts } }
  if (w.__rampaMotion) return
  const kit = w.__rampaKit
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const docBox = (el: Element): InPageRect => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) }
  }
  const viewBox = (el: Element): InPageRect => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
  }
  const shown = (el: Element, min = 2): boolean => {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions)) return false
    const r = el.getBoundingClientRect()
    return r.width >= min && r.height >= min
  }
  const COLOR = new Set([
    'color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke',
    'boxShadow', 'textShadow', 'filter', 'caretColor', 'textDecorationColor', 'accentColor', 'stopColor', 'floodColor', 'lightingColor', 'columnRuleColor',
  ])

  const inventory: MotionKit['inventory'] = (maxImages) => {
    const out: MotionInventory = { animations: [], short: 0, smil: [], videos: [], images: [], canvases: [], marquees: [], page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } }
    const byTarget = new Map<Element, AnimationFact>()
    for (const animation of document.getAnimations()) {
      if (animation.playState !== 'running') continue
      const effect = animation.effect as KeyframeEffect | null
      const target = effect?.target
      if (!effect || !target) continue
      const timing = effect.getComputedTiming()
      const infinite = !Number.isFinite(Number(timing.activeDuration))
      const end = Number(timing.endTime ?? 0)
      if (!infinite && end <= 5000) {
        out.short++
        continue
      }
      if (!shown(target)) continue
      const properties = new Set<string>()
      try {
        for (const frame of effect.getKeyframes()) for (const key of Object.keys(frame)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(key)) properties.add(key)
      } catch {
        // A keyframe list the browser will not give.
      }
      const name =
        typeof (animation as unknown as { animationName?: string }).animationName === 'string'
          ? (animation as unknown as { animationName: string }).animationName
          : typeof (animation as unknown as { transitionProperty?: string }).transitionProperty === 'string'
            ? `transition ${(animation as unknown as { transitionProperty: string }).transitionProperty}`
            : animation.id || 'script'
      const fact = byTarget.get(target)
      if (fact) {
        fact.count++
        if (!fact.names.includes(name) && fact.names.length < 4) fact.names.push(name)
        for (const p of properties) if (!fact.properties.includes(p) && fact.properties.length < 8) fact.properties.push(p)
        fact.infinite ||= infinite
        fact.endMs = fact.infinite ? -1 : Math.max(fact.endMs, Math.round(end))
        fact.colorOnly &&= [...properties].every((p) => COLOR.has(p))
      } else {
        byTarget.set(target, {
          el: kit.describe(target),
          box: docBox(target),
          names: [name],
          properties: [...properties].slice(0, 8),
          infinite,
          endMs: infinite ? -1 : Math.round(end),
          count: 1,
          colorOnly: properties.size > 0 && [...properties].every((p) => COLOR.has(p)),
        })
      }
    }
    out.animations = [...byTarget.values()].slice(0, 200)
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      const animations = Array.from(svg.querySelectorAll('animate, animateTransform, animateMotion, set'))
      if (animations.length === 0 || !shown(svg)) continue
      let infinite = false
      let longest = 0
      for (const a of animations) {
        const repeat = (a.getAttribute('repeatCount') ?? '').trim()
        const repeatDur = (a.getAttribute('repeatDur') ?? '').trim()
        if (repeat === 'indefinite' || repeatDur === 'indefinite') infinite = true
        const seconds = (value: string): number => {
          const m = /^([\d.]+)\s*(ms|s|min|h)?$/.exec(value)
          if (!m) return 0
          const n = Number(m[1])
          return m[2] === 'ms' ? n / 1000 : m[2] === 'min' ? n * 60 : m[2] === 'h' ? n * 3600 : n
        }
        const dur = seconds((a.getAttribute('dur') ?? '').trim())
        const times = repeat && repeat !== 'indefinite' ? Number(repeat) || 1 : 1
        longest = Math.max(longest, repeatDur && repeatDur !== 'indefinite' ? seconds(repeatDur) : dur * times)
      }
      out.smil.push({ el: kit.describe(svg), box: docBox(svg), count: animations.length, infinite, activeMs: infinite ? -1 : Math.round(longest * 1000) })
    }
    for (const video of Array.from(document.querySelectorAll('video'))) {
      if (!shown(video, 8) || !video.currentSrc) continue
      const duration = video.duration
      out.videos.push({
        el: kit.describe(video),
        box: docBox(video),
        url: video.currentSrc.slice(0, 2000),
        paused: video.paused,
        autoplay: video.autoplay,
        loop: video.loop,
        muted: video.muted,
        controls: video.controls,
        durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : Number.isNaN(duration) ? 0 : -1,
        currentMs: Math.round(video.currentTime * 1000),
      })
    }
    const urls = (value: string) => Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)).map((m) => m[2] ?? '')
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (out.images.length >= maxImages) break
      let url = ''
      if (el instanceof HTMLImageElement) url = el.currentSrc || el.src
      else {
        const background = getComputedStyle(el).backgroundImage
        if (background && background !== 'none') url = urls(background).find((u) => !/^data:image\/svg/i.test(u)) ?? ''
      }
      if (!url || /\.svg(\?|#|$)/i.test(url) || /^data:image\/svg/i.test(url) || !shown(el, 8)) continue
      out.images.push({ el: kit.describe(el), box: docBox(el), url: new URL(url, document.baseURI).href })
    }
    for (const canvas of Array.from(document.querySelectorAll('canvas'))) if (shown(canvas, 8)) out.canvases.push(docBox(canvas))
    for (const marquee of Array.from(document.querySelectorAll('marquee'))) if (shown(marquee)) out.marquees.push({ el: kit.describe(marquee), box: docBox(marquee) })
    return out
  }

  // ---- text that changes on its own (ACT efbfc7) ----
  interface Tracked {
    last: string
    changes: number
    times: number[]
    values: string[]
  }
  const tracked = new Map<Element, Tracked>()
  const dirty = new Set<Element>()
  let observer: MutationObserver | undefined
  const textOf = (el: Element): string => cut(((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim(), 2000)
  const touch = (node: Node | null) => {
    let el: Element | null = node && node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null)
    for (; el && el !== document.documentElement; el = el.parentElement) {
      if (dirty.has(el)) break
      dirty.add(el)
    }
  }
  const textStart: MotionKit['textStart'] = (max) => {
    observer?.disconnect()
    tracked.clear()
    dirty.clear()
    // Every element with text of its own, and its parents a few levels up: their first value is known.
    const start = new Set<Element>()
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node && start.size < max; node = walker.nextNode()) {
      if ((node.textContent ?? '').trim() === '') continue
      let el = node.parentElement
      for (let level = 0; el && el !== document.documentElement && level < 4; el = el.parentElement, level++) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) break
        start.add(el)
      }
    }
    for (const el of start) tracked.set(el, { last: textOf(el), changes: 0, times: [], values: [] })
    observer = new MutationObserver((records) => {
      for (const record of records) touch(record.target)
    })
    observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
    return tracked.size
  }
  const textStep: MotionKit['textStep'] = (t) => {
    if (observer) for (const record of observer.takeRecords()) touch(record.target)
    for (const el of dirty) {
      if (!el.isConnected) continue
      const value = textOf(el)
      const entry = tracked.get(el)
      if (!entry) {
        if (tracked.size < 20_000) tracked.set(el, { last: value, changes: 0, times: [], values: [] })
        continue
      }
      if (value === entry.last) continue
      if (entry.values.length === 0) entry.values.push(cut(entry.last, 40))
      if (entry.values.length < 4) entry.values.push(cut(value, 40))
      entry.last = value
      entry.changes++
      entry.times.push(Math.round(t))
    }
    dirty.clear()
  }
  const textTargets: MotionKit['textTargets'] = ({ lastsMs, fineMs }) => {
    const out: TextTarget[] = []
    for (const [el, entry] of tracked) {
      if (entry.changes < 2 || (entry.times[entry.times.length - 1] ?? 0) < lastsMs) continue
      if (!el.isConnected || entry.last === '' || !shown(el, 1)) continue
      // ACT efbfc7, "no child changed": the deepest element whose text changes.
      if (Array.from(el.children).some((child) => (tracked.get(child)?.changes ?? 0) > 0)) continue
      let alone = true
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const text = textOf(a)
        if (text !== '' && text !== entry.last) {
          alone = false
          break
        }
      }
      // The time between changes, read where the steps are fine (the series' first seconds) when it changed there.
      const fine = entry.times.filter((t) => t <= fineMs)
      const times = fine.length >= 3 ? fine : entry.times
      const gaps = times.slice(1).map((t, i) => t - (times[i] ?? 0)).sort((a, b) => a - b)
      out.push({
        el: kit.describe(el),
        box: docBox(el),
        changes: entry.changes,
        firstMs: entry.times[0] ?? 0,
        lastMs: entry.times[entry.times.length - 1] ?? 0,
        intervalMs: gaps[Math.floor(gaps.length / 2)] ?? 0,
        values: entry.values,
        alone,
      })
      if (out.length >= 40) break
    }
    return out
  }

  // ---- the page's own time, for CSS and SVG animations (as the flash probe does) ----
  const frozen = new Map<Animation, { base: number; at: number }>()
  const svgBase = new Map<SVGSVGElement, number>()
  let now = 0
  const freeze: MotionKit['freeze'] = () => {
    now = 0
    let count = 0
    for (const animation of document.getAnimations()) {
      const ours = frozen.has(animation)
      if (!ours && animation.playState !== 'running') continue
      if (!ours) animation.pause()
      frozen.set(animation, { base: Number(animation.currentTime ?? 0), at: 0 })
      count++
    }
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      if (!svg.querySelector('animate, animateTransform, animateMotion, set')) continue
      svg.pauseAnimations()
      svgBase.set(svg, svg.getCurrentTime())
      count++
    }
    return count
  }
  const seek: MotionKit['seek'] = (t) => {
    now = t
    for (const animation of document.getAnimations()) {
      if (frozen.has(animation) || animation.playState !== 'running') continue
      animation.pause()
      frozen.set(animation, { base: Number(animation.currentTime ?? 0), at: now })
    }
    for (const [animation, { base, at }] of frozen) {
      try {
        animation.currentTime = base + (now - at)
      } catch {
        // Cancelled meanwhile.
      }
    }
    for (const [svg, base] of svgBase) svg.setCurrentTime(base + now / 1000)
  }
  const scroll: MotionKit['scroll'] = (y) => {
    window.scrollTo({ left: 0, top: y, behavior: 'instant' as ScrollBehavior })
    return { x: Math.round(window.scrollX), y: Math.round(window.scrollY) }
  }

  // ---- what moves where ----
  const deepAt = (x: number, y: number): Element | null => {
    let el = document.elementFromPoint(x, y)
    while (el?.shadowRoot) {
      const inner: Element | null = el.shadowRoot.elementFromPoint(x, y)
      if (!inner || inner === el) break
      el = inner
    }
    return el
  }
  const overlap = (r: DOMRect, box: InPageRect): number => {
    const width = Math.max(0, Math.min(r.right, box.x + box.width) - Math.max(r.left, box.x))
    const height = Math.max(0, Math.min(r.bottom, box.y + box.height) - Math.max(r.top, box.y))
    return box.width * box.height > 0 ? (width * height) / (box.width * box.height) : 0
  }
  /**
   * The element that moves in a region of the window: of the ancestors of what is there that cover most of the region,
   * the outermost about its size (a carousel rather than the slide that happens to show, or the track that holds them
   * all); else the innermost that covers it; else what is there.
   */
  const region: MotionKit['region'] = (box) => {
    const points: Array<[number, number]> = [[0.5, 0.5]]
    for (const fy of [0.25, 0.5, 0.75]) for (const fx of [0.25, 0.5, 0.75]) if (fx !== 0.5 || fy !== 0.5) points.push([fx, fy])
    const area = Math.max(1, box.width * box.height)
    for (const [fx, fy] of points) {
      const hit = deepAt(box.x + box.width * fx, box.y + box.height * fy)
      if (!hit || hit === document.documentElement || hit === document.body) continue
      let innermost: Element | undefined
      let outermost: Element | undefined
      for (let a: Element | null = hit; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
        const r = a.getBoundingClientRect()
        if (overlap(r, box) < 0.8) continue
        innermost ??= a
        if (r.width * r.height <= 1.5 * area) outermost = a
      }
      const chosen = outermost ?? innermost ?? hit
      return { el: kit.describe(chosen), box: docBox(chosen) }
    }
    return null
  }
  const contains: MotionKit['contains'] = (pairs) =>
    pairs.map(([outer, inner]) => {
      const a = kit.resolve(outer)
      const b = kit.resolve(inner)
      return !!a && !!b && a !== document.body && a !== document.documentElement && a.localName !== 'main' && a.contains(b)
    })
  const VISUAL = 'img, video, canvas, svg, iframe, object, embed, input, button, select, textarea, a[href]'
  const parallel: MotionKit['parallel'] = (ref) => {
    const el = kit.resolve(ref)
    if (!el) return true
    const all = (document.body?.innerText ?? '').replace(/\s+/g, '')
    const own = ((el as HTMLElement).innerText ?? '').replace(/\s+/g, '')
    if (all.length - own.length > 0) return true
    for (const other of Array.from(document.querySelectorAll(VISUAL))) {
      if (el.contains(other) || other.contains(el)) continue
      if (shown(other, 4)) return true
    }
    return false
  }

  // ---- controls that may pause, stop or hide it ----
  const plain = (text: string) =>
    ` ${text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()} `
  const MOTION_NOUN = /\b(animat\w*|animac\w*|anima\w*|motion|movement|movimento|movimiento|carousel|carrossel|carrusel|slideshow|slides?|ticker|scroll\w*|rolagem|autoplay|rotation|rotacao|rotacion|updates?|atualizac\w*|actualizac\w*|changes|mudancas|cambios|video|banner)\b/
  const ALL = /\b(all|every|todas?|todos?)\b/
  const PAUSE = /\b(pause|pausa|pausar|pauze|freeze|congelar)\b/
  const STOP = /\b(stop|parar|pare|detener|deten|interromper|interrumpir)\b/
  const TURN_OFF = /\b(turn off|switch off|disable|desligar|desativar|desactivar|apagar)\b/
  const REDUCE = /\b(reduce motion|reduced motion|reduzir movimento|reducir movimiento|less motion|menos movimento|menos movimiento)\b/
  const HIDE = /\b(hide|ocultar|oculte|esconder|esconda)\b/
  const CLOSE = /\b(close|dismiss|fechar|feche|cerrar|cierre)\b/
  const FREQUENCY = /\b(frequency|speed|interval|slower|delay|frequencia|velocidade|intervalo|velocidad|frecuencia|mais devagar|mas lento)\b/
  const OPENER = /\b(control|controls|settings|options|preferences|accessibility|controle|controles|configurac\w*|configuracion\w*|opcoes|ajustes|preferencias|acessibilidade|opciones|accesibilidad)\b/
  const nameOf = (el: Element): string => {
    const labelled = collapse(
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
    const labels = 'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []).map((l) => collapse(l.textContent)).join(' ') : ''
    const value = el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type) ? el.value : ''
    const inner = collapse((el as HTMLElement).innerText ?? el.textContent)
    const alt = collapse(el.querySelector('img[alt]')?.getAttribute('alt'))
    const svg = collapse(el.querySelector('svg title')?.textContent)
    return cut(collapse(el.getAttribute('aria-label')) || labelled || labels || value || inner || el.getAttribute('title') || alt || svg || (el instanceof HTMLInputElement && el.type === 'image' ? (el.alt ?? '') : ''), 120)
  }
  const classify = (name: string, code: string): { kind: RawControl['kind']; word: string } | undefined => {
    const text = plain(name)
    const noun = MOTION_NOUN.test(text)
    const first = (re: RegExp) => re.exec(text)?.[1]
    // A toggle named for both ("Play/Pause", "Start/Stop") counts by its pause or stop word.
    const pause = first(PAUSE)
    const stop = first(STOP)
    if (REDUCE.test(text)) return { kind: 'setting', word: first(REDUCE) ?? 'reduce motion' }
    if (first(TURN_OFF) && noun) return { kind: ALL.test(text) || /animat|anima|motion|moviment/.test(text) ? 'setting' : 'stop', word: `${first(TURN_OFF)}` }
    if (pause) return { kind: ALL.test(text) ? 'setting' : 'pause', word: pause }
    if (stop) return { kind: ALL.test(text) ? 'setting' : 'stop', word: stop }
    const hide = first(HIDE)
    if (hide) return { kind: 'hide', word: hide }
    const close = first(CLOSE)
    if (close || /^\s*[×✕✖xX]\s*$/.test(name)) return { kind: 'close', word: close ?? name.trim() }
    const frequency = first(FREQUENCY)
    if (frequency) return { kind: 'frequency', word: frequency }
    if (name.trim() === '') {
      const coded = plain(code.replace(/[-_]/g, ' '))
      const c = /\b(pause|stop)\b/.exec(coded)?.[1]
      if (c) return { kind: c === 'pause' ? 'pause' : 'stop', word: c }
    }
    const opener = first(OPENER)
    if (opener) return { kind: 'opener', word: opener }
    return undefined
  }
  const CONTROL = 'button, input[type=button], input[type=submit], input[type=image], input[type=checkbox], a[href], [role=button], [role=switch], [role=checkbox], [role=link], [role=menuitem], summary, [onclick]'
  const edgeDistance = (a: DOMRect, b: DOMRect): number => {
    const dx = Math.max(0, a.left - b.right, b.left - a.right)
    const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom)
    return Math.round(Math.hypot(dx, dy))
  }
  const controls: MotionKit['controls'] = (items) => {
    const resolved = items.map((item) => ({ key: item.key, el: kit.resolve(item.ref) })).filter((i): i is { key: string; el: Element } => i.el !== null)
    const shownOut: RawControl[] = []
    const openers: Array<{ el: Element; control: RawControl }> = []
    const hidden: Array<{ el: Element; control: RawControl }> = []
    const all = Array.from(document.querySelectorAll(CONTROL)).slice(0, 4000)
    const factsOf = (el: Element, name: string): ControlFacts => w.__rampaActivate?.facts(el) ?? { texts: [name], code: [], disabled: false, submit: false, sensitiveForm: false, download: false }
    for (const el of all) {
      if (resolved.some((item) => item.el === el)) continue
      const name = nameOf(el)
      const code = [el.id, el.getAttribute('class') ?? '', ...Array.from(el.attributes).filter((a) => a.name.startsWith('data-')).map((a) => a.value)].join(' ').slice(0, 300)
      const found = classify(name, code)
      if (!found) continue
      const isShown = kit.visible(el) && el.getBoundingClientRect().width >= 1 && el.getBoundingClientRect().height >= 1
      const near: RawControl['near'] = []
      const r = el.getBoundingClientRect()
      const controlsIds = (el.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)
      for (const item of resolved) {
        const distance = isShown ? edgeDistance(r, item.el.getBoundingClientRect()) : 9999
        const owned = controlsIds.map((id) => document.getElementById(id)).some((target) => !!target && (target === item.el || target.contains(item.el) || item.el.contains(target)))
        if (owned) {
          near.push({ item: item.key, how: 'controls', distance })
          continue
        }
        if (found.kind === 'setting') {
          near.push({ item: item.key, how: 'page', distance })
          continue
        }
        let level = 0
        let inside = false
        for (let a: Element | null = item.el; a && a !== document.body && a !== document.documentElement && a.localName !== 'main' && level <= 5; a = a.parentElement, level++) {
          if (a.contains(el)) {
            inside = true
            break
          }
        }
        if (inside) near.push({ item: item.key, how: 'container', distance })
        else if (found.kind !== 'close' && distance <= 120) near.push({ item: item.key, how: 'distance', distance })
        // Anywhere on the page, last: ACT efbfc7 counts an instrument anywhere in the page, and pressing it tells what
        // it stops. A "Close" only ever hides its own container.
        else if (found.kind !== 'close' && found.kind !== 'opener') near.push({ item: item.key, how: 'page', distance })
      }
      const control: RawControl = { el: kit.describe(el), name, kind: found.kind, word: found.word, shows: isShown, near, facts: factsOf(el, name) }
      if (found.kind === 'opener') {
        if (isShown) openers.push({ el, control })
      } else if (!isShown && found.kind !== 'frequency' && found.kind !== 'close') hidden.push({ el, control })
      else if (near.length > 0) shownOut.push(control)
      if (shownOut.length + hidden.length + openers.length >= 80) break
    }
    // A pause control that does not show counts only through a control that may show it, near what moves ("Control
    // changes", "Settings") or naming its container in aria-controls; it may then serve anything on the page.
    const reached = new Set<Element>()
    const kept: RawControl[] = []
    for (const opener of openers) {
      const ids = (opener.el.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)
      const owned = hidden.filter((h) => ids.some((id) => document.getElementById(id)?.contains(h.el)))
      if (owned.length === 0 && opener.control.near.length === 0) continue
      const opens = owned.length > 0 ? owned : hidden
      if (opens.length === 0) continue
      for (const h of opens) reached.add(h.el)
      kept.push({ ...opener.control, opens: opens.map((h) => kit.cssPath(h.el)).slice(0, 4) })
    }
    for (const h of hidden) {
      if (!reached.has(h.el)) continue
      kept.push({ ...h.control, near: resolved.map((item) => ({ item: item.key, how: 'page' as const, distance: 9999 })) })
    }
    return [...shownOut, ...kept].slice(0, 60)
  }

  const states: MotionKit['states'] = (items) =>
    items.map((item) => {
      const el = kit.resolve(item.ref)
      const empty: ItemState = { key: item.key, gone: true, visible: false, box: { x: 0, y: 0, width: 0, height: 0 }, text: '', running: 0, videoPlaying: false, smilRunning: false, smilTime: 0, src: '' }
      if (!el || !el.isConnected) return empty
      const textEl = (item.textRef ? kit.resolve(item.textRef) : null) ?? el
      let running = 0
      for (const animation of document.getAnimations()) {
        const target = (animation.effect as KeyframeEffect | null)?.target
        if (target && (target === el || el.contains(target)) && animation.playState === 'running') running++
      }
      const videos = el instanceof HTMLVideoElement ? [el] : Array.from(el.querySelectorAll('video'))
      const svgs = el instanceof SVGSVGElement ? [el] : Array.from(el.querySelectorAll('svg'))
      const smil = svgs.filter((svg) => svg.querySelector('animate, animateTransform, animateMotion, set'))
      const img = el instanceof HTMLImageElement ? el : el.querySelector('img')
      return {
        key: item.key,
        gone: false,
        visible: shown(el, 1),
        box: viewBox(el),
        text: textOf(textEl),
        running,
        videoPlaying: videos.some((v) => !v.paused && !v.ended),
        smilRunning: smil.some((svg) => !svg.animationsPaused()),
        smilTime: smil[0]?.getCurrentTime() ?? 0,
        src: img ? img.currentSrc || img.src : getComputedStyle(el).backgroundImage.slice(0, 300),
      }
    })

  /** Scrolls an element to the middle of the window; its box in the window, or null when it is gone. */
  const reveal: MotionKit['reveal'] = (ref) => {
    const el = kit.resolve(ref)
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior })
    return viewBox(el)
  }

  w.__rampaMotion = { inventory, textStart, textStep, textTargets, scroll, freeze, seek, region, contains, parallel, controls, states, reveal }
}
