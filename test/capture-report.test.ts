import { afterAll, describe, expect, it } from 'vitest'
import type { CaptureRecord } from '../src/core/capture.ts'
import type { Report } from '../src/core/types.ts'
import { AXE_TAGS, axeSource } from '../src/engine/axe.ts'
import { type Locale, type MessageKey, t } from '../src/i18n.ts'
import { paint } from '../src/report/color.ts'
import { captureLines, escapeHtml } from '../src/report/common.ts'
import { renderHtml } from '../src/report/html.ts'
import { prose, renderMarkdown } from '../src/report/markdown.ts'
import { renderReport } from '../src/report/pretty.ts'
import { toSarif } from '../src/report/sarif.ts'
import { launchBrowser } from '../src/surfaces/web.ts'
import { recordedReport } from './report-fixtures.ts'

/** A page read in full: styled, every image captured. */
const CLEAN: CaptureRecord = { version: 1, styled: true, images: { captured: 5, notCaptured: 0, reasons: {} } }

/** Every field of the record, each with something to say. */
const FULL: CaptureRecord = {
  version: 1,
  styled: false,
  styledBy: 'stylesheets',
  stylesheets: { linked: 4, applied: 0, failed: 4, retried: true },
  overlay: { selector: 'div#consent', coverage: 0.89, hidden: true },
  blocked: true,
  httpStatus: 403,
  cut: { elements: 5000 },
  unsettledAfterMs: 3000,
  loadTimedOutMs: 30000,
  images: { captured: 22, notCaptured: 16, reasons: { 'outside-page': 3, limit: 13 } },
  notJudged: [
    { criterion: '1.1.1', candidates: 30, timedOut: 4, offlineMisses: 2, errors: 1 },
    { criterion: '2.4.4', candidates: 78, capped: 28 },
  ],
}

const LINES: Record<Locale, string[]> = {
  en: [
    'The page was read without its styles: its linked stylesheets had not applied, even after one more load.',
    "The page's stylesheets: 0 of 4 applied, 4 failed, after one more load.",
    'A layer lay over the viewport when the page was read (div#consent, on top at 89% of the points sampled); it was hidden while images, labels and contrast were captured.',
    'The site sent a bot check or a refusal in place of the page.',
    'The server answered HTTP 403 for this address.',
    "The page was cut at 5000 elements, the collector's limit.",
    "The page's load event had not fired after 30000 ms; the page was read as it was then.",
    'The page was still changing (network or DOM) when the wait after load reached its cap of 3000 ms.',
    'Images: 22 captured, 16 not captured: 3 outside the page (an off-canvas menu); 13 over the limit of images captured per page.',
    'Candidates the model did not judge for 1.1.1: 4 of 30 after the time limit (--time-limit), 2 of 30 with no cached judgment (--offline), 1 of 30 where the model failed.',
    'Candidates the model did not judge for 2.4.4: 28 of 78 past the cap on candidates (--max-candidates).',
  ],
  'pt-BR': [
    'A página foi lida sem os estilos: as folhas de estilo da página não tinham sido aplicadas, mesmo depois de mais um carregamento.',
    'Folhas de estilo da página: 0 de 4 aplicadas, 4 com falha, depois de mais um carregamento.',
    'Uma camada cobria a área visível quando a página foi lida (div#consent, por cima em 89% dos pontos amostrados); ela foi escondida enquanto imagens, rótulos e contraste eram capturados.',
    'O site mandou uma verificação anti-robô ou uma recusa no lugar da página.',
    'O servidor respondeu HTTP 403 para este endereço.',
    'A página foi cortada em 5000 elementos, o limite do coletor.',
    'O evento load da página não tinha disparado após 30000 ms; a página foi lida como estava então.',
    'A página ainda estava mudando (rede ou DOM) quando a espera depois do carregamento chegou ao limite de 3000 ms.',
    'Imagens: 22 com captura, 16 sem captura: 3 fora da página (um menu fora da tela); 13 além do limite de imagens capturadas por página.',
    'Candidatos que o modelo não julgou em 1.1.1: 4 de 30 depois do tempo limite (--time-limit), 2 de 30 sem julgamento em cache (--offline), 1 de 30 em que o modelo falhou.',
    'Candidatos que o modelo não julgou em 2.4.4: 28 de 78 além do limite de candidatos (--max-candidates).',
  ],
}

const TITLE: Record<Locale, string> = { en: 'How the page was read', 'pt-BR': 'Como a página foi lida' }
const LOCALES: Locale[] = ['en', 'pt-BR']

const plain = paint(false)

const recorded = new Map<string, Promise<Report>>()

/** The report of a recorded page in a locale, made once (so every variant has the same createdAt), with the capture record given, or none. */
async function withRecord(capture: CaptureRecord | undefined, locale: Locale = 'en', name = 'examples-store-before'): Promise<Report> {
  const key = `${name}|${locale}`
  if (!recorded.has(key)) recorded.set(key, recordedReport(name, { locale }).then(({ report }) => report))
  const rest = withoutRecord((await recorded.get(key)) as Report)
  return capture ? { ...rest, capture } : rest
}

function withoutRecord(report: Report): Report {
  const { capture: _capture, ...rest } = report
  return rest
}

describe('captureLines', () => {
  it('says nothing of a page read in full, a report with no record, or a target that could not be loaded', () => {
    for (const locale of LOCALES) {
      expect(captureLines({ capture: CLEAN }, locale)).toEqual([])
      expect(captureLines({ capture: { version: 1, styled: true } }, locale)).toEqual([])
      expect(captureLines({}, locale)).toEqual([])
      expect(captureLines({ capture: FULL, notLoaded: { error: 'ENOENT' } }, locale)).toEqual([])
    }
  })

  it('gives one line per fact of a full record, in order, in English and in Portuguese', () => {
    for (const locale of LOCALES) expect(captureLines({ capture: FULL }, locale)).toEqual(LINES[locale])
  })

  it('words a page told unstyled by its look, a layer left in place, and stylesheets that failed on a page read with its styles', () => {
    const record: CaptureRecord = {
      version: 1,
      styled: false,
      styledBy: 'look',
      stylesheets: { linked: 18, applied: 17, failed: 1 },
      overlay: { selector: 'div', coverage: 0.78, hidden: false },
    }
    expect(captureLines({ capture: record }, 'en')).toEqual([
      "The page was read without its styles: its body text had the browser's default look.",
      "The page's stylesheets: 17 of 18 applied, 1 failed.",
      'A layer lay over the viewport when the page was read (div, on top at 78% of the points sampled); it was not hidden for the captures.',
    ])
    expect(captureLines({ capture: record }, 'pt-BR')).toEqual([
      'A página foi lida sem os estilos: o texto do corpo tinha a aparência padrão do navegador.',
      'Folhas de estilo da página: 17 de 18 aplicadas, 1 com falha.',
      'Uma camada cobria a área visível quando a página foi lida (div, por cima em 78% dos pontos amostrados); ela não foi escondida para as capturas.',
    ])
    // Stylesheets all applied on the first load are nothing to say; images all captured neither.
    expect(captureLines({ capture: { version: 1, styled: true, stylesheets: { linked: 3, applied: 3, failed: 0 } } }, 'en')).toEqual([])
  })

  it('has every string in both tables', () => {
    const keys: MessageKey[] = [
      'captureTitle',
      'captureUnstyledStylesheets',
      'captureUnstyledLook',
      'captureUnstyled',
      'captureStylesheets',
      'captureStylesheetsRetried',
      'captureOverlay',
      'captureOverlayShown',
      'captureBlocked',
      'captureHttpStatus',
      'captureCut',
      'captureLoadTimedOut',
      'captureUnsettled',
      'captureImages',
      'captureNotJudged',
      'captureCapped',
      'captureTimedOut',
      'captureOfflineMisses',
      'captureErrors',
    ]
    // A key missing from the Portuguese table falls back to the English text.
    for (const key of keys) expect(t('pt-BR', key), key).not.toBe(t('en', key))
  })
})

describe('the capture record in each format', () => {
  it('terminal: the heading and the lines after the notes, with or without --verbose; nothing else moves', async () => {
    for (const locale of LOCALES) {
      const full = await withRecord(FULL, locale)
      const none = await withRecord(undefined, locale)
      const section = `${TITLE[locale]}\n${LINES[locale].map((line) => `  ${line}`).join('\n')}\n\n`
      for (const verbose of [false, true]) {
        const shown = renderReport(full, { verbose, paint: plain })
        const without = renderReport(none, { verbose, paint: plain })
        expect(shown).toContain(section)
        expect(shown.replace(section, '')).toBe(without)
        expect(renderReport(await withRecord(CLEAN, locale), { verbose, paint: plain })).toBe(without)
      }
    }
  })

  it('Markdown: a heading and a list after the notes; nothing for a clean record', async () => {
    for (const locale of LOCALES) {
      const markdown = renderMarkdown([await withRecord(FULL, locale)])
      const without = renderMarkdown([await withRecord(undefined, locale)])
      const section = `#### ${TITLE[locale]}\n\n${LINES[locale].map((line) => `- ${prose(line)}`).join('\n')}\n\n`
      expect(markdown).toContain(section)
      expect(markdown.indexOf(section)).toBeLessThan(markdown.indexOf(`#### ${t(locale, 'coverageTitle')}`))
      expect(markdown.replace(section, '')).toBe(without)
      expect(renderMarkdown([await withRecord(CLEAN, locale)])).toBe(without)
    }
  })

  it('Markdown: with several pages, each line names its page', async () => {
    const full = await withRecord(FULL)
    const clean = await withRecord(CLEAN, 'en', 'examples-store-after')
    const markdown = renderMarkdown([full, clean])
    expect(markdown).toContain(`#### How the page was read\n\n- \`examples/store/before.html\`: ${prose(LINES.en[0] as string)}\n`)
    expect(markdown).not.toContain('`examples/store/after.html`: The page')
    expect(renderMarkdown([await withRecord(CLEAN), clean])).toBe(renderMarkdown([await withRecord(undefined), await withRecord(undefined, 'en', 'examples-store-after')]))
  })

  it('Markdown: at the size limit of a comment, the section takes only the room the findings left', async () => {
    const report = await withRecord(FULL)
    const many = Array.from({ length: 600 }, (_, index) => report.findings.map((finding) => ({ ...finding, fingerprint: `${finding.fingerprint}-${index}` }))).flat()
    const full = { ...report, findings: many }
    const none = withoutRecord(full)
    const sections: string[] = []
    for (const maxLength of [60_000, 5000, 2600, 2000]) {
      const shown = renderMarkdown([full], { maxLength })
      const without = renderMarkdown([none], { maxLength })
      // The same finding blocks and the same count of those left out: only the section is added, whole, in part or not at all.
      const start = shown.indexOf('#### How the page was read\n\n')
      const end = start === -1 ? start : shown.indexOf('\n\n', start + 28) + 2
      expect(start === -1 ? shown : shown.slice(0, start) + shown.slice(end)).toBe(without)
      if (start !== -1) expect(shown.length).toBeLessThanOrEqual(maxLength)
      sections.push(start === -1 ? '' : shown.slice(start, end))
    }
    const [roomy, ample, tight, cramped] = sections
    expect(roomy).toBe(`#### How the page was read\n\n${LINES.en.map((line) => `- ${prose(line)}`).join('\n')}\n\n`)
    expect(ample).toBe(roomy)
    // With room for some of its lines only, it shows those and counts the rest; with none, there is no section.
    expect(tight).toMatch(/^#### How the page was read\n\n(- [^\n]*\n){1,10}- …and \d+ more\n\n$/)
    expect(cramped).toBe('')
  })

  it('HTML: a section with a heading and a list after the notes; nothing for a clean record', async () => {
    for (const locale of LOCALES) {
      const html = renderHtml([await withRecord(FULL, locale)])
      const without = renderHtml([await withRecord(undefined, locale)])
      const section = `<section class="capture">\n<h3>${escapeHtml(TITLE[locale])}</h3>\n<ul class="notes">${LINES[locale].map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>\n</section>\n`
      expect(html).toContain(section)
      expect(html.replace(section, '')).toBe(without)
      expect(renderHtml([await withRecord(CLEAN, locale)])).toBe(without)
    }
  })

  it('HTML: the report of a full record keeps the structure the report holds itself to', async () => {
    const html = renderHtml([await withRecord(FULL), await withRecord(CLEAN, 'en', 'examples-store-after')], { verbose: true })
    expect(html).not.toMatch(/<script|<link |<img |<iframe|@import|url\(/i)
    expect(html.match(/<h1>/g)).toHaveLength(1)
    // Headings never skip a level: h1, then each page's h2, then its parts' h3.
    const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map((match) => Number(match[1]))
    for (const [index, level] of levels.entries()) if (index > 0) expect(level).toBeLessThanOrEqual((levels[index - 1] as number) + 1)
    // The section sits in the first page's section, under its h2, and its list holds list items only.
    const page = html.slice(html.indexOf('<section class="page" aria-labelledby="page-1">'), html.indexOf('<section class="page" aria-labelledby="page-2">'))
    expect(page).toContain('<h3>How the page was read</h3>')
    const list = /<section class="capture">\n<h3>[^<]+<\/h3>\n<ul class="notes">(.*)<\/ul>\n<\/section>/.exec(page)?.[1] ?? ''
    expect(list.replace(/<li>[^<]*<\/li>/g, '')).toBe('')
    expect(list.match(/<li>/g)).toHaveLength(LINES.en.length)
    expect(html.match(/class="capture"/g)).toHaveLength(1)
  })

  it('SARIF: the page coverage carries the record as it is, with no result or notification; nothing for a clean record', async () => {
    const full = toSarif([await withRecord(FULL)])
    const none = toSarif([await withRecord(undefined)])
    const [coverage] = full.runs[0]?.properties.coverage as Array<Record<string, unknown>>
    expect(coverage?.capture).toEqual(FULL)
    delete coverage?.capture
    expect(full).toEqual(none)
    expect(JSON.stringify(toSarif([await withRecord(CLEAN)]))).toBe(JSON.stringify(none))
  })
})

// Integration: axe-core on the HTML report of a full record, as test/html-report.test.ts runs it. Needs Chrome or Edge.
const browser = await launchBrowser().catch(() => undefined)
afterAll(async () => browser?.close())

describe.skipIf(!browser)('HTML report of a capture record in a browser', { timeout: 30_000 }, () => {
  it('passes axe-core in light and dark mode, on a desktop and a phone', async () => {
    if (!browser) return
    const html = renderHtml([await withRecord(FULL), await withRecord(FULL, 'en', 'examples-store-after')], { verbose: true })
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [1280, 320]) {
        const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme })
        const page = await context.newPage()
        await page.setContent(html)
        await page.evaluate(() => {
          for (const details of document.querySelectorAll('details')) details.open = true
        })
        await page.addScriptTag({ content: await axeSource() })
        const result = await page.evaluate(async (tags) => {
          const axe = (window as unknown as { axe: { run(context: Document, options: unknown): Promise<{ violations: Array<{ id: string }> }> } }).axe
          const { violations } = await axe.run(document, { runOnly: { type: 'tag', values: tags } })
          return { violations: violations.map((violation) => violation.id), scrolls: document.documentElement.scrollWidth > window.innerWidth }
        }, [...AXE_TAGS, 'best-practice'])
        await context.close()
        expect(result, `${colorScheme} at ${width}px`).toEqual({ violations: [], scrolls: false })
      }
    }
  })
})
