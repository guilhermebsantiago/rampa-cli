import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { type CheckCommandOptions, runCheck } from '../src/cli/commands/check.ts'
import type { GlobalContext } from '../src/cli/context.ts'
import { memoryCache } from '../src/core/cache.ts'
import { type CaptureRecord, captureRecord } from '../src/core/capture.ts'
import { type CheckOptions, checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { linkPurpose } from '../src/criteria/link-purpose.ts'
import { nonTextContent } from '../src/criteria/non-text-content.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import { t } from '../src/i18n.ts'
import { paint } from '../src/report/color.ts'
import { providerIdentity } from '../src/providers/ai-sdk.ts'
import { formatReports } from '../src/report/formats.ts'
import { blockedNote, httpErrorNote } from '../src/snapshot/blocked.ts'
import { uncapturedImagesNote } from '../src/snapshot/image-skips.ts'
import { captureStyle, reachNotes, reachSeen, truncationNote } from '../src/snapshot/reach.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node, travelSnapshot } from './helpers.ts'
import { stubModel } from './stub-model.ts'

function options(extra: Partial<CheckOptions> = {}): CheckOptions {
  return { criteria: [], llm: false, provider: undefined, runs: 1, cache: memoryCache(), offline: false, locale: 'en', minConfidence: 'low', concurrency: 1, ...extra }
}

/** A web page of a few paragraphs, with what `extra` adds to its body and its snapshot. */
function page(children: A11yNode[] = [], extra: Partial<A11ySnapshot> = {}): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'Example',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-11-09T00:00:00.000Z',
    collector: { name: 'rampa-web', version: '0.1.0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'en',
      native: { tag: 'html' },
      children: [
        node({
          ref: 'html > body',
          native: { tag: 'body' },
          children: [node({ ref: 'html > body > p', role: 'paragraph', text: 'Opening hours and prices.', native: { tag: 'p' } }), ...children],
        }),
      ],
    }),
    ...extra,
  }
}

const CROP = 'data:image/png;base64,iVBORw0KGgo='

function image(ref: string, skipped?: string): A11yNode {
  return node({
    ref,
    role: 'img',
    name: 'A photo of the shop',
    bounds: { x: 0, y: 0, width: 300, height: 200 },
    native: { tag: 'img', attributes: { alt: 'A photo of the shop', src: `${ref.replace(/\W/g, '')}.jpg` }, ...(skipped ? { imageSkipped: skipped } : {}) },
    ...(skipped ? {} : { image: CROP }),
  })
}

async function report(snapshot: A11ySnapshot, extra: Partial<CheckOptions> = {}): Promise<Report> {
  return checkSnapshot(snapshot, emptyEngine(), options(extra))
}

describe('the capture record of a report', () => {
  it('says only that a page read in full was styled, with its images when it has them', async () => {
    expect((await report(travelSnapshot())).capture).toEqual({ version: 1, styled: true })
    expect((await report(page())).capture).toEqual({ version: 1, styled: true })
    // A CSS background's crop (1.4.5) is no image node; an svg with a crop is.
    const banner = node({ ref: 'html > body > div.hero', bounds: { x: 0, y: 0, width: 1280, height: 300 }, native: { tag: 'div', backgroundImage: 'url("hero.jpg")' }, image: CROP })
    const chart = node({ ref: 'html > body > svg', role: 'graphics-document', bounds: { x: 0, y: 0, width: 400, height: 300 }, native: { tag: 'svg' }, image: CROP })
    const pictured = await report(page([image('html > body > img'), banner, chart]))
    expect(pictured.capture).toEqual({ version: 1, styled: true, images: { captured: 2, notCaptured: 0, reasons: {} } })
    expect(pictured.notes).toBeUndefined()
  })

  it('gives the styles, the stylesheets and how Rampa told, for a page read without its stylesheets', async () => {
    const snapshot = page([], {
      reach: {
        stylesheets: {
          linked: 3,
          applied: 1,
          failed: [
            { href: 'https://example.com/theme.css', reason: 'HTTP 404' },
            { href: 'https://cdn.example.com/fonts.css', reason: 'blocked' },
          ],
          unstyled: true,
          retried: true,
        },
      },
    })
    const unstyled = await report(snapshot)
    expect(unstyled.capture).toEqual({ version: 1, styled: false, styledBy: 'stylesheets', stylesheets: { linked: 3, applied: 1, failed: 2, retried: true } })
    expect(unstyled.notes).toEqual(reachNotes(reachSeen(snapshot), 'en'))
    expect(unstyled.notes).toHaveLength(1)
  })

  it('gives a layer over the viewport', async () => {
    const snapshot = page([], { reach: { overlay: { ref: 'html > body > div#consent', selector: 'div#consent', coverage: 0.93, hidden: true } } })
    const covered = await report(snapshot)
    expect(covered.capture).toEqual({ version: 1, styled: true, overlay: { selector: 'div#consent', coverage: 0.93, hidden: true } })
    expect(covered.notes).toEqual(reachNotes(reachSeen(snapshot), 'en'))
  })

  it('gives a bot check the site sent instead of the page, and leaves its detail in blocked', async () => {
    const blocked = { kind: 'challenge' as const, vendor: 'Cloudflare', evidence: 'title' as const, detail: 'Just a moment...', status: 403 }
    const snapshot = page([], { blocked })
    const refused = await report(snapshot, { criteria: [linkPurpose], llm: true, provider: stubModel() })
    expect(refused.capture).toEqual({ version: 1, styled: true, blocked: true })
    expect(refused.blocked).toEqual(blocked)
    expect(refused.notes).toEqual([blockedNote(blocked, 'en')])
  })

  it('gives the HTTP status of an error page', async () => {
    const snapshot = page([], { httpStatus: 404 })
    const missing = await report(snapshot)
    expect(missing.capture).toEqual({ version: 1, styled: true, httpStatus: 404 })
    expect(missing.httpStatus).toBe(404)
    expect(missing.notes).toEqual([httpErrorNote(404, 'en')])
  })

  it('gives a page cut at the budget of elements', async () => {
    const snapshot = page([], { truncated: true, elementLimit: 3 })
    const cut = await report(snapshot)
    expect(cut.capture).toEqual({ version: 1, styled: true, cut: { elements: 3 } })
    const truncated = cut.coverage.truncated
    if (!truncated) throw new Error('no cut in the coverage')
    expect(cut.notes).toEqual([truncationNote(truncated, { probes: false }, 'en')])
  })

  it('gives a page that had not settled or loaded when it was read', async () => {
    const snapshot = page([], { reach: { unsettledAfterMs: 10_000, loadTimedOutMs: 30_000 } })
    const late = await report(snapshot)
    expect(late.capture).toEqual({ version: 1, styled: true, unsettledAfterMs: 10_000, loadTimedOutMs: 30_000 })
    expect(late.notes).toEqual(reachNotes(reachSeen(snapshot), 'en'))
  })

  it('counts the images left without a capture by reason, as the note does', async () => {
    const snapshot = page([image('#a', 'stacked'), image('#b', 'outside-page'), image('#c', 'stacked')])
    const record = { version: 1, styled: true, images: { captured: 0, notCaptured: 3, reasons: { 'outside-page': 1, stacked: 2 } } }
    const unjudged = await report(snapshot)
    expect(unjudged.capture).toEqual(record)
    // The note comes only when a criterion that judges pixels runs; the record says the same either way.
    expect(unjudged.notes).toBeUndefined()
    const offline = { llm: true, offline: true, criteria: [nonTextContent], provider: { ...providerIdentity('ollama:gemma4:12b'), judge: (): never => { throw new Error('offline') } } }
    const judged = await report(snapshot, offline)
    expect(judged.capture).toEqual(record)
    expect(judged.notes).toEqual([uncapturedImagesNote(snapshot.root, 'en')])
  })

  it('lists the candidates the cap left unjudged, per criterion', async () => {
    const links = Array.from({ length: 6 }, (_, i) =>
      node({
        ref: `#a${i}`,
        role: 'link',
        name: `Book number ${i}`,
        native: { tag: 'a', attributes: { href: `/page-${i}` }, html: `<a href="/page-${i}">Book number ${i}</a>` },
        children: [node({ ref: `#a${i}-text`, text: `Book number ${i}` })],
      }),
    )
    const capped = await report(page(links), { criteria: [linkPurpose], llm: true, provider: stubModel(), maxCandidates: 2 })
    expect(capped.capture).toEqual({ version: 1, styled: true, notJudged: [{ criterion: '2.4.4', candidates: 6, capped: 4 }] })
    expect(capped.notes).toEqual([t('en', 'notJudgedCap', { max: 2, list: t('en', 'notJudgedItem', { criterion: '2.4.4', count: 4, total: 6 }) })])
  })

  it('gives the misses and errors of a criterion from its summary, and leaves out a criterion the model judged in full', () => {
    const summary = { applicable: true, judged: 0, failed: 0, passed: 0, cannotTell: 0, discarded: 0, errors: 0, offlineMisses: 0 }
    const record = captureRecord(page(), [
      { ...summary, criterion: '1.1.1', candidates: 9, offlineMisses: 2, errors: 1, timedOut: 3 },
      { ...summary, criterion: '2.4.2', candidates: 1, judged: 1, passed: 1 },
    ])
    expect(record.notJudged).toEqual([{ criterion: '1.1.1', candidates: 9, timedOut: 3, offlineMisses: 2, errors: 1 }])
  })

  it("reads a recording with no reach at all as unstyled from the browser's default look, as captureStyle does", async () => {
    const look = { size: 16, weight: 400, family: 'times new roman', color: 'rgb(0, 0, 0)' }
    const paragraphs = Array.from({ length: 260 }, (_, i) => node({ ref: `html > body > p:nth-of-type(${i + 1})`, role: 'paragraph', native: { tag: 'p' } }))
    const snapshot = page(paragraphs)
    snapshot.root.native.bodyLook = look
    expect(snapshot.reach).toBeUndefined()
    expect(captureStyle(snapshot)).toEqual({ unstyled: true, by: 'look' })
    const plain = await report(snapshot)
    expect(plain.capture).toEqual({ version: 1, styled: false, styledBy: 'look' })
    expect(plain.notes).toEqual([t('en', 'recordedUnstyledLook')])
    // A styled body, or a recording that says the collector found author styles, is read as it was.
    expect(captureRecord({ ...snapshot, root: { ...snapshot.root, native: { ...snapshot.root.native, authorStyles: 4 } } }, [])).toEqual({ version: 1, styled: true })
  })

  it('counts the image controls a native surface crops from its screenshot', () => {
    const button = node({ ref: '//android.widget.ImageButton[1]', role: 'button', name: 'Search', native: { imageControl: true }, image: CROP })
    const photo = node({ ref: '//android.widget.ImageView[1]', role: 'img', name: 'Shop front', image: CROP })
    const icon = node({ ref: '//android.widget.ImageView[2]', role: 'img', name: 'Logo' })
    const app = { ...page(), surface: 'android' as const, target: 'com.example.shop', root: node({ ref: '/hierarchy', native: {}, children: [button, photo, icon] }) }
    expect(captureRecord(app, [])).toEqual({ version: 1, styled: true, images: { captured: 2, notCaptured: 0, reasons: {} } })
  })

  it('holds no field but those of its shape, none of them a covered share', async () => {
    const snapshot = page([image('#a'), image('#b', 'limit')], {
      truncated: true,
      elementLimit: 4,
      httpStatus: 500,
      reach: {
        stylesheets: { linked: 1, applied: 0, failed: [{ href: 'https://example.com/a.css', reason: 'HTTP 500' }], unstyled: true },
        overlay: { selector: 'div.modal', coverage: 0.8, hidden: true },
        unsettledAfterMs: 5000,
        loadTimedOutMs: 30_000,
      },
    })
    const record = (await report(snapshot)).capture as CaptureRecord
    const shape = ['version', 'styled', 'styledBy', 'stylesheets', 'overlay', 'blocked', 'httpStatus', 'cut', 'unsettledAfterMs', 'loadTimedOutMs', 'images', 'notJudged']
    expect(Object.keys(record).every((key) => shape.includes(key))).toBe(true)
    expect(JSON.stringify(record)).not.toMatch(/cover(ed)?Share|share/i)
    expect(record.images).toEqual({ captured: 1, notCaptured: 1, reasons: { limit: 1 } })
  })

  it('goes into JSON as it is, and validates against schema/report.schema.json', async () => {
    const schema = JSON.parse(await readFile('schema/report.schema.json', 'utf8')) as Parameters<typeof z.fromJSONSchema>[0]
    const validator = z.fromJSONSchema(schema)
    const snapshot = page([image('#a'), image('#b', 'stacked')], { httpStatus: 404, reach: { overlay: { selector: 'div#consent', coverage: 0.9, hidden: true } } })
    const full = await report(snapshot)
    const json = JSON.parse(formatReports('json', [full], { verbose: false, paint: paint(false) }))
    expect(json.schemaVersion).toBe(1)
    expect(json.capture).toEqual(JSON.parse(JSON.stringify(full.capture)))
    expect(validator.safeParse(json).success).toBe(true)
    expect(validator.safeParse({ ...json, capture: { ...json.capture, version: 2 } }).success).toBe(false)
    expect(validator.safeParse({ ...json, capture: { version: 1 } }).success).toBe(false)
    // A report written before the record still validates.
    const { capture: _left, ...older } = json
    expect(validator.safeParse(older).success).toBe(true)
  })
})

describe('the capture record and a target that could not be loaded', { timeout: 60_000 }, () => {
  const context: GlobalContext = { locale: 'en', motion: false, config: {} }
  let dir: string
  let stdout: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rampa-capture-record-'))
    stdout = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('is on the report of the page checked, and not on the report of the target that could not be loaded', async () => {
    const broken = join(dir, 'broken.json')
    await writeFile(broken, 'not json', 'utf8')
    const flags: CheckCommandOptions = {
      criteria: '1.1.1,2.4.2,2.4.4',
      llm: false,
      runs: '1',
      format: 'json',
      failOn: 'confirmed',
      minConfidence: 'medium',
      cacheDir: join(dir, 'cache'),
      concurrency: '1',
    }
    await runCheck(['demo/recorded/examples-store-before.snapshot.json', broken], flags, context)
    const [checked, notLoaded] = JSON.parse(stdout) as Report[]
    expect(checked?.capture).toMatchObject({ version: 1, styled: true })
    expect(notLoaded?.notLoaded).toBeDefined()
    expect(notLoaded?.capture).toBeUndefined()
  })
})
