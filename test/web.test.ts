import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { A11ySnapshotSchema } from '../src/snapshot/schema.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'

// Integration: needs Chrome or Edge (or Playwright's Chromium). Skipped when none is installed.
const browser = await launchBrowser().catch(() => undefined)
afterAll(async () => browser?.close())

const example = (name: string) => pathToFileURL(resolve('examples/language-of-parts', name)).href

// A cold browser on a CI runner needs more than the default 5 s for the first page.
describe.skipIf(!browser)('web surface', { timeout: 30_000 }, () => {
  it('collects a valid snapshot and runs axe-core', async () => {
    if (!browser) return
    const { snapshot, engine } = await collectWeb(browser, example('mismatch.html'), { runAxe: true, locale: 'en' })
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot.locale).toBe('en')
    expect(engine.engine.name).toBe('axe-core')
    const imageAlt = engine.rules.find((r) => r.ruleId === 'image-alt' && r.outcome === 'violation')
    expect(imageAlt?.nodes[0]?.ref).toBe('html > body > main > img')
    const validLang = engine.rules.find((r) => r.ruleId === 'valid-lang' && r.outcome === 'pass')
    expect(validLang?.nodes.map((n) => n.ref)).toContain('html > body > main > blockquote')
  })

  it('leaves text that is not rendered out of the judgment', async () => {
    if (!browser) return
    const page = 'data:text/html,<html lang="en"><body><p lang="es"><span style="display:none">Het weer is vandaag mooi en zonnig.</span></p></body></html>'
    const { snapshot, engine } = await collectWeb(browser, page, { runAxe: true, locale: 'en' })
    expect(languageOfParts.candidates(snapshot, engine)).toEqual([])
    expect(snapshot.root.native.html).toBe('<html lang="en">')
  })

  it('hands the judgment layer exactly the elements with a declared language', async () => {
    if (!browser) return
    const { snapshot, engine } = await collectWeb(browser, example('mismatch.html'), { runAxe: true, locale: 'en' })
    const candidates = languageOfParts.candidates(snapshot, engine)
    expect(candidates.map((c) => c.context.declared)).toEqual(['es', 'pt-BR'])
    expect(candidates[0]?.context.text).toContain('Het weer is vandaag mooi en zonnig')
    expect(candidates[0]?.context.html.startsWith('<blockquote lang="es">')).toBe(true)
  })
})
