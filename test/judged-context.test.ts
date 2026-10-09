import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { siblingsOf } from '../src/core/siblings.ts'
import type { EngineResults } from '../src/core/types.ts'
import { headingsAndLabels } from '../src/criteria/headings-and-labels.ts'
import { identifyInputPurpose } from '../src/criteria/identify-input-purpose.ts'
import { pageTitled } from '../src/criteria/page-titled.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { node } from './helpers.ts'

const NO_ENGINE: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function page(children: A11yNode[], extra: Partial<A11ySnapshot> = {}): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://shop.example/help/returns',
    title: 'Returns',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'en', children: [node({ ref: 'body', native: { tag: 'body' }, children })] }),
    ...extra,
  }
}

describe('2.4.2 with the titles of sibling pages', () => {
  const body = [node({ ref: 'h1', role: 'heading', name: 'Returns and refunds', native: { tag: 'h1' }, text: 'Returns and refunds' })]

  it('lists the closest pages of a crawl first, in a fixed order', () => {
    const pages = [
      { url: 'https://shop.example/blog/news', title: 'News' },
      { url: 'https://shop.example/help/shipping', title: 'Shipping' },
      { url: 'https://shop.example/help/returns', title: 'Returns' },
      { url: 'https://shop.example/help/faq', title: 'FAQ' },
    ]
    expect(siblingsOf('https://shop.example/help/returns', pages).map((p) => p.title)).toEqual(['FAQ', 'Shipping', 'News'])
  })

  it('shows them to the model only when a crawl read them', () => {
    const alone = pageTitled.candidates(page(body), NO_ENGINE)
    const [candidate] = pageTitled.candidates(page(body, { siblings: [{ url: 'https://shop.example/help/faq', title: 'Help center' }] }), NO_ENGINE)
    if (!alone[0] || !candidate) throw new Error('no candidate')
    expect(pageTitled.prompt(alone[0], page(body)).user).not.toContain('other pages')
    const user = pageTitled.prompt(candidate, page(body)).user
    expect(user).toContain('Titles of other pages: "Help center"')
    expect(user).toContain('does not tell this page apart')
  })
})

describe('2.4.6 with headings and labels cut off on screen', () => {
  const content = node({ ref: 'p', role: 'paragraph', text: 'Send it back within thirty days for a full refund.', native: { tag: 'p' } })

  it('tells the model what people see of a cut-off heading, and nothing more for the rest', () => {
    const name = 'Returns and refunds for orders shipped abroad'
    const cut = node({ ref: 'h2', role: 'heading', name, text: name, native: { tag: 'h2', shown: 0.4 } })
    const whole = node({ ref: 'h2', role: 'heading', name, text: name, native: { tag: 'h2' } })
    const [shown] = headingsAndLabels.candidates(page([cut, content]), NO_ENGINE)
    const [plain] = headingsAndLabels.candidates(page([whole, content]), NO_ENGINE)
    if (!shown || !plain) throw new Error('no candidate')
    expect(shown.context.shown).toBe('Returns and refund…')
    expect(headingsAndLabels.prompt(shown, page([cut, content])).user).toContain('people see only: "Returns and refund…"')
    expect(headingsAndLabels.prompt(plain, page([whole, content])).user).not.toContain('cut off')
  })
})

describe('1.3.5 with Chromium form issues and words for someone else', () => {
  const field = (ref: string, name: string, attributes: Record<string, string>, native: Record<string, unknown> = {}) =>
    node({ ref, role: 'textbox', name, native: { tag: 'input', attributes, ...native } })
  const form = (children: A11yNode[], legend?: string) =>
    node({
      ref: 'form',
      role: 'form',
      native: { tag: 'form' },
      children: legend
        ? [node({ ref: 'fieldset', role: 'group', native: { tag: 'fieldset' }, children: [node({ ref: 'legend', name: legend, text: legend, native: { tag: 'legend' } }), ...children] })]
        : children,
    })
  const fail = { asks: 'an email address', about: 'user', purpose: 'email', verdict: 'fail', evidence: 'Email', confidence: 'high' } as const

  it('passes an issue that still holds to the prompt and the message, and drops one that no longer does', () => {
    const issue = { formIssues: ['FormInputAssignedAutocompleteValueToIdOrNameAttributeError'] }
    const snapshot = page([form([field('#email', 'Email', { name: 'email', type: 'email' }, issue), field('#name', 'Name', { name: 'name', autocomplete: 'name' }, issue)])])
    const [email, name] = identifyInputPurpose.candidates(snapshot, NO_ENGINE)
    if (!email || !name) throw new Error('no candidate')
    expect(email.context.formIssues).toEqual(['FormInputAssignedAutocompleteValueToIdOrNameAttributeError'])
    // The field has a token now: a script added it after the browser raised the issue.
    expect(name.context.formIssues).toEqual([])
    expect(identifyInputPurpose.prompt(email, snapshot).user).toContain("Chromium's own form check: the name or id is an autocomplete token")
    expect(identifyInputPurpose.message(fail, email, 'en')).toContain("Chromium's own form check flags this field too.")
  })

  it('keeps a fail below the threshold when the form asks about someone else', () => {
    const snapshot = page([form([field('#to-email', 'Email', { type: 'email' })], 'Gift recipient')])
    const [candidate] = identifyInputPurpose.candidates(snapshot, NO_ENGINE)
    if (!candidate) throw new Error('no candidate')
    expect(candidate.context.someoneElse).toBe('recipient')
    expect(identifyInputPurpose.confidenceCap?.(candidate)).toBe('low')
    const own = identifyInputPurpose.candidates(page([form([field('#email', 'Email', { type: 'email' })], 'Your details')]), NO_ENGINE)
    expect(own.map((c) => identifyInputPurpose.confidenceCap?.(c))).toEqual([undefined])
  })
})

const browser = await launchBrowser().catch(() => undefined)
afterAll(async () => browser?.close())

describe.skipIf(!browser)('collected in a real browser', { timeout: 30_000 }, () => {
  it('records how much of a heading or label an ellipsis leaves on screen', async () => {
    if (!browser) return
    const dir = await mkdtemp(join(tmpdir(), 'rampa-shown-'))
    const file = join(dir, 'cut.html')
    await writeFile(
      file,
      '<!doctype html><html lang="en"><title>Cut</title><h2 id="cut" style="width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Returns and refunds for orders shipped abroad</h2><h2 id="whole">Returns</h2><p>Text.</p></html>',
      'utf8',
    )
    const { snapshot } = await collectWeb(browser, pathToFileURL(file).href, { runAxe: false, locale: 'en' })
    const shown = Object.fromEntries([...walkTree(snapshot.root)].filter((n) => n.native.tag === 'h2').map((n) => [n.ref, n.native.shown]))
    expect(shown['#cut']).toBeGreaterThan(0.1)
    expect(shown['#cut']).toBeLessThan(0.6)
    expect(shown['#whole']).toBeUndefined()
  })


  it('records them on the field they are about', async () => {
    if (!browser) return
    const dir = await mkdtemp(join(tmpdir(), 'rampa-form-issues-'))
    const file = join(dir, 'form.html')
    await writeFile(
      file,
      '<!doctype html><html lang="en"><title>Sign up</title><form><label for="e">Email</label><input id="e" name="email"><label for="t">Phone</label><input id="t" name="phone" autocomplete="telephone"><label for="n">Work email</label><input id="n" name="work" type="email" autocomplete="email"></form></html>',
      'utf8',
    )
    const { snapshot } = await collectWeb(browser, pathToFileURL(file).href, { runAxe: false, locale: 'en' })
    const issues = Object.fromEntries([...walkTree(snapshot.root)].filter((n) => n.native.tag === 'input').map((n) => [n.ref, n.native.formIssues]))
    expect(issues).toEqual({
      '#e': ['FormInputAssignedAutocompleteValueToIdOrNameAttributeError'],
      '#t': ['FormInputHasWrongButWellIntendedAutocompleteValueError'],
      '#n': undefined,
    })
  })
})
