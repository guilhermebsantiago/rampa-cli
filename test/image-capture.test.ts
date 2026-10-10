import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import { afterAll, describe, expect, it } from 'vitest'
import { fileCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import { nonTextContent } from '../src/criteria/non-text-content.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { providerIdentity } from '../src/providers/ai-sdk.ts'
import { imageSkipOf, uncapturedImagesNote } from '../src/snapshot/image-skips.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { flatColor } from '../src/surfaces/image-capture.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'

// Integration: needs Chrome or Edge (or Playwright's Chromium). Skipped when none is installed.
const browser = await launchBrowser().catch(() => undefined)
afterAll(async () => browser?.close())

const COLORS = { red: 'rgb(255,0,0)', green: 'rgb(0,128,0)', blue: 'rgb(0,0,255)', teal: 'rgb(0,128,128)' }
const svg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="${color}"/></svg>`
/** A transparent 1×1 GIF, the stand-in lazy loaders put in src until the swap. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** The page, with one SVG file per color next to it, so the images load from addresses as on a real site. */
async function site(html: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rampa-capture-'))
  for (const [name, color] of Object.entries(COLORS)) await writeFile(join(dir, `${name}.svg`), svg(color), 'utf8')
  await writeFile(join(dir, 'teal-copy.svg'), svg(COLORS.teal), 'utf8')
  await writeFile(join(dir, 'page.html'), html, 'utf8')
  return pathToFileURL(join(dir, 'page.html')).href
}

function colorsOf(image: string | undefined): string[] {
  const png = PNG.sync.read(Buffer.from((image ?? '').split(',')[1] ?? '', 'base64'))
  const colors = new Set<string>()
  for (let i = 0; i < png.data.length; i += 4) colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`)
  return [...colors]
}

async function collect(html: string): Promise<Map<string, A11yNode>> {
  if (!browser) throw new Error('no browser')
  const { snapshot } = await collectWeb(browser, await site(html), { runAxe: false, locale: 'en', captureImages: true })
  const byId = new Map<string, A11yNode>()
  for (const node of walkTree(snapshot.root)) {
    const id = (node.native.attributes as Record<string, string> | undefined)?.id
    if (id) byId.set(id, node)
  }
  return byId
}

const STYLE = '<style>body { margin: 0; } img { display: block; width: 300px; height: 100px; }</style>'

const LAZY = `<!doctype html><html lang="en"><head>${STYLE}</head><body>
<div style="height: 3000px"></div>
<img id="swapped" class="lazy" alt="A green field" src="${PIXEL}" data-src="green.svg">
<img id="stuck" alt="A red barn" src="${PIXEL}" data-src="red.svg">
<script>
// Swaps data-src in a while after the image comes into view, as lazy loaders do.
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    observer.unobserve(entry.target)
    setTimeout(() => { entry.target.src = entry.target.dataset.src }, 300)
  }
})
for (const img of document.querySelectorAll('img.lazy')) observer.observe(img)
</script></body></html>`

// Three slides stacked in one box, as the dev page www.ufc.br/pt has them: the first shows, the others are transparent.
const CAROUSEL = `<!doctype html><html lang="en"><head>${STYLE}<style>
#slides { position: relative; width: 300px; height: 100px; }
.slide { position: absolute; inset: 0; opacity: 0; transition: opacity 700ms; }
.slide.active { opacity: 1; }
</style></head><body><div id="slides">
<div class="slide active"><a href="#one"><img id="one" alt="Slide one" src="red.svg"></a></div>
<div class="slide"><a href="#two"><img id="two" alt="Slide two" src="green.svg"></a></div>
<div class="slide"><a href="#three"><img id="three" alt="Slide three" src="blue.svg"></a></div>
</div></body></html>`

// Two pictures in one box whose pixels are the same: a capture cannot tell which one it shows.
const TWINS = `<!doctype html><html lang="en"><head>${STYLE}<style>
#twins { position: relative; width: 300px; height: 100px; }
#twins img { position: absolute; inset: 0; }
</style></head><body><div id="twins">
<img id="first" alt="A teal wall" src="teal.svg"><img id="second" alt="A teal door" src="teal-copy.svg">
</div></body></html>`

// Each case in a box of its own, so no two pictures share one (that would make them a stack).
const OUT_OF_SIGHT = `<!doctype html><html lang="en"><head>${STYLE}<style>section { height: 120px; }</style></head><body>
<nav style="position: fixed; left: -320px; top: 0; width: 300px"><img id="menu-logo" alt="Shop" src="blue.svg"></nav>
<section><div style="height: 0; overflow: hidden"><img id="folded" alt="A map of the campus" src="green.svg"></div></section>
<section><img id="faded" alt="A red barn" src="red.svg" style="opacity: 0"></section>
<section><canvas id="chart" aria-label="Sales by month" width="300" height="100"></canvas></section>
<section><img id="shown" alt="A blue sky" src="blue.svg"></section>
</body></html>`

// Pictures hidden from assistive technology: an unnamed svg and a canvas that may carry information, and the
// decorative ones the cheap signals leave alone (a repeated icon, an icon-sized svg, an svg inside a named link).
const HIDDEN = `<!doctype html><html lang="en"><head>${STYLE}<style>section { height: 140px; }</style></head><body>
<section><svg id="badge" width="200" height="100" viewBox="0 0 200 100"><rect width="100" height="100" fill="rgb(0,0,255)"/><rect x="100" width="100" height="100" fill="rgb(255,0,0)"/></svg></section>
<section><canvas id="drawn" width="200" height="100"></canvas></section>
<section>${['one', 'two', 'three'].map((id) => `<svg id="${id}" width="48" height="48"><rect width="48" height="48" fill="rgb(0,128,0)"/></svg>`).join('')}</section>
<section><svg id="tiny" width="20" height="20"><rect width="20" height="20" fill="rgb(0,0,255)"/></svg></section>
<section><a href="#next"><svg id="arrow" width="100" height="100"><rect width="100" height="100" fill="rgb(255,0,0)"/></svg> Next page</a></section>
<section><svg id="named" role="img" aria-label="A green square" width="100" height="100"><rect width="100" height="100" fill="rgb(0,128,0)"/></svg></section>
<script>
const context = document.getElementById('drawn').getContext('2d')
context.fillStyle = 'rgb(0,128,128)'
context.fillRect(0, 0, 200, 100)
</script></body></html>`

describe.skipIf(!browser)('image capture', { timeout: 60_000 }, () => {
  it('crops svg and canvas images hidden from assistive technology as rendered, and leaves the decorative ones alone', async () => {
    const nodes = await collect(HIDDEN)
    expect(colorsOf(nodes.get('badge')?.image).sort()).toEqual(['0,0,255', '255,0,0'])
    expect(colorsOf(nodes.get('drawn')?.image)).toEqual(['0,128,128'])
    expect(nodes.get('badge')?.native.svgHash).toMatch(/^[0-9a-f]{8}$/)
    for (const id of ['one', 'two', 'three', 'tiny', 'arrow']) {
      expect(nodes.get(id)?.image, id).toBeUndefined()
      expect(imageSkipOf(nodes.get(id) as A11yNode), id).toBeUndefined()
    }
    // An svg with role="img" and a name is an image like any other.
    expect(colorsOf(nodes.get('named')?.image)).toEqual(['0,128,0'])
  })

  it('waits for a lazy image to swap in its picture, and leaves out one that never does', async () => {
    const nodes = await collect(LAZY)
    expect(colorsOf(nodes.get('swapped')?.image)).toEqual(['0,128,0'])
    expect(nodes.get('stuck')?.image).toBeUndefined()
    expect(imageSkipOf(nodes.get('stuck') as A11yNode)).toBe('placeholder')
  })

  it('captures each slide of a stacked carousel alone, with its own pixels', async () => {
    const nodes = await collect(CAROUSEL)
    expect(colorsOf(nodes.get('one')?.image)).toEqual(['255,0,0'])
    expect(colorsOf(nodes.get('two')?.image)).toEqual(['0,128,0'])
    expect(colorsOf(nodes.get('three')?.image)).toEqual(['0,0,255'])
  })

  it('leaves out stacked images whose captures cannot be told apart', async () => {
    const nodes = await collect(TWINS)
    for (const id of ['first', 'second']) {
      expect(nodes.get(id)?.image).toBeUndefined()
      expect(imageSkipOf(nodes.get(id) as A11yNode)).toBe('stacked')
    }
  })

  it('leaves out images outside the page, cut off, transparent or blank, and says why', async () => {
    const nodes = await collect(OUT_OF_SIGHT)
    const reasons = Object.fromEntries(['menu-logo', 'folded', 'faded', 'chart', 'shown'].map((id) => [id, imageSkipOf(nodes.get(id) as A11yNode)]))
    expect(reasons).toEqual({ 'menu-logo': 'outside-page', folded: 'clipped', faded: 'not-shown', chart: 'blank', shown: undefined })
    expect(colorsOf(nodes.get('shown')?.image)).toEqual(['0,0,255'])
  })
})

describe('images left without a capture', () => {
  const image = (ref: string, reason?: string): A11yNode => ({
    ref,
    role: 'img',
    name: 'A photo',
    states: [],
    bounds: { x: 0, y: 0, width: 300, height: 100 },
    native: { tag: 'img', attributes: { alt: 'A photo', src: 'photo.jpg' }, ...(reason ? { imageSkipped: reason } : {}) },
    children: [],
  })
  const snapshot = (children: A11yNode[]): A11ySnapshot => ({
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: { ref: 'html', role: 'document', states: [], native: { tag: 'html' }, children },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'rampa-web', version: '0.0.0' },
  })

  it('sums up the reasons in one note, in the report language', () => {
    const root = snapshot([image('#a', 'stacked'), image('#b', 'stacked'), image('#c', 'outside-page'), image('#d')]).root
    expect(uncapturedImagesNote(root, 'en')).toBe(
      '3 image(s) were left without a capture, so no judgment looked at them: 1 outside the page (an off-canvas menu); 2 stacked with other images in one box and captured the same as them. The snapshot says why for each (native.imageSkipped).',
    )
    expect(uncapturedImagesNote(root, 'pt-BR')).toContain('2 empilhada com outras imagens')
    expect(uncapturedImagesNote(snapshot([image('#d')]).root, 'en')).toBeUndefined()
  })

  it('puts the note in the report when a criterion that judges pixels runs', async () => {
    const options = {
      llm: true,
      provider: {
        ...providerIdentity('ollama:gemma4:12b'),
        judge(): never {
          throw new Error('offline')
        },
      },
      runs: 1,
      cache: fileCache(await mkdtemp(join(tmpdir(), 'rampa-cache-'))),
      offline: true,
      locale: 'en' as const,
      minConfidence: 'medium' as const,
      concurrency: 1,
    }
    const page = snapshot([image('#a', 'clipped')])
    const judged = await checkSnapshot(page, emptyEngine(), { ...options, criteria: [nonTextContent] })
    expect(judged.notes).toEqual([expect.stringContaining('1 cut off by the box that holds it')])
    // No criterion looked at pixels, so nothing was left out of one.
    const unjudged = await checkSnapshot(page, emptyEngine(), { ...options, criteria: [] })
    expect(unjudged.notes).toBeUndefined()
  })

  it('tells a flat capture from a picture', () => {
    const png = (pixels: number[][]) => {
      const image = new PNG({ width: pixels.length, height: 1 })
      pixels.forEach((rgba, i) => image.data.set(rgba, i * 4))
      return PNG.sync.write(image)
    }
    expect(flatColor(png([[255, 255, 255, 255], [252, 255, 253, 255]]))).toBe(0xffffffff)
    expect(flatColor(png([[255, 255, 255, 255], [0, 0, 0, 255]]))).toBeUndefined()
  })
})
