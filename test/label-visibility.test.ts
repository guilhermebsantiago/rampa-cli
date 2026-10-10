import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import { afterAll, describe, expect, it } from 'vitest'
import { emptyEngine } from '../src/engine/axe.ts'
import { labelsOrInstructions, shown } from '../src/criteria/labels-or-instructions.ts'
import { noVisibleLabelRule } from '../src/rules/forms.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { indexTree, walkTree } from '../src/snapshot/tree.ts'
import { labelTargets, textShows } from '../src/surfaces/label-visibility.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { node } from './helpers.ts'

// Integration: needs Chrome or Edge (or Playwright's Chromium). Skipped when none is installed.
const browser = await launchBrowser().catch(() => undefined)
afterAll(async () => browser?.close())

const box = { x: 0, y: 0, width: 200, height: 24 }

function png(pixels: number[][], width = pixels.length): Uint8Array {
  const image = new PNG({ width, height: Math.ceil(pixels.length / width) })
  pixels.forEach((rgba, i) => image.data.set(rgba, i * 4))
  return PNG.sync.write(image)
}

describe('the label pixel test', () => {
  const white = [255, 255, 255, 255]
  const black = [0, 0, 0, 255]
  const nearWhite = [250, 250, 250, 255]

  it('sees text where a few pixels change, and nothing where none does or the change is a faint tint', () => {
    expect(textShows(png([black, black, black, black, white, white]), png(Array(6).fill(white)))).toBe(true)
    expect(textShows(png(Array(6).fill(white)), png(Array(6).fill(white)))).toBe(false)
    expect(textShows(png([nearWhite, nearWhite, nearWhite, nearWhite, white, white]), png(Array(6).fill(white)))).toBe(false)
    // Three changed pixels are noise, not a letter.
    expect(textShows(png([black, black, black, white, white, white]), png(Array(6).fill(white)))).toBe(false)
    // A box that changed size between the captures cannot be compared: taken as showing.
    expect(textShows(png(Array(6).fill(white)), png(Array(4).fill(white)))).toBe(true)
  })

  it('measures the labels 3.3.2 relies on: on screen, with text, tied to a field it judges, and no picture in them', () => {
    const field = (ref: string, attributes: Record<string, string>) => node({ ref, role: 'textbox', bounds: box, native: { tag: 'input', attributes } })
    const label = (ref: string, text: string, control: string | null, extra: Partial<A11yNode> = {}) =>
      node({ ref, role: 'generic', text, bounds: box, native: { tag: 'label', attributes: {}, labelControl: control }, ...extra })
    const root = node({
      ref: 'html',
      role: 'document',
      children: [
        label('#l-name', 'Name', '#name'),
        field('#name', { id: 'name' }),
        label('#l-check', 'Remember me', '#check'),
        field('#check', { id: 'check', type: 'checkbox' }),
        label('#l-dot', 'Hidden', '#dot', { bounds: { x: 0, y: 0, width: 1, height: 1 } }),
        field('#dot', { id: 'dot' }),
        label('#l-icon', 'Search', '#q', { children: [node({ ref: '#l-icon > svg', native: { tag: 'svg' }, bounds: box })] }),
        field('#q', { id: 'q' }),
        node({ ref: '#caption', text: 'Card number', bounds: box, native: { tag: 'span', attributes: { id: 'caption' } } }),
        field('#card', { 'aria-labelledby': 'caption' }),
        node({
          ref: '#wrap',
          text: 'City',
          bounds: box,
          native: { tag: 'label', attributes: {}, labelControl: null },
          children: [field('#city', {})],
        }),
        label('#l-orphan', 'Orphan', null),
      ],
    })
    expect(labelTargets(root).map((n) => n.ref)).toEqual(['#l-name', '#caption', '#wrap'])
  })

  it('takes a measured label whose text does not show off the screen, for 3.3.2 and its rule', () => {
    const label = node({ ref: '#l-email', text: 'Email', bounds: box, native: { tag: 'label', attributes: { for: 'email' }, labelControl: '#email', textVisible: false } })
    const field = node({ ref: '#email', role: 'textbox', name: 'Email', bounds: box, native: { tag: 'input', attributes: { id: 'email', type: 'email' }, html: '<input id="email" type="email">' } })
    const snapshot: A11ySnapshot = {
      schemaVersion: 1,
      surface: 'web',
      target: 'test://unseen',
      locale: 'en',
      viewport: { width: 1280, height: 800, scale: 1 },
      collectedAt: '2026-10-09T00:00:00.000Z',
      collector: { name: 'test', version: '0' },
      root: node({ ref: 'html', role: 'document', lang: 'en', children: [node({ ref: 'form', native: { tag: 'form' }, bounds: box, children: [label, field] })] }),
    }
    expect(shown(label)).toBe(false)
    const [candidate] = labelsOrInstructions.candidates(snapshot, emptyEngine())
    expect(candidate?.context).toMatchObject({ hiddenSource: 'hidden-label', unseen: true })
    if (!candidate) throw new Error('no candidate')
    // The prompt is the one a hidden label always had; only the message says how Rampa knows.
    expect(labelsOrInstructions.prompt(candidate, snapshot).user).toContain('Its name comes from: a label that is hidden from view')
    const claim = { shown: '', rule: '', verdict: 'fail' as const, problem: 'no_visible_label' as const, evidence: 'Email', confidence: 'high' as const }
    expect(labelsOrInstructions.message(claim, candidate, 'en')).toBe(
      'Nothing on screen tells what to enter in the field "Email": its label is on the page, but its text does not show: the label looks the same with its text made transparent.',
    )
    const run = noVisibleLabelRule.run(snapshot, emptyEngine(), { locale: 'en', index: indexTree(snapshot.root) })
    expect(run.hits).toHaveLength(1)
    expect(noVisibleLabelRule.message(run.hits[0] as never, 'pt-BR')).toContain('o texto dele não aparece')
    // Measured as showing, or not measured, the label is read as before.
    label.native.textVisible = true
    expect(labelsOrInstructions.candidates(snapshot, emptyEngine())).toEqual([])
  })
})

// Four fields: a label clipped away by a visually-hidden class that keeps its size, white text on white, a label
// inside a box that hides it, and a label people can read. And one in dark gray on white, which shows.
const FORM = `<!doctype html><html lang="en"><head><style>
body { margin: 0; background: #fff; color: #222; font: 16px/1.4 sans-serif; }
.row { padding: 8px; }
.visually-hidden { position: absolute; clip-path: inset(50%); white-space: nowrap; }
.ghost { color: #fff; }
.shut { height: 0; overflow: hidden; }
.gray { color: #555; }
</style></head><body><form>
<div class="row"><label for="sr" class="visually-hidden">Street address</label><input id="sr" type="text"></div>
<div class="row"><label for="ghost" class="ghost">Postal code</label><input id="ghost" type="text"></div>
<div class="row"><div class="shut"><label for="shut">Apartment</label></div><input id="shut" type="text"></div>
<div class="row"><label for="seen">City</label><input id="seen" type="text"></div>
<div class="row"><label for="gray" class="gray">State</label><input id="gray" type="text"></div>
<div class="row"><label class="ghost">Birthday <input id="birthday" type="date"></label></div>
<div class="row"><label>Phone <input id="phone" type="tel"></label></div>
</form></body></html>`

describe.skipIf(!browser)('label pixels in a real browser', { timeout: 60_000 }, () => {
  it('records which labels show their text, and 3.3.2 takes the others as hidden', async () => {
    if (!browser) return
    const dir = await mkdtemp(join(tmpdir(), 'rampa-labels-'))
    await writeFile(join(dir, 'form.html'), FORM, 'utf8')
    const { snapshot, engine } = await collectWeb(browser, pathToFileURL(join(dir, 'form.html')).href, { runAxe: true, locale: 'en' })
    // A wrapped field keeps its own text while its label's goes transparent: the date's "mm/dd/yyyy" is not the label.
    const facts = Object.fromEntries(
      [...walkTree(snapshot.root)].filter((n) => n.native.tag === 'label').map((n) => [String(n.native.labelControl).replace('#', ''), n.native.textVisible]),
    )
    expect(facts).toEqual({ sr: false, ghost: false, shut: false, seen: true, gray: true, birthday: false, phone: true })
    const candidates = labelsOrInstructions.candidates(snapshot, engine)
    expect(candidates.map((c) => [c.ref, c.context.hiddenSource, c.context.unseen])).toEqual([
      ['#sr', 'hidden-label', true],
      ['#ghost', 'hidden-label', true],
      ['#shut', 'hidden-label', true],
      ['#birthday', 'hidden-label', true],
    ])
  })
})
