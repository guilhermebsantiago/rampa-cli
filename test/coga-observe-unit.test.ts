import { describe, expect, it } from 'vitest'
import { interruptionsOf } from '../src/advisory/checks/interruptions.ts'
import { CONTROL_MOVE_PX, SHIFT_SCORE, layoutShifts, moveOf, sessionsOf } from '../src/advisory/checks/layout-shift.ts'
import { clipboardBlocks, pasteCancelled } from '../src/advisory/checks/paste-blocked.ts'
import { carouselMoves, motionImpact, reducedMotions } from '../src/advisory/checks/reduced-motion.ts'
import { observationWindow, observedLoad } from '../src/advisory/observed.ts'
import {
  COGNITIVE_VERSION,
  type CogaAnimation,
  type CogaData,
  type CogaField,
  type CogaLayer,
  type CogaShift,
  OBSERVE_VARIANT,
  REDUCE_VARIANT,
  imageLoops,
} from '../src/probes/cognitive-kit.ts'
import { probeLaunchArgs } from '../src/probes/run.ts'
import type { A11ySnapshot, ProbeRecord } from '../src/snapshot/schema.ts'

/** The pure half of the observed checks: thresholds over records, with no browser. */

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const el = (ref: string, label = '') => ({ ref, tag: 'div', label })

function data(over: Partial<CogaData> = {}): CogaData {
  return {
    windowMs: 8000,
    loadMs: 500,
    endMs: 8500,
    firstSampleMs: 200,
    sampleMs: 300,
    samples: 27,
    viewport: { width: 1280, height: 800 },
    activatedMs: -1,
    animations: { firstMs: 1500, first: [], lastMs: 8500, last: [] },
    videos: [],
    images: [],
    carousels: [],
    layers: [],
    permissions: [],
    plays: [],
    shifts: [],
    alerts: [],
    windows: [],
    ...over,
  }
}

function animation(ref: string, over: Partial<CogaAnimation> = {}): CogaAnimation {
  return { el: el(ref), box: box(0, 0, 48, 48), visible: true, kind: 'css-animation', name: 'spin', properties: ['transform'], infinite: true, iterations: -1, durationMs: 1000, endMs: -1, colorOnly: false, ancestor: -1, carousel: -1, ...over }
}

function layer(ref: string, over: Partial<CogaLayer> = {}): CogaLayer {
  return { el: el(ref), dialog: false, modal: false, position: 'fixed', firstMs: 1000, lastMs: 8000, samples: 20, cover: 0.5, coversContent: true, text: 'Subscribe to our newsletter', prose: 27, consent: false, within: -1, box: box(0, 0, 640, 400), ...over }
}

function field(ref: string, over: Partial<CogaField> = {}): CogaField {
  return {
    el: el(ref),
    kind: 'text',
    type: 'text',
    autocomplete: '',
    label: ref,
    onpaste: false,
    paste: { prevented: false, changed: false, readClipboard: false },
    beforeinput: { prevented: false, changed: false },
    copy: { prevented: false, data: false },
    ...over,
  }
}

describe('coga/reduced-motion rules', () => {
  it('tells motion that ignores the setting from motion shown only under it', () => {
    const reduce = data({ animations: { firstMs: 1500, first: [animation('#spin'), animation('#pulse', { name: 'pulse' })], lastMs: 8500, last: [animation('#spin')] } })
    const observe = data({ animations: { firstMs: 1500, first: [animation('#spin')], lastMs: 8500, last: [animation('#spin')] } })
    const motions = reducedMotions(reduce, observe)
    expect(motions.map((m) => [m.el.ref, m.without, motionImpact(m)])).toEqual([
      ['#spin', 'same', 'hurdle'],
      ['#pulse', 'only-reduce', 'suggestion'],
    ])
    // Without the other load there is nothing to compare.
    expect(reducedMotions(reduce, undefined).map((m) => m.without)).toEqual(['unknown', 'unknown'])
  })

  it('leaves out what ends within 5 s, color-only changes, hidden and tiny elements', () => {
    const reduce = data({
      animations: {
        firstMs: 1500,
        first: [
          animation('#entrance', { infinite: false, endMs: 4000, iterations: 1 }),
          animation('#long', { infinite: false, endMs: 7000, iterations: 1 }),
          animation('#glow', { colorOnly: true, properties: ['backgroundColor'] }),
          animation('#hidden', { visible: false }),
          animation('#dot', { box: box(0, 0, 6, 6) }),
        ],
        lastMs: 8500,
        last: [],
      },
    })
    const motions = reducedMotions(reduce, data())
    expect(motions.map((m) => [m.el.ref, m.endless, motionImpact(m)])).toEqual([['#long', false, 'suggestion']])
  })

  it('folds an animated element into its animated ancestor, and one animation on many elements into one', () => {
    const rings = [animation('#spinner'), animation('#ring', { name: 'spin-inner', ancestor: 0 })]
    const cards = ['#a', '#b', '#c'].map((ref) => animation(ref, { name: 'grow', box: box(0, 0, 160, 60) }))
    const reduce = data({ animations: { firstMs: 1500, first: [...rings, ...cards], lastMs: 8500, last: [] } })
    const motions = reducedMotions(reduce, undefined)
    expect(motions.map((m) => [m.el.ref, m.animation?.names, m.others?.map((o) => o.ref)])).toEqual([
      ['#a', ['grow'], ['#b', '#c']],
      ['#spinner', ['spin', 'spin-inner'], undefined],
    ])
  })

  it('counts carousel moves after the first second, once per move, and folds animations inside a moving carousel', () => {
    const carousel = { el: el('#hero'), box: box(0, 0, 600, 200), slides: 3, changes: [900, 1600, 2500, 2700, 3400], samples: 26 }
    expect(carouselMoves(carousel, data())).toEqual([1600, 2500, 3400])
    const reduce = data({ carousels: [carousel], animations: { firstMs: 1500, first: [animation('#slide-fade', { carousel: 0 })], lastMs: 8500, last: [] } })
    expect(reducedMotions(reduce, undefined).map((m) => m.kind)).toEqual(['carousel'])
    // A slider that only sets itself up while the page loads does not move.
    expect(carouselMoves({ ...carousel, changes: [900, 1400] }, data())).toEqual([])
  })

  it('reports animated images by their loop count, and videos that loop or last', () => {
    const image = { el: el('#gif'), box: box(0, 0, 64, 64), src: 'loading.gif' }
    const video = { el: el('#hero'), box: box(0, 0, 640, 360), visible: true, src: 'hero.webm', autoplay: true, loop: false, muted: true, controls: false, durationMs: 3000, playing: { firstMs: 600, lastMs: 8400, samples: 25 }, carousel: -1 }
    const reduce = data({
      images: [
        { ...image, animated: true, format: 'image/gif', loops: -1 },
        { ...image, el: el('#once'), animated: true, format: 'image/gif', loops: 1 },
        { ...image, el: el('#still'), animated: false, loops: null },
      ],
      videos: [video, { ...video, el: el('#bg'), loop: true }],
    })
    expect(reducedMotions(reduce, undefined).map((m) => [m.kind, m.el.ref, m.endless])).toEqual([
      ['video', '#bg', true],
      ['image', '#gif', true],
      ['image', '#once', false],
    ])
  })
})

describe('coga/interruptions rules', () => {
  it('reports dialogs, big layers, toasts after load, alerts, windows, permissions and sound', () => {
    const observe = data({
      layers: [
        layer('#modal', { dialog: true, modal: true, cover: 0.3 }),
        layer('#wall', { cover: 0.9 }),
        layer('#toast', { cover: 0.05, coversContent: false, text: 'Maria just booked a visit', prose: 25, firstMs: 3000 }),
        layer('#header', { cover: 0.1, coversContent: false, text: 'Home News', prose: 0, firstMs: 200 }),
      ],
      alerts: [{ type: 'alert', atMs: 900, message: 'Welcome!' }],
      windows: [{ url: 'https://example.com/promo', atMs: 900 }],
      permissions: [
        { api: 'notifications', atMs: 300, activated: false },
        { api: 'notifications', atMs: 400, activated: false },
        { api: 'geolocation', atMs: 2000, activated: true },
      ],
      plays: [
        { el: el('#jingle'), tag: 'audio', src: 'jingle.mp3', atMs: 500, muted: false, volume: 1, autoplay: true, how: 'autoplay', outcome: 'blocked', audible: null, activated: null, attached: true },
        { el: el('#bg'), tag: 'video', src: 'bg.mp4', atMs: 500, muted: true, volume: 1, autoplay: true, how: 'autoplay', outcome: 'playing', audible: null, activated: false, attached: true },
      ],
    })
    const found = interruptionsOf(observe, undefined)
    expect(found.map((item) => [item.kind, item.el?.ref ?? item.detail?.api ?? item.text, item.impact])).toEqual([
      ['permission', 'notifications', 'hurdle'],
      ['sound', '#jingle', 'hurdle'],
      ['alert', 'Welcome!', 'hurdle'],
      ['window', 'https://example.com/promo', 'hurdle'],
      ['dialog', '#modal', 'hurdle'],
      ['overlay', '#wall', 'hurdle'],
      ['toast', '#toast', 'suggestion'],
    ])
  })

  it('notes a consent banner apart only when it is modal or covers a quarter of the window', () => {
    const consent = layer('#cmp', { consent: true, text: 'We use cookies', cover: 0.4 })
    const bar = layer('#bar', { consent: true, text: 'We use cookies. OK', cover: 0.12 })
    expect(interruptionsOf(data({ layers: [consent, bar] }), undefined).map((item) => [item.kind, item.el?.ref, item.impact])).toEqual([['consent', '#cmp', 'suggestion']])
  })

  it('leaves out a flash shorter than two samples, an app shell with nothing under it, and a dialog inside its own layer', () => {
    const flash = layer('#flash', { samples: 1 })
    const shell = layer('#app', { cover: 1, coversContent: false, firstMs: 100, prose: 0 })
    const backdrop = layer('#backdrop', { cover: 1 })
    const box = layer('#box', { dialog: true, modal: true, cover: 0.2, within: 3 })
    const found = interruptionsOf(data({ layers: [flash, shell, layer('#x', { samples: 1 }), backdrop, box] }), undefined)
    expect(found.map((item) => [item.kind, item.el?.ref, item.layer?.cover])).toEqual([['dialog', '#box', 1]])
  })

  it('leaves a carousel that keeps moving under reduced motion to coga/reduced-motion', () => {
    const carousel = { el: el('#hero'), box: box(0, 0, 600, 200), slides: 3, changes: [2000, 3000], samples: 26 }
    expect(interruptionsOf(data({ carousels: [carousel] }), data({ carousels: [carousel] }))).toEqual([])
    expect(interruptionsOf(data({ carousels: [carousel] }), data({ carousels: [{ ...carousel, changes: [] }] })).map((item) => item.kind)).toEqual(['carousel'])
  })
})

describe('coga/layout-shift rules', () => {
  const shift = (atMs: number, score: number, sources: CogaShift['sources']): CogaShift => ({ atMs, score, input: false, sources })
  const source = (ref: string, dy: number, interactive: boolean, size = box(0, 300, 1280, 400)) => ({ el: el(ref), before: size, after: { ...size, y: size.y + dy }, interactive })

  it('reports a shift of 0.05 or more, and one that moves a control 24 px or more', () => {
    expect(SHIFT_SCORE).toBe(0.05)
    expect(CONTROL_MOVE_PX).toBe(24)
    const reports = layoutShifts(
      data({
        shifts: [
          shift(800, 0.06, [source('#main', 120, false)]),
          shift(4000, 0.001, [source('#pay', 30, true, box(100, 200, 120, 40))]),
          shift(7000, 0.001, [source('#link', 20, true, box(100, 200, 120, 40))]),
          shift(7500, 0.049, [source('#text', 60, false)]),
        ],
      }),
    )
    expect(reports.map((r) => [r.source.el.ref, r.by, r.interactive, r.distance, r.direction])).toEqual([
      ['#pay', 'control', true, 30, 'down'],
      ['#main', 'score', false, 120, 'down'],
    ])
  })

  it('groups shifts in session windows and ignores those with input', () => {
    const shifts = [shift(100, 0.02, []), shift(900, 0.02, []), shift(2500, 0.02, []), { ...shift(2600, 0.5, []), input: true }]
    expect(sessionsOf(shifts).map((session) => session.map((s) => s.atMs))).toEqual([[100, 900], [2500]])
    // An element that appears did not move.
    expect(moveOf({ before: box(0, 0, 0, 0), after: box(0, 100, 50, 50) }).distance).toBe(0)
  })
})

describe('coga/paste-blocked rules', () => {
  it('reports a paste cancelled with nothing inserted, never one the page inserts itself', () => {
    const blocked = field('#pass', { kind: 'password', type: 'password', paste: { prevented: true, changed: false, readClipboard: false } })
    const trimmed = field('#cpf', { paste: { prevented: true, changed: true, readClipboard: false } })
    const reads = field('#reads', { paste: { prevented: true, changed: false, readClipboard: true } })
    const input = field('#code', { kind: 'code', beforeinput: { prevented: true, changed: false } })
    expect([blocked, trimmed, reads, input].map(pasteCancelled)).toEqual(['paste', undefined, undefined, 'beforeinput'])
    const blocks = clipboardBlocks({ fields: [blocked, trimmed, reads, input] })
    expect(blocks.map((b) => [b.kind, b.el.ref, b.impact])).toEqual([
      ['paste', '#pass', 'barrier'],
      ['paste', '#code', 'barrier'],
    ])
  })

  it('makes one advisory of three or more fields that all cancel, and leaves out what another check owns', () => {
    const fields = ['#a', '#b', '#c'].map((ref) => field(ref, { paste: { prevented: true, changed: false, readClipboard: false } }))
    expect(clipboardBlocks({ fields }).map((b) => [b.kind, b.fields?.length])).toEqual([['paste-all', 3]])
    expect(clipboardBlocks({ fields }, (f) => f.el.ref === '#a').map((b) => b.kind)).toEqual(['paste', 'paste'])
  })

  it('reports copy, the context menu and unselectable text on the page, but not a copy that adds a source line', () => {
    const text = (over: object) => ({ el: el('main > p', 'Some text'), chars: 300, copy: { prevented: false, data: false }, contextmenu: { prevented: false }, userSelect: { chars: 400, none: 0 }, ...over })
    expect(clipboardBlocks({ fields: [], text: text({ copy: { prevented: true, data: true } }) })).toEqual([])
    const blocks = clipboardBlocks({ fields: [field('#f', { copy: { prevented: true, data: false } })], text: text({ copy: { prevented: true, data: false }, contextmenu: { prevented: true }, userSelect: { chars: 400, none: 300, by: el('html > body') } }) })
    // The page's own copy block covers the field's.
    expect(blocks.map((b) => [b.kind, b.el.ref, b.impact])).toEqual([
      ['copy-text', 'main > p', 'hurdle'],
      ['user-select', 'html > body', 'hurdle'],
      ['contextmenu', 'main > p', 'suggestion'],
    ])
    expect(clipboardBlocks({ fields: [], text: text({ userSelect: { chars: 150, none: 150 } }) })).toEqual([])
  })
})

describe('the observation', () => {
  it('runs with the cognitive profile only: 8 s, 3 s with --fast, or coga.observe seconds; 0 turns it off', () => {
    expect(observationWindow([], undefined, false)).toBeUndefined()
    expect(observationWindow(['cognitive'], undefined, false)).toBe(8000)
    expect(observationWindow(['cognitive'], undefined, true)).toBe(3000)
    expect(observationWindow(['cognitive'], { observe: 5 }, true)).toBe(5000)
    expect(observationWindow(['cognitive'], { observe: 0 }, false)).toBeUndefined()
    expect(observationWindow(['cognitive'], { observe: false }, false)).toBeUndefined()
  })

  it('starts the browser with no extra switches for the observation alone', () => {
    expect(probeLaunchArgs(['cognitive'])).toEqual([])
    expect(probeLaunchArgs(['cognitive', 'layout'])).not.toEqual([])
  })

  it('reads a record only of a version it knows, and says why it cannot', () => {
    const record = (over: Partial<ProbeRecord>): ProbeRecord => ({
      kind: 'cognitive',
      version: COGNITIVE_VERSION,
      conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'test', variant: OBSERVE_VARIANT },
      status: 'complete',
      guard: { blocked: [], navigations: [], dialogs: [] },
      durationMs: 1,
      data: data(),
      ...over,
    })
    const snapshot = (probes: ProbeRecord[]) => ({ observations: { probes } }) as unknown as A11ySnapshot
    expect(observedLoad(snapshot([record({})]), OBSERVE_VARIANT, 'en', {}).data?.windowMs).toBe(8000)
    expect(observedLoad(snapshot([record({})]), REDUCE_VARIANT, 'en', {}).reason).toMatch(/^the live page was not observed/)
    expect(observedLoad(snapshot([record({ status: 'skipped', reason: 'the page did not load', data: null })]), OBSERVE_VARIANT, 'en', {}).reason).toBe('the observation did not run: the page did not load')
    expect(observedLoad(snapshot([record({ version: '0' })]), OBSERVE_VARIANT, 'pt-BR', {}).reason).toMatch(/^a observação não rodou/)
    expect(observedLoad(snapshot([record({ data: { layers: 'x' } })]), OBSERVE_VARIANT, 'en', {}).reason).toBe('the observation did not run: unreadable observation record')
  })

  it('reads how many times an animated image plays from its bytes', () => {
    const gif = (loop?: number) => {
      const netscape = loop === undefined ? [] : [0x21, 0xff, 0x0b, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 0x03, 0x01, loop & 0xff, loop >> 8, 0x00]
      return new Uint8Array([...Array.from('GIF89a', (c) => c.charCodeAt(0)), 1, 0, 1, 0, 0, 0, 0, ...netscape, 0x3b])
    }
    expect(imageLoops(gif(0), 'image/gif')).toBe(-1)
    expect(imageLoops(gif(2), 'image/gif')).toBe(3)
    expect(imageLoops(gif(), 'image/gif')).toBe(1)
    const chunk = (type: string, body: number[]) => [0, 0, 0, body.length, ...Array.from(type, (c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0]
    const png = (plays: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', Array(13).fill(0)), ...chunk('acTL', [0, 0, 0, 2, 0, 0, 0, plays])])
    expect(imageLoops(png(0), 'image/png')).toBe(-1)
    expect(imageLoops(png(4), 'image/png')).toBe(4)
  })
})
