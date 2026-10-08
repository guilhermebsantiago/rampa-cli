// Renders the README media from the real CLI: the intro GIF and its static
// frame, terminal screenshots and the banner. Run with `pnpm media`.
// Needs Chrome or Edge, network access for Google Fonts, and either a model
// or cached judgments (.rampa/cache) for the screenshots of the judgment layer.

import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import gifenc from 'gifenc'
import { PNG } from 'pngjs'
import type { Page } from 'playwright-core'
import { menu, scene } from '../src/cli/intro.ts'
import { paint } from '../src/report/color.ts'
import { launchBrowser } from '../src/surfaces/web.ts'

process.env.FORCE_COLOR = '1'
const OUT = 'docs/media'
const FONTS =
  'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap'

// GitHub's dark palette, so the screenshots look native on the repository page.
const TERMINAL_CSS = `
  :root { --bg:#0d1117; --chrome:#161b22; --border:#30363d; --fg:#e6edf3; --red:#ff7b72; --green:#3fb950;
          --yellow:#d29922; --cyan:#39c5cf; --gray:#8b949e; --prompt:#7ee787; }
  html, body { margin:0; background:transparent; }
  .window { display:inline-block; min-width:760px; background:var(--bg); border:1px solid var(--border); overflow:hidden; }
  .rounded { border-radius:12px; }
  .bar { height:34px; background:var(--chrome); display:flex; align-items:center; gap:8px; padding:0 14px;
         border-bottom:1px solid var(--border); font:600 13px 'Atkinson Hyperlegible', sans-serif; color:var(--gray); }
  .dot { width:12px; height:12px; border-radius:50%; }
  .r { background:#ff5f56 } .y { background:#ffbd2e } .g { background:#27c93f }
  .title { flex:1; text-align:center; margin-right:52px; }
  pre { margin:0; padding:16px 22px 20px; font:15px/1.5 'JetBrains Mono', monospace; color:var(--fg); white-space:pre; }
  .b { font-weight:700 } .d { opacity:.68 } .red { color:var(--red) } .green { color:var(--green) }
  .yellow { color:var(--yellow) } .cyan { color:var(--cyan) } .gray { color:var(--gray) }
  .ps { color:var(--prompt) } .cur { background:var(--fg); color:var(--bg) }
  .tight pre { line-height:1.25 }
  /* Block elements drawn as cells, the way terminals render them: no gaps between rows or columns. */
  .k { display:inline-block; width:1ch; height:1lh; vertical-align:top; }
  .kf { background:currentColor }
  .ku { background:linear-gradient(currentColor 50%, transparent 50%) }
  .kd { background:linear-gradient(transparent 50%, currentColor 50%) }
  .k1 { background:linear-gradient(transparent 87.5%, currentColor 87.5%) }
  .k3 { background:linear-gradient(transparent 62.5%, currentColor 62.5%) }
  .k5 { background:linear-gradient(transparent 37.5%, currentColor 37.5%) }
  .k7 { background:linear-gradient(transparent 12.5%, currentColor 12.5%) }
`

const BLOCKS: Record<string, string> = { '█': 'kf', '▀': 'ku', '▄': 'kd', '▁': 'k1', '▃': 'k3', '▅': 'k5', '▇': 'k7' }

function terminalPage(title: string, rounded: boolean, tight = false): string {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>${TERMINAL_CSS}</style></head>
<body class="${tight ? 'tight' : ''}"><div class="window${rounded ? ' rounded' : ''}" id="window"><div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">${title}</span></div><pre id="screen"></pre></div></body></html>`
}

const SGR_COLORS: Record<number, string> = { 31: 'red', 32: 'green', 33: 'yellow', 36: 'cyan', 90: 'gray' }

/** The few SGR codes the CLI emits (bold, dim, five colors) become spans. */
export function ansiToHtml(input: string): string {
  const text = input.replace(/\x1b\[2K|\r/g, '')
  let bold = false
  let dim = false
  let fg: string | undefined
  let html = ''
  let last = 0
  const flush = (chunk: string) => {
    if (!chunk) return
    const escaped = [...chunk]
      .map((ch) => (BLOCKS[ch] ? `<i class="k ${BLOCKS[ch]}"></i>` : ch.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')))
      .join('')
    const classes = [bold ? 'b' : '', dim ? 'd' : '', fg ?? ''].filter(Boolean)
    html += classes.length > 0 ? `<span class="${classes.join(' ')}">${escaped}</span>` : escaped
  }
  for (const match of text.matchAll(/\x1b\[([\d;]*)m/g)) {
    flush(text.slice(last, match.index))
    last = match.index + match[0].length
    for (const code of (match[1] || '0').split(';').map(Number)) {
      if (code === 0) {
        bold = false
        dim = false
        fg = undefined
      } else if (code === 1) bold = true
      else if (code === 2) dim = true
      else if (code === 22) {
        bold = false
        dim = false
      } else if (code === 39) fg = undefined
      else if (SGR_COLORS[code]) fg = SGR_COLORS[code]
    }
  }
  flush(text.slice(last))
  return html
}

const prompt = (command: string, cursor = false) =>
  `<span class="ps">$</span> ${command}${cursor ? '<span class="cur"> </span>' : ''}`

async function setScreen(page: Page, html: string): Promise<void> {
  await page.evaluate((value) => {
    const screen = document.getElementById('screen')
    if (screen) screen.innerHTML = value
  }, html)
}

async function shot(page: Page): Promise<Buffer> {
  return page.locator('#window').screenshot({ omitBackground: true })
}

/** The intro as people see it: type `rampa`, the stairs become a ramp, the menu appears. */
async function renderIntro(page: Page): Promise<void> {
  const p = paint(true)
  const frames: Array<{ html: string; delay: number }> = []
  frames.push({ html: prompt('', true), delay: 500 })
  for (let i = 1; i <= 'rampa'.length; i++) frames.push({ html: prompt('rampa'.slice(0, i), true), delay: 90 })
  const withPrompt = (lines: string[]) => `${prompt('rampa')}\n${ansiToHtml(lines.join('\n'))}`
  for (let rows = 0; rows <= 4; rows++) frames.push({ html: withPrompt(scene(rows, 0, p, 'en')), delay: 120 })
  for (let columns = 4; columns < 21; columns += 4) frames.push({ html: withPrompt(scene(4, columns, p, 'en')), delay: 60 })
  const finalScene = scene(4, 21, p, 'en')
  frames.push({ html: withPrompt(finalScene), delay: 300 })
  frames.push({ html: `${withPrompt(finalScene)}${ansiToHtml(menu('en'))}`, delay: 6000 })

  // Fix the window size to the largest frame so every frame has the same dimensions.
  await setScreen(page, frames.at(-1)?.html ?? '')
  const box = await page.locator('#window').boundingBox()
  if (!box) throw new Error('terminal window not rendered')
  await page.locator('#window').evaluate((el, size) => {
    ;(el as HTMLElement).style.width = `${size.width}px`
    ;(el as HTMLElement).style.height = `${size.height}px`
  }, box)

  const gif = gifenc.GIFEncoder()
  let first = true
  let last: Buffer | undefined
  for (const frame of frames) {
    await setScreen(page, frame.html)
    last = await shot(page)
    const png = PNG.sync.read(last)
    const palette = gifenc.quantize(png.data, 256)
    gif.writeFrame(gifenc.applyPalette(png.data, palette), png.width, png.height, {
      palette,
      delay: frame.delay,
      // Plays once: the motion lasts about 2 s, well under the 5 s of WCAG 2.2.2.
      ...(first ? { repeat: -1 } : {}),
    })
    first = false
  }
  gif.finish()
  await writeFile(join(OUT, 'intro.gif'), gif.bytes())
  if (last) await writeFile(join(OUT, 'intro.png'), last)
}

function run(args: string[]): string {
  const result = spawnSync(process.execPath, ['dist/cli.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '1' },
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return result.stdout
}

async function renderCommand(page: Page, name: string, shown: string, args: string[], keep?: (line: string) => boolean): Promise<void> {
  const output = run(args)
  const lines = output.split('\n').filter((line) => (keep ? keep(line) : true))
  await setScreen(page, `${prompt(shown)}\n${ansiToHtml(lines.join('\n').replace(/\n+$/, ''))}`)
  await writeFile(join(OUT, `${name}.png`), await shot(page))
}

function bannerPage(theme: 'light' | 'dark'): string {
  const c =
    theme === 'light'
      ? { fg: '#1f2328', sub: '#57606a', accent: '#0b7285', soft: '#99d8e0', stairs: '#afb8c1' }
      : { fg: '#e6edf3', sub: '#9198a1', accent: '#39c5cf', soft: '#1b5a63', stairs: '#3d444d' }
  // A staircase outline with a ramp laid over it: the name, drawn.
  const xh = (y: number) => 40 + (240 - y) * 1.6
  const bands = [40, 92, 144, 196]
    .map((y, i) => {
      const h = 42
      const fill = i === 3 ? c.accent : i === 2 ? c.accent : c.soft
      return `<polygon points="${xh(y + h)},${y + h} ${xh(y)},${y} 360,${y} 360,${y + h}" fill="${fill}" opacity="${0.55 + i * 0.15}"/>`
    })
    .join('')
  const stairs = 'M40 240 V190 H120 V140 H200 V90 H280 V40 H360 V240 Z'
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>
  html, body { margin:0; background:transparent; }
  .banner { width:1320px; height:300px; display:flex; align-items:center; gap:56px; padding:0 40px; box-sizing:border-box; }
  .name { font:700 104px/1 'Atkinson Hyperlegible', sans-serif; color:${c.fg}; letter-spacing:-1px; }
  .tag { font:400 34px/1.25 'Atkinson Hyperlegible', sans-serif; color:${c.fg}; margin-top:14px; }
  .sub { font:400 20px/1.4 'Atkinson Hyperlegible', sans-serif; color:${c.sub}; margin-top:14px; }
  .accent { color:${c.accent}; }
  </style></head><body><div class="banner" id="banner">
  <svg width="400" height="280" viewBox="0 0 400 280" role="img" aria-label="A staircase turned into a ramp">
    <path d="${stairs}" fill="none" stroke="${c.stairs}" stroke-width="3" stroke-dasharray="8 7"/>${bands}
  </svg>
  <div><div class="name">rampa</div>
  <div class="tag">Accessibility checks <span class="accent">beyond syntax</span></div>
  <div class="sub">axe-core decides what rules can · a model judges the rest · every claim needs evidence</div></div>
  </div></body></html>`
}

await mkdir(OUT, { recursive: true })
const browser = await launchBrowser()
try {
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } })
  const page = await context.newPage()

  for (const theme of ['light', 'dark'] as const) {
    await page.setContent(bannerPage(theme), { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await writeFile(join(OUT, `banner-${theme}.png`), await page.locator('#banner').screenshot({ omitBackground: true }))
  }

  await page.setContent(terminalPage('rampa', false, true), { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await renderIntro(page)

  await page.setContent(terminalPage('rampa', true), { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await renderCommand(page, 'check-before', 'rampa check examples/store/before.html', ['check', 'examples/store/before.html'])
  await renderCommand(page, 'check-after', 'rampa check examples/store/after.html', ['check', 'examples/store/after.html'])
  await renderCommand(
    page,
    'check-pt-br',
    'rampa check examples/non-text-content/alt-quality.html --locale pt-BR',
    ['check', 'examples/non-text-content/alt-quality.html', '--locale', 'pt-BR'],
  )
  await renderCommand(page, 'eval', 'rampa eval --criteria 3.1.2,1.1.1', ['eval', '--criteria', '3.1.2,1.1.1'], (line) => !line.includes('Results:'))
  console.log(`media written to ${OUT}/`)
} finally {
  await browser.close()
}
