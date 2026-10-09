import { describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import { headingsAndLabels } from '../src/criteria/headings-and-labels.ts'
import { linkPurpose } from '../src/criteria/link-purpose.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { walkTree } from '../src/snapshot/tree.ts'
import { normalizeScope, scopeTree } from '../src/surfaces/scope.ts'
import { node } from './helpers.ts'

const noEngine: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

/** A page with a cart component, an ad inside the cart's paragraph, and a sponsored aside. */
function page(): A11yNode {
  return node({
    ref: 'html',
    role: 'document',
    lang: 'en',
    native: { tag: 'html', html: '<html lang="en">', langText: 'Corner Store Your cart Orders ship free. Click here Ad text Sponsored offer Read more' },
    children: [
      node({
        ref: 'body',
        native: { tag: 'body' },
        children: [
          node({ ref: 'header', role: 'banner', native: { tag: 'header' }, children: [node({ ref: 'header > img', role: 'img', name: 'Corner Store', native: { tag: 'img' } })] }),
          node({
            ref: 'main',
            role: 'main',
            native: { tag: 'main', html: '<main><section id="cart">…</section></main>' },
            text: 'Main text outside the cart',
            children: [
              node({
                ref: '#cart',
                role: 'region',
                name: 'Cart',
                native: { tag: 'section', attributes: { id: 'cart' } },
                children: [
                  node({ ref: '#cart > h2', role: 'heading', name: 'Your cart', native: { tag: 'h2' }, children: [node({ ref: '#cart > h2 > span', text: 'Your cart' })] }),
                  node({
                    ref: '#cart > p',
                    role: 'paragraph',
                    text: 'Orders ship free.',
                    native: { tag: 'p', readingText: 'Orders ship free. Click here Ad text' },
                    children: [
                      node({ ref: '#cart > p > a', role: 'link', name: 'Click here', text: 'Click here', native: { tag: 'a', attributes: { href: '/shipping' } } }),
                      node({ ref: '#cart > p > span.ad', text: 'Ad text', native: { tag: 'span' } }),
                    ],
                  }),
                ],
              }),
              node({
                ref: 'aside.ad',
                role: 'complementary',
                name: 'Sponsored',
                text: 'Sponsored offer',
                native: { tag: 'aside' },
                children: [node({ ref: 'aside.ad > a', role: 'link', name: 'Read more', text: 'Read more', native: { tag: 'a', attributes: { href: 'https://ads.example' } } })],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

const refs = (root: A11yNode | undefined) => (root ? [...walkTree(root)].map((n) => n.ref) : [])
const find = (root: A11yNode | undefined, ref: string) => (root ? [...walkTree(root)].find((n) => n.ref === ref) : undefined)
const snapshotOf = (root: A11yNode): A11ySnapshot => ({
  schemaVersion: 1,
  surface: 'web',
  target: 'https://shop.test/cart',
  locale: 'en',
  viewport: { width: 1280, height: 800, scale: 1 },
  root,
  collectedAt: '2026-10-08T00:00:00.000Z',
  collector: { name: 'test', version: '0' },
})

describe('normalizeScope', () => {
  it('is undefined when there is nothing to scope to, and lists trimmed selectors otherwise', () => {
    expect(normalizeScope()).toBeUndefined()
    expect(normalizeScope([], ' ')).toBeUndefined()
    expect(normalizeScope(' #cart ', ['.ad', ''])).toEqual({ include: ['#cart'], exclude: ['.ad'] })
  })
})

describe('scopeTree', () => {
  it('keeps the included component whole and its ancestors as a skeleton', () => {
    const scoped = scopeTree(page(), new Set(['#cart']), new Set())
    expect(refs(scoped)).toEqual(['html', 'body', 'main', '#cart', '#cart > h2', '#cart > h2 > span', '#cart > p', '#cart > p > a', '#cart > p > span.ad'])
    // The ancestors keep what explains the component (language, landmark), never content of their own.
    expect(scoped).toMatchObject({ ref: 'html', lang: 'en', native: { tag: 'html', html: '<html lang="en">' } })
    expect(scoped?.native.langText).toBeUndefined()
    expect(find(scoped, 'main')).toMatchObject({ role: 'main', native: { tag: 'main', html: '<main>' } })
    expect(find(scoped, 'main')?.text).toBeUndefined()
    // Inside the component nothing changes.
    expect(find(scoped, '#cart > p')).toEqual(find(page(), '#cart > p'))
  })

  it('drops excluded subtrees and the recorded texts that still read them', () => {
    const scoped = scopeTree(page(), new Set(), new Set(['aside.ad', '#cart > p > span.ad']))
    expect(refs(scoped)).not.toContain('aside.ad')
    expect(refs(scoped)).not.toContain('#cart > p > span.ad')
    expect(find(scoped, '#cart > p')).toMatchObject({ text: 'Orders ship free.', native: { tag: 'p' } })
    expect(find(scoped, '#cart > p')?.native.readingText).toBeUndefined()
    expect(scoped?.native.langText).toBeUndefined()
    // Untouched subtrees keep everything.
    expect(find(scoped, 'header')).toEqual(find(page(), 'header'))
    expect(find(scoped, 'main')?.text).toBe('Main text outside the cart')
  })

  it('follows axe-core when an include sits inside an exclude: the closer selector wins', () => {
    const scoped = scopeTree(page(), new Set(['#cart']), new Set(['main']))
    expect(refs(scoped)).toContain('#cart > p > a')
    expect(refs(scoped)).not.toContain('aside.ad')
    expect(scopeTree(page(), new Set(), new Set(['html']))).toBeUndefined()
  })

  it('never hands the criteria an ancestor of the component to judge', () => {
    // Scoped to a link and to a span inside a heading: the paragraph, the heading and the region around them are skeletons.
    const scoped = scopeTree(page(), new Set(['#cart > p > a', '#cart > h2 > span']), new Set())
    if (!scoped) throw new Error('nothing in scope')
    expect(find(scoped, '#cart')).toMatchObject({ role: 'region', name: 'Cart' })
    expect(find(scoped, '#cart > h2')?.name).toBeUndefined()
    expect(find(scoped, '#cart > p')?.text).toBeUndefined()
    const snapshot = snapshotOf(scoped)
    expect(linkPurpose.candidates(snapshot, noEngine).map((c) => c.ref)).toEqual(['#cart > p > a'])
    expect(headingsAndLabels.candidates(snapshot, noEngine)).toEqual([])
  })
})
