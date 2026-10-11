import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import type { EngineResults, ReviewItem } from '../src/core/types.ts'
import { runRuleChecks } from '../src/rules/index.ts'
import { errorPreventionScopeRule, motionActuationScopeRule } from '../src/rules/scope.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { type MotionFacts, scanScript } from '../src/surfaces/motion.ts'
import { collectWeb } from '../src/surfaces/web.ts'
import { browserForTests } from './browser.ts'
import { node } from './helpers.ts'

const engine: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function snapshot(children: A11yNode[], motion?: MotionFacts): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://shop.test/checkout',
    title: 'Checkout',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-11T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', native: { tag: 'html', ...(motion ? { motion } : {}) }, children: [node({ ref: 'body', role: 'generic', native: { tag: 'body' }, children })] }),
  }
}

const field = (ref: string, name: string, attributes: Record<string, string>) => node({ ref, role: 'textbox', name, native: { tag: 'input', attributes } })
const button = (ref: string, name: string) => node({ ref, role: 'button', name, text: name, native: { tag: 'button' } })
const form = (ref: string, children: A11yNode[]) => node({ ref, role: 'form', native: { tag: 'form', attributes: { action: '/x', method: 'post' } }, children })

const review = (items: readonly ReviewItem[] | undefined, ruleId: string) => (items ?? []).filter((item) => item.ruleId === ruleId)

describe('3.3.4 applies here', () => {
  it('lists payment fields, the buttons that commit and what the page shows of a review, per form', () => {
    const page = snapshot([
      node({ ref: 'h2', role: 'heading', name: 'Review your order', text: 'Review your order', native: { tag: 'h2' } }),
      form('#pay', [
        field('#card', 'Card number', { autocomplete: 'cc-number', name: 'card' }),
        field('#cvv', 'CVV', { name: 'cvv' }),
        node({ ref: '#ok', role: 'checkbox', name: 'I have read the terms of sale', native: { tag: 'input', attributes: { type: 'checkbox' } } }),
        button('#pay > button', 'Pay R$ 49,90'),
      ]),
      form('#danger', [button('#danger > button', 'Delete my account')]),
      form('#sign', [button('#sign > button', 'Accept the contract')]),
      form('#give', [button('#give > card', 'Donate by credit/debit card Visa Mastercard American Express .st0 { fill:#0071ce }'), button('#give > wallet', 'Apple Pay'), button('#give > monthly', 'Doar mensalmente')]),
    ])
    const run = errorPreventionScopeRule.run(page, engine, { locale: 'en', index: new Map() as never })
    expect(run.applicable).toBe(4)
    expect(run.hits.map((hit) => [hit.ref, hit.facts.kinds, hit.evidence])).toEqual([
      ['#pay', 'financial,payment', 'cc-number, cvv, “Pay R$ 49,90”'],
      ['#danger', 'data', '“Delete my account”'],
      ['#sign', 'legal', '“Accept the contract”'],
      ['#give', 'financial', '“Donate by credit/debit card Visa Mastercard American Expres…”, “Apple Pay”, “Doar mensalmente”'],
    ])
    const pay = run.hits[0] as (typeof run.hits)[number]
    expect(errorPreventionScopeRule.message(pay, 'en')).toBe(
      '3.3.4 applies here: payment fields (cc-number, cvv); a control that buys, pays or transfers: “Pay R$ 49,90”. Check that the submission can be reversed, that the data entered is checked for input errors and can be corrected, or that a step lets the person review, confirm and correct it before it is final (WCAG 3.3.4). Rampa submits nothing, so it cannot tell. Seen on this page: a checkbox “I have read the terms of sale”; a review step (“review your order”).',
    )
    expect(errorPreventionScopeRule.message(run.hits[1] as (typeof run.hits)[number], 'pt-BR')).toContain('O 3.3.4 se aplica aqui: um controle que exclui dados: “Delete my account”.')
  })

  it('leaves out a cookie banner, a newsletter, a cart button and a page with nothing to commit', () => {
    const page = snapshot([
      button('#cookie-ok', 'Accept all'),
      button('#cookie-agree', 'I agree'),
      form('#news', [field('#mail', 'E-mail', { autocomplete: 'email' }), button('#news > button', 'Subscribe')]),
      form('#cart', [button('#cart > button', 'Add to cart')]),
      button('#filter', 'Remove filter'),
      // Words that start like paying and are something else.
      button('#plans', 'Pay attention to this'),
      button('#gift', 'Give feedback'),
    ])
    expect(errorPreventionScopeRule.run(page, engine, { locale: 'en', index: new Map() as never })).toEqual({ hits: [], applicable: 0 })
    // A rule for one kind of content: on a page with none, it is not listed, and 3.3.4 stays not checked.
    const stage = runRuleChecks(page, engine, 'en', [errorPreventionScopeRule])
    expect(stage.ran).toEqual([])
  })
})

describe('2.5.4 applies here', () => {
  it('finds the calls that use motion in a script, and not feature detection', () => {
    const code = `var a=1;window.addEventListener("devicemotion",function(e){tilt(e)});x.ondeviceorientation = f;
      if (typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission();
      const s = new Gyroscope({ frequency: 60 }); var ok = 'ondevicemotion' in window; if (w.ondevicemotion === null) {}`
    expect(scanScript(code, 'https://cdn.test/app.js').map((mention) => [mention.api, mention.name])).toEqual([
      ['addEventListener', 'devicemotion'],
      ['handler', 'deviceorientation'],
      ['requestPermission', 'DeviceOrientationEvent'],
      ['sensor', 'Gyroscope'],
    ])
  })

  it('says 2.5.4 applies when the page listens, and may apply when only its scripts use motion', () => {
    const listens = snapshot([], { listeners: [{ type: 'devicemotion', script: 'https://shop.test/js/level.js', line: 12 }], mentions: [], leftOut: 0 })
    const [hit] = motionActuationScopeRule.run(listens, engine, { locale: 'en', index: new Map() as never }).hits
    expect(hit).toMatchObject({ ref: 'html', outcome: 'review', subject: 'listeners:devicemotion', evidence: 'devicemotion (shop.test/…/level.js:12)' })
    expect(motionActuationScopeRule.message(hit as NonNullable<typeof hit>, 'en')).toBe(
      "2.5.4 applies here: the page listens to the device's motion (devicemotion (shop.test/…/level.js:12)). Check that whatever is done by moving or tilting the device can also be done with a control on the screen, and that responding to motion can be turned off to avoid accidental actuation, unless the motion is essential or goes through an accessibility-supported interface (WCAG 2.5.4). If the script only collects data (analytics, fraud checks) and nothing on the page responds to motion, 2.5.4 does not apply.",
    )
    const later = snapshot([], { listeners: [], mentions: [{ api: 'requestPermission', name: 'DeviceMotionEvent', script: '', quote: 'DeviceMotionEvent.requestPermission()' }], leftOut: 0 })
    const [maybe] = motionActuationScopeRule.run(later, engine, { locale: 'en', index: new Map() as never }).hits
    expect(motionActuationScopeRule.message(maybe as NonNullable<typeof maybe>, 'en')).toContain('2.5.4 may apply here: the page\'s scripts use the device\'s motion, perhaps after a tap (DeviceMotionEvent.requestPermission() (inline)).')
    // No record (another surface, an older snapshot), or nothing found: the rule says nothing.
    expect(motionActuationScopeRule.run(snapshot([]), engine, { locale: 'en', index: new Map() as never })).toEqual({ hits: [], applicable: 0 })
  })
})

const browser = await browserForTests('the scope notes tests')
afterAll(async () => {
  await browser?.close()
})

const options = (): CheckOptions => ({
  criteria: [],
  llm: false,
  provider: undefined,
  runs: 1,
  cache: memoryCache(),
  offline: false,
  locale: 'en',
  minConfidence: 'medium',
  concurrency: 1,
})
const fixture = (name: string) => pathToFileURL(resolve('test/fixtures/rules', name)).href

describe.skipIf(!browser)('scope notes on real pages', { timeout: 60_000 }, () => {
  const check = async (name: string) => {
    if (!browser) throw new Error('no browser')
    const { snapshot: collected, engine: results } = await collectWeb(browser, fixture(name), { runAxe: true, locale: 'en' })
    return { snapshot: collected, report: await checkSnapshot(collected, results, options()) }
  }

  it('notes 3.3.4 and 2.5.4 on a checkout that listens to motion, never as failures', async () => {
    const { snapshot: page, report } = await check('scope-applies.html')
    const motion = page.root.native.motion as MotionFacts
    expect(motion.listeners).toEqual([expect.objectContaining({ type: 'devicemotion', script: fixture('scope-applies.html') })])
    const legal = review(report.needsReview, 'rampa/error-prevention-scope')
    expect(legal.map((item) => [item.criterion, item.ref])).toEqual([
      ['3.3.4', '#checkout'],
      ['3.3.4', '#settings'],
      ['3.3.4', '#quiz'],
    ])
    expect(legal[0]?.message).toContain('payment fields (cc-number, cc-exp, cc-csc); a control that buys, pays or transfers: “Place order”')
    expect(legal[0]?.message).toContain('Seen on this page: a checkbox “I have reviewed my order”; a review step (“order summary”); a word about reversing it (“cancel within”).')
    expect(legal[2]?.message).toContain('a control that hands in test answers: “Submit answers”')
    const [moves] = review(report.needsReview, 'rampa/motion-actuation-scope')
    expect(moves?.criterion).toBe('2.5.4')
    expect(moves?.message).toContain("2.5.4 applies here: the page listens to the device's motion (devicemotion (")
    expect(report.findings.filter((finding) => ['3.3.4', '2.5.4'].includes(finding.criterion))).toEqual([])
    expect(report.belowThreshold.filter((finding) => ['3.3.4', '2.5.4'].includes(finding.criterion))).toEqual([])
    const status = (id: string) => report.coverage.criteria?.find((record) => record.id === id)?.status
    expect(status('3.3.4')).toBe('needs-review')
    expect(status('2.5.4')).toBe('needs-review')
    expect(report.coverage.notChecked).not.toContain('3.3.4')
  })

  it('finds motion a script asks for only after a tap', async () => {
    const { snapshot: page, report } = await check('scope-motion-tap.html')
    const motion = page.root.native.motion as MotionFacts
    expect(motion.listeners).toEqual([])
    expect(motion.mentions.map((mention) => [mention.api, mention.name])).toEqual([
      ['addEventListener', 'devicemotion'],
      ['requestPermission', 'DeviceMotionEvent'],
    ])
    expect(review(report.needsReview, 'rampa/motion-actuation-scope')[0]?.message).toContain('2.5.4 may apply here')
  })

  it('says nothing about a cookie banner, a newsletter, a cart or feature detection', async () => {
    const { snapshot: page, report } = await check('scope-controls.html')
    expect((page.root.native.motion as MotionFacts).listeners).toEqual([])
    expect((page.root.native.motion as MotionFacts).mentions).toEqual([])
    expect([...review(report.needsReview, 'rampa/error-prevention-scope'), ...review(report.needsReview, 'rampa/motion-actuation-scope')]).toEqual([])
    const status = (id: string) => report.coverage.criteria?.find((record) => record.id === id)?.status
    expect(status('3.3.4')).toBe('not-checked')
    expect(status('2.5.4')).toBe('not-checked')
  })
})
