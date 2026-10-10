import type { Browser, BrowserContext, Page } from 'playwright-core'

/**
 * The clipboard a probe pastes from, and a lock on it. A browser has one clipboard for all its pages (headless
 * Chromium keeps its own, apart from the system's), so two probes that paste at the same time in one browser would
 * paste each other's values: every use goes through `withClipboard`, one at a time per browser. What the clipboard
 * held before is put back afterwards.
 *
 * A paste here is trusted: the probe writes the clipboard, focuses the field and presses the real shortcut
 * (Ctrl+V, or Cmd+V on macOS), so the browser runs its own paste command and the page receives a trusted `paste`
 * event and a `beforeinput` of type `insertFromPaste`. A synthetic `ClipboardEvent` is never dispatched: it carries
 * no data the browser inserts, so fields that trim a pasted value or spread a code across boxes would look blocked.
 */

const locks = new WeakMap<Browser, Promise<void>>()

/** Runs `fn` with the browser's clipboard to itself. */
export async function withClipboard<T>(browser: Browser, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(browser) ?? Promise.resolve()
  let release: () => void = () => undefined
  const mine = new Promise<void>((resolve) => {
    release = resolve
  })
  locks.set(
    browser,
    previous.then(() => mine),
  )
  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

/** Lets the page read and write the clipboard, as a person's browser lets a site they paste into. */
export async function allowClipboard(context: BrowserContext): Promise<boolean> {
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    return true
  } catch {
    return false
  }
}

/** Writes `text` and reads it back: false when the clipboard is not available to the page. */
export async function writeClipboard(page: Page, text: string): Promise<boolean> {
  return page
    .evaluate(async (value) => {
      try {
        await navigator.clipboard.writeText(value)
        return (await navigator.clipboard.readText()) === value
      } catch {
        return false
      }
    }, text)
    .catch(() => false)
}

/** What the clipboard holds as text, or null when it cannot be read. */
export async function readClipboard(page: Page): Promise<string | null> {
  return page
    .evaluate(async () => {
      try {
        return await navigator.clipboard.readText()
      } catch {
        return null
      }
    })
    .catch(() => null)
}

/** The real paste shortcut, pressed on the focused element. */
export async function pasteShortcut(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+V')
}
