/**
 * How a web ref names an element past the top document. A ref is a CSS selector, and two separators extend it
 * where one selector cannot reach:
 *
 * - `host >>> path`: `path` inside the open shadow root of the element `host` names;
 * - `frame |> path`: `path` inside the document shown by the <iframe> or <frame> that `frame` names.
 *
 * They nest, as in `iframe:nth-of-type(2) |> my-card >>> button`. Each part is a chain of compounds, parent
 * `>` child, scoped to its own document or shadow root: in a document it starts at a unique `#id` or at
 * `html`, in a shadow root at one of the root's own children. Neither separator can occur inside a part,
 * because ids are escaped with CSS.escape, which escapes spaces, `>` and `|`.
 *
 * The collector (surfaces/in-page.ts) and the probe kit (probes/kit.ts) build refs this way; a test holds
 * them to the same strings. Every place that finds an element by its ref goes through `resolveRefInPage`,
 * or through `elementForRef` when the element sits in a frame the page itself cannot read.
 */

export const SHADOW_SEPARATOR = ' >>> '
export const FRAME_SEPARATOR = ' |> '

/** Whether the ref reaches into a shadow root or a frame: it is no longer a plain CSS selector. */
export function isQualifiedRef(ref: string): boolean {
  return ref.includes(SHADOW_SEPARATOR) || ref.includes(FRAME_SEPARATOR)
}

/** Whether the element is in a frame's document rather than the page's own. */
export function refInFrame(ref: string): boolean {
  return ref.includes(FRAME_SEPARATOR)
}

/** The ref of the frame element that holds the element, or undefined when it is in the page's own document. */
export function frameOfRef(ref: string): string | undefined {
  const at = ref.lastIndexOf(FRAME_SEPARATOR)
  return at === -1 ? undefined : ref.slice(0, at)
}

/**
 * Runs in the page (serialized by the browser library, so it references nothing outside its body): the element
 * a ref names, through open shadow roots and the documents of frames this page may read; null when it names
 * none or a part does not parse. Started in a frame's own context, it resolves a ref relative to that frame.
 */
export function resolveRefInPage(ref: string): Element | null {
  const isDocument = (scope: Node): boolean => scope.nodeType === 9
  // A part is parent > child from its anchor. In a document the anchor (a unique #id, or html) is found by
  // the selector itself; a shadow root's children have no parent element to anchor them, so the chain is
  // walked one child at a time from the root, which a selector could match at any depth.
  const select = (scope: Document | ShadowRoot, path: string): Element | null => {
    if (isDocument(scope)) {
      try {
        return scope.querySelector(path)
      } catch {
        return null
      }
    }
    let pool: Element[] = Array.from(scope.children)
    let current: Element | null = null
    for (const step of path.split(' > ')) {
      let found: Element | undefined
      try {
        found = pool.find((child) => child.matches(step))
      } catch {
        return null
      }
      if (!found) return null
      current = found
      pool = Array.from(found.children)
    }
    return current
  }
  let scope: Document | ShadowRoot | null = document
  let el: Element | null = null
  const frames = ref.split(' |> ')
  for (let f = 0; f < frames.length; f++) {
    if (f > 0) {
      let doc: Document | null = null
      try {
        doc = (el as HTMLIFrameElement | null)?.contentDocument ?? null
      } catch {
        doc = null
      }
      if (!doc) return null
      scope = doc
    }
    const parts = (frames[f] ?? '').split(' >>> ')
    for (let s = 0; s < parts.length; s++) {
      if (s > 0) scope = el?.shadowRoot ?? null
      if (!scope) return null
      el = select(scope, parts[s] ?? '')
      if (!el) return null
    }
  }
  return el
}

/** The source that installs `resolveRefInPage` as `window.__rampaResolve`, for in-page functions that cannot import it. */
export function resolverSource(): string {
  return `window.__rampaResolve = ${resolveRefInPage.toString()};`
}

/** A handle to a value in a page or a frame, as Playwright's and Puppeteer's JSHandle both give it. */
export interface HandleLike<E> {
  asElement(): E | null
  dispose(): Promise<void>
}

/** A frame that evaluates a function with one argument and hands back a handle: Playwright and Puppeteer frames and pages. */
export interface HandleFrame<E> {
  // biome-ignore lint/suspicious/noExplicitAny: each library types evaluateHandle with its own generics
  evaluateHandle(fn: (arg: any) => unknown, arg: any): Promise<HandleLike<E>>
}

/** An element handle that may be a frame: Playwright's and Puppeteer's ElementHandle. */
export interface FrameElementLike<E> {
  contentFrame(): Promise<HandleFrame<E> | null>
  dispose(): Promise<void>
}

/**
 * The element a ref names, as a handle in the frame that holds it, so a screenshot of it is placed right. Each
 * frame part is resolved in its own frame, which also reaches frames of other origins. Undefined when any part
 * names nothing.
 */
export async function elementForRef<E extends FrameElementLike<E>>(top: HandleFrame<E>, ref: string): Promise<E | undefined> {
  const parts = ref.split(FRAME_SEPARATOR)
  let frame: HandleFrame<E> = top
  for (let i = 0; i < parts.length; i++) {
    const handle = await frame.evaluateHandle(resolveRefInPage, parts[i] ?? '')
    const element = handle.asElement()
    if (!element) {
      await handle.dispose()
      return undefined
    }
    if (i === parts.length - 1) return element
    const child = await element.contentFrame().catch(() => null)
    await element.dispose()
    if (!child) return undefined
    frame = child
  }
  return undefined
}
