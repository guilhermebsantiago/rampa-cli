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
import { captureImageNodes, flatColor } from '../src/surfaces/image-capture.ts'
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

// Content over a picture where it sits (usereserva.com.br's prize-wheel popup over its product photos, and
// thewhitecompany.com's cookie banner over a candle, in the sixth real-page study), and content of the picture's own card.
const COVERED = `<!doctype html><html lang="en"><head>${STYLE}<style>
section { height: 140px; position: relative; }
.card { position: relative; width: 300px; height: 100px; }
.caption { position: absolute; left: 0; bottom: 0; width: 300px; background: rgb(255,255,255); font: 14px sans-serif; }
.stretched { position: absolute; inset: 0; }
#banner { position: absolute; left: 0; width: 400px; height: 40px; background: rgb(20,20,20); color: white; }
#wrapper { position: absolute; inset: 0; pointer-events: auto; }
</style></head><body>
<section><img id="under-popup" alt="A linen shirt" src="green.svg"></section>
<section><img id="under-banner" alt="A large candle" src="red.svg"></section>
<section><div class="card"><img id="captioned" alt="A blue sky" src="blue.svg"><span class="caption">Sky over the bay</span><a class="stretched" href="#sky" aria-label="Sky"></a></div></section>
<section><img id="under-wrapper" alt="A teal door" src="teal.svg"></section>
<div style="height: 1500px"></div>
<section><img id="scrolled-to" alt="A teal wall" src="teal-copy.svg"></section>
<div id="wrapper"></div>
<div id="banner">We use cookies</div>
<script>
// The banner sits over the bottom of the second image only, at a corner and its centre line.
const second = document.getElementById('under-banner').getBoundingClientRect()
const banner = document.getElementById('banner')
banner.style.top = (second.top + window.scrollY + 70) + 'px'
// A popup added to the body over the first image, absolutely placed.
const first = document.getElementById('under-popup').getBoundingClientRect()
const popup = document.createElement('div')
popup.id = 'popup'
popup.style.cssText = 'position:absolute;left:0;width:320px;height:120px;background:rgb(250,200,0);top:' + (first.top + window.scrollY - 10) + 'px'
popup.textContent = 'Spin the wheel'
document.body.appendChild(popup)
// A popup fixed to the window that opens once the page scrolls, after the fixed layers were hidden: hidden for the capture too.
let opened = false
addEventListener('scroll', () => {
  if (opened || scrollY < 300) return
  opened = true
  const late = document.createElement('div')
  late.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6)'
  document.body.appendChild(late)
})
</script></body></html>`

// Layers fixed to the window over the page while consent is pending, as on www.gov.br/pt-br: a backdrop inside the header
// bar's open shadow root, which the fixed layers marked in the page's document do not take in, and a cookie bar along the
// bottom of the window, which keeps the backdrop from being the layer on top over most of the viewport, and lies over the
// last image, which cannot scroll above it. Further down, a popup fixed to the window whose content sets its own
// visibility, as OneTrust's banner does: hiding the popup alone leaves a box over the image's centre and a mark beside it,
// away from the points looked at, showing.
const CONSENT = `<!doctype html><html lang="en"><head>${STYLE}<style>
header { height: 100px; }
section { height: 140px; }
#cookies { position: fixed; left: 0; right: 0; bottom: 0; height: 150px; background: rgb(12,30,63); color: white; z-index: 1000; }
#popup { position: fixed; inset: 0; z-index: 50; }
#popup .sdk { visibility: visible; position: absolute; inset: 0; }
#popup .box { position: absolute; width: 100px; height: 40px; background: rgb(250,200,0); }
#popup .mark { position: absolute; width: 40px; height: 20px; background: rgb(20,20,20); }
</style></head><body>
<header><top-bar id="bar"></top-bar></header>
<section><img id="first-card" alt="A farmer" src="green.svg"></section>
<div style="height: 900px"></div>
<section><img id="lower-card" alt="A tourist" src="blue.svg"></section>
<footer style="height: 120px"><img id="last-card" alt="A seal" src="red.svg"></footer>
<div id="cookies">We use cookies. <button id="accept" onclick="window.accepted = true; this.parentElement.remove()">Accept cookies</button></div>
<script>
window.accepted = false
customElements.define('top-bar', class extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' }).innerHTML = '<style>.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 998; }</style><a href="#sign-in">Sign in</a><div class="overlay" role="button"></div>'
  }
})
// The popup opens once the page scrolls to the lower image: its box over the image's centre, its mark at the image's
// left between the centre and the corners.
addEventListener('scroll', () => {
  if (document.getElementById('popup') || scrollY < 600) return
  const image = document.getElementById('lower-card').getBoundingClientRect()
  const popup = document.createElement('div')
  popup.id = 'popup'
  popup.innerHTML = '<div class="sdk"><div class="box"></div><div class="mark"></div></div>'
  popup.querySelector('.box').style.cssText = 'left:' + (image.left + 100) + 'px;top:' + (image.top + 30) + 'px'
  popup.querySelector('.mark').style.cssText = 'left:' + (image.left + 45) + 'px;top:' + (image.top + 35) + 'px'
  document.body.appendChild(popup)
})
</script></body></html>`

// A consent dialog opened modally inside the open shadow root of a host fixed to the window, as on www.heals.com: in the
// top layer, it sets its own visibility, so neither the host's visibility nor its opacity hides it or its backdrop.
const MODAL = `<!doctype html><html lang="en"><head>${STYLE}</head><body>
<section><img id="under-modal" alt="A lamp" src="green.svg"></section>
<consent-notice id="notice" style="position: fixed; z-index: 10"></consent-notice>
<script>
customElements.define('consent-notice', class extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' })
    root.innerHTML = '<style>dialog { visibility: visible; margin: 0; inset: 0; width: 400px; height: 150px; border: 0; background: rgb(246,245,241); } dialog::backdrop { background: rgba(0,0,0,0.5); }</style><dialog><p>We use cookies.</p><button>Accept all</button></dialog>'
    root.querySelector('dialog').showModal()
  }
})
</script></body></html>`

// An offer shown as a popover, in the top layer, from a container fixed to the window: it sets its own visibility, and
// the container's opacity does not reach it, so it is hidden itself.
const POPOVER = `<!doctype html><html lang="en"><head>${STYLE}</head><body>
<section><img id="under-popover" alt="A chair" src="red.svg"></section>
<div id="promo" style="position: fixed; z-index: 5"><div id="offer" popover="manual" style="visibility: visible; margin: 0; inset: 0 auto auto 0; width: 400px; height: 150px; border: 0; background: rgb(250,200,0)">Ten percent off</div></div>
<script>document.getElementById('offer').showPopover()</script>
</body></html>`

// A consent banner fixed to the window from the start, whose content sets its own visibility as OneTrust's does
// (www.irishnews.com): its button lies over the top of the photo, away from the points looked at, so only hiding the
// marked layer keeps it out. A bar fixed to the window, which fades, holds a logo captured after the photo.
const ONETRUST = `<!doctype html><html lang="en"><head>${STYLE}<style>
#banner-sdk { position: fixed; inset: 0; z-index: 100; pointer-events: none; }
#banner-sdk .container { visibility: visible; position: absolute; left: 100px; top: 0; width: 100px; height: 20px; background: rgb(20,20,20); }
#bar { position: fixed; right: 0; bottom: 0; width: 320px; height: 120px; transition: opacity 1s; }
</style></head><body>
<img id="photo" alt="A match" src="green.svg">
<div style="height: 2000px"></div>
<div id="banner-sdk"><div class="container"><button>Manage Cookies</button></div></div>
<div id="bar"><img id="bar-logo" alt="Sponsor" src="blue.svg"></div>
</body></html>`

// An element with role="img" drawn by an img inside it: one whose lazy source is swapped in, and one never loaded.
const ROLE_IMG = `<!doctype html><html lang="en"><head>${STYLE}<style>.slide { width: 300px; height: 100px; } .slide img { width: 300px; height: 100px; }</style></head><body>
<div style="height: 1200px"></div>
<div id="loaded-slide" class="slide" role="img" title="A green field"><img class="lazy" alt="" data-src="green.svg"></div>
<div style="height: 200px"></div>
<div id="lazy-slide" class="slide" role="img" title="A large candle"><img alt="" data-src="red.svg"></div>
<script>
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    observer.unobserve(entry.target)
    setTimeout(() => { entry.target.src = entry.target.dataset.src }, 200)
  }
})
for (const img of document.querySelectorAll('img.lazy')) observer.observe(img)
</script></body></html>`

describe.skipIf(!browser)('image capture', { timeout: 60_000 }, () => {
  it('leaves out an image with other content laid over it, and captures one whose own card draws over it', async () => {
    const nodes = await collect(COVERED)
    const reasons = Object.fromEntries(['under-popup', 'under-banner', 'captioned', 'under-wrapper', 'scrolled-to'].map((id) => [id, imageSkipOf(nodes.get(id) as A11yNode)]))
    expect(reasons).toEqual({ 'under-popup': 'covered', 'under-banner': 'covered', captioned: undefined, 'under-wrapper': undefined, 'scrolled-to': undefined })
    expect(nodes.get('under-popup')?.image).toBeUndefined()
    // A caption and a link stretched over the picture belong to its card; a transparent wrapper over the page paints nothing.
    expect(colorsOf(nodes.get('captioned')?.image)).toContain('0,0,255')
    expect(colorsOf(nodes.get('under-wrapper')?.image)).toEqual(['0,128,128'])
    // The popup fixed to the window that opened on the scroll is hidden for the capture: the picture's own pixels, undimmed.
    expect(colorsOf(nodes.get('scrolled-to')?.image)).toEqual(['0,128,128'])
  })

  it('hides layers fixed to the window over an image for its capture, in a shadow root or opened late, and clicks nothing', async () => {
    const nodes = await collect(CONSENT)
    for (const id of ['first-card', 'lower-card', 'last-card']) expect(imageSkipOf(nodes.get(id) as A11yNode), id).toBeUndefined()
    // The pictures' own colors, not dimmed by the backdrop nor painted over by the popup's content or the cookie bar.
    expect(colorsOf(nodes.get('first-card')?.image)).toEqual(['0,128,0'])
    expect(colorsOf(nodes.get('lower-card')?.image)).toEqual(['0,0,255'])
    expect(colorsOf(nodes.get('last-card')?.image)).toEqual(['255,0,0'])
  })

  it('makes the marked layers transparent for image captures, so content that sets its own visibility stays out', async () => {
    const nodes = await collect(ONETRUST)
    expect(colorsOf(nodes.get('photo')?.image)).toEqual(['0,128,0'])
    // The bar was made transparent for the photo and holds the logo: back as the page has it, not fading in.
    expect(colorsOf(nodes.get('bar-logo')?.image)).toEqual(['0,0,255'])
  })

  it('hides a popover in the top layer over an image for its capture, and leaves out an image under a modal dialog', async () => {
    // Neither the popover nor its container: the picture's own color.
    const shown = await collect(POPOVER)
    expect(imageSkipOf(shown.get('under-popover') as A11yNode)).toBeUndefined()
    expect(colorsOf(shown.get('under-popover')?.image)).toEqual(['255,0,0'])
    // Under a modal dialog the page is inert: hit testing no longer sees what else lies over the image, so it is left out.
    const blocked = await collect(MODAL)
    expect(imageSkipOf(blocked.get('under-modal') as A11yNode)).toBe('covered')
    expect(blocked.get('under-modal')?.image).toBeUndefined()
  })

  it('hides the fixed layers on a test’s own page, which marks none, and puts them back after each capture', async () => {
    if (!browser) throw new Error('no browser')
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    try {
      await page.goto(await site(CONSENT))
      const image = (ref: string): A11yNode => ({
        ref,
        role: 'img',
        name: 'A photo',
        states: [],
        bounds: { x: 0, y: 0, width: 300, height: 100 },
        native: { tag: 'img', attributes: { alt: 'A photo' } },
        children: [],
      })
      const root: A11yNode = { ref: 'html', role: 'document', states: [], native: { tag: 'html' }, children: [image('#first-card'), image('#lower-card'), image('#last-card')] }
      await captureImageNodes(
        {
          // biome-ignore lint/suspicious/noExplicitAny: Playwright's evaluate infers its argument type from a generic it cannot see here
          evaluate: <Arg, Result>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg) => page.evaluate(fn as (arg: any) => Result | Promise<Result>, arg),
          screenshot: (ref) => page.locator(ref).screenshot({ type: 'png', animations: 'disabled', scale: 'css' }),
        },
        root,
      )
      const [first, lower, last] = root.children
      expect(colorsOf(first?.image)).toEqual(['0,128,0'])
      expect(colorsOf(lower?.image)).toEqual(['0,0,255'])
      expect(colorsOf(last?.image)).toEqual(['255,0,0'])
      // Every layer shows again as the page had it, and the cookie bar is still waiting for an answer.
      const after = await page.evaluate(() => ({
        accepted: (window as unknown as { accepted: boolean }).accepted,
        cookies: document.getElementById('cookies') ? getComputedStyle(document.getElementById('cookies') as Element).visibility : 'removed',
        backdrop: getComputedStyle(document.getElementById('bar')?.shadowRoot?.querySelector('.overlay') as Element).visibility,
        popup: getComputedStyle(document.getElementById('popup') as Element).visibility,
        content: getComputedStyle(document.querySelector('#popup .box') as Element).visibility,
        inline: [...document.querySelectorAll<HTMLElement>('#cookies, #popup, #popup .box'), document.getElementById('bar')?.shadowRoot?.querySelector<HTMLElement>('.overlay')].map(
          (el) => ['visibility', 'opacity', 'transition'].map((prop) => el?.style.getPropertyValue(prop) ?? '').join(''),
        ),
      }))
      expect(after).toEqual({ accepted: false, cookies: 'visible', backdrop: 'visible', popup: 'visible', content: 'visible', inline: ['', '', '', ''] })
    } finally {
      await page.close()
    }
  })

  it('waits for the img an element with role="img" draws with, and leaves the element out when it never loads', async () => {
    const nodes = await collect(ROLE_IMG)
    expect(colorsOf(nodes.get('loaded-slide')?.image)).toEqual(['0,128,0'])
    expect(nodes.get('lazy-slide')?.image).toBeUndefined()
    expect(imageSkipOf(nodes.get('lazy-slide') as A11yNode)).toBe('not-loaded')
  })

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
