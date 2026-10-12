import type { Browser, Page, Route } from 'playwright-core'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ControlFacts, Harness, type HarnessAction, type SkipReason, skipReason } from './activate.ts'
import type { InPageElement, Kit } from './kit.ts'
import { type ProbeOptions, type ProbePage, skippedRecord } from './page.ts'

/**
 * Timing Adjustable (2.2.1), item C10 of docs/plans/wcag-coverage.md, with the motion probe (`--probe motion`). A
 * time limit set by the content must be one the person can turn off, adjust or extend (with a warning, at least 20 s
 * and a simple action), unless an exception applies. The probe looks for time limits the page enforces by itself
 * while nobody touches it: Playwright's fake clock jumps the page's time forward (timers due fire once per jump, as
 * when a laptop wakes up) through checkpoints up to 20 hours, and at each one the probe records what the page did:
 *
 * - a navigation, a reload, a form submitted, a window opened (all intercepted, never followed), the address changed
 *   in place, or most of its text replaced: the time limit's consequence;
 * - a warning: a dialog or layer, an alert, a browser dialog or new text that speaks of the session or the time, with
 *   the controls in it;
 * - blocks of text that went away and did not come back (a message that disappears).
 *
 * When something happened, a second fresh load jumps to just before it and moves in steps of 5 s or more, to time the
 * warning and the consequence; when the warning has a control named to extend ("Stay signed in", "Continuar"), a third
 * load presses it once the warning shows and checks whether the consequence still comes. A meta refresh, which the
 * browser times in real time, is axe-core's. While time jumps, the page may make at most 40 GET requests (polling,
 * analytics); later ones are refused, counted, and what follows them is never failed. The rule (rules/time-limits.ts)
 * decides; a model may only clear a failure for an exception (criteria/timing-adjustable.ts).
 */

export const TIME_LIMITS_VERSION = '1'
export const TIME_LIMITS_VARIANT = 'time-limits'
const M = 60_000
const H = 60 * M
/** The page's time at each check, in ms. Past 20 hours a time limit is an exception. */
export const CHECKPOINTS_MS: readonly number[] = [
  10_000, 30_000, M, 2 * M, 3 * M, 5 * M, 7 * M, 10 * M, 12 * M, 15 * M, 18 * M, 20 * M, 25 * M, 28 * M, 30 * M, 40 * M, 50 * M, H, 75 * M, 90 * M, 2 * H, 3 * H, 4 * H,
  6 * H, 8 * H, 10 * H, 12 * H, 16 * H, 20 * H,
]
export const TWENTY_HOURS_MS = 20 * H
const TIME_BUDGET_MS = 60_000
/** GET requests the page may make while its time jumps, after it loaded. */
export const REQUEST_BUDGET = 40
const MIN_STEP_MS = 5000
const MAX_STEPS = 60
/** After a jump, a moment of the page's time for frames and the renders a timer asked for. */
const FLUSH_MS = 50
/** Controls of a warning the probe never presses: they end the session rather than keep it. */
const SIGN_OUT = /sign ?out|log ?out|log ?off|sair|encerrar|desconectar|cerrar sesi|salir|end session|terminar/i

export interface TimeControl {
  el: InPageElement
  name: string
  /** Named to extend the time: "Continue", "Stay signed in", "Mais tempo". */
  extend: boolean
  skip?: { reason: SkipReason; detail?: string | undefined } | undefined
}

export interface TimeEvent {
  kind: 'navigation' | 'reload' | 'submit' | 'window' | 'address' | 'content' | 'removed' | 'meta'
  /** The page's time when it was seen, and the last check before it: it happened in between. */
  at: number
  from: number
  url?: string | undefined
  /** What went (a block's text, the share of the text replaced), cut to 200 characters. */
  text?: string | undefined
  el?: InPageElement | undefined
  /** Requests refused (by the guard, or past the probe's budget) since the check before: the page may have needed them. */
  blocked: number
}

export interface TimeWarning {
  at: number
  from: number
  kind: 'layer' | 'alert' | 'dialog' | 'text'
  text: string
  el?: InPageElement | undefined
  controls: TimeControl[]
}

export interface TimeExtension {
  /** The control pressed, and whether its name says it extends the time. */
  control: { el: InPageElement; name: string; extend?: boolean | undefined }
  /** navigated: the press itself started a navigation (intercepted), which may be how the page renews the session. */
  outcome: 'extended' | 'not-extended' | 'navigated' | 'not-exercised' | 'unmatched'
  reason?: string | undefined
  /** When the press was made, and when the consequence came after it, if it did (the page's time). */
  pressedAt?: number | undefined
  eventAt?: number | undefined
  /** How long the probe waited for it: past the time it came without the press. */
  watchedTo?: number | undefined
  blocked: number
}

export interface TimeData {
  viewport: { width: number; height: number }
  /** The checks of the first load, as far as it went. */
  checkpoints: number[]
  reachedMs: number
  /** A meta refresh in the page: the browser times it in real time, and axe-core reports it. */
  meta?: string | undefined
  events: TimeEvent[]
  warnings: TimeWarning[]
  /** The second load: from the check before the first event (or warning) to past it, in steps. */
  refine?: { from: number; to: number; stepMs: number; eventAt?: number | undefined; eventKind?: TimeEvent['kind'] | undefined; warningAt?: number | undefined; confirmed: boolean } | undefined
  extension?: TimeExtension | undefined
  /** Countdowns and timers shown on load (role=timer, "mm:ss", "N minutes left"), and sentences about time limits. */
  countdowns: string[]
  notices: string[]
  requests: { allowed: number; blocked: number }
  loads: number
  actions: HarnessAction[]
  end: 'complete' | 'time'
}

interface Check {
  nav: Array<{ url: string; type: string; same: boolean; meta: boolean }>
  hooks: Array<{ type: string; detail?: string | undefined }>
  layers: Array<{ el: InPageElement; text: string; timed: boolean; controls: Array<{ el: InPageElement; name: string; extend: boolean; facts: ControlFacts }> }>
  alerts: string[]
  timedText: string[]
  removed: Array<{ el: InPageElement; text: string }>
  back: string[]
  /** Share of the page's text replaced since load (0 to 1), and how much there was. */
  replaced: number
  total: number
  url: string
}

interface TimeKit {
  start(exclude: string[]): { countdowns: string[]; notices: string[]; meta?: string | undefined }
  check(): Check
  find(ref: string): boolean
}

/** Installs `window.__rampaTime`; needs the kit and the harness's activate hooks. Serialized: self-contained. */
export function installTimeKit(): void {
  const w = window as unknown as { __rampaKit: Kit; __rampaTime?: TimeKit; __rampaNav?: Array<{ url: string; type: string; same: boolean }>; __rampaActivate?: { facts(el: Element): ControlFacts } }
  if (w.__rampaTime) return
  const kit = w.__rampaKit
  const collapse = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const cut = (value: string, n: number) => (value.length > n ? `${value.slice(0, n - 1)}…` : value)
  const plain = (text: string) =>
    ` ${text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}:]+/gu, ' ')
      .trim()} `
  const TIMED =
    /(session|sessao|sesion|expir|time ?out|timed|inactiv|idle|logged out|log out|signed out|sign out|still there|are you there|more time|mais tempo|mas tiempo|desconectad|desconect|ainda esta ai|sigue ahi|tempo esgotado|tiempo agotado|time is up|time limit|time allowed|tempo limite|limite de tempo|tiempo limite|cronometr|minutes? (left|remaining)|seconds? (left|remaining)|restam|restantes|quedan|countdown|(you have|voce tem|tiene|tienes) \d+ (minutes?|hours?|seconds?|minutos?|horas?|segundos?))/
  const EXTEND =
    /\b(continue|continuar|stay|keep|extend|more time|still here|i m here|yes|sim|si|renew|renovar|prorrogar|estender|ampliar|manter|mantener|seguir|refresh|reset|reiniciar|i need more time|preciso de mais tempo|necesito mas tiempo)\b/
  const COUNTDOWN = /(\b\d{1,2}:\d{2}\b|\b\d+\s*(minutes?|minutos?|seconds?|segundos?|min|s)\s*(left|remaining|restantes?|para|until|ate|hasta)\b)/i
  const shown = (el: Element): boolean => kit.visible(el) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
  const cover = (el: Element): number => {
    const r = el.getBoundingClientRect()
    const width = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0))
    const height = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))
    return (width * height) / Math.max(1, window.innerWidth * window.innerHeight)
  }
  const DIALOG = 'dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]'
  const layers = (): Element[] => {
    const found = new Set<Element>()
    for (const el of Array.from(document.querySelectorAll(DIALOG))) if (shown(el)) found.add(el)
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT)
    for (let n = walker.nextNode(), i = 0; n && i < 20_000; n = walker.nextNode(), i++) {
      const el = n as HTMLElement
      if (el.offsetParent !== null) continue
      const style = getComputedStyle(el)
      if ((style.position === 'fixed' || style.position === 'sticky') && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && cover(el) >= 0.05) found.add(el)
    }
    return [...found]
  }
  const nameOf = (el: Element): string => {
    const labelled = collapse(
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
    const value = el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type) ? el.value : ''
    return cut(collapse(el.getAttribute('aria-label')) || labelled || value || collapse((el as HTMLElement).innerText ?? el.textContent) || collapse(el.getAttribute('title')), 80)
  }
  const CONTROL = 'button, input[type=button], input[type=submit], a[href], [role=button], [role=link]'
  const controlsIn = (el: Element) =>
    Array.from(el.querySelectorAll(CONTROL))
      .filter(shown)
      .slice(0, 8)
      .map((c) => {
        const name = nameOf(c)
        return { el: kit.describe(c), name, extend: EXTEND.test(plain(name)), facts: w.__rampaActivate?.facts(c) ?? { texts: [name], code: [], disabled: false, submit: false, sensitiveForm: false, download: false } }
      })
  const lines = (): string[] =>
    (document.body?.innerText ?? '')
      .slice(0, 200_000)
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').replace(/\d/g, '0').trim())
      .filter(Boolean)
  let excluded: Element[] = []
  let blocks = new Map<Element, { text: string; gone: boolean; el: InPageElement }>()
  let startLines: string[] = []
  let knownLayers = new Set<Element>()
  let knownAlerts = new Set<string>()
  let knownText = new Set<string>()
  let navSeen = 0
  let meta: { seconds: number; url: string } | undefined
  const timedSentences = (): string[] => {
    const out: string[] = []
    for (const line of (document.body?.innerText ?? '').slice(0, 200_000).split(/\n|(?<=[.!?])\s+/)) {
      const text = collapse(line)
      if (text.length >= 8 && text.length <= 300 && TIMED.test(plain(text))) out.push(text)
      if (out.length >= 30) break
    }
    return out
  }
  // A countdown that ticks is the same sentence: digits masked.
  const sentenceKey = (text: string) => text.replace(/\d/g, '0')
  const start: TimeKit['start'] = (exclude) => {
    excluded = exclude.map((ref) => kit.resolve(ref)).filter((el): el is Element => el !== null)
    blocks = new Map()
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node && blocks.size < 1500; node = walker.nextNode()) {
      const el = node.parentElement
      if (!el || blocks.has(el) || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue
      if (excluded.some((x) => x.contains(el))) continue
      const text = collapse((el as HTMLElement).innerText ?? el.textContent)
      if (text.length >= 15 && shown(el)) blocks.set(el, { text, gone: false, el: kit.describe(el) })
    }
    startLines = lines()
    knownLayers = new Set(layers())
    knownAlerts = new Set(Array.from(document.querySelectorAll('[role=alert], [role=status], [aria-live]')).map((el) => collapse(el.textContent)))
    const sentences = timedSentences()
    knownText = new Set(sentences.map(sentenceKey))
    navSeen = w.__rampaNav?.length ?? 0
    kit.drain()
    const refresh = document.querySelector('meta[http-equiv="refresh" i]')
    const content = refresh?.getAttribute('content') ?? ''
    const m = /^\s*(\d+)\s*(?:[;,]\s*(?:url\s*=\s*)?['"]?([^'"]*)['"]?)?/i.exec(content)
    meta = m ? { seconds: Number(m[1]), url: m[2] ? new URL(m[2], document.baseURI).href : location.href } : undefined
    const countdowns: string[] = []
    for (const el of Array.from(document.querySelectorAll('[role=timer], time, [class*=countdown i], [id*=countdown i], [class*=timer i], [id*=timer i]'))) {
      const text = collapse((el as HTMLElement).innerText ?? el.textContent)
      if (text && shown(el)) countdowns.push(cut(text, 120))
      if (countdowns.length >= 5) break
    }
    for (const line of (document.body?.innerText ?? '').slice(0, 100_000).split('\n')) {
      if (countdowns.length >= 8) break
      const text = collapse(line)
      if (text.length <= 160 && COUNTDOWN.test(text) && !countdowns.includes(cut(text, 120))) countdowns.push(cut(text, 120))
    }
    return { countdowns, notices: sentences.slice(0, 12).map((t) => cut(t, 200)), ...(content ? { meta: cut(content, 200) } : {}) }
  }
  const check: TimeKit['check'] = () => {
    const navs = (w.__rampaNav ?? []).slice(navSeen)
    navSeen = w.__rampaNav?.length ?? 0
    const nav = navs.map((n) => ({
      url: n.url,
      type: n.type,
      same: n.same,
      // The browser's own refresh, timed in real time: axe-core's meta-refresh reports it.
      meta: !!meta && meta.seconds > 0 && (n.type === 'reload' || n.url.replace(/#.*$/, '') === meta.url.replace(/#.*$/, '')),
    }))
    const hooks = kit.drain().filter((e) => e.type === 'submit' || e.type === 'open' || e.type === 'modal' || e.type === 'history').map((e) => ({ type: e.type, ...(e.detail ? { detail: e.detail } : {}) }))
    const now = layers()
    const fresh = now.filter((el) => !knownLayers.has(el) && ![...knownLayers].some((old) => old.contains(el)))
    for (const el of now) knownLayers.add(el)
    const out: Check['layers'] = fresh.slice(0, 4).map((el) => {
      const text = cut(collapse((el as HTMLElement).innerText ?? el.textContent), 300)
      return { el: kit.describe(el), text, timed: TIMED.test(plain(text)), controls: controlsIn(el) }
    })
    const alerts: string[] = []
    for (const el of Array.from(document.querySelectorAll('[role=alert], [role=status], [aria-live]'))) {
      const text = collapse(el.textContent)
      if (!text || knownAlerts.has(text)) continue
      knownAlerts.add(text)
      if (TIMED.test(plain(text)) && shown(el)) alerts.push(cut(text, 300))
    }
    const timedText: string[] = []
    for (const sentence of timedSentences()) {
      if (knownText.has(sentenceKey(sentence))) continue
      knownText.add(sentenceKey(sentence))
      timedText.push(cut(sentence, 300))
    }
    const removed: Check['removed'] = []
    const back: string[] = []
    for (const [el, block] of blocks) {
      const present = el.isConnected && shown(el)
      if (!present && !block.gone) {
        block.gone = true
        if (removed.length < 6) removed.push({ el: block.el, text: cut(block.text, 200) })
      } else if (present && block.gone) {
        block.gone = false
        back.push(block.el.ref)
      }
    }
    // Lines of text that went or came, as a multiset (digits masked: a clock is no new text).
    const before = new Map<string, number>()
    let total = 0
    for (const line of startLines) {
      before.set(line, (before.get(line) ?? 0) + 1)
      total += line.length
    }
    let changed = 0
    for (const line of lines()) {
      const left = before.get(line) ?? 0
      if (left > 0) before.set(line, left - 1)
      else changed += line.length
    }
    for (const [line, left] of before) changed += line.length * left
    return { nav, hooks, layers: out, alerts, timedText, removed, back, replaced: total > 0 ? Math.min(1, changed / (2 * total)) : 0, total, url: location.href }
  }
  const find: TimeKit['find'] = (ref) => kit.resolve(ref) !== null
  w.__rampaTime = { start, check, find }
}

const time = (page: Page) => ({
  start: (exclude: string[]) => page.evaluate((x) => (window as unknown as { __rampaTime: TimeKit }).__rampaTime.start(x), exclude),
  check: () => page.evaluate(() => (window as unknown as { __rampaTime: TimeKit }).__rampaTime.check()),
})

/** The probe's request budget, per page: GET requests after the page loaded, and those refused past it. */
interface Budget {
  armed: boolean
  allowed: number
  blocked: number
}
const budgets = new WeakMap<Page, Budget>()

async function installBudget(page: Page): Promise<void> {
  const budget: Budget = { armed: false, allowed: 0, blocked: 0 }
  budgets.set(page, budget)
  // Page routes run before the context's, where the network guard is: past the budget a request is refused here.
  await page.route('**/*', async (route: Route) => {
    try {
      if (budget.armed && !route.request().isNavigationRequest()) {
        if (budget.allowed >= REQUEST_BUDGET) {
          budget.blocked++
          return await route.abort('blockedbyclient')
        }
        budget.allowed++
      }
      return await route.fallback()
    } catch {
      // The page closed while the request was in flight.
    }
  })
}

const refused = (probe: ProbePage) => probe.guard.log.blocked.filter((b) => b.type !== 'ping').length + (budgets.get(probe.page)?.blocked ?? 0)

async function pause(page: Page): Promise<void> {
  const pageNow = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(pageNow + 1000).catch(() => page.clock.pauseAt(Date.now() + 5000))
}

/** Jumps the page's time to `to` (ms since the pause), firing what is due once, then lets frames and renders run. */
async function jump(page: Page, from: number, to: number): Promise<void> {
  const step = to - from
  if (step <= 0) return
  if (step > FLUSH_MS) await page.clock.fastForward(step - FLUSH_MS)
  await page.clock.runFor(Math.min(step, FLUSH_MS))
  // A render a timer asked for (React, Vue) runs in its own task.
  await page.waitForTimeout(30)
}

interface Seen {
  events: TimeEvent[]
  warnings: TimeWarning[]
  /** A consequence that ends the page as it was: a navigation, a reload, a submission, the address changed, the text replaced. */
  terminal?: TimeEvent | undefined
}

/** Reads one check into events and warnings: what the page did between `from` and `at`. */
function read(check: Check, from: number, at: number, blocked: number, guardDialogs: string[], origin: string, startUrl: string): Seen {
  const events: TimeEvent[] = []
  const warnings: TimeWarning[] = []
  const bare = (u: string) => u.replace(/#.*$/, '')
  for (const n of check.nav) {
    if (n.meta) events.push({ kind: 'meta', at, from, url: n.url.slice(0, 300), blocked })
    else if (!n.same) events.push({ kind: n.type === 'reload' ? 'reload' : 'navigation', at, from, url: n.url.slice(0, 300), blocked })
    // An address set in place (pushState); a fragment alone (a carousel's #slide-2) is no consequence.
    else if (bare(n.url) !== bare(startUrl)) events.push({ kind: 'address', at, from, url: n.url.slice(0, 300), blocked })
  }
  for (const hook of check.hooks) {
    if (hook.type === 'submit') events.push({ kind: 'submit', at, from, ...(hook.detail ? { url: hook.detail.slice(0, 300) } : {}), blocked })
    if (hook.type === 'open') events.push({ kind: 'window', at, from, ...(hook.detail ? { url: hook.detail.slice(0, 300) } : {}), blocked })
  }
  if (check.replaced >= 0.5 && check.total >= 200) events.push({ kind: 'content', at, from, text: `${Math.round(check.replaced * 100)}% of the text replaced`, blocked })
  for (const removed of check.removed) events.push({ kind: 'removed', at, from, el: removed.el, text: removed.text, blocked })
  for (const layer of check.layers) {
    if (!layer.timed) continue
    warnings.push({ at, from, kind: 'layer', text: layer.text, el: layer.el, controls: layer.controls.map(({ facts, ...c }) => ({ ...c, ...withSkip(facts, origin, c.name, layer.text) })) })
  }
  for (const text of check.alerts) warnings.push({ at, from, kind: 'alert', text, controls: [] })
  for (const message of guardDialogs) warnings.push({ at, from, kind: 'dialog', text: message.slice(0, 300), controls: [] })
  if (warnings.length === 0) for (const text of check.timedText.slice(0, 2)) warnings.push({ at, from, kind: 'text', text, controls: [] })
  // An address set in place counts when most of the text went with it, which the 'content' event says.
  const terminal = events.find((e) => e.kind === 'navigation' || e.kind === 'reload' || e.kind === 'submit' || e.kind === 'content')
  return { events, warnings, ...(terminal ? { terminal } : {}) }
}

/**
 * The skip list, as for every activate-class press; a control in a warning about the session may say "Renovar
 * sessão" or "Confirm" for what only keeps the person signed in.
 */
function withSkip(facts: ControlFacts, origin: string, name: string, warning: string): { skip?: TimeControl['skip'] } {
  const skip = skipReason(facts, origin)
  if (skip?.reason === 'destructive' && /session|sess[aã]o|sesi[oó]n|time|tempo|tiempo|signed in|conectad/i.test(`${name} ${warning}`) && !/sign out|log ?out|sair|cerrar sesi|encerrar/i.test(name)) return {}
  return skip ? { skip } : {}
}

/** One load's walk through time: checks from `from` to `to` every `step`, or at the given checkpoints. */
async function walk(probe: ProbePage, schedule: number[], deadline: number, origin: string, stopAtTerminal: boolean): Promise<Seen & { reached: number; timedOut: boolean; checked: number[] }> {
  const page = probe.page
  const kit = time(page)
  const out: Seen & { reached: number; timedOut: boolean; checked: number[] } = { events: [], warnings: [], reached: 0, timedOut: false, checked: [] }
  const startUrl = page.url()
  const back = new Set<string>()
  let now = 0
  let blockedBefore = refused(probe)
  let dialogsBefore = probe.guard.log.dialogs.length
  for (const at of schedule) {
    if (Date.now() > deadline) {
      out.timedOut = true
      break
    }
    await jump(page, now, at)
    const from = now
    now = at
    const check = await kit.check().catch(() => undefined)
    if (!check) break
    const blocked = refused(probe) - blockedBefore
    blockedBefore = refused(probe)
    const dialogs = probe.guard.log.dialogs.slice(dialogsBefore).map((d) => `${d.type}: ${d.message}`)
    dialogsBefore = probe.guard.log.dialogs.length
    const seen = read(check, from, at, blocked, dialogs, origin, startUrl)
    for (const ref of check.back) back.add(ref)
    out.events.push(...seen.events)
    // New sentences about time (a countdown's own text) are kept for the model, a few at most.
    for (const warning of seen.warnings) if (warning.kind !== 'text' || out.warnings.filter((x) => x.kind === 'text').length < 3) out.warnings.push(warning)
    out.checked.push(at)
    out.reached = at
    if (seen.terminal && !out.terminal) {
      out.terminal = seen.terminal
      if (stopAtTerminal) break
    }
  }
  // Blocks that came back were cycling (a carousel, a rotating banner), not removed.
  out.events = out.events.filter((e) => e.kind !== 'removed' || !back.has(e.el?.ref ?? ''))
  return out
}

async function freshPage(harness: Harness, exclude: string[]): Promise<{ probe: ProbePage; start: Awaited<ReturnType<TimeKit['start']>> }> {
  const probe = await harness.page(true)
  await probe.page.evaluate(installTimeKit)
  const start = await time(probe.page).start(exclude)
  await pause(probe.page)
  const budget = budgets.get(probe.page)
  if (budget) budget.armed = true
  return { probe, start }
}

export async function runTimeLimitsProbe(browser: Browser, url: string, options: ProbeOptions, exclude: readonly string[] = []): Promise<ProbeRecord> {
  const started = Date.now()
  const deadline = started + TIME_BUDGET_MS
  const harness = new Harness(browser, url, options, {
    kind: 'motion',
    version: TIME_LIMITS_VERSION,
    variant: TIME_LIMITS_VARIANT,
    limits: { controls: 2, timeMs: TIME_BUDGET_MS },
    page: { clock: true, beforeLoad: (page) => installBudget(page) },
  })
  const refs = [...exclude]
  let data: TimeData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await freshPage(harness, refs)
    conditions = first.probe.conditions
    const viewport = first.probe.page.viewportSize() ?? first.probe.conditions.viewport
    const coarse = await walk(first.probe, [...CHECKPOINTS_MS], deadline, harness.origin, true)
    const events = coarse.events
    data = {
      viewport,
      checkpoints: coarse.checked,
      reachedMs: coarse.reached,
      ...(first.start.meta ? { meta: first.start.meta } : {}),
      events,
      warnings: coarse.warnings,
      countdowns: first.start.countdowns,
      notices: first.start.notices,
      requests: { allowed: budgets.get(first.probe.page)?.allowed ?? 0, blocked: budgets.get(first.probe.page)?.blocked ?? 0 },
      loads: 0,
      actions: [],
      end: coarse.timedOut ? 'time' : 'complete',
    }
    // The second load: from the check before the first warning or consequence, in steps, to time them.
    const firstWarning = coarse.warnings.find((w) => w.kind !== 'text')
    const target = coarse.terminal ?? firstWarning
    if (target && Date.now() < deadline - 5000) {
      const until = coarse.terminal ? coarse.terminal.at : Math.min(TWENTY_HOURS_MS, (firstWarning?.at ?? 0) + 30 * M)
      const from = Math.min(firstWarning?.from ?? target.from, target.from)
      const stepMs = Math.max(MIN_STEP_MS, Math.ceil((until - from) / MAX_STEPS / 1000) * 1000)
      const schedule: number[] = []
      if (from > 0) schedule.push(from)
      for (let t = from + stepMs; t <= until + stepMs && schedule.length < MAX_STEPS + 2; t += stepMs) schedule.push(t)
      const second = await freshPage(harness, refs)
      const fine = await walk(second.probe, schedule, deadline, harness.origin, true)
      const warning = fine.warnings.find((w) => w.kind !== 'text')
      data.refine = {
        from,
        to: fine.reached,
        stepMs,
        ...(fine.terminal ? { eventAt: fine.terminal.at, eventKind: fine.terminal.kind } : {}),
        ...(warning ? { warningAt: warning.at } : {}),
        confirmed: !!coarse.terminal && !!fine.terminal && fine.terminal.kind === coarse.terminal.kind,
      }
      // The warning as the second load showed it, with its controls (the first load may have shown it with the consequence).
      if (warning) data.warnings = [...data.warnings.filter((w) => w !== firstWarning), { ...warning }]
      // The third load: the warning's control named to extend, pressed once the warning shows; with none, its other
      // control ("OK", "Got it"), which may extend the time too. Never one that signs out or closes the session.
      const control = warning?.controls.find((c) => c.extend && !c.skip) ?? warning?.controls.find((c) => !c.skip && !SIGN_OUT.test(c.name))
      if (warning && control && fine.terminal && Date.now() < deadline - 5000) {
        data.extension = await tryExtension(harness, refs, warning, control, fine.terminal.at, stepMs, deadline)
      } else if (warning && warning.controls.some((c) => c.extend && c.skip)) {
        const skipped = warning.controls.find((c) => c.extend && c.skip) as TimeControl
        harness.skip({ ref: skipped.el.ref, label: skipped.name }, skipped.skip?.reason ?? 'destructive', skipped.skip?.detail)
        data.extension = { control: { el: skipped.el, name: skipped.name }, outcome: 'not-exercised', reason: `skip list: ${skipped.skip?.reason}`, blocked: 0 }
      }
    }
  } finally {
    await harness.close()
  }
  if (!data || !conditions) throw new Error('the first page did not load')
  data.loads = harness.loads
  data.actions = harness.actions
  return harness.record(data, { ...conditions, variant: TIME_LIMITS_VARIANT }, data.end === 'time' ? `time budget reached (${TIME_BUDGET_MS / 1000} s)` : undefined)
}

/** Presses the warning's control once it shows, then waits past the time the consequence came without the press. */
async function tryExtension(harness: Harness, refs: string[], warning: TimeWarning, control: TimeControl, eventAt: number, stepMs: number, deadline: number): Promise<TimeExtension> {
  const { probe } = await freshPage(harness, refs)
  const page = probe.page
  const kit = time(page)
  const base: Pick<TimeExtension, 'control' | 'blocked'> = { control: { el: control.el, name: control.name, extend: control.extend }, blocked: 0 }
  let now = 0
  // To the moment the warning showed on the second load, then on in steps until the control is there.
  for (let at = warning.at; at < eventAt; at += stepMs) {
    await jump(page, now, at)
    now = at
    // Only waiting for it to show; the skip list is read on it below, once, before the press.
    if (await harness.locate(probe, control.el, { check: false })) break
  }
  if (!(await harness.locate(probe, control.el, { check: (facts) => withSkip(facts, harness.origin, control.name, warning.text).skip })))
    return { ...base, outcome: 'unmatched', reason: harness.lastSkip ? 'the skip list, read again on this load, leaves the control alone' : 'the warning or its control did not show on this load' }
  const aimed = await harness.aim(probe, control.el)
  if (!('x' in aimed)) return { ...base, outcome: 'not-exercised', reason: 'cover' in aimed ? 'under another layer' : 'does not show' }
  harness.log('activate', { ref: control.el.ref, label: control.name, detail: 'pressed to extend the time limit' })
  const blockedAt = refused(probe)
  const pressedAt = now
  await page.mouse.click(aimed.x, aimed.y)
  await page.clock.runFor(1000)
  now += 1000
  const startUrl = page.url()
  const right = await kit.check().catch(() => undefined)
  if (right && read(right, pressedAt, now, 0, [], harness.origin, startUrl).terminal) return { ...base, outcome: 'navigated', pressedAt, blocked: refused(probe) - blockedAt }
  // Past the time it came without the press, by the time the warning gave and at least a minute.
  const watchedTo = eventAt + Math.max(M, eventAt - warning.at)
  let came: number | undefined
  for (let at = now + stepMs; at <= watchedTo && Date.now() < deadline; at += stepMs) {
    await jump(page, now, at)
    now = at
    const check = await kit.check().catch(() => undefined)
    if (!check) break
    const seen = read(check, now - stepMs, now, 0, [], harness.origin, startUrl)
    if (seen.terminal) {
      came = now
      break
    }
  }
  const blocked = refused(probe) - blockedAt
  return { ...base, outcome: came === undefined ? 'extended' : 'not-extended', pressedAt, ...(came !== undefined ? { eventAt: came } : {}), watchedTo: Math.min(now, watchedTo), blocked }
}

/** The time-limit probe as part of `--probe motion`; a probe that fails leaves a skipped record. */
export async function timeLimitsProbe(browser: Browser, url: string, options: ProbeOptions, exclude: readonly string[] = []): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runTimeLimitsProbe(browser, url, options, exclude)]
  } catch (error) {
    return [skippedRecord('motion', TIME_LIMITS_VERSION, TIME_LIMITS_VARIANT, `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
