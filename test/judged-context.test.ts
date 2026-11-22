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

  it('adds the titles of the pages of the same site it links to, as read for 2.4.4', () => {
    const destinations: A11ySnapshot['destinations'] = {
      '/help/shipping': { kind: 'page', status: 200, title: 'Shipping' },
      // The page itself under another address, another site, a file and a page that could not be read say nothing.
      '/help/returns/?ref=footer': { kind: 'page', status: 200, title: 'Returns' },
      'https://other.example/': { kind: 'page', status: 200, title: 'Other shop' },
      '/help/policy.pdf': { kind: 'file', status: 200, contentType: 'application/pdf' },
      '/help/gone': { kind: 'unreadable', status: 404, reason: 'not found' },
      '/old-help': { kind: 'page', status: 200, finalUrl: 'https://shop.example/help/faq', title: 'Returns' },
    }
    const [candidate] = pageTitled.candidates(page(body, { destinations, siblings: [{ url: 'https://shop.example/help/faq', title: 'Help center' }] }), NO_ENGINE)
    // A crawl's titles come first; a title the page shares with a page it links to stays: it is what tells nothing apart.
    expect(candidate?.context.siblings).toEqual(['Help center', 'Shipping', 'Returns'])
    // A home page is described by the site's name (G88): the pages it links to are not listed.
    const [home] = pageTitled.candidates(page(body, { target: 'https://shop.example/', title: 'Returns', destinations }), NO_ENGINE)
    expect(home?.context.siblings).toBeUndefined()
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

  const button = (name: string) => node({ ref: `button-${name}`, role: 'button', name, native: { tag: 'button' } })
  const select = node({
    ref: '#profession',
    role: 'combobox',
    name: 'Choose a profession',
    native: { tag: 'select', attributes: { id: 'profession' } },
    children: ['Dietitian', 'Paramedic'].map((name) => node({ ref: `option-${name}`, name, native: { tag: 'option' } })),
  })

  it('keeps a fail below the threshold in a form that looks people or records up', () => {
    // Modeled on round 8's register searches: the names are a registered doctor's, the profession a registrant's.
    const register = page([form([field('#first', 'First name', {}), field('#last', 'Last name', {}), button('Search registered doctors')])])
    const candidates = identifyInputPurpose.candidates(register, NO_ENGINE)
    expect(candidates.map((c) => c.context.lookup)).toEqual(['Search registered doctors', 'Search registered doctors'])
    expect(candidates.map((c) => identifyInputPurpose.confidenceCap?.(c))).toEqual(['low', 'low'])
    const [profession] = identifyInputPurpose.candidates(page([form([select, button('Search')])]), NO_ENGINE)
    expect(profession?.context.lookup).toBe('Search')
    const [servant] = identifyInputPurpose.candidates(page([form([field('#servidor', 'Nome do servidor', {}), button('Pesquisar')])]), NO_ENGINE)
    expect(servant?.context.lookup).toBe('Pesquisar')
    // The cap reads the form; the model's question about the field is the same as before.
    const first = candidates[0]!
    expect(identifyInputPurpose.prompt(first, register)).toEqual(identifyInputPurpose.prompt({ ...first, context: { ...first.context, lookup: undefined } }, register))
  })

  it('does not take a form that asks for an email, telephone, password or message as a search', () => {
    // A page wrapped in one form element holds the site search's button and a contact form together.
    const contact = page([form([button('Search'), field('#name', 'Name', {}), field('#email', 'Email', { type: 'email' })])])
    expect(identifyInputPurpose.candidates(contact, NO_ENGINE).map((c) => c.context.lookup)).toEqual([undefined, undefined])
    const signIn = page([form([field('#user', 'Username', {}), field('#password', 'Password', { type: 'password' }), button('Find my account')])])
    expect(identifyInputPurpose.candidates(signIn, NO_ENGINE).map((c) => c.context.lookup)).toEqual([undefined, undefined])
    // A search word later in the button's name is not a search button.
    const newsletter = page([form([field('#name', 'Your name', {}), button('Sign up to search jobs')])])
    expect(identifyInputPurpose.candidates(newsletter, NO_ENGINE).map((c) => identifyInputPurpose.confidenceCap?.(c))).toEqual([undefined])
  })

  it('reads the submit buttons closest to the field, by the name the browser gives them', () => {
    const block = (ref: string, children: A11yNode[]) => node({ ref, native: { tag: 'div' }, children })
    // An ASP.NET page is one form: the site search, a register search and a callback form share it.
    const submit = (ref: string, name: string) =>
      node({ ref, role: 'button', native: { tag: 'input', attributes: { type: 'submit' } }, ax: { role: 'button', name, nameFrom: 'value' } })
    const wholePage = page([
      form([
        block('header', [field('#q', 'Search the site', {}), submit('#go', 'Search')]),
        block('register', [field('#forename', 'Forename', {}), field('#surname', 'Surname', {}), submit('#find', 'SEARCH REGISTERED DOCTORS')]),
        // The telephone field is a plain text input, as many are; the block's own button is what tells it apart.
        block('callback', [field('#name', 'Your name', {}), field('#phone', 'Phone number', {}), node({ ref: 'send', role: 'button', name: 'Call me back', native: { tag: 'button' } })]),
      ]),
    ])
    const lookups = Object.fromEntries(identifyInputPurpose.candidates(wholePage, NO_ENGINE).map((c) => [c.ref, c.context.lookup]))
    expect(lookups).toEqual({ '#q': 'Search', '#forename': 'SEARCH REGISTERED DOCTORS', '#surname': 'SEARCH REGISTERED DOCTORS', '#name': undefined, '#phone': undefined })
    // A button that only clears or toggles does not submit: the search button further up still counts.
    const clear = node({ ref: 'clear', role: 'button', name: 'Clear', native: { tag: 'button', attributes: { type: 'button' } } })
    const [surname] = identifyInputPurpose.candidates(page([form([block('row', [field('#s', 'Surname', {}), clear]), button('Search')])]), NO_ENGINE)
    expect(surname?.context.lookup).toBe('Search')
    // Buttons that do not all search are not a search form's.
    const mixed = page([form([field('#first', 'First name', {}), button('Search'), button('Save')])])
    expect(identifyInputPurpose.candidates(mixed, NO_ENGINE).map((c) => c.context.lookup)).toEqual([undefined])
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
