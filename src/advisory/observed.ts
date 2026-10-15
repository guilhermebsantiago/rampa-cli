import type { Locale } from '../i18n.ts'
import { COGNITIVE_VERSION, type CogaData, type CogaElement, FAST_OBSERVE_MS, OBSERVE_MS } from '../probes/cognitive-kit.ts'
import { matchNode } from '../probes/identity.ts'
import type { InPageRect } from '../probes/kit.ts'
import type { A11ySnapshot } from '../snapshot/schema.ts'
import type { CogaSettings } from './check.ts'
import { am } from './messages.ts'
import type { Page } from './page.ts'
import type { Profile, Reference } from './types.ts'

/**
 * What the observed checks share: reading the cognitive observation's records from the snapshot, and the words for
 * times, shares and elements. The checks (reduced-motion, interruptions, layout-shift, paste-blocked) are pure
 * functions of those records, so a recorded snapshot gives the same advisories offline.
 */

/** GAIA, Guia de Acessibilidade de Interfaces para Autismo (Britto, UFSCar, 2016): recommendations, not a standard. */
export const GAIA_G09: Reference = { kind: 'guide', label: 'GAIA G09 Eliminar distrações', url: 'https://gaia.wiki.br/engajamento/eliminar-distracoes' }
export const GAIA_G18: Reference = { kind: 'guide', label: 'GAIA G18 Evite sons perturbadores', url: 'https://gaia.wiki.br/multimidia/evite-sons-perturbadores' }

/** Advisories per check and page at most: the rest are left out, the most important kept. */
export const MAX_PER_CHECK = 8

export interface Observed {
  data?: CogaData | undefined
  /** Why there is no data: no observation, one that did not run, or one this version cannot read. */
  reason?: string | undefined
}

/** The record of one load of the observation (observe or reduce), or why there is none. */
export function observedLoad(snapshot: A11ySnapshot, variant: string, locale: Locale, coga: CogaSettings): Observed {
  const records = (snapshot.observations?.probes ?? []).filter((record) => record.kind === 'cognitive')
  const record = records.find((candidate) => candidate.conditions.variant === variant)
  if (!record) return { reason: am(locale, coga.observe === 0 || coga.observe === false ? 'obsOff' : 'obsNotObserved') }
  if (record.status === 'skipped') return { reason: am(locale, 'obsSkipped', { reason: record.reason ?? 'skipped' }) }
  if (record.version !== COGNITIVE_VERSION) return { reason: am(locale, 'obsSkipped', { reason: `observation version ${record.version}, which this check does not read` }) }
  if (!isData(record.data)) return { reason: am(locale, 'obsSkipped', { reason: 'unreadable observation record' }) }
  return { data: record.data }
}

function isData(data: unknown): data is CogaData {
  const d = data as Partial<CogaData> | null
  return Boolean(
    d &&
      typeof d === 'object' &&
      typeof d.loadMs === 'number' &&
      typeof d.windowMs === 'number' &&
      Array.isArray(d.layers) &&
      Array.isArray(d.shifts) &&
      Array.isArray(d.carousels) &&
      d.animations &&
      Array.isArray(d.animations.first) &&
      Array.isArray(d.animations.last),
  )
}

/**
 * Whether the live page is watched in this run, and for how long: only with the cognitive profile, on a web page
 * Rampa loads itself. `coga.observe` seconds win; else 3 s with --fast and 8 s otherwise; 0 or false turns it off.
 */
export function observationWindow(profiles: readonly Profile[] | undefined, coga: CogaSettings | undefined, fast: boolean): number | undefined {
  if (!profiles?.includes('cognitive')) return undefined
  const seconds = coga?.observe
  if (seconds === false || seconds === 0) return undefined
  if (typeof seconds === 'number') return Math.round(seconds * 1000)
  return fast ? FAST_OBSERVE_MS : OBSERVE_MS
}

const decimal = (value: number, locale: Locale, digits = 1) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)

/** "1.5 s", "1,5 s". */
export function seconds(ms: number, locale: Locale): string {
  return `${decimal(Math.max(0, ms) / 1000, locale)} s`
}

/** "40%", in the report's language. */
export function percent(share: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(share)
}

export function score(value: number, locale: Locale): string {
  return decimal(value, locale, 3)
}

/** When something happened, from the load event: during the load, or so many seconds after it. */
export function when(atMs: number, data: CogaData, locale: Locale): string {
  return atMs <= data.loadMs + 100 ? am(locale, 'whenLoading') : am(locale, 'whenAfter', { seconds: seconds(atMs - data.loadMs, locale) })
}

/** The sentence every observed advisory ends with: experimental, and how the page was watched. */
export function experimental(data: CogaData, locale: Locale): string {
  return am(locale, 'obsExperimental', { seconds: seconds(data.windowMs, locale) })
}

/** The start tag the collector kept for an element, when the same element is in the snapshot. */
export function htmlOf(page: Page, el: CogaElement): string | undefined {
  const node = matchNode(page.index, el.ref, el.id)
  return typeof node?.native.html === 'string' ? node.native.html : undefined
}

/** How a message names an element: its text, or its tag. */
export function nameOf(el: CogaElement): string {
  const label = el.label.replace(/\s+/g, ' ').trim()
  return label ? `<${el.tag}> "${label.length > 60 ? `${label.slice(0, 59)}…` : label}"` : `<${el.tag}>`
}

/** Text quoted from the page, on one line and cut. */
export function quote(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function rectText(rect: InPageRect): string {
  return `${rect.x},${rect.y} ${rect.width}×${rect.height}`
}

/** The element facts every observed advisory records, so the claim can be found on the page again. */
export function elementFacts(el: CogaElement | undefined, prefix = ''): Record<string, string> {
  if (!el) return {}
  return { [`${prefix}tag`]: el.tag, ...(el.label ? { [`${prefix}text`]: quote(el.label, 80) } : {}) }
}
