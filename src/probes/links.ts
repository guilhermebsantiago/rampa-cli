import type { Browser } from 'playwright-core'
import type { A11ySnapshot, Destination, ProbeRecord } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import { ACTIVATE_LIMITS, type ControlFacts, Harness, type HarnessAction, type OpenedLayer, type SkipReason, type Watch, skipReason } from './activate.ts'
import { matchNode } from './identity.ts'
import type { InPageElement } from './kit.ts'
import { type ProbeOptions, skippedRecord } from './page.ts'

/**
 * Where scripted links lead (2.4.4), the first probe on the activate-class harness (activate.ts). A scripted link is a
 * link whose address says nothing: `href="#"`, an empty `href`, a `javascript:` address, a `#fragment` that names
 * nothing on the page, or an element with `role="link"` and no address. Each one that shows and has a name, outside
 * the skip list and within the budget, is clicked once (a trusted click at its middle, after checking that nothing
 * covers it). The navigation it starts is intercepted in the page and recorded, never followed; a window it opens,
 * an address it sets in place (pushState: the page's title and first heading are read then), a fragment it moves to,
 * a form it submits (cancelled), a dialog it opens (not exercised) are recorded too. Once a click changed the page,
 * the next link gets a fresh one. The addresses go into the snapshot's destinations, read like any link's, so the
 * 2.4.4 judgment compares a scripted link's text with where it leads as it does for a real href.
 */

export const LINKS_VERSION = '1'
/** Scripted links listed per page; at most ACTIVATE_LIMITS.controls of them are clicked. */
const MAX_LISTED = 100

export type ScriptedHow = 'empty' | 'hash' | 'javascript' | 'fragment' | 'no-href'

export const OUTCOME_KINDS = [
  'navigation',
  'new-window',
  'route',
  'fragment',
  'download',
  'submit',
  'dialog',
  'opened',
  'content',
  'nothing',
  'not-exercised',
  'unmatched',
  'not-tried',
] as const
export type OutcomeKind = (typeof OUTCOME_KINDS)[number]

/** What clicking a scripted link did. Facts only: 2.4.4 decides what they mean. */
export interface LinkOutcome {
  kind: OutcomeKind
  /** navigation, new-window, download, route: the address (absolute). submit: the form's action. */
  url?: string | undefined
  /** route: the page's title and first heading once the address changed in place. */
  title?: string | undefined
  heading?: string | undefined
  /** fragment: the id it moved to. */
  fragment?: string | undefined
  /** opened: the dialog or layer that showed, whose controls are not exercised. */
  opened?: OpenedLayer | undefined
  /** dialog: the browser dialog's text, dismissed. */
  message?: string | undefined
  /** not-exercised: what covers it, or that it does not show; not-tried: the budget. */
  cover?: (InPageElement & { text: string }) | undefined
  reason?: string | undefined
  /** The window's facts, as the harness recorded them. */
  watch?: Watch | undefined
}

export interface ScriptedLink extends InPageElement {
  /** The href as written, when there is one. */
  href?: string | undefined
  how: ScriptedHow
  /** In a navigation landmark, header or footer: tried after the links of the content. */
  chrome?: boolean | undefined
  /** On the skip list: never clicked. */
  skip?: { reason: SkipReason; detail?: string | undefined } | undefined
  outcome?: LinkOutcome | undefined
}

export interface LinksData {
  viewport: { width: number; height: number }
  /** Scripted links found that show and have a name. */
  found: number
  /** At most 100, content first, then menus, header and footer. */
  links: ScriptedLink[]
  /** Clicks made. */
  activated: number
  /** Pages loaded: the first, and one fresh page after each click that changed the page. */
  loads: number
  /** Every action of the harness: loads, clicks, skips, intercepted navigations, windows, submissions, dialogs, blocked requests. */
  actions: HarnessAction[]
  end: 'complete' | 'budget' | 'time'
}

/** Runs in the page; needs the kit and the activate kit. The scripted links that show and have a name. */
export function findScriptedLinks(args: { max: number }): { found: number; links: Array<ScriptedLink & { facts: ControlFacts }> } {
  const w = window as unknown as {
    __rampaKit: { describe(el: Element): InPageElement; visible(el: Element): boolean }
    __rampaActivate: { facts(el: Element): ControlFacts }
  }
  const kit = w.__rampaKit
  const CHROME = 'nav,header,footer,[role=navigation],[role=banner],[role=contentinfo]'
  const names = (id: string) => document.getElementById(id) !== null || document.getElementsByName(id).length > 0
  const links: Array<ScriptedLink & { facts: ControlFacts }> = []
  let found = 0
  for (const el of Array.from(document.querySelectorAll('a[href],[role=link]'))) {
    const role = (el.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
    if (role !== '' && role !== 'link') continue
    let how: ScriptedHow
    const raw = el.getAttribute('href')
    if ((el.localName === 'a' || el.localName === 'area') && raw !== null) {
      const href = raw.trim()
      if (href === '') how = 'empty'
      else if (href === '#') how = 'hash'
      else if (/^javascript:/i.test(href)) how = 'javascript'
      else if (href.startsWith('#')) {
        let id = href.slice(1)
        try {
          id = decodeURIComponent(id)
        } catch {
          // keep it as written
        }
        // A fragment that names an element is an in-page link, and "#top" is the top of the page. A route of a
        // single-page app ("#/about", "#!/about") names nothing and is tried: its view is where it leads.
        if (names(id) || id.toLowerCase() === 'top') continue
        how = 'fragment'
      } else continue
    } else how = 'no-href'
    if (!kit.visible(el) || el.getBoundingClientRect().width < 1) continue
    const described = kit.describe(el)
    if (!described.label) continue
    found++
    if (links.length >= args.max) continue
    links.push({ ...described, ...(raw !== null ? { href: raw.slice(0, 300) } : {}), how, ...(el.closest(CHROME) ? { chrome: true } : {}), facts: w.__rampaActivate.facts(el) })
  }
  return { found, links }
}

function withoutHash(url: string): string {
  return url.replace(/#.*$/, '')
}

/** What a click did, from the window's facts: the strongest effect wins. `before` is the address before the click. */
export function linkOutcome(watch: Watch, before: string): LinkOutcome {
  const leaves = watch.navigations.filter((n) => !n.same && !n.download)
  const downloads = watch.navigations.filter((n) => n.download)
  const submit = watch.submits[0]
  if (submit !== undefined) return { kind: 'submit', url: submit, watch }
  const opened = watch.windows[0]
  if (opened !== undefined) return { kind: 'new-window', url: opened, watch }
  const leave = leaves[0]
  if (leave) return { kind: 'navigation', url: leave.url, watch }
  const download = downloads[0]
  if (download) return { kind: 'download', url: download.url, watch }
  if (watch.url && withoutHash(watch.url) !== withoutHash(before)) return { kind: 'route', url: watch.url, title: watch.title, heading: watch.heading, watch }
  if (watch.dialogs.length > 0) return { kind: 'dialog', message: watch.dialogs[0], watch }
  if (watch.opened) return { kind: 'opened', opened: watch.opened, watch }
  const hash = watch.url ? (/#(.*)$/.exec(watch.url)?.[1] ?? '') : ''
  if (watch.url && hash !== '') {
    let fragment = hash
    try {
      fragment = decodeURIComponent(hash)
    } catch {
      // keep it as written
    }
    // A route of a single-page app that routes by fragment ("#/about") shows another view: read like an address set in place.
    if (/^[/!]/.test(fragment)) return { kind: 'route', url: watch.url, title: watch.title, heading: watch.heading, watch }
    return { kind: 'fragment', url: watch.url, fragment, watch }
  }
  if (watch.dom > 0 || watch.modals > 0) return { kind: 'content', watch }
  return { kind: 'nothing', watch }
}

/** Kinds whose address is where the link leads, to read like a link's href. */
export const ADDRESS_KINDS: readonly OutcomeKind[] = ['navigation', 'new-window', 'download']

/** The addresses scripted links led to in a links record, to read at collection (http, https and file only). */
export function scriptedAddresses(records: readonly ProbeRecord[]): string[] {
  const addresses = new Set<string>()
  for (const record of records) {
    if (record.kind !== 'links' || record.status === 'skipped') continue
    const links = (record.data as Partial<LinksData> | null)?.links
    if (!Array.isArray(links)) continue
    for (const link of links) {
      const url = link?.outcome?.url
      if (!link?.outcome || !ADDRESS_KINDS.includes(link.outcome.kind) || typeof url !== 'string') continue
      if (/^(https?|file):/i.test(url)) addresses.add(url)
    }
  }
  return [...addresses]
}

// Reading a record back: what 2.4.4 and the coverage rule need (rules/links.ts, criteria/link-purpose.ts).

/** The links probe's record, when it is one these helpers read. */
export function linksRecord(records: readonly ProbeRecord[] | undefined): ProbeRecord | undefined {
  return records?.find((r) => r.kind === 'links' && r.version === LINKS_VERSION && r.status !== 'skipped')
}

export function linksData(record: ProbeRecord): LinksData {
  const data = record.data
  return (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as LinksData
}

/**
 * What clicking each scripted link did, keyed by the snapshot ref of the link it was found on. A fact whose ref or
 * identity does not match the snapshot (the page changed between loads) is left out: 2.4.4 then reads that link
 * as it would without the probe.
 */
export function scriptedOutcomes(snapshot: A11ySnapshot, index: TreeIndex): Map<string, LinkOutcome> {
  const outcomes = new Map<string, LinkOutcome>()
  const record = linksRecord(snapshot.observations?.probes)
  if (!record) return outcomes
  const links = linksData(record).links
  for (const link of Array.isArray(links) ? links : []) {
    if (!link?.outcome || typeof link.outcome.kind !== 'string') continue
    const node = matchNode(index, link.ref, link.id)
    if (node) outcomes.set(node.ref, link.outcome)
  }
  return outcomes
}

/**
 * Where a scripted link leads, as a destination 2.4.4 reads: what was read at the address it went to (a navigation, a
 * new window, a download), or, for an address set in place (a single-page app's route), the title and first heading
 * the page showed then.
 */
export function scriptedDestination(snapshot: A11ySnapshot, outcome: LinkOutcome): Destination | undefined {
  if (!outcome.url) return undefined
  if (outcome.kind === 'route') {
    const title = outcome.title?.trim() || undefined
    const heading = outcome.heading?.trim() || undefined
    return title || heading ? { kind: 'page', finalUrl: outcome.url, ...(title ? { title } : {}), ...(heading ? { heading } : {}) } : undefined
  }
  if (outcome.kind === 'navigation' || outcome.kind === 'new-window' || outcome.kind === 'download') return snapshot.destinations?.[outcome.url]
  return undefined
}

/** The words of the prompt line for what clicking a scripted link did, or undefined when it says nothing of use. */
export function activationText(outcome: LinkOutcome): string | undefined {
  const url = outcome.url ? outcome.url.slice(0, 200) : ''
  switch (outcome.kind) {
    case 'navigation':
      return `it goes to ${url}`
    case 'new-window':
      return `it opens a new window at ${url}`
    case 'download':
      return `it downloads ${url}`
    case 'route':
      return `it changes the address to ${url} and shows other content in place`
    case 'fragment':
      return 'it moves to another part of this page'
    case 'submit':
      return 'it submits a form'
    case 'opened':
      return outcome.opened?.name ? `it opens a dialog or layer that reads "${outcome.opened.name.slice(0, 100)}"` : 'it opens a dialog or layer'
    case 'dialog':
      return outcome.message ? `it shows a browser message: "${outcome.message.slice(0, 100)}"` : undefined
    default:
      return undefined
  }
}

/** 2.4.4: every scripted link once, within the budget, on a fresh page after each click that changed the page. */
export async function runLinksProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord> {
  const limits = ACTIVATE_LIMITS
  const harness = new Harness(browser, url, options, { kind: 'links', version: LINKS_VERSION, variant: 'scripted-links', limits })
  let data: LinksData | undefined
  let conditions: ProbeRecord['conditions'] | undefined
  try {
    const first = await harness.page()
    conditions = first.conditions
    const viewport = first.page.viewportSize() ?? first.conditions.viewport
    const listed = await first.page.evaluate(findScriptedLinks, { max: MAX_LISTED })
    // Links of the content first, then those in menus, header and footer, as destinations.ts reads real links.
    const ordered = [...listed.links.filter((l) => !l.chrome), ...listed.links.filter((l) => l.chrome)]
    data = { viewport, found: listed.found, links: [], activated: 0, loads: 0, actions: [], end: 'complete' }
    for (const { facts, ...link } of ordered) {
      const entry: ScriptedLink = link
      data.links.push(entry)
      const skip = skipReason(facts, harness.origin)
      if (skip) {
        entry.skip = skip
        harness.skip(link, skip.reason, skip.detail)
        continue
      }
      if (harness.activated >= limits.controls || !harness.timeLeft()) {
        if (data.end === 'complete') data.end = harness.activated >= limits.controls ? 'budget' : 'time'
        entry.outcome = { kind: 'not-tried', reason: data.end }
        continue
      }
      const probe = await harness.page()
      if (!(await harness.locate(probe, link))) {
        entry.outcome = { kind: 'unmatched' }
        continue
      }
      const aimed = await harness.aim(probe, link)
      if ('cover' in aimed) {
        entry.outcome = { kind: 'not-exercised', cover: aimed.cover }
        continue
      }
      if ('hidden' in aimed) {
        entry.outcome = { kind: 'not-exercised', reason: 'not showing on this load' }
        harness.log('not-exercised', { ref: link.ref, label: link.label, detail: 'not showing on this load' })
        continue
      }
      const before = probe.page.url()
      harness.activated++
      harness.log('activate', { ref: link.ref, label: link.label, detail: `click at ${aimed.x},${aimed.y}` })
      const watch = await harness.window(probe, () => probe.page.mouse.click(aimed.x, aimed.y), { ref: link.ref, label: link.label })
      entry.outcome = linkOutcome(watch, before)
    }
  } finally {
    await harness.close()
  }
  if (!data || !conditions) throw new Error('the first page did not load')
  data.activated = harness.activated
  data.loads = harness.loads
  data.actions = harness.actions
  const reason = data.end === 'budget' ? `control budget reached (${limits.controls})` : data.end === 'time' ? `time budget reached (${limits.timeMs / 1000} s)` : undefined
  return harness.record(data, conditions, reason)
}

/** The links probe as a step of the probe stage; a probe that fails leaves a skipped record. */
export async function linksProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const started = Date.now()
  try {
    return [await runLinksProbe(browser, url, options)]
  } catch (error) {
    return [skippedRecord('links', LINKS_VERSION, 'scripted-links', `probe failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`, Date.now() - started)]
  }
}
