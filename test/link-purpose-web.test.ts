import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { linkPurpose } from '../src/criteria/link-purpose.ts'
import { linkGeneric, linkMismatch } from '../src/eval/pairs.ts'
import { A11ySnapshotSchema } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { destinationCache } from '../src/surfaces/destinations.ts'
import { collectWeb, launchBrowser } from '../src/surfaces/web.ts'

// Integration: needs Chrome or Edge (or Playwright's Chromium). Skipped when none is installed.
const browser = await launchBrowser().catch(() => undefined)
afterAll(async () => browser?.close())

const news = pathToFileURL(resolve('examples/link-purpose/news.html')).href

describe.skipIf(!browser)('2.4.4 on a real page', { timeout: 30_000 }, () => {
  it('reads where the local links of a local page lead, and judges each link with it', async () => {
    if (!browser) return
    const { snapshot, engine } = await collectWeb(browser, news, {
      runAxe: true,
      locale: 'en',
      followLinks: { policy: 'same-origin', cache: destinationCache() },
    })
    expect(A11ySnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot.destinations?.['launch-week.html']).toMatchObject({ kind: 'page', title: 'Launch week recap | Corner Store blog' })
    expect(snapshot.destinations?.['prices-2025.csv']).toMatchObject({ kind: 'file', contentType: 'text/csv' })
    expect(snapshot.destinations?.['news.html']).toEqual({ kind: 'same-page' })
    // Keys are the hrefs as written, so a saved snapshot carries no path of this machine.
    expect(JSON.stringify(snapshot.destinations)).not.toContain('file:')

    const byName = (name: string) => linkPurpose.candidates(snapshot, engine).filter((c) => c.context.name === name)
    expect(byName('Pricing')[0]?.context.destination).toMatchObject({ title: 'Launch week recap | Corner Store blog' })
    expect(byName('Download').map((c) => c.context.sameText)).toEqual([
      { links: 2, places: 2, apart: false },
      { links: 2, places: 2, apart: false },
    ])
    expect(byName('Read more').map((c) => c.context.sameText?.apart)).toEqual([true, true])
  })

  it('records the line a link sits on in a block split by <br>, and tells same-text links apart by it', async () => {
    if (!browser) return
    const dir = await mkdtemp(join(tmpdir(), 'rampa-lines-'))
    const path = join(dir, 'page.html')
    // museucatavento.org.br's opening hours block in the sixth real-page study, and blocks that give no line.
    await writeFile(
      path,
      `<!doctype html><html lang="pt"><body>
        <div id="hours">FUNCIONAMENTO: terça a domingo das 09h às 17h.<br>Bilheteria fecha às 16h.<br><br>AGENDAMENTO DE GRUPOS <a id="groups" href="https://museu.example/agendamento">CLIQUE AQUI</a><br><br>GARANTA SEU INGRESSO <strong>INDIVIDUAL</strong> <a id="tickets" href="https://museu.example/ingressos">CLIQUE AQUI</a><br><br><span><a id="alone" href="https://museu.example/senhas">CLIQUE AQUI</a></span><br></div>
        <p>Para mais informações, <a id="inline" href="https://museu.example/info">clique aqui</a>.</p>
        <p><a id="single" href="https://museu.example/single">Leia mais</a> sobre o museu<br></p>
      </body></html>`,
    )
    const { snapshot } = await collectWeb(browser, pathToFileURL(path).href, { runAxe: false, locale: 'pt-BR' })
    const lineOf = (id: string) => [...walkTree(snapshot.root)].find((node) => (node.native.attributes as Record<string, string> | undefined)?.id === id)?.native.lineText
    expect(lineOf('groups')).toBe('AGENDAMENTO DE GRUPOS CLIQUE AQUI')
    expect(lineOf('tickets')).toBe('GARANTA SEU INGRESSO INDIVIDUAL CLIQUE AQUI')
    expect(lineOf('alone')).toBe('CLIQUE AQUI')
    // No <br> around it, or the link's line is the block's only line with text.
    expect(lineOf('inline')).toBeUndefined()
    expect(lineOf('single')).toBeUndefined()
    const shared = linkPurpose.candidates(snapshot, { engine: { name: 'axe-core', version: 'test' }, rules: [] }).filter((c) => c.context.name === 'CLIQUE AQUI')
    expect(shared.map((c) => c.context.sameText?.apart)).toEqual([true, true, true])
  })

  it('reads what a slot or another element with display: contents holds as shown, and follows its links', async () => {
    if (!browser) return
    // chop.edu's footer in the seventh real-page study: its links sat under slots, were recorded as hidden and never followed.
    const dir = await mkdtemp(join(tmpdir(), 'rampa-slots-'))
    await writeFile(join(dir, 'terms.html'), '<!doctype html><html lang="en"><head><title>Terms of Use</title></head><body><h1>Terms of Use</h1></body></html>')
    await writeFile(
      join(dir, 'page.html'),
      `<!doctype html><html lang="en"><body>
        <site-footer><a id="slotted" href="terms.html">Terms of use</a></site-footer>
        <div id="contents" style="display: contents"><a id="inside" href="terms.html">Terms</a></div>
        <div style="display: none"><div id="gone" style="display: contents"><a id="hidden" href="terms.html">Hidden terms</a></div></div>
        <script>customElements.define('site-footer', class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<div><slot></slot></div>' } })</script>
      </body></html>`,
    )
    const { snapshot } = await collectWeb(browser, pathToFileURL(join(dir, 'page.html')).href, { runAxe: false, locale: 'en', followLinks: { policy: 'same-origin', cache: destinationCache() } })
    const nodes = [...walkTree(snapshot.root)]
    const byId = (id: string) => nodes.find((node) => (node.native.attributes as Record<string, string> | undefined)?.id === id)
    expect(nodes.find((node) => node.native.tag === 'slot')?.states).not.toContain('hidden')
    expect(byId('contents')?.states).not.toContain('hidden')
    expect(byId('slotted')?.states).not.toContain('hidden')
    expect(byId('gone')?.states).toContain('hidden')
    expect(snapshot.destinations?.['terms.html']).toMatchObject({ kind: 'page', title: 'Terms of Use' })
  })

  it('follows nothing with --follow-links none', async () => {
    if (!browser) return
    const { snapshot } = await collectWeb(browser, news, { runAxe: false, locale: 'en', followLinks: { policy: 'none' } })
    expect(snapshot.destinations).toBeUndefined()
  })

  it('breaks pages for the corrupted pairs: a generic text where it stands alone, a destination about something else', async () => {
    if (!browser) return
    const dir = await mkdtemp(join(tmpdir(), 'rampa-pairs-'))
    const path = join(dir, 'page.html')
    await writeFile(
      path,
      `<!doctype html><html lang="en"><body>
        <p><a id="alone" href="https://shop.test/plans">Plans and pricing</a></p>
        <p>See the <a id="inline" href="#desc">product description</a> below.</p>
        <a id="logo" href="https://shop.test/"><img alt="Corner Store" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>
        <span id="scripted" role="link" tabindex="0">Store locator</span>
        <p id="desc">A mug that keeps coffee warm.</p>
      </body></html>`,
    )
    const url = pathToFileURL(path).href
    let changed = 0
    const named = async (corruptor: typeof linkGeneric) => {
      const { snapshot } = await collectWeb(browser, url, {
        runAxe: false,
        locale: 'en',
        mutate: async (page) => {
          changed = await corruptor.apply(page)
        },
      })
      const links = [...walkTree(snapshot.root)].filter((node) => node.role === 'link')
      return Object.fromEntries(links.map((node) => [node.ref, { name: node.name, href: (node.native.attributes as Record<string, string>).href }]))
    }

    const generic = await named(linkGeneric)
    expect(changed).toBe(2)
    expect(generic['#alone']?.name).toBe('Check it out')
    expect(generic['#scripted']?.name).toBe('Check it out')
    expect(generic['#inline']?.name).toBe('product description')
    // An image-only link is 1.1.1's: its alt stays as it is.
    expect(generic['#logo']?.name).not.toBe('Check it out')

    const mismatch = await named(linkMismatch)
    expect(changed).toBe(2)
    expect(mismatch['#alone']).toEqual({ name: 'Plans and pricing', href: '#hours' })
    expect(mismatch['#inline']?.href).toBe('#hours')
    expect(mismatch['#logo']?.href).toBe('https://shop.test/')
  })
})
