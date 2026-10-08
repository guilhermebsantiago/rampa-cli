import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import { afterAll, describe, expect, it } from 'vitest'
import { identifyInputPurpose } from '../src/criteria/identify-input-purpose.ts'
import { imagesOfText } from '../src/criteria/images-of-text.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { attributesOf } from '../src/criteria/shared.ts'
import { A11ySnapshotSchema } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
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

  it('names a field by its label without the options it wraps, and marks fields that take no input', async () => {
    if (!browser) return
    const { snapshot, engine } = await collectWeb(browser, await page(FORM), { runAxe: true, locale: 'en' })
    const nodes = [...walkTree(snapshot.root)]
    expect(nodes.find((n) => n.native.tag === 'select')?.name).toBe('Birthday month')
    expect(nodes.find((n) => attributesOf(n).id === 'account')?.states).toContain('readonly')
    expect(identifyInputPurpose.candidates(snapshot, engine).map((c) => c.context.label)).toEqual(['Birthday month', 'Email'])
  })

  it('captures a CSS background as a picture, without the content drawn over it', async () => {
    if (!browser) return
    const { snapshot } = await collectWeb(browser, await page(BACKGROUNDS), { runAxe: false, locale: 'en', captureImages: true })
    const nodes = [...walkTree(snapshot.root)]
    const hero = nodes.find((n) => attributesOf(n).class === 'hero')
    expect(hero?.native.backgroundImage).toBe('data:…')
    expect(imagesOfText.candidates(snapshot, { engine: { name: 'none', version: '0' }, rules: [] }).map((c) => c.ref)).toEqual([hero?.ref])
    // The heading over the background is hidden in the capture: every pixel is the background's own color.
    const png = PNG.sync.read(Buffer.from((hero?.image ?? '').split(',')[1] ?? '', 'base64'))
    const colors = new Set<string>()
    for (let i = 0; i < png.data.length; i += 4) colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`)
    expect([...colors]).toEqual(['253,230,138'])
    // An icon-sized background holds no legible words and is not captured.
    expect(nodes.find((n) => attributesOf(n).class === 'icon')?.image).toBeUndefined()
  })
})

const FORM = `<!doctype html><html lang="en"><body><form>
<label>Birthday month <select><option>January</option><option>February</option></select></label>
<label>Account number <input id="account" readonly value="12345"></label>
<label>Email <input type="email"></label>
</form></body></html>`

const BACKGROUNDS = `<!doctype html><html lang="en"><head><style>
.hero { width: 400px; height: 120px; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='120'><rect width='400' height='120' fill='%23fde68a'/></svg>"); }
.hero h2 { margin: 0; color: #111; font: bold 48px sans-serif; }
.icon { display: inline-block; width: 16px; height: 16px; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16'/></svg>"); }
</style></head><body><div class="hero"><h2>Autumn arrivals</h2></div><span class="icon"></span></body></html>`

async function page(html: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rampa-web-'))
  const file = join(dir, 'page.html')
  await writeFile(file, html, 'utf8')
  return pathToFileURL(file).href
}
