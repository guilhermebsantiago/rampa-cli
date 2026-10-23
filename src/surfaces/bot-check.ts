import type { Blocked } from '../snapshot/schema.ts'

/**
 * Bot checks and refusals in place of the page. A site behind bot protection (Cloudflare, Akamai, DataDome, HUMAN,
 * Imperva, AWS WAF...) often answers an automated browser with a challenge page, a captcha or a short "Access denied"
 * page instead of its content. Checked as if it were the site, that page gives findings about the vendor's page and
 * says nothing of the site, so the collector recognizes it and does not read it: the snapshot records `blocked`, and
 * the report says that nothing was checked, and why (core/check.ts). Rampa never solves or gets around a bot check.
 *
 * Only strong signs count, so a page that merely loads a vendor's script is checked as usual: a response header that
 * names a challenge, or, on a short page, a vendor's challenge script, form or frame, its reference number, a
 * challenge page's title, or an HTTP refusal (403, 429).
 */

/** What the page shows, read in the page before anything else of it (`blockedFactsInPage`). */
export interface BlockedFacts {
  title: string
  /** Characters of rendered text in the body, counted up to 20 000. */
  text: number
  /** Elements in the document. */
  elements: number
  /** The vendors' marks found on the page: the vendor, and what was found, as it reads in the page (a global, a selector, an address, a reference). */
  marks: Array<{ vendor: string; detail: string }>
}

/** The response that brought the page's document. */
export interface DocumentResponse {
  status: number
  headers: Record<string, string>
}

/** A page this short is a vendor's page; a site's own page with a vendor's script on it is longer. */
export const SHORT = { elements: 400, text: 3000 }

/**
 * Titles of challenge and block pages: HUMAN's "Access to this page has been denied", Imperva's "Pardon Our
 * Interruption", Fortinet's "The URL you requested has been blocked", and others no site gives its own page.
 */
const TITLES =
  /^(attention required! \| cloudflare|access to this page has been denied|pardon our interruption|request rejected|web page blocked|checking your browser|verifying you are human|verify you are human|human verification|bot verification|are you a robot|robot or human|are you human|ddos-guard|vercel security checkpoint|sucuri website firewall)\b|the url you requested has been blocked|prove your humanity/i

/**
 * Titles a page of the site could have too (a loading screen's "Just a moment"), which some vendors translate: they
 * count only when the page came with an HTTP error, as challenges and refusals do. A vendor's header alone is no
 * sign: Cloudflare and Akamai serve every page of the sites behind them.
 */
const ERROR_TITLES = /^(just a moment|um momento|un momento|einen moment|un instant|access denied|acesso negado|acceso denegado|request blocked|security check)\b/i

/** Who serves the response, from headers that name a vendor; undefined when none does. */
function vendorOfResponse(headers: Record<string, string>): string | undefined {
  const server = (headers.server ?? '').toLowerCase()
  if (headers['cf-mitigated'] !== undefined || headers['cf-ray'] !== undefined || server === 'cloudflare') return 'Cloudflare'
  if (headers['x-datadome'] !== undefined || server === 'datadome') return 'DataDome'
  if (server.startsWith('akamaighost') || server.startsWith('akamai')) return 'Akamai'
  if (headers['x-iinfo'] !== undefined || (headers['x-cdn'] ?? '').toLowerCase().includes('imperva')) return 'Imperva'
  if (headers['x-amzn-waf-action'] !== undefined) return 'AWS WAF'
  if (server === 'cloudfront') return 'Amazon CloudFront'
  return undefined
}

/** Whether the page in place of the one asked for is a bot check or a refusal, from what it shows and the response that brought it. */
export function blockedPage(facts: BlockedFacts, response: DocumentResponse | undefined): Blocked | undefined {
  const status = response?.status
  const headers = response?.headers ?? {}
  const title = facts.title.trim().slice(0, 120)
  const common = { ...(status ? { status } : {}), ...(title ? { title } : {}) }
  // Cloudflare marks the response of every challenge it serves, whatever the page looks like.
  if ((headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge') return { kind: 'challenge', vendor: 'Cloudflare', evidence: 'header', detail: 'cf-mitigated: challenge', ...common }
  if (facts.elements >= SHORT.elements || facts.text >= SHORT.text) return undefined
  const mark = facts.marks[0]
  if (mark) return { kind: 'challenge', vendor: mark.vendor, evidence: 'mark', detail: mark.detail, ...common }
  const vendor = vendorOfResponse(headers)
  const failed = status !== undefined && status >= 400
  if (title && (TITLES.test(title) || (ERROR_TITLES.test(title) && failed))) {
    return { kind: 'challenge', ...(vendor ? { vendor } : {}), evidence: 'title', detail: title, ...common }
  }
  if (status === 403 || status === 429) return { kind: 'refused', ...(vendor ? { vendor } : {}), evidence: 'status', detail: `HTTP ${status}`, ...common }
  return undefined
}

/**
 * Runs in the page: its title, how much it holds, and the marks bot-check vendors leave on their pages. A page of
 * `short` elements or more is no vendor's page, and its text and marks are not read. Self-contained.
 */
export function blockedFactsInPage(short: number): BlockedFacts {
  const elements = document.getElementsByTagName('*').length
  if (elements >= short) return { title: document.title ?? '', text: 0, elements, marks: [] }
  const marks: Array<{ vendor: string; detail: string }> = []
  const w = window as unknown as Record<string, unknown>
  const has = (selector: string): boolean => {
    try {
      return document.querySelector(selector) !== null
    } catch {
      return false
    }
  }
  const addresses = Array.from(document.querySelectorAll('iframe[src], script[src]'), (el) => el.getAttribute('src') ?? '')
  const loads = (pattern: RegExp): string | undefined => addresses.find((src) => pattern.test(src))
  if (w._cf_chl_opt !== undefined) marks.push({ vendor: 'Cloudflare', detail: 'window._cf_chl_opt' })
  else if (has('#challenge-form, #challenge-running, #challenge-stage, #cf-challenge-running')) marks.push({ vendor: 'Cloudflare', detail: '#challenge-form' })
  else if (has('#cf-error-details, .cf-error-overview')) marks.push({ vendor: 'Cloudflare', detail: '#cf-error-details' })
  if (loads(/captcha-delivery\.com/)) marks.push({ vendor: 'DataDome', detail: 'captcha-delivery.com' })
  if (has('#px-captcha, meta[name="description"][content="px-captcha"]')) marks.push({ vendor: 'HUMAN (PerimeterX)', detail: '#px-captcha' })
  if (loads(/_Incapsula_Resource/)) marks.push({ vendor: 'Imperva', detail: '_Incapsula_Resource' })
  if (has('form[action*="validateCaptcha"]')) marks.push({ vendor: 'Amazon', detail: 'validateCaptcha' })
  if (w.gokuProps !== undefined || w.awsWafCookieDomainList !== undefined || loads(/\.awswaf\.com\//)) marks.push({ vendor: 'AWS WAF', detail: 'awswaf.com' })
  const body = document.body
  const text = body ? (body.innerText ?? '').slice(0, 20_000) : ''
  // Akamai's reference numbers (18.cd290c17.1792762826.467ee9f) and Imperva's incident IDs, in the vendors' own pages and in a site's custom error page.
  const reference = /\b\d{1,2}\.[0-9a-f]{8}\.\d{10}\.[0-9a-f]{6,8}\b/.exec(text)
  if (reference || text.includes('errors.edgesuite.net')) marks.push({ vendor: 'Akamai', detail: reference ? `Reference ${reference[0]}` : 'errors.edgesuite.net' })
  if (/Incapsula incident ID/.test(text)) marks.push({ vendor: 'Imperva', detail: 'Incapsula incident ID' })
  return { title: document.title ?? '', text: text.replace(/\s+/g, ' ').trim().length, elements, marks }
}
