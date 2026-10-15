import type { Browser, BrowserContext, Response } from 'playwright-core'
import { errorMessage } from '../core/util.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import type { BrowserOptions } from '../surfaces/browser-options.ts'
import {
  COGNITIVE_VERSION,
  type CogaData,
  type CogaImage,
  OBSERVE_MS,
  OBSERVE_VARIANT,
  PASTE_VALUES,
  REDUCE_VARIANT,
  SAMPLE_MS,
  cogaAnimations,
  cogaClipboard,
  cogaImages,
  cogaRead,
  imageLoops,
  installCogaRecorder,
} from './cognitive-kit.ts'
import { animatedFormat, imageBytes } from './flash.ts'
import { type ProbeOptions, type ProbePage, openProbePage, quietEvaluate, skippedRecord } from './page.ts'

/**
 * The cognitive observation (`--profile cognitive` turns it on; `--probe cognitive` records it alone). It feeds the
 * profile's advisories on motion, interruptions, layout shifts and paste (src/advisory/checks/), never a WCAG rule.
 *
 * The page is loaded twice at the same time, each load in its own context behind the network guard:
 *
 * - **observe**, with the run's settings and `prefers-reduced-motion: no-preference`: for a window after the load
 *   event (8 s by default) nothing is clicked, typed, scrolled or focused, and an init script records what the page
 *   does on its own: layout shifts (PerformanceObserver), permission requests (answered as a closed prompt, never
 *   granted), media that starts or tries to start, alert boxes and new windows, and every 300 ms the dialogs and
 *   layers on top of the page and the slides a carousel shows. Then the clipboard events are dispatched on the page
 *   itself (paste, a beforeinput of a paste, copy, a context menu), never typed, and every field gets its value back.
 * - **reduce**, with `prefers-reduced-motion: reduce`: the same recorder, and the running animations, videos,
 *   animated images and carousels, to tell motion that keeps running under the setting.
 *
 * Every read goes over the DevTools protocol without a user gesture (`quietEvaluate`), so the page never has user
 * activation from Rampa: a permission request or sound it starts while `navigator.userActivation.hasBeenActive` is
 * false came with no input at all. Whether an image animates is read from the bytes the browser itself received
 * (a GIF, PNG or WebP response, at most 10 images within 2 s), never fetched again; images of a local page are read
 * from disk.
 */

const FIRST_INVENTORY_MS = 1000
const MAX_IMAGES = 10
const IMAGE_BUDGET_MS = 2000
const MAX_FIELDS = 20
/** Image responses that may animate, by content type; the others (JPEG, AVIF, SVG) never do. */
const MAY_ANIMATE = /^image\/(gif|png|apng|webp)\b/i

type ImageFacts = Pick<CogaImage, 'format' | 'animated' | 'loops' | 'reason'>

export async function cognitiveProbe(browser: Browser, url: string, options: ProbeOptions): Promise<ProbeRecord[]> {
  const windowMs = Math.max(1000, Math.round(options.observeMs ?? OBSERVE_MS))
  return Promise.all([observeLoad(browser, url, options, OBSERVE_VARIANT, windowMs), observeLoad(browser, url, options, REDUCE_VARIANT, windowMs)])
}

async function observeLoad(browser: Browser, url: string, options: ProbeOptions, variant: string, windowMs: number): Promise<ProbeRecord> {
  const started = Date.now()
  // The image responses the page received, by address: their bytes say whether an image animates.
  const responses = new Map<string, Response | 'still'>()
  let probe: ProbePage
  try {
    probe = await openProbePage(browser, url, options, {
      quiet: true,
      variant,
      context: { reducedMotion: variant === REDUCE_VARIANT ? 'reduce' : 'no-preference' },
      beforeLoad: async (page) => {
        await page.addInitScript(installCogaRecorder)
        page.on('response', (response) => {
          try {
            if (response.request().resourceType() !== 'image' || responses.size >= 400) return
            responses.set(response.url(), MAY_ANIMATE.test(response.headers()['content-type'] ?? '') ? response : 'still')
          } catch {
            // A response of a page that closed.
          }
        })
      },
    })
  } catch (error) {
    return skippedRecord('cognitive', COGNITIVE_VERSION, variant, `the page did not load: ${errorMessage(error).split('\n')[0]}`, Date.now() - started)
  }
  const { page, context, guard } = probe
  try {
    const clock = await quietEvaluate(page, () => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      return { load: Math.round(nav?.loadEventEnd || performance.now()), now: Math.round(performance.now()) }
    })
    const until = async (pageMs: number) => {
      const nowMs = await quietEvaluate(page, () => Math.round(performance.now()))
      if (pageMs > nowMs) await page.waitForTimeout(pageMs - nowMs)
    }
    await until(clock.load + Math.min(FIRST_INVENTORY_MS, windowMs))
    const first = await quietEvaluate(page, cogaAnimations)
    await until(clock.load + windowMs)
    const last = await quietEvaluate(page, cogaAnimations)
    const read = await quietEvaluate(page, cogaRead)
    const shown = await quietEvaluate(page, cogaImages, MAX_IMAGES * 2)
    const imageFacts = await readImages(context, shown, url, options.browserOptions, responses)
    // Alert boxes and windows the clipboard events set off belong to the paste test, not to the interruptions.
    const trialAt = guard.now()
    const clipboard = variant === OBSERVE_VARIANT ? await quietEvaluate(page, cogaClipboard, { max: MAX_FIELDS, ...PASTE_VALUES }) : undefined
    const pageMs = (guardAt: number) => Math.round(guard.start + guardAt - read.timeOrigin)
    const data: CogaData = {
      windowMs,
      loadMs: read.loadMs || clock.load,
      endMs: read.nowMs,
      firstSampleMs: read.firstSampleMs,
      sampleMs: SAMPLE_MS,
      samples: read.samples,
      viewport: read.viewport,
      activatedMs: read.activatedMs,
      animations: { firstMs: first.atMs, first: first.items, lastMs: last.atMs, last: last.items },
      videos: read.videos,
      images: imageFacts,
      carousels: read.carousels,
      layers: read.layers,
      permissions: read.permissions,
      plays: read.plays,
      shifts: read.shifts,
      alerts: guard.log.dialogs.filter((dialog) => dialog.at < trialAt && dialog.type !== 'beforeunload').map((dialog) => ({ type: dialog.type, atMs: pageMs(dialog.at), message: dialog.message.slice(0, 200) })),
      windows: [
        ...read.opened.map((opened) => ({ url: opened.url.slice(0, 300), atMs: Math.round(opened.at - read.timeOrigin) })),
        ...guard.log.navigations.filter((navigation) => navigation.cause === 'popup' && navigation.at < trialAt).map((navigation) => ({ url: navigation.url, atMs: pageMs(navigation.at) })),
      ],
      ...(clipboard ? { clipboard } : {}),
    }
    if (clipboard) {
      // What the page said when a paste was cancelled ("Pasting is not allowed"), as evidence for the paste test.
      const said = guard.log.dialogs.filter((dialog) => dialog.at >= trialAt).map((dialog) => dialog.message.slice(0, 120))
      if (said.length > 0) clipboard.alerts = said.slice(0, 5)
    }
    const conditions: ProbeRecord['conditions'] = { ...probe.conditions, variant }
    if (variant === REDUCE_VARIANT) conditions.reducedMotion = true
    else delete conditions.reducedMotion
    return { kind: 'cognitive', version: COGNITIVE_VERSION, conditions, status: 'complete', guard: guard.log, durationMs: Date.now() - started, data }
  } catch (error) {
    return skippedRecord('cognitive', COGNITIVE_VERSION, variant, `the observation stopped: ${errorMessage(error).split('\n')[0]}`, Date.now() - started)
  } finally {
    await context.close().catch(() => undefined)
  }
}

/** Whether each image on show animates, and how many times it plays, from the bytes the page received. */
async function readImages(
  context: BrowserContext,
  shown: Array<Pick<CogaImage, 'el' | 'box' | 'src'>>,
  pageUrl: string,
  browserOptions: BrowserOptions | undefined,
  responses: Map<string, Response | 'still'>,
): Promise<CogaImage[]> {
  const deadline = Date.now() + IMAGE_BUDGET_MS
  const out: CogaImage[] = []
  for (const image of shown.slice(0, MAX_IMAGES)) {
    if (Date.now() > deadline) {
      out.push({ ...image, animated: null, loops: null, reason: 'time' })
      continue
    }
    out.push({ ...image, ...(await imageFacts(context, image.src, pageUrl, browserOptions, responses.get(image.src))) })
  }
  return out
}

async function imageFacts(context: BrowserContext, src: string, pageUrl: string, browserOptions: BrowserOptions | undefined, response: Response | 'still' | undefined): Promise<ImageFacts> {
  if (response === 'still') return { animated: false, loops: null }
  let bytes: Uint8Array | string
  if (response) {
    const body = await Promise.race([response.body().catch(() => undefined), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1000))])
    bytes = body ? new Uint8Array(body) : 'not-read'
  } else if (src.startsWith('data:') || src.startsWith('file:')) {
    // A local page's image and an inline one are read where they are, with no request.
    bytes = await imageBytes(context, src, pageUrl, browserOptions).catch(() => 'not-read')
  } else bytes = 'not-seen'
  if (typeof bytes === 'string') return { animated: null, loops: null, reason: bytes }
  const format = animatedFormat(bytes)
  return format ? { format, animated: true, loops: imageLoops(bytes, format) } : { animated: false, loops: null }
}
