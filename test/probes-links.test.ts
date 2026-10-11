import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkSnapshot } from '../src/core/check.ts'
import type { Report } from '../src/core/types.ts'
import { linkPurpose } from '../src/criteria/link-purpose.ts'
import { emptyEngine } from '../src/engine/axe.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import { type ControlFacts, type Watch, changedPage, destructiveCode, destructiveWord, skipReason, skipText } from '../src/probes/activate.ts'
import { type LinksData, type ScriptedLink, linkOutcome, scriptedAddresses } from '../src/probes/links.ts'
import { DETERMINISM_ARGS, parseProbeKinds } from '../src/probes/run.ts'
import { renderReport } from '../src/report/pretty.ts'
import { paint } from '../src/report/color.ts'
import { SCRIPTED_LINKS_RULE } from '../src/rules/links.ts'
import { A11ySnapshotSchema, type A11yNode, type A11ySnapshot, type ProbeRecord } from '../src/snapshot/schema.ts'
import { destinationCache } from '../src/surfaces/destinations.ts'
import { loadRecorded } from '../src/surfaces/targets.ts'
import { type Collected, collectWeb, launchBrowser } from '../src/surfaces/web.ts'
import { startFixtureServers } from './media-server.ts'
import { probeCheckOptions } from './probe-helpers.ts'

const facts = (extra: Partial<ControlFacts> = {}): ControlFacts => ({ texts: [], code: [], disabled: false, submit: false, sensitiveForm: false, download: false, ...extra })

describe('the activate-class skip list', () => {
  it('reads destructive, transactional and account-changing names in English, Portuguese and Spanish', () => {
    for (const [text, word] of [
      ['Delete account', 'delete'],
      ['Sign out', 'sign out'],
      ['Log-out', 'log out'],
      ['Buy now', 'buy'],
      ['Unsubscribe from all e-mails', 'unsubscribe'],
      ['Excluir conta', 'excluir'],
      ['Sair', 'sair'],
      ['Finalizar compra', 'finalizar compra'],
      ['Cancelar assinatura', 'cancelar assinatura'],
      ['Cerrar sesión', 'cerrar sesion'],
      ['Añadir al carrito', 'anadir al carrito'],
      ['Eliminar', 'eliminar'],
      ['Accept all cookies', 'accept'],
    ] as const) {
      expect(destructiveWord(text), text).toBe(word)
    }
    for (const text of ['Pricing', 'Read the story', 'Documentation', 'Contact', 'Next page', 'Display options', 'Payload reference', 'Subscriptions']) {
      expect(destructiveWord(text), text).toBeUndefined()
    }
  })

  it('reads the same verbs in code (handlers, javascript: addresses, ids, classes), but not analytics calls', () => {
    expect(skipText('removeItem(3)')).toBe(' remove item 3 ')
    expect(destructiveCode('javascript:removeItem(3)')).toBe('remove')
    expect(destructiveCode('btn-logout')).toBe('logout')
    expect(destructiveCode("ga('send', 'event'); location.assign('/docs')")).toBeUndefined()
    expect(destructiveCode("document.forms[0].submit()")).toBeUndefined()
  })

  it('keeps out submissions, sensitive forms, downloads, new windows and other origins', () => {
    const origin = 'https://example.com'
    expect(skipReason(facts({ texts: ['Pricing'] }), origin)).toBeUndefined()
    expect(skipReason(facts({ submit: true }), origin)?.reason).toBe('submit')
    expect(skipReason(facts({ method: 'delete' }), origin)).toEqual({ reason: 'submit', detail: 'data-method="delete"' })
    expect(skipReason(facts({ method: 'get' }), origin)).toBeUndefined()
    expect(skipReason(facts({ sensitiveForm: true }), origin)?.reason).toBe('sensitive-form')
    expect(skipReason(facts({ download: true }), origin)?.reason).toBe('download')
    expect(skipReason(facts({ target: '_blank' }), origin)?.reason).toBe('new-window')
    expect(skipReason(facts({ target: '_self' }), origin)).toBeUndefined()
    expect(skipReason(facts({ origin: 'https://other.example' }), origin)?.reason).toBe('other-origin')
    expect(skipReason(facts({ disabled: true }), origin)?.reason).toBe('disabled')
    expect(skipReason(facts({ secret: true }), origin)?.reason).toBe('secret')
    expect(skipReason(facts({ texts: ['Next'], code: ['btn-delete'] }), origin)).toEqual({ reason: 'destructive', detail: 'delete' })
  })

  it('keeps the activate class out of --probe all, and names it --probe interact', () => {
    expect(parseProbeKinds('all')).not.toContain('links')
    expect(parseProbeKinds('links')).toEqual(['links'])
    expect(parseProbeKinds('interact')).toEqual(['shortcuts', 'links', 'input', 'form'])
  })
})

const watch = (extra: Partial<Watch> = {}): Watch => ({ dom: 0, style: 0, samples: [], navigations: [], windows: [], submits: [], dialogs: [], modals: 0, text: { before: 100, changed: 0 }, storage: 0, blocked: 0, ms: 600, ...extra })

describe('what a click on a scripted link did', () => {
  const page = 'https://example.com/shop'
  it('names the strongest effect, and never counts an intercepted navigation as a change to the page', () => {
    const leave = watch({ navigations: [{ url: 'https://example.com/pricing', type: 'push', same: false, at: 1 }] })
    expect(linkOutcome(leave, page)).toMatchObject({ kind: 'navigation', url: 'https://example.com/pricing' })
    expect(changedPage(leave)).toBe(false)
    expect(linkOutcome(watch({ windows: ['https://example.com/help'] }), page)).toMatchObject({ kind: 'new-window', url: 'https://example.com/help' })
    expect(linkOutcome(watch({ submits: ['https://example.com/cart'], navigations: leave.navigations }), page).kind).toBe('submit')
    const route = watch({ url: 'https://example.com/app/settings', title: 'Settings', heading: 'Your settings', dom: 4 })
    expect(linkOutcome(route, page)).toMatchObject({ kind: 'route', title: 'Settings', heading: 'Your settings' })
    expect(changedPage(route)).toBe(true)
    expect(linkOutcome(watch({ url: 'https://example.com/shop#/about', hashOnly: true, dom: 3 }), page).kind).toBe('route')
    const fragment = watch({ url: 'https://example.com/shop#desc', hashOnly: true })
    expect(linkOutcome(fragment, page)).toMatchObject({ kind: 'fragment', fragment: 'desc' })
    expect(changedPage(fragment)).toBe(false)
    expect(linkOutcome(watch({ url: 'https://example.com/shop#', hashOnly: true }), page).kind).toBe('nothing')
    expect(linkOutcome(watch({ opened: { ref: '#d', id: { tag: 'div', sig: 'div|d||||' }, tag: 'div', role: 'dialog', label: 'Sign in', name: 'Sign in', modal: true, cover: 1 } }), page).kind).toBe('opened')
    expect(linkOutcome(watch({ dom: 2 }), page).kind).toBe('content')
    // Text that changed with no mutation outside the noise is the page's own (a carousel).
    expect(changedPage(watch({ text: { before: 100, changed: 40 } }))).toBe(false)
  })
})

const node = (ref: string, tag: string, attributes: Record<string, string>, role: string, name: string, children: A11yNode[] = []): A11yNode => ({
  ref,
  role,
  name,
  states: [],
  native: { tag, attributes },
  children,
})
const text = (ref: string, value: string): A11yNode => ({ ref, role: 'text', text: value, states: [], native: { tag: '#text' }, children: [] }) as A11yNode

function scriptedSnapshot(links: ScriptedLink[], destinations: A11ySnapshot['destinations'] = {}): A11ySnapshot {
  const data: LinksData = { viewport: { width: 1280, height: 800 }, found: links.length, links, activated: links.length, loads: 1, actions: [], end: 'complete' }
  const record: ProbeRecord = {
    kind: 'links',
    version: '1',
    conditions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, browser: 'chromium 1 (headless)', variant: 'scripted-links' },
    status: 'complete',
    guard: { blocked: [], navigations: [], dialogs: [] },
    durationMs: 1,
    data,
  }
  const body = node('html > body', 'body', {}, 'generic', '', [
    node('#pricing', 'a', { id: 'pricing', href: '#' }, 'link', 'Pricing', [text('#pricing > #text', 'Pricing')]),
    node('p', 'p', {}, 'paragraph', '', [
      node('#sales', 'span', { id: 'sales', role: 'link' }, 'link', 'Contact', [text('#sales > #text', 'Contact')]),
      node('#support', 'span', { id: 'support', role: 'link' }, 'link', 'Contact', [text('#support > #text', 'Contact')]),
    ]),
  ])
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://example.com/',
    title: 'Acme',
    viewport: { width: 1280, height: 800, scale: 1 },
    root: node('html', 'html', { lang: 'en' }, 'document', '', [body]),
    destinations,
    observations: { probes: [record] },
    collectedAt: new Date(0).toISOString(),
    collector: { name: 'rampa-web', version: '0' },
  }
}

const link = (ref: string, tag: string, attributes: Record<string, string>, label: string, outcome: ScriptedLink['outcome']): ScriptedLink => ({
  ref,
  id: { tag, sig: [tag, attributes.id ?? '', attributes.role ?? '', '', '', attributes.href ?? ''].join('|') },
  tag,
  role: 'link',
  label,
  how: attributes.href === '#' ? 'hash' : 'no-href',
  outcome,
})

/** A model that answers per link text, and keeps the prompts it was asked. */
function perLink(answers: Record<string, Record<string, unknown>>): ModelProvider & { asked: string[] } {
  const asked: string[] = []
  return {
    id: 'stub:links',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      asked.push(request.user)
      const name = /<link>([\s\S]*?)<\/link>/.exec(request.user)?.[1] ?? ''
      const output = answers[name] ?? { promises: name, leadsTo: '', verdict: 'pass', evidence: name, problem: 'none', suggestedText: '', confidence: 'high' }
      return { output: request.schema.parse(output), inputTokens: 100, outputTokens: 20, latencyMs: 1, modelId: 'stub' }
    },
  }
}

const ANSWERS = {
  Pricing: { promises: 'prices', leadsTo: 'a blog post', verdict: 'fail', evidence: 'Pricing', problem: 'mismatch', suggestedText: 'Launch week recap', confidence: 'high' },
  Contact: { promises: 'contact', leadsTo: 'sales or support', verdict: 'fail', evidence: 'Contact', problem: 'ambiguous', suggestedText: 'Contact sales', confidence: 'high' },
}

describe('2.4.4 reads where scripted links lead', () => {
  const blog = 'https://example.com/blog/launch'
  const destinations = {
    [blog]: { kind: 'page' as const, status: 200, title: 'Launch week recap', heading: 'Launch week recap' },
    'https://example.com/contact/sales': { kind: 'page' as const, status: 200, title: 'Contact sales', heading: 'Contact sales' },
    'https://example.com/contact/support': { kind: 'page' as const, status: 200, title: 'Contact support', heading: 'Contact support' },
  }
  const clicked = [
    link('#pricing', 'a', { id: 'pricing', href: '#' }, 'Pricing', { kind: 'navigation', url: blog }),
    link('#sales', 'span', { id: 'sales', role: 'link' }, 'Contact', { kind: 'navigation', url: 'https://example.com/contact/sales' }),
    link('#support', 'span', { id: 'support', role: 'link' }, 'Contact', { kind: 'navigation', url: 'https://example.com/contact/support' }),
  ]

  it('gives the judgment what the click did and what was read there, and keeps a mismatch and an ambiguity it can verify', async () => {
    const model = perLink(ANSWERS)
    const report = await checkSnapshot(scriptedSnapshot(clicked, destinations), emptyEngine(), probeCheckOptions({ criteria: [linkPurpose], llm: true, provider: model }))
    const pricing = model.asked.find((prompt) => prompt.includes('<link>Pricing</link>')) ?? ''
    expect(pricing).toContain(`What activating the link does (a browser test clicked it and stopped any navigation): it goes to ${blog}`)
    expect(pricing).toContain('Where the link leads (read at its address): a page titled "Launch week recap"')
    expect(model.asked.find((prompt) => prompt.includes('<link>Contact</link>'))).toContain('2 links on this page have this text and lead to 2 different places, and nothing in the context of this one tells it apart')
    const findings = report.findings.filter((f) => f.criterion === '2.4.4')
    expect(findings.map((f) => f.message).sort()).toEqual([
      'The link text "Contact" is shared by 2 links that lead to 2 different places, and nothing around this one tells it apart.',
      'The link text "Contact" is shared by 2 links that lead to 2 different places, and nothing around this one tells it apart.',
      'The link text "Pricing" does not match where the link leads: a page titled "Launch week recap".',
    ])
    expect(report.discarded).toEqual([])
  })

  it('without the probe, the same answers cannot be verified: a scripted link has no known destination', async () => {
    const snapshot = scriptedSnapshot(clicked, destinations)
    snapshot.observations = undefined
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions({ criteria: [linkPurpose], llm: true, provider: perLink(ANSWERS) }))
    expect(report.findings.filter((f) => f.criterion === '2.4.4')).toEqual([])
    expect(report.discarded.map((d) => d.reason).sort()).toEqual([
      'mismatch without a known destination',
      'no other link with this text leads elsewhere from the same context',
      'no other link with this text leads elsewhere from the same context',
    ])
  })

  it('ignores a fact whose identity does not match the snapshot (the page changed between loads)', async () => {
    const moved = [{ ...clicked[0], id: { tag: 'a', sig: 'a|other||||#' } } as ScriptedLink]
    const model = perLink(ANSWERS)
    await checkSnapshot(scriptedSnapshot(moved, destinations), emptyEngine(), probeCheckOptions({ criteria: [linkPurpose], llm: true, provider: model }))
    expect(model.asked.find((prompt) => prompt.includes('<link>Pricing</link>'))).not.toContain('What activating the link does')
  })

  it('reports the probe as facts for the judgment, never as a check that found no failure', async () => {
    const report = await checkSnapshot(scriptedSnapshot(clicked, destinations), emptyEngine(), probeCheckOptions())
    const row = report.coverage.probes?.find((c) => c.criterion === '2.4.4')
    expect(row).toMatchObject({ method: 'probe/links@1', rule: SCRIPTED_LINKS_RULE, inventory: true, applicable: 3, failures: 0 })
    expect(row?.note).toContain('3 scripted link(s) found, 3 clicked')
    expect(row?.note).toContain('3 go to another address (intercepted)')
    // With --no-llm, 2.4.4 stays not checked: the probe decided nothing.
    expect(report.coverage.criteria?.find((c) => c.id === '2.4.4')?.status).toBe('not-checked')
    const text = renderReport(report, { verbose: true, paint: paint(false) })
    expect(text).toMatch(/2\.4\.4 +probe\/links@1 \(rampa\/scripted-links\) · scripted links clicked at 1280×800 · chromium 1 \(headless\): facts for the judgment/)
    expect(text).not.toMatch(/Probed \(experimental\): +2\.4\.4/)
  })

  it('lists the addresses to read, http and file only', () => {
    const record = scriptedSnapshot([
      ...clicked,
      link('#x', 'a', { id: 'x', href: '#' }, 'Mail', { kind: 'navigation', url: 'mailto:a@example.com' }),
      link('#y', 'a', { id: 'y', href: '#' }, 'Go', { kind: 'route', url: 'https://example.com/app' }),
    ]).observations?.probes ?? []
    expect(scriptedAddresses(record).sort()).toEqual([blog, 'https://example.com/contact/sales', 'https://example.com/contact/support'])
  })
})

// Integration: needs Chrome or Edge, and the fixtures over HTTP. Skipped, with the reason on stderr, when no browser starts.
const browser = await launchBrowser({ args: DETERMINISM_ARGS }).catch((error: unknown) => {
  process.stderr.write(`\nSkipping the links probe tests: no browser started (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).\n`)
  return undefined
})
const servers = browser ? await startFixtureServers() : undefined
afterAll(async () => {
  await browser?.close()
  await servers?.close()
}, 60_000)

const collected = new Map<string, Promise<Collected>>()
function probed(name: string): Promise<Collected> {
  if (!browser || !servers) throw new Error('no browser')
  let result = collected.get(name)
  if (!result) {
    result = collectWeb(browser, `${servers.origin}/${name}`, { runAxe: false, locale: 'en', probes: ['links'], followLinks: { policy: 'same-origin', cache: destinationCache() } })
    collected.set(name, result)
  }
  return result
}

const recordOf = (snapshot: A11ySnapshot) => snapshot.observations?.probes.find((p) => p.kind === 'links')
const dataOf = (snapshot: A11ySnapshot) => recordOf(snapshot)?.data as LinksData
const outcomes = (snapshot: A11ySnapshot) => Object.fromEntries(dataOf(snapshot).links.map((l) => [l.ref, l.skip ? `skip ${l.skip.reason}${l.skip.detail ? ` ${l.skip.detail}` : ''}` : (l.outcome?.kind ?? 'none')]))

describe.skipIf(!browser)('links probe (2.4.4)', { timeout: 240_000 }, () => {
  it('clicks each scripted link once, intercepts where it goes, and reads the address like a link’s', async () => {
    const { snapshot } = await probed('links-scripted.html')
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(recordOf(snapshot)).toMatchObject({ kind: 'links', version: '1', status: 'complete', conditions: { variant: 'scripted-links' } })
    expect(outcomes(snapshot)).toEqual({
      '#pricing': 'navigation',
      '#docs': 'navigation',
      '#help': 'new-window',
      '#settings': 'route',
      '#desc-link': 'fragment',
      '#open-signin': 'opened',
      '#soon': 'nothing',
      '#contact-sales': 'navigation',
      '#contact-support': 'navigation',
    })
    const data = dataOf(snapshot)
    const byRef = (ref: string) => data.links.find((l) => l.ref === ref)?.outcome
    const origin = servers?.origin ?? ''
    expect(byRef('#pricing')?.url).toBe(`${origin}/links/blog-launch.html`)
    expect(byRef('#settings')).toMatchObject({ url: `${origin}/links/app/settings`, title: 'Settings · Acme', heading: 'Your settings' })
    expect(byRef('#desc-link')?.fragment).toBe('desc')
    expect(byRef('#open-signin')?.opened).toMatchObject({ name: 'Sign in to Acme', modal: true })
    // The clicks stopped every navigation: the server saw the page loads and Rampa's own reads of the addresses, nothing else.
    const requests = servers?.requests ?? []
    expect(snapshot.destinations?.[`${origin}/links/blog-launch.html`]).toMatchObject({ kind: 'page', title: 'Launch week recap · Acme blog' })
    expect(snapshot.destinations?.[`${origin}/links/help.html`]).toMatchObject({ kind: 'page', title: 'Help center · Acme' })
    expect(requests.filter((r) => r.includes('/links/') && !r.startsWith('GET /links/'))).toEqual([])
    // The ticking clock never made the page "changed"; a dialog that opened and an address set in place did.
    expect(data.loads).toBeGreaterThanOrEqual(3)
    expect(data.actions.filter((a) => a.action === 'not-exercised').map((a) => a.label)).toEqual(['Sign in to Acme'])
    expect(recordOf(snapshot)?.guard.navigations.filter((n) => n.cause === 'intercepted').length).toBeGreaterThanOrEqual(4)
  })

  it('lets the 2.4.4 judgment compare a scripted link with where it went', async () => {
    const { snapshot, engine } = await probed('links-scripted.html')
    const model = perLink(ANSWERS)
    const report = await checkSnapshot(snapshot, engine, probeCheckOptions({ criteria: [linkPurpose], llm: true, provider: model }))
    const messages = report.findings.filter((f) => f.criterion === '2.4.4').map((f) => f.message)
    expect(messages).toContain('The link text "Pricing" does not match where the link leads: a page titled "Launch week recap · Acme blog".')
    expect(messages.filter((m) => m.startsWith('The link text "Contact" is shared by 2 links'))).toHaveLength(2)
    expect(model.asked.find((p) => p.includes('<link>See the description of the product</link>'))).toContain('within this page, to the part that reads "This product is a set of web pages about rockets."')
    expect(model.asked.find((p) => p.includes('<link>Help center</link>'))).toContain('it opens a new window at')
  })

  it('never touches a control the skip list names, and its log matches what reached the server', async () => {
    const { snapshot } = await probed('links-destructive.html')
    const record = recordOf(snapshot)
    expect(outcomes(snapshot)).toEqual({
      '#delete': 'skip destructive delete',
      '#remove': 'skip destructive remove',
      '#sair': 'skip destructive sair',
      '#news': 'skip destructive unsubscribe',
      '#comprar': 'skip destructive comprar',
      '#eliminar': 'skip destructive eliminar',
      '#seen': 'skip submit data-method="post"',
      '#report': 'skip download',
      '#gallery': 'skip new-window target="_blank"',
      '#tips': 'skip sensitive-form',
      '#refresh': 'nothing',
      '#next': 'navigation',
    })
    const data = dataOf(snapshot)
    expect(data.actions.filter((a) => a.action === 'activate').map((a) => a.ref)).toEqual(['#refresh', '#next'])
    expect(data.actions.filter((a) => a.action === 'skip').map((a) => a.ref)).toEqual(['#delete', '#remove', '#sair', '#news', '#comprar', '#eliminar', '#seen', '#report', '#gallery', '#tips'])
    // The guard's log: the one POST a click tried, blocked, and the one navigation, intercepted.
    const origin = servers?.origin ?? ''
    expect(record?.guard.blocked.map((b) => `${b.method} ${b.url}`)).toEqual([`POST ${origin}/touched?post`])
    expect(record?.guard.navigations.map((n) => `${n.cause} ${n.url}`)).toEqual([`intercepted ${origin}/links/next.html`])
    expect(data.actions.filter((a) => a.action === 'blocked').map((a) => a.detail)).toEqual([`POST ${origin}/touched?post`])
    // Nothing a destructive control would have sent ever reached the server.
    expect((servers?.requests ?? []).filter((r) => r.includes('/touched'))).toEqual([])
  })

  it('never guesses past a cookie wall: what it covers is not exercised, and "Accept all" is never pressed', async () => {
    const { snapshot } = await probed('links-overlay.html')
    expect(outcomes(snapshot)).toEqual({ '#story': 'not-exercised', '#accept': 'skip destructive accept', '#settings': 'nothing' })
    const story = dataOf(snapshot).links.find((l) => l.ref === '#story')
    expect(story?.outcome?.cover).toMatchObject({ ref: '#wall' })
    const report = await checkSnapshot(snapshot, emptyEngine(), probeCheckOptions())
    expect(report.coverage.probes?.find((c) => c.criterion === '2.4.4')?.note).toContain('1 not exercised: <a> "Read the story" under <div> "We use cookies to measure visits.')
  })

  it('replays a saved snapshot offline to the same prompts', async () => {
    const { snapshot, engine } = await probed('links-scripted.html')
    const live = perLink(ANSWERS)
    const first = await checkSnapshot(snapshot, engine, probeCheckOptions({ criteria: [linkPurpose], llm: true, provider: live }))
    const dir = await mkdtemp(join(tmpdir(), 'rampa-links-'))
    const path = join(dir, 'links.snapshot.json')
    await writeFile(path, JSON.stringify(snapshot), 'utf8')
    await writeFile(join(dir, 'links.engine.json'), JSON.stringify(engine), 'utf8')
    const loaded = await loadRecorded(path, 'en')
    const replay = perLink(ANSWERS)
    const second = await checkSnapshot(loaded.snapshot, loaded.engine, probeCheckOptions({ criteria: [linkPurpose], llm: true, provider: replay }))
    const key = (report: Report) => report.findings.map((f) => `${f.fingerprint} ${f.message}`).sort()
    expect(key(second)).toEqual(key(first))
    expect(replay.asked.sort()).toEqual(live.asked.sort())
  })
})
