import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { gestureJudgments, pointerGestures } from '../src/criteria/pointer-gestures.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import type { Watch } from '../src/probes/activate.ts'
import { type DeviceMotionData, type MotionEffect, motionEffect, motionFunctions, motionSteps, quaternion, sameMotionEffect } from '../src/probes/device-motion.ts'
import { type GestureTarget, type GesturesData, type ViewState, effectOf, gesturePath, gesturesFor, sameEffect, viewChange } from '../src/probes/gestures.ts'
import type { GestureCandidate, PointerData } from '../src/probes/pointer.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { gestureVerdicts, motionVerdict } from '../src/rules/gestures.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { indexTree } from '../src/snapshot/tree.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { byRule, probeCheckOptions, reviewByRule } from './probe-helpers.ts'

const GESTURE = 'rampa/gesture-alternatives'
const MOTION = 'rampa/motion-actuation'
const POINTER_GESTURE = 'rampa/pointer-gestures'
const SCOPE = 'rampa/motion-actuation-scope'

describe('the gestures probe is opt-in', () => {
  it('stays out of --probe all and joins --probe interact', () => {
    expect(parseProbeKinds('all')).not.toContain('gestures')
    expect(parseProbeKinds('gestures')).toEqual(['gestures'])
    expect(parseProbeKinds('interact')).toContain('gestures')
  })
})

const state = (extra: Partial<ViewState> = {}): ViewState => ({ ring: [], parts: '', layout: 'a', scroll: '', scale: 1, ...extra })
const RING = ['Photo 1', 'Photo 2', 'Photo 3', 'Photo 4']

describe('what a gesture did, and whether a control did the same', () => {
  it('reads a change of slide, content, zoom and layout, and leaves the browser’s scrolling out', () => {
    expect(viewChange(state({ ring: RING, focus: 'Photo 1' }), state({ ring: RING, focus: 'Photo 2', layout: 'b' }))).toEqual(['slide', 'layout'])
    expect(viewChange(state({ zoom: 5 }), state({ zoom: 6 }))).toEqual(['zoom'])
    expect(viewChange(state({ parts: 'Zoom: 100%' }), state({ parts: 'Zoom: 150%' }))).toEqual(['content'])
    const grey = (value: string) => value.repeat(256)
    expect(viewChange(state({ thumb: grey('00') }), state({ thumb: grey('20') }))).toEqual(['pixels'])
    // Pixels that change with the page's clock stopped are not the gesture's.
    expect(viewChange(state({ thumb: grey('00') }), state({ thumb: grey('20') }), true)).toEqual([])
    // A strip the browser scrolled: the slide and the pixels it moved are the browser's, not the page's.
    expect(effectOf(['slide', 'pixels', 'scroll'])).toEqual([])
    expect(effectOf(['content', 'scroll'])).toEqual(['content'])
  })

  it('compares the move along the slides, so a carousel that turned on its own still matches', () => {
    const g0 = state({ ring: RING, focus: 'Photo 1' })
    const g1 = state({ ring: RING, focus: 'Photo 2', layout: 'b' })
    // The control's load started a slide later (autoplay): the same move of one slide forward.
    expect(sameEffect(g0, g1, state({ ring: RING, focus: 'Photo 2' }), state({ ring: RING, focus: 'Photo 3', layout: 'c' }))).toBe(true)
    // Two slides at once is something else.
    expect(sameEffect(g0, g1, state({ ring: RING, focus: 'Photo 1' }), state({ ring: RING, focus: 'Photo 3', layout: 'c' }))).toBe(false)
    // A control that changed nothing.
    expect(sameEffect(g0, g1, state({ ring: RING, focus: 'Photo 1' }), state({ ring: RING, focus: 'Photo 1' }))).toBe(false)
    // Zoom: the same direction.
    expect(sameEffect(state({ zoom: 5 }), state({ zoom: 6 }), state({ zoom: 5 }), state({ zoom: 6, layout: 'b' }))).toBe(true)
    expect(sameEffect(state({ zoom: 5 }), state({ zoom: 6 }), state({ zoom: 5 }), state({ zoom: 4, layout: 'b' }))).toBe(false)
    // From the same start, the same content.
    expect(sameEffect(state({ parts: 'Zoom: 100%' }), state({ parts: 'Zoom: 200%' }), state({ parts: 'Zoom: 100%' }), state({ parts: 'Zoom: 200%' }))).toBe(true)
    expect(sameEffect(state({ parts: 'Zoom: 100%' }), state({ parts: 'Zoom: 200%' }), state({ parts: 'Zoom: 100%' }), state({ parts: 'Zoom: 150%' }))).toBe(false)
  })

  it('swipes across the middle of a box and pinches from its centre, inside the window', () => {
    const swipe = gesturePath('swipe-left', { x: 100, y: 100, width: 400, height: 200 }, { width: 1280, height: 800 })
    expect(swipe[0]).toEqual([{ x: 400, y: 200 }])
    expect(swipe.at(-1)).toEqual([{ x: 200, y: 200 }])
    const pinch = gesturePath('pinch-out', { x: 0, y: 0, width: 400, height: 200 }, { width: 300, height: 800 })
    expect(pinch[0]).toHaveLength(2)
    // Clamped to the window.
    expect(Math.max(...pinch.flat().map((p) => p.x))).toBeLessThanOrEqual(298)
    expect(gesturesFor('map')).toEqual(['pinch-out'])
    expect(gesturesFor('carousel')).toEqual(['swipe-left', 'swipe-right'])
  })
})

describe('the device moved, and what a control did', () => {
  it('shakes on two axes and tilts by 35° and back', () => {
    const shake = motionSteps('shake')
    expect(shake[0]?.linear[0]).toBe(20)
    expect(shake[1]?.linear[0]).toBe(-20)
    const tilt = motionSteps('tilt-forward')
    expect(Math.max(...tilt.map((s) => s.beta))).toBe(35)
    expect(tilt.at(-1)?.beta).toBe(0)
    expect(motionSteps('tilt-sideways').some((s) => s.gamma === 35 && s.beta === 0)).toBe(true)
    const q = quaternion({ beta: 0, gamma: 35 })
    expect(q.x).toBe(0)
    expect(q.y).toBeCloseTo(Math.sin((35 * Math.PI) / 360))
  })

  it("reads what the page's own sentence says a motion does", () => {
    expect(motionFunctions(['Shake your phone to undo the last item you added.'])).toEqual(['undo'])
    expect(motionFunctions(['Agite o celular para desfazer a última ação'])).toEqual(['desfazer'])
    expect(motionFunctions(['Tilt your phone forward'])).toEqual([])
  })

  const watch = (extra: Partial<Watch> = {}): Watch => ({ dom: 0, style: 0, samples: [], navigations: [], windows: [], submits: [], dialogs: [], modals: 0, text: { before: 100, changed: 0 }, storage: 0, blocked: 0, ms: 500, ...extra })
  const removed = { ref: 'li', id: { tag: 'li', sig: 'li|||||' }, tag: 'li', label: 'Rain jacket', what: 'removed' }

  it('sorts a window into navigation, content, scroll and style, and matches a control on the same elements', () => {
    expect(motionEffect(watch({ navigations: [{ url: 'https://example.com/next', type: 'push', same: false, at: 1 }] }), undefined)?.kind).toBe('navigation')
    const content = motionEffect(watch({ dom: 2, samples: [removed] }), { gone: ['Rain jacket'], came: [], scrolled: [] })
    expect(content).toMatchObject({ kind: 'content', detail: 'gone: "Rain jacket"', marks: ['li|removed'] })
    expect(motionEffect(watch(), { gone: [], came: [], scrolled: [{ target: 'page', dx: 0, dy: 120, scrollable: true }] })?.kind).toBe('scroll')
    expect(motionEffect(watch({ style: 12 }), { gone: [], came: [], scrolled: [] })?.kind).toBe('style')
    expect(motionEffect(watch(), { gone: [], came: [], scrolled: [] })).toBeUndefined()
    const undo = motionEffect(watch({ dom: 1, samples: [removed] }), { gone: ['Rain jacket'], came: [], scrolled: [] })
    expect(sameMotionEffect(content, undo)).toBe(true)
    const other = motionEffect(watch({ dom: 1, samples: [{ ...removed, ref: '#quote', what: 'text' }] }), { gone: ['A'], came: ['B'], scrolled: [] })
    expect(sameMotionEffect(content, other)).toBe(false)
  })
})

// Recorded facts, no browser.

const sig = (tag: string, a: Record<string, string>) => [tag, a.id ?? '', a.role ?? '', a.type ?? '', a.name ?? '', a.href ?? ''].join('|')
const element = (id: string, tag: string, role: string, name: string, extra: Record<string, string> = {}): A11yNode => ({
  ref: `#${id}`,
  role,
  name,
  states: [],
  native: { tag, attributes: { id, ...extra } },
  children: [],
})
const described = (node: A11yNode) => ({ ref: node.ref, id: { tag: node.native.tag as string, sig: sig(node.native.tag as string, node.native.attributes as Record<string, string>) }, tag: node.native.tag as string, role: node.role, label: node.name ?? '' })

const record = (variant: string, data: unknown, kind: ProbeRecord['kind'] = 'gestures'): ProbeRecord => ({
  kind,
  version: '1',
  conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant },
  status: 'complete',
  guard: { blocked: [], navigations: [], dialogs: [] },
  durationMs: 1,
  data,
})

function snapshotOf(nodes: A11yNode[], records: ProbeRecord[], root: Partial<A11yNode> = {}): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'Harbour',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html', attributes: {} }, children: [{ ref: 'html > body', role: 'generic', states: [], native: { tag: 'body', attributes: {} }, children: nodes }], ...root },
    observations: { probes: records },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const gesturesRecord = (targets: GestureTarget[]) => record('gestures', { viewport: { width: 1280, height: 800 }, touch: true, listeners: true, targets, loads: 1, actions: [], end: 'complete' } satisfies GesturesData)
const motionRecord = (data: Partial<DeviceMotionData>) => record('device-motion', { listeners: [{ type: 'devicemotion', script: 'https://example.com/app.js', line: 12 }], sensors: true, mentions: [], tries: [], controls: [], loads: 1, actions: [], end: 'complete', ...data })

const target = (node: A11yNode, kind: GestureTarget['kind'], extra: Partial<GestureTarget> = {}): GestureTarget => ({ ...described(node), kind, why: 'a carousel with touch or pointer listeners', texts: [node.name ?? ''], tries: [], alternatives: [], ...extra })
const swiped = { gesture: 'swipe-left' as const, changed: ['slide', 'layout'], detail: 'slide "Photo 1" → "Photo 2"' }

describe('2.5.1 over recorded facts', () => {
  const photos = element('photos', 'div', 'region', 'Photos')
  const gallery = element('gallery', 'div', 'region', 'Gallery')
  const pad = element('pad', 'canvas', 'img', 'Signature')
  const story = element('story', 'div', 'region', 'Stories')
  const art = element('art', 'div', 'region', 'Artwork')
  const quotes = element('quotes', 'div', 'region', 'Quotes')
  const once = element('once', 'div', 'region', 'Once')
  const later = element('later', 'div', 'region', 'Later')
  const still = element('still', 'div', 'region', 'Still')
  const targets = [
    target(photos, 'carousel', { effect: swiped, confirmed: true }),
    target(gallery, 'carousel', { effect: swiped, alternatives: [{ kind: 'next', label: 'Next photo', ref: '#next', reproduced: true }] }),
    target(pad, 'drawing', { essential: 'a signature pad', effect: { gesture: 'swipe-left', changed: ['pixels'], detail: 'its pixels changed' } }),
    target(story, 'touch', { effect: { gesture: 'swipe-left', changed: [], detail: 'navigation: https://example.com/story/2', context: true } }),
    target(art, 'viewer', { effect: { gesture: 'pinch-out', changed: ['pixels'], detail: 'its pixels changed' }, confirmed: true }),
    target(quotes, 'carousel', { effect: swiped, alternatives: [{ kind: 'next', label: 'Next page of quotes', ref: '#skip', reproduced: false, changed: ['slide'] }] }),
    target(once, 'carousel', { effect: swiped, confirmed: false }),
    target(later, 'carousel', { effect: swiped }),
    target(still, 'carousel', {}),
  ]
  const snapshot = snapshotOf([photos, gallery, pad, story, art, quotes, once, later, still], [gesturesRecord(targets)])

  it('fails a gesture no control does on two loads, clears one a control does, and leaves the rest to a person', async () => {
    const read = gestureVerdicts(snapshot.observations?.probes[0]?.data as GesturesData, indexTree(snapshot.root))
    expect(read.verdicts.map((v) => `${v.node.ref} ${v.result} ${v.why}`)).toEqual([
      '#photos failure none-found',
      '#gallery pass alternative',
      '#pad review essential',
      '#story review context',
      '#art review pixels',
      '#quotes review none-worked',
      '#once review once',
      '#later review unconfirmed',
    ])
    expect(read).toMatchObject({ applicable: 9, noEffect: 1 })
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(report, GESTURE).map((f) => `${f.ref} ${f.confidence}`)).toEqual(['#photos medium'])
    expect(byRule(report, GESTURE)[0]?.message).toMatch(/^<div> "Photos" is a carousel: a swipe to the left changes it \(slide "Photo 1" → "Photo 2"\), and Rampa found no control around it that does the same with a single pointer, on two loads \(WCAG 2\.5\.1\)\./)
    expect(reviewByRule(report, GESTURE).map((r) => r.ref)).toEqual(['#pad', '#story', '#art', '#quotes', '#once', '#later'])
    expect(reviewByRule(report, GESTURE)[0]?.message).toContain('looks like a signature pad')
    expect(reviewByRule(report, GESTURE)[3]?.message).toContain('The controls around it ("Next page of quotes" (did something else))')
    const row = report.coverage.probes?.find((c) => c.criterion === '2.5.1')
    expect(row).toMatchObject({ method: 'probe/gestures@1', rule: GESTURE, status: 'failures', applicable: 9, failures: 1, review: 6 })
    expect(row?.note).toContain('with a single-pointer alternative: <div> "Gallery" ("Next photo")')
    expect(row?.note).toContain('1 did not change')
    const pt = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(byRule(pt, GESTURE)[0]?.message).toMatch(/^<div> "Photos" é um carrossel: um deslize para a esquerda o muda/)
  })

  it('takes over from the pointer probe’s list of gestures', async () => {
    const pointer = record(
      'pointer',
      { viewport: { width: 1280, height: 800 }, found: 0, withDown: 0, presses: [], drags: [], gestures: [{ ...described(photos), kind: 'carousel', why: 'touch listeners', alternatives: [] } satisfies GestureCandidate], listeners: true, loads: 1, actions: [], end: 'complete' } satisfies PointerData,
      'pointer',
    )
    const alone = await checkSnapshot(snapshotOf([photos], [pointer]), emptyEngine(), probeCheckOptions())
    expect(reviewByRule(alone, POINTER_GESTURE).map((r) => r.ref)).toEqual(['#photos'])
    const both = await checkSnapshot(snapshotOf([photos], [pointer, gesturesRecord([target(photos, 'carousel', { effect: swiped, confirmed: true })])]), emptyEngine(), probeCheckOptions())
    expect(reviewByRule(both, POINTER_GESTURE)).toEqual([])
    expect(both.coverage.probes?.filter((c) => c.criterion === '2.5.1').map((c) => c.rule)).toEqual([GESTURE])
    expect(byRule(both, GESTURE).map((f) => f.ref)).toEqual(['#photos'])
  })
})

/** A model that answers whether a gesture is essential, per element, and keeps the prompts. */
function judge(answers: Record<string, 'essential' | 'invented' | 'fail'>): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:gestures',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      asked.push(request.user)
      const name = /Element: (.*)/.exec(request.user)?.[1] ?? ''
      const answer = Object.entries(answers).find(([label]) => name.includes(label))?.[1] ?? 'fail'
      const texts = request.user.split('Texts of the element and around it:\n')[1]?.split('\n') ?? []
      const quote = (texts.find((line) => /draw/i.test(line)) ?? '- ""').replace(/^- "|"$/g, '')
      const outputs: Record<string, Record<string, unknown>> = {
        essential: { verdict: 'pass', evidence: quote, confidence: 'high' },
        invented: { verdict: 'pass', evidence: 'Sign with your finger', confidence: 'high' },
        fail: { verdict: 'fail', evidence: '', confidence: 'high' },
      }
      return { output: request.schema.parse(outputs[answer]), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

describe('2.5.1 essential gestures: the model may only clear, quoting the page', () => {
  const photos = element('photos', 'div', 'region', 'Photos')
  const board = element('board', 'div', 'application', 'Board')
  const failing = (node: A11yNode, texts: string[]) => target(node, 'touch', { texts, effect: swiped, confirmed: true })
  const snapshot = snapshotOf([photos, board], [gesturesRecord([failing(photos, ['Photos']), failing(board, ['Board', 'Draw the route with your finger to plan the walk'])])])

  it('is asked only for failures, and only with judgment on', async () => {
    expect(gestureJudgments(snapshot)).toEqual([pointerGestures])
    expect(gestureJudgments(snapshotOf([], [gesturesRecord([])]))).toEqual([])
    const off = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(byRule(off, GESTURE).map((f) => f.ref)).toEqual(['#photos', '#board'])
  })

  it('clears a gesture the page shows to be essential, and keeps the rest', async () => {
    const model = judge({ Board: 'essential', Photos: 'fail' })
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ llm: true, provider: model }))
    expect(model.asked).toHaveLength(2)
    expect(model.asked[1]).toContain('Gesture: a swipe to the left')
    expect(byRule(report, GESTURE).map((f) => f.ref)).toEqual(['#photos'])
    expect(byRule(report, GESTURE)[0]?.evidence).toMatch(/the model did not find the gesture essential$/)
    expect(report.coverage.probes?.find((c) => c.rule === GESTURE)?.note).toContain('finding cleared by the model: the gesture is essential ("Draw the route with your finger to plan the walk")')
  })

  it('discards a quote the page does not show', async () => {
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ llm: true, provider: judge({ Board: 'invented' }) }))
    expect(report.discarded).toEqual([expect.objectContaining({ criterion: '2.5.1', reason: 'evidence is not text the page shows' })])
    expect(byRule(report, GESTURE).map((f) => f.ref)).toEqual(['#photos', '#board'])
  })
})

describe('2.5.4 over recorded facts', () => {
  const content: MotionEffect = { kind: 'content', detail: 'gone: "Rain jacket"', marks: ['li|removed'], gone: ['Rain jacket'], came: [] }
  const shook = { pattern: 'shake' as const, effect: content }
  const tries = [{ pattern: 'shake' as const, via: 'sensors' as const, events: { motion: 90, orientation: 1 }, effect: content }]
  const undo = { ...described(element('undo', 'button', 'button', 'Undo', { type: 'button' })), role: 'alternative' as const, why: 'named for "undo"', reproduced: true }
  const off = { ...described(element('shake', 'input', 'checkbox', 'Shake to undo', { type: 'checkbox' })), role: 'switch' as const, why: 'named for motion', stopped: true }
  const cases: Array<[string, Partial<DeviceMotionData>, string]> = [
    ['no listener', { listeners: [] }, 'none no-listener'],
    ['nothing reached', { tries: [{ pattern: 'shake', via: 'sensors', events: { motion: 0, orientation: 0 } }] }, 'review unreached'],
    ['nothing changed', { tries: [{ pattern: 'shake', via: 'sensors', events: { motion: 90, orientation: 0 } }] }, 'review nothing'],
    ['parallax', { effect: { pattern: 'tilt-sideways', effect: { kind: 'style', detail: '12 class or style change(s)', marks: [], gone: [], came: [] } } }, 'review style'],
    ['once', { tries, effect: shook, confirmed: false }, 'review once'],
    ['no control', { tries, effect: shook, confirmed: true }, 'failure no-alternative'],
    ['controls that differ', { tries, effect: shook, confirmed: true, controls: [{ ...undo, reproduced: false, did: 'text of <p>' }] }, 'review alternatives-differ'],
    ['no switch', { tries, effect: shook, confirmed: true, controls: [undo] }, 'failure no-switch'],
    ['a switch that did not stop it', { tries, effect: shook, confirmed: true, controls: [undo, { ...off, stopped: false }] }, 'review switch-unclear'],
    ['scrolling, no switch', { effect: { pattern: 'tilt-forward', effect: { kind: 'scroll', detail: 'scrolled the page by 0,120 px', marks: [], gone: [], came: [], scroll: { target: 'page', dx: 0, dy: 120, scrollable: true } } }, confirmed: true, scrolls: true }, 'failure no-switch'],
    ['both', { tries, effect: shook, confirmed: true, controls: [undo, off] }, 'pass pass'],
  ]

  it('fails a motion that operates something with no control, or with no switch, and reviews the rest', () => {
    for (const [, data, expected] of cases) {
      const listeners = data.listeners ?? [{ type: 'devicemotion', script: 'https://example.com/app.js', line: 12 }]
      const verdict = motionVerdict({ sensors: true, mentions: [], tries: [], controls: [], ...data, listeners })
      expect(`${verdict.result} ${verdict.why}`).toBe(expected)
    }
  })

  it('reports one item on the document, and says why in its message', async () => {
    const report = await checkSnapshot(snapshotOf([], [motionRecord({ tries, effect: shook, confirmed: true })]), emptyEngine(), probeCheckOptions())
    expect(byRule(report, MOTION).map((f) => `${f.ref} ${f.criterion} ${f.confidence}`)).toEqual(['html 2.5.4 medium'])
    expect(byRule(report, MOTION)[0]?.message).toMatch(/^Shaking the device changes the page \(gone: "Rain jacket"\), on two loads, and Rampa found no control on the page that does the same \(WCAG 2\.5\.4, ACT c249d5\)/)
    expect(byRule(report, MOTION)[0]?.evidence).toContain('listeners: devicemotion (example.com/…/app.js:12)')
    const noSwitch = await checkSnapshot(snapshotOf([], [motionRecord({ tries, effect: shook, confirmed: true, controls: [undo] })]), emptyEngine(), probeCheckOptions())
    expect(byRule(noSwitch, MOTION)[0]?.message).toContain('"Undo" does the same, but Rampa found no way on the page to turn the response to motion off (WCAG 2.5.4, ACT 7677a9)')
    const pass = await checkSnapshot(snapshotOf([], [motionRecord({ tries, effect: shook, confirmed: true, controls: [undo, off] })]), emptyEngine(), probeCheckOptions())
    expect([...byRule(pass, MOTION), ...reviewByRule(pass, MOTION)]).toEqual([])
    expect(pass.coverage.probes?.find((c) => c.criterion === '2.5.4')).toMatchObject({ status: 'no-failure-found', applicable: 1 })
    const none = await checkSnapshot(snapshotOf([], [motionRecord({ listeners: [] })]), emptyEngine(), probeCheckOptions())
    expect(none.coverage.probes?.find((c) => c.criterion === '2.5.4')).toMatchObject({ status: 'no-failure-found', applicable: 0 })
    const pt = await checkSnapshot(snapshotOf([], [motionRecord({ tries: [{ pattern: 'shake', via: 'sensors', events: { motion: 90, orientation: 0 } }] })]), emptyEngine(), probeCheckOptions({ locale: 'pt-BR' }))
    expect(reviewByRule(pt, MOTION)[0]?.message).toMatch(/^O 2\.5\.4 se aplica aqui: a página escuta o movimento do aparelho/)
  })

  it('takes over from the scope note once the device was moved on the page’s listeners', async () => {
    const motion = { listeners: [{ type: 'devicemotion', script: 'https://example.com/app.js', line: 12 }], mentions: [], leftOut: 0 }
    const root = { native: { tag: 'html', attributes: {}, motion } }
    const alone = await checkSnapshot(snapshotOf([], [], root), emptyEngine(), probeCheckOptions())
    expect(reviewByRule(alone, SCOPE)).toHaveLength(1)
    const probed = await checkSnapshot(snapshotOf([], [motionRecord({ tries: [{ pattern: 'shake', via: 'sensors', events: { motion: 90, orientation: 0 } }] })], root), emptyEngine(), probeCheckOptions())
    expect(reviewByRule(probed, SCOPE)).toEqual([])
    expect(reviewByRule(probed, MOTION)).toHaveLength(1)
    // A probe that found no listener on its load leaves the note in place.
    const missed = await checkSnapshot(snapshotOf([], [motionRecord({ listeners: [] })], root), emptyEngine(), probeCheckOptions())
    expect(reviewByRule(missed, SCOPE)).toHaveLength(1)
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the gestures probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
const servers = browser ? await startFixtureServers() : undefined
afterAll(async () => {
  await browser?.close()
  await servers?.close()
}, 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser || !servers) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, `${servers.origin}/${name}`, { runAxe: false, locale: 'en', probes: ['gestures'] })
    collected.set(name, result)
  }
  return result
}

const recordOf = (snapshot: A11ySnapshot, variant: string) => snapshot.observations?.probes.find((p) => p.kind === 'gestures' && p.conditions.variant === variant)
const targetsOf = (snapshot: A11ySnapshot) => (recordOf(snapshot, 'gestures')?.data as GesturesData).targets
const motionOf = (snapshot: A11ySnapshot) => recordOf(snapshot, 'device-motion')?.data as DeviceMotionData

describe.skipIf(!browser)('gestures probe (2.5.1, 2.5.4)', { timeout: 400_000 }, () => {
  it('swipes and pinches, and fails what no control does: a carousel, one that turns on its own, a picture that zooms', async () => {
    const { snapshot, engine } = await probed('gestures-fail.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(recordOf(snapshot, 'gestures')).toMatchObject({ kind: 'gestures', version: '1', status: 'complete' })
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, GESTURE).map((f) => f.ref)).toEqual(['#photos', '#news', '#chart'])
    expect(byRule(report, GESTURE)[0]?.evidence).toBe('a carousel with touch or pointer listeners; swipe-left: slide "Photo 1 of 4: the harbour at dawn" → "Photo 2 of 4: boats at noon"; no previous, next, dot or zoom control around it; again on a second fresh load')
    // The signature pad: drawing is essential, for a person.
    expect(reviewByRule(report, GESTURE).map((r) => r.ref)).toEqual(['#signature'])
    const targets = targetsOf(snapshot)
    expect(targets.find((t) => t.ref === '#news')?.autoplay).toBe(true)
    expect(targets.find((t) => t.ref === '#chart')?.effect).toMatchObject({ gesture: 'pinch-out', detail: 'content "Zoom: 100%" → "Zoom: 300%"' })
    // Nothing listens to motion here: the device-motion part loads nothing.
    expect(motionOf(snapshot)).toMatchObject({ listeners: [], end: 'no-listener', loads: 0 })
    expect(report.coverage.probes?.find((c) => c.criterion === '2.5.4')).toMatchObject({ status: 'no-failure-found', applicable: 0 })
  })

  it('finds the single-pointer way next to each gesture: next, a dot, zoom in, even on a carousel that turns', async () => {
    const { snapshot, engine } = await probed('gestures-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect([...byRule(report, GESTURE), ...reviewByRule(report, GESTURE)]).toEqual([])
    const found = targetsOf(snapshot).map((t) => `${t.ref} ${t.alternatives.find((a) => a.reproduced)?.label ?? 'none'}`)
    expect(found).toEqual(['#gallery Next photo', '#tour Go to slide 2', '#offers Next offer', '#map Zoom in'])
    expect(targetsOf(snapshot).find((t) => t.ref === '#map')?.effect?.detail).toBe('zoom 5 → 6')
    expect(report.coverage.probes?.find((c) => c.criterion === '2.5.1')).toMatchObject({ status: 'no-failure-found', applicable: 4 })
  })

  it('reports nothing for near misses: a strip the browser scrolls, touch listeners that only count; a control that does something else is for a person', async () => {
    const { snapshot, engine } = await probed('gestures-near.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, GESTURE)).toEqual([])
    expect(reviewByRule(report, GESTURE).map((r) => r.ref)).toEqual(['#quotes'])
    const targets = targetsOf(snapshot)
    expect(targets.filter((t) => !t.effect).map((t) => t.ref)).toEqual(['#strip', '#pad'])
    expect(targets.find((t) => t.ref === '#strip')?.tries[0]?.changed).toContain('scroll')
  })

  it('shakes the device, and fails an undo on shake that no control does', async () => {
    const { snapshot, engine } = await probed('gestures-motion-fail.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, MOTION).map((f) => f.criterion)).toEqual(['2.5.4'])
    expect(byRule(report, MOTION)[0]?.message).toContain('ACT c249d5')
    const data = motionOf(snapshot)
    expect(data.effect).toMatchObject({ pattern: 'shake', effect: { kind: 'content', gone: ['Rain jacket'] } })
    expect(data.confirmed).toBe(true)
    expect((data.tries[0]?.events.motion ?? 0) + (data.tries[0]?.events.orientation ?? 0)).toBeGreaterThan(0)
    // The scope note steps aside for the probe.
    expect(reviewByRule(report, SCOPE)).toEqual([])
  })

  it('finds the Undo button and the switch that turns shaking off', async () => {
    const { snapshot, engine } = await probed('gestures-motion-pass.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect([...byRule(report, MOTION), ...reviewByRule(report, MOTION)]).toEqual([])
    expect(motionOf(snapshot).controls.map((c) => `${c.ref} ${c.role} ${c.reproduced ?? c.stopped}`)).toEqual(['#undo alternative true', '#shake switch true'])
  })

  it('fails tilt to scroll with no way to turn it off; the browser’s scrolling stands in for a control', async () => {
    const { snapshot, engine } = await probed('gestures-motion-noswitch.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, MOTION)[0]?.message).toContain('ACT 7677a9')
    const data = motionOf(snapshot)
    expect(data.effect).toMatchObject({ pattern: 'tilt-forward', effect: { kind: 'scroll', scroll: { target: 'page', scrollable: true } } })
    expect(data.scrolls).toBe(true)
  })

  it('leaves a parallax that moves only styles to a person, never as a failure', async () => {
    const { snapshot, engine } = await probed('gestures-motion-near.html')
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions())
    expect(byRule(report, MOTION)).toEqual([])
    expect(reviewByRule(report, MOTION)[0]?.message).toContain('decorative motion (a parallax) operates nothing')
    expect(motionOf(snapshot).effect?.effect.kind).toBe('style')
  })

  it('replays a saved snapshot offline to the same findings', async () => {
    const { snapshot, engine } = await probed('gestures-fail.html')
    const live = await checkSnapshot(snapshot, engine, probeCheckOptions())
    const dir = await mkdtemp(join(tmpdir(), 'rampa-gestures-'))
    const path = join(dir, 'gestures.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'gestures.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replayed = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions())
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.evidence}`)
    expect(key(replayed)).toEqual(key(live))
    expect(replayed.coverage.probes).toEqual(live.coverage.probes)
  })
})
