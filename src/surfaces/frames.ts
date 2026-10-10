import { errorMessage } from '../core/util.ts'
import { FRAME_SEPARATOR, SHADOW_SEPARATOR } from '../snapshot/refs.ts'
import { type InPageAxe, type InPagePartial, axeFinishInPage, axePartialInPage, frameRefInPage } from './in-page.ts'

/**
 * axe-core in every frame of a page. axe-core checks one document per run, so each frame is checked on its own
 * (`axe.runPartial`) and the results are put together in the top frame (`axe.finishRun`), which ties each
 * element of a frame to that frame. Frames are reached through the browser library, not through the page: a
 * frame of another origin is out of the page's reach but not out of Playwright's or Puppeteer's.
 */

/** One frame of the page, as the browser library reaches it. */
export interface FrameDriver {
  /** Runs a self-contained function in the frame with one JSON argument, and returns its JSON result. */
  evaluate<Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>
  /** Runs script source in the frame as a <script> would, without adding one, so the frame's CSP cannot block it. */
  run(source: string): Promise<void>
  /** The frame's address now, when the library tells it. */
  url?(): string
  /**
   * The frame shown by the <iframe> or <frame> that axe-core's selector names in this frame (`axe.utils.shadowSelect`),
   * or undefined when there is none. Without it, axe-core checks the top frame only.
   */
  child?(selector: unknown): Promise<FrameDriver | undefined>
}

/** What axe-core did in one frame it was asked to check. */
export interface EngineFrame {
  /** The frame element's ref (snapshot/refs.ts). */
  ref: string
  /** axe-core ran in the frame, and its results are in the engine's. */
  engine: boolean
  /** The frame's address when axe-core ran in it. */
  url?: string | undefined
  /** Why it did not: the browser library could not reach the frame, the frame budget ran out, or the error. */
  reason?: string | undefined
}

export interface AxeSettings {
  tags: string[]
  /** Rules to run besides the tags, such as experimental ones the tags leave out. */
  rules?: readonly string[] | undefined
  locale: unknown
  /** axe-core's context, to check part of the page: selectors to include and exclude. The whole page when absent. */
  context?: { include?: string[] | undefined; exclude?: string[] | undefined } | undefined
}

export interface FrameLimits {
  /** Frames checked per page, nested ones included; the rest are recorded as not checked. */
  frames: number
  /** Longest wait for one frame to take axe-core and run it; a frame stuck loading answers nothing. */
  frameMs: number
  /** Longest time for all the frames of a page together. */
  totalMs: number
}

export const FRAME_LIMITS: FrameLimits = { frames: 30, frameMs: 5000, totalMs: 30_000 }

/**
 * Runs axe-core in the top frame and in every frame it holds, depth first in the order axe-core lists them, and
 * finishes the run in the top frame. axe-core must already be on the top frame; each other frame gets `source`.
 */
export async function runAxeInFrames(
  top: FrameDriver,
  settings: AxeSettings,
  source: () => Promise<string>,
  limits: FrameLimits = FRAME_LIMITS,
): Promise<{ axe: InPageAxe; frames: EngineFrame[] }> {
  const options = {
    runOnly: { type: 'tag', values: settings.tags },
    ...(settings.rules && settings.rules.length > 0 ? { rules: Object.fromEntries(settings.rules.map((id) => [id, { enabled: true }])) } : {}),
  }
  const first = await top.evaluate(axePartialInPage, { context: settings.context ?? null, options, keep: true })
  // One entry per frame, in axe-core's order; null for a frame that was not checked, whose own frames are then skipped.
  const partials: unknown[] = []
  const frames: EngineFrame[] = []
  let budget = limits.frames
  const deadline = Date.now() + limits.totalMs
  const visit = async (driver: FrameDriver, contexts: InPagePartial['frames'], prefix: string): Promise<void> => {
    for (const { frameSelector, frameContext } of contexts) {
      let ref = `${prefix}${selectorText(frameSelector)}`
      const skip = (reason: string) => {
        partials.push(null)
        frames.push({ ref, engine: false, reason })
      }
      try {
        ref = (await driver.evaluate(frameRefInPage, frameSelector).catch(() => null)) ?? ref
        if (budget <= 0) {
          skip(`over the limit of ${limits.frames} frames per page`)
          continue
        }
        const left = deadline - Date.now()
        if (left <= 0) {
          skip(`over the limit of ${limits.totalMs / 1000} s for the frames of a page`)
          continue
        }
        budget--
        const ms = Math.min(limits.frameMs, left)
        const child = driver.child ? await within(driver.child(frameSelector), ms) : undefined
        if (!child) {
          skip(driver.child ? 'the frame could not be reached' : 'the browser library gives no access to frames')
          continue
        }
        const code = await source()
        // One limit for the frame as a whole: injecting axe-core and running it.
        const answer = await within(
          child.run(code).then(() => child.evaluate(axePartialInPage, { context: frameContext, options, keep: false })),
          ms,
        )
        partials.push(answer.partial ?? null)
        const url = child.url?.()
        frames.push({ ref, engine: true, ...(url ? { url } : {}) })
        await visit(child, answer.frames, `${ref}${FRAME_SEPARATOR}`)
      } catch (error) {
        skip(errorMessage(error).split('\n')[0] ?? 'error')
      }
    }
  }
  await visit(top, first.frames, '')
  const axe = await top.evaluate(axeFinishInPage, { partials, options, locale: settings.locale })
  return { axe, frames }
}

/** axe-core's selector of an element, in a frame's ref: a string, or an array that crosses shadow roots. */
function selectorText(selector: unknown): string {
  return Array.isArray(selector) ? selector.map(String).join(SHADOW_SEPARATOR) : String(selector)
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The handle API a frame driver needs from Playwright and Puppeteer: frames, handles and the frame an element shows. */
export interface LibraryFrame {
  // biome-ignore lint/suspicious/noExplicitAny: each library types evaluate with its own generics
  evaluate(fn: any, arg?: any): Promise<unknown>
  url?(): string
  // biome-ignore lint/suspicious/noExplicitAny: each library types evaluateHandle with its own generics
  evaluateHandle(fn: any, arg?: any): Promise<{ asElement(): { contentFrame(): Promise<LibraryFrame | null>; dispose(): Promise<void> } | null; dispose(): Promise<void> }>
}

/** A frame driver over a Playwright or Puppeteer frame (or page): both evaluate a function or a script string the same way. */
export function libraryFrameDriver(frame: LibraryFrame): FrameDriver {
  return {
    evaluate: <Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) => frame.evaluate(fn, arg) as Promise<Result>,
    async run(source) {
      await frame.evaluate(source)
    },
    ...(frame.url ? { url: () => frame.url?.() ?? '' } : {}),
    async child(selector) {
      const handle = await frame.evaluateHandle(
        (axeSelector: unknown) => (window as unknown as { axe: { utils: { shadowSelect(selector: unknown): Element | null } } }).axe.utils.shadowSelect(axeSelector),
        selector,
      )
      const element = handle.asElement()
      if (!element) {
        await handle.dispose()
        return undefined
      }
      try {
        const content = await element.contentFrame()
        return content ? libraryFrameDriver(content) : undefined
      } finally {
        await element.dispose()
      }
    },
  }
}
