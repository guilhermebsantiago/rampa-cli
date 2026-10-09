import { describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import { type LinkPurposeJudgment, describeDestination, linkPurpose } from '../src/criteria/link-purpose.ts'
import type { A11yNode, A11ySnapshot, Destination } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const noFindings: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function snapshot(children: A11yNode[], destinations?: Record<string, Destination>): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://shop.test/news/',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-08T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    destinations,
    root: node({ ref: 'html', role: 'document', lang: 'en', children: [node({ ref: 'body', native: { tag: 'body' }, children })] }),
  }
}

function link(ref: string, text: string, href?: string, attributes: Record<string, string> = {}): A11yNode {
  return node({
    ref,
    role: 'link',
    name: text,
    native: { tag: 'a', attributes: { ...(href === undefined ? {} : { href }), ...attributes } },
    children: [node({ ref: `${ref}-text`, text })],
  })
}

const heading = (ref: string, text: string) => node({ ref, role: 'heading', name: text, native: { tag: 'h2' } })
const item = (ref: string, ...children: A11yNode[]) => node({ ref, role: 'listitem', native: { tag: 'li' }, children })
const list = (ref: string, ...children: A11yNode[]) => node({ ref, role: 'list', native: { tag: 'ul' }, children })

const judgment = (extra: Partial<LinkPurposeJudgment>): LinkPurposeJudgment => ({
  promises: '',
  leadsTo: '',
  verdict: 'fail',
  evidence: 'Read more',
  problem: 'generic',
  suggestedText: 'Spring garden guide',
  confidence: 'high',
  ...extra,
})

describe('2.4.4 link context', () => {
  it('reads the header cells over a link in a table, a header spanning columns included (H79)', () => {
    const cell = (ref: string, x: number, child: A11yNode) => node({ ref, role: 'cell', native: { tag: 'td' }, bounds: { x, y: 40, width: 100, height: 20 }, children: [child] })
    const table = node({
      ref: 'table',
      role: 'table',
      native: { tag: 'table' },
      children: [
        node({
          ref: 'tbody',
          native: { tag: 'tbody' },
          children: [
            node({ ref: 'tr1', role: 'row', children: [node({ ref: 'th', role: 'columnheader', text: 'Ulysses', bounds: { x: 0, y: 0, width: 300, height: 20 } })] }),
            node({
              ref: 'tr2',
              role: 'row',
              children: [cell('td1', 0, link('a-html', 'HTML', 'u.htm')), cell('td2', 100, link('a-epub', 'EPUB', 'u.epub')), cell('td3', 200, link('a-txt', 'Plain text', 'u.txt'))],
            }),
          ],
        }),
      ],
    })
    const candidates = linkPurpose.candidates(snapshot([table]), noFindings)
    expect(candidates.map((c) => c.context.headers)).toEqual(['Ulysses', 'Ulysses', 'Ulysses'])
    expect(linkPurpose.prompt(candidates[1]!, snapshot([table])).user).toContain('Header cells of its table cell: Ulysses')
  })

  it('reads a short div as the sentence of the link, and a block of nothing but links as no context', () => {
    const sentence = node({
      ref: 'div',
      native: { tag: 'div', readingText: 'Read more about the spring garden' },
      text: 'about the spring garden',
      children: [link('more', 'Read more', '/garden')],
    })
    const menu = node({ ref: 'p', role: 'paragraph', native: { tag: 'p' }, children: [link('a', 'Mugs', '/mugs'), link('b', 'Plants', '/plants')] })
    const [inSentence, mugs] = linkPurpose.candidates(snapshot([sentence, menu]), noFindings)
    expect(inSentence?.context.context).toBe('Read more about the spring garden')
    expect(mugs?.context.context).toBeUndefined()
  })

  it('takes a link named by aria-labelledby, and patches nothing on it since its name lives elsewhere', () => {
    const label = node({ ref: 'p#go', role: 'paragraph', text: 'Skip to the reviews', native: { tag: 'p', attributes: { id: 'go' } } })
    const icon = node({ ref: 'svg-a', role: 'link', name: 'Skip to the reviews', native: { tag: 'a', attributes: { href: '#reviews', 'aria-labelledby': 'go' } } })
    const [candidate] = linkPurpose.candidates(snapshot([label, icon]), noFindings)
    expect(candidate?.ref).toBe('svg-a')
    expect(linkPurpose.patch?.(judgment({ evidence: 'Skip to the reviews', suggestedText: 'Go to the reviews' }), candidate!, snapshot([]))).toBeUndefined()
  })
})

describe('2.4.4 links that share a text', () => {
  const posts = (headingFor: (i: number) => string | undefined, hrefFor: (i: number) => string) =>
    [1, 2, 3].flatMap((i) => {
      const title = headingFor(i)
      return [...(title ? [heading(`h${i}`, title)] : []), list(`ul${i}`, item(`li${i}`, link(`more${i}`, 'Read more', hrefFor(i))))]
    })

  it('says when nothing tells them apart, and verifies an ambiguous claim against that fact', () => {
    const page = snapshot([heading('h', 'Latest posts'), ...posts(() => undefined, (i) => `/posts/${i}`)])
    const candidates = linkPurpose.candidates(page, noFindings)
    expect(candidates.map((c) => c.context.sameText)).toEqual(Array(3).fill({ links: 3, places: 3, apart: false }))
    expect(linkPurpose.prompt(candidates[0]!, page).user).toContain(
      'Links with the same text: 3 links on this page have this text and lead to 3 different places, and nothing in the context of this one tells it apart',
    )
    const ambiguous = judgment({ problem: 'ambiguous' })
    expect(linkPurpose.verify(ambiguous, candidates[0]!, page)).toEqual({ ok: true })
    expect(linkPurpose.message(ambiguous, candidates[0]!, 'en')).toBe(
      'The link text "Read more" is shared by 3 links that lead to 3 different places, and nothing around this one tells it apart.',
    )
    expect(linkPurpose.message(ambiguous, candidates[0]!, 'pt-BR')).toContain('é o mesmo de 3 links que levam a 3 lugares diferentes')
  })

  it('lets the heading above each one tell them apart (H80)', () => {
    const page = snapshot(posts((i) => ['Spring garden', 'Kitchen tools', 'Lamps'][i - 1], (i) => `/posts/${i}`))
    const candidates = linkPurpose.candidates(page, noFindings)
    expect(candidates.map((c) => c.context.sameText?.apart)).toEqual([true, true, true])
    expect(linkPurpose.verify(judgment({ problem: 'ambiguous' }), candidates[0]!, page)).toEqual({
      ok: false,
      reason: 'no other link with this text leads elsewhere from the same context',
    })
  })

  it('counts one place for the same address, a redirect to it, a tracking parameter or the same page at another path', () => {
    const same = (destinations: Record<string, Destination>, ...hrefs: string[]) => {
      const page = snapshot([list('ul', ...hrefs.map((href, i) => item(`li${i}`, link(`a${i}`, 'Shop', href))))], destinations)
      return linkPurpose.candidates(page, noFindings)[0]?.context.sameText
    }
    expect(same({}, '/shop', 'https://shop.test/shop/', '/shop?utm_source=footer')).toEqual({ links: 3, places: 1, apart: true })
    expect(same({ '/old': { kind: 'page', finalUrl: 'https://shop.test/shop' } }, '/shop', '/old')?.places).toBe(1)
    const copy: Destination = { kind: 'page', title: 'Shop', heading: 'Our shop' }
    expect(same({ '/shop': copy, '/about/shop': copy }, '/shop', '/about/shop')?.places).toBe(1)
    // The same path with another query may show another page, even when the HTML looks the same before scripts run.
    expect(same({ '/contact?page=1': copy, '/contact?page=2': copy }, '/contact?page=1', '/contact?page=2')?.places).toBe(2)
    expect(linkPurpose.prompt(linkPurpose.candidates(snapshot([link('a', 'Shop', '/shop'), link('b', 'Shop', '/shop')]), noFindings)[0]!, snapshot([])).user).toContain(
      '2 links on this page have this text, and they all lead to the same place.',
    )
  })

  it('states nothing about a link whose address the markup does not give', () => {
    const scripted = node({ ref: 'span', role: 'link', name: 'Shop', native: { tag: 'span', attributes: { role: 'link' } }, children: [node({ ref: 'span-text', text: 'Shop' })] })
    const page = snapshot([scripted, link('a', 'Shop', '/shop')])
    const [first, second] = linkPurpose.candidates(page, noFindings)
    expect(first?.context.sameText).toBeUndefined()
    expect(second?.context.sameText).toBeUndefined()
    expect(linkPurpose.prompt(first!, page).user).not.toContain('Address')
  })
})

describe('2.4.4 where a link leads', () => {
  const pricing = (destination: Destination) => {
    const page = snapshot([link('a', 'Pricing', '/blog/launch')], { '/blog/launch': destination })
    return { page, candidate: linkPurpose.candidates(page, noFindings)[0]! }
  }

  it('puts what was read at the address in the prompt, and nothing when it could not be read', () => {
    const { page, candidate } = pricing({ kind: 'page', status: 200, title: 'Launch week recap | Shop', heading: 'Launch week recap', description: 'What shipped' })
    expect(linkPurpose.prompt(candidate, page).user).toContain(
      'Where the link leads (read at its address): a page titled "Launch week recap | Shop", described as "What shipped"',
    )
    const missing = pricing({ kind: 'unreadable', status: 404, reason: 'not found' })
    expect(missing.candidate.context.destination).toBeUndefined()
    expect(linkPurpose.prompt(missing.candidate, missing.page).user).not.toContain('Where the link leads')
  })

  it('describes files, sections and redirects', () => {
    expect(describeDestination({ kind: 'file', contentType: 'application/pdf', bytes: 1677722 })).toBe('a PDF file to download or open, 1.6 MB')
    expect(describeDestination({ kind: 'page', title: 'Help', section: 'Refunds', finalUrl: 'https://shop.test/help' })).toBe(
      'a page titled "Help"; the part the address points to begins "Refunds" (the address redirects to https://shop.test/help)',
    )
    expect(describeDestination({ kind: 'page' })).toBeUndefined()
  })

  it('resolves a spelled-out address of the page itself like a "#part" link', () => {
    const target = node({ ref: 'p#faq', role: 'paragraph', text: 'Questions people ask', native: { tag: 'p', attributes: { id: 'faq' } } })
    const page = snapshot([link('a', 'FAQ', 'https://shop.test/news/#faq'), target])
    expect(linkPurpose.candidates(page, noFindings)[0]?.context.target).toBe('Questions people ask')
    expect(linkPurpose.prompt(linkPurpose.candidates(page, noFindings)[0]!, page).user).toContain(
      'Where the link leads: within this page, to the part that reads "Questions people ask"',
    )
  })

  it('keeps a mismatch only when the destination is known, and names it in the message', () => {
    const { page, candidate } = pricing({ kind: 'page', title: 'Launch week recap' })
    const mismatch = judgment({ evidence: 'Pricing', problem: 'mismatch', suggestedText: 'Launch week recap' })
    expect(linkPurpose.verify(mismatch, candidate, page)).toEqual({ ok: true })
    expect(linkPurpose.message(mismatch, candidate, 'en')).toBe('The link text "Pricing" does not match where the link leads: a page titled "Launch week recap".')
    expect(linkPurpose.message(mismatch, candidate, 'pt-BR')).toBe(
      'O texto do link "Pricing" não corresponde ao destino do link: uma página com o título "Launch week recap".',
    )
    const scripted = snapshot([node({ ref: 's', role: 'link', name: 'Pricing', native: { tag: 'span' }, children: [node({ ref: 't', text: 'Pricing' })] })])
    expect(linkPurpose.verify(mismatch, linkPurpose.candidates(scripted, noFindings)[0]!, scripted)).toEqual({
      ok: false,
      reason: 'mismatch without a known destination',
    })
  })

  it('accepts the link text quoted with the prompt\'s own tags, never another text', () => {
    const { page, candidate } = pricing({ kind: 'page', title: 'Launch week recap' })
    const generic = judgment({ evidence: '<link>Pricing</link>', suggestedText: 'Launch week recap' })
    expect(linkPurpose.verify(generic, candidate, page)).toEqual({ ok: true })
    expect(linkPurpose.verify({ ...generic, evidence: '<link>Plans</link>' }, candidate, page).ok).toBe(false)
  })

  it('asks the collection stage for destinations', () => {
    expect(linkPurpose.needs.fetch).toBe(true)
  })
})
