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
