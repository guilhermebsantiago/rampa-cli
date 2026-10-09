import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import { afterAll, describe, expect, it } from 'vitest'
import { identifyInputPurpose } from '../src/criteria/identify-input-purpose.ts'
import { imagesOfText } from '../src/criteria/images-of-text.ts'
import { labelsOrInstructions } from '../src/criteria/labels-or-instructions.ts'
import { languageOfParts } from '../src/criteria/language-of-parts.ts'
import { attributesOf } from '../src/criteria/shared.ts'
import { type Corruptor, autocompleteDrop, autocompleteSwap, labelHidden, textAsImage } from '../src/eval/pairs.ts'
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

  it('captures an image without the fixed layers painted over it, and puts them back', async () => {
    if (!browser) return
    const screenshots = await mkdtemp(join(tmpdir(), 'rampa-shots-'))
    const { snapshot } = await collectWeb(browser, await page(OVERLAY), { runAxe: false, locale: 'en', captureImages: true, screenshotDir: screenshots })
    const nodes = [...walkTree(snapshot.root)]
    // The photo under the cookie banner comes out green only; the logo inside the sticky header still shows.
    expect(colorsOf(nodes.find((n) => attributesOf(n).id === 'photo')?.image)).toEqual(['0,128,0'])
    expect(colorsOf(nodes.find((n) => attributesOf(n).id === 'logo')?.image)).toEqual(['0,0,255'])
    // The full-page screenshot, taken after the captures, has the banner back.
    const page_ = PNG.sync.read(await readFile(snapshot.screenshot ?? ''))
    let red = 0
    for (let i = 0; i < page_.data.length; i += 4) if (page_.data[i] === 255 && page_.data[i + 1] === 0 && page_.data[i + 2] === 0) red++
    expect(red).toBeGreaterThan(1000)
  })
})

describe.skipIf(!browser)('corrupted pairs', { timeout: 30_000 }, () => {
  const collect = async (html: string, corruptor: Corruptor, captureImages = false) => {
    let changed = 0
    const collected = await collectWeb(browser as NonNullable<typeof browser>, await page(html), {
      runAxe: true,
      locale: 'en',
      captureImages,
      mutate: async (p) => {
        changed = await corruptor.apply(p)
      },
    })
    return { ...collected, changed, nodes: [...walkTree(collected.snapshot.root)] }
  }
  const violations = (engine: { rules: { ruleId: string; outcome: string }[] }, ruleId: string) =>
    engine.rules.filter((rule) => rule.ruleId === ruleId && rule.outcome === 'violation').length

  it('label-hidden moves visible labels into aria-label, which the engine accepts', async () => {
    const { snapshot, engine, changed, nodes } = await collect(LABELS, labelHidden)
    expect(changed).toBe(3)
    // The checkbox keeps its label: the corruption leaves controls that name themselves alone.
    expect(nodes.filter((n) => n.native.tag === 'input').map((n) => `${n.role}:${n.name}`)).toEqual([
      'textbox:First name:',
      'textbox:Date of birth:',
      'textbox:Shipping Name',
      'checkbox:Remember me',
    ])
    expect(labelsOrInstructions.candidates(snapshot, engine).map((c) => c.context.hiddenSource)).toEqual(['aria-label', 'aria-label', 'aria-label'])
    expect(violations(engine, 'label')).toBe(0)
  })

  it('autocomplete-drop and autocomplete-swap change tokens and keep the syntax valid', async () => {
    const dropped = await collect(TOKENS, autocompleteDrop)
    expect(dropped.changed).toBe(3)
    expect(dropped.nodes.filter((n) => attributesOf(n).autocomplete !== undefined)).toHaveLength(0)
    const swapped = await collect(TOKENS, autocompleteSwap)
    // The password field takes no name-suffix token, so it keeps its own.
    expect(swapped.changed).toBe(2)
    expect(swapped.nodes.flatMap((n) => attributesOf(n).autocomplete ?? [])).toEqual(['shipping honorific-suffix', 'current-password', 'honorific-suffix'])
    expect(violations(swapped.engine, 'autocomplete-valid')).toBe(0)
  })

  it('text-as-image swaps a photo for a legible picture of a sentence', async () => {
    const { changed, nodes } = await collect(PHOTO, textAsImage, true)
    expect(changed).toBe(1)
    const image = nodes.find((n) => n.native.tag === 'img')
    expect(image?.name).toBe('Members save twenty percent this week')
    // Dark text on white: the capture has both.
    const colors = colorsOf(image?.image)
    expect(colors).toContain('255,255,255')
    expect(colors.some((color) => color.split(',').every((channel) => Number(channel) < 80))).toBe(true)
  })
})

const LABELS = `<!doctype html><html lang="en"><body>
<label>First name:<input id="fname" type="text" name="fname"></label>
<label for="dob">Date of birth:</label><input id="dob" type="date">
<div id="shipping">Shipping</div><span id="name">Name</span><input type="text" aria-labelledby="shipping name">
<label><input type="checkbox"> Remember me</label>
</body></html>`

const TOKENS = `<!doctype html><html lang="en"><body>
<label>Office email<input type="text" autocomplete="shipping work email"></label>
<label>Password<input type="password" autocomplete="current-password"></label>
<label>Street address<textarea autocomplete="street-address"></textarea></label>
</body></html>`

const PHOTO = `<!doctype html><html lang="en"><body><img alt="A green field under a clear sky" width="40" height="40" src="${svg('rgb(0,128,0)')}"></body></html>`

function colorsOf(image: string | undefined): string[] {
  const png = PNG.sync.read(Buffer.from((image ?? '').split(',')[1] ?? '', 'base64'))
  const colors = new Set<string>()
  for (let i = 0; i < png.data.length; i += 4) colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`)
  return [...colors]
}

function svg(color: string): string {
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='100'><rect width='300' height='100' fill='${color}'/></svg>`
}

const OVERLAY = `<!doctype html><html lang="en"><head><style>
body { margin: 0; }
header { position: sticky; top: 0; height: 60px; background: white; }
#logo { width: 120px; height: 40px; display: block; }
#photo { width: 300px; height: 100px; display: block; margin-top: 20px; }
.cookies { position: fixed; left: 0; top: 70px; width: 100%; height: 60px; background: rgb(255, 0, 0); }
</style></head><body>
<header><img id="logo" alt="Shop" src="${svg('rgb(0,0,255)')}"></header>
<img id="photo" alt="A green field" src="${svg('rgb(0,128,0)')}">
<div class="cookies">We use cookies</div>
</body></html>`

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
