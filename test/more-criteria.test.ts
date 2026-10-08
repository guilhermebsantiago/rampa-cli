import { describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import { headingsAndLabels } from '../src/criteria/headings-and-labels.ts'
import { languageOfPage } from '../src/criteria/language-of-page.ts'
import { linkPurpose } from '../src/criteria/link-purpose.ts'
import { pageTitled } from '../src/criteria/page-titled.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const noFindings: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function violation(ruleId: string, ref: string): EngineResults {
  return {
    engine: { name: 'axe-core', version: 'test' },
    rules: [{ ruleId, outcome: 'violation', criteria: [], help: '', nodes: [{ ref, target: ref, html: '' }] }],
  }
}

/** A store page: a vague title, a "Click here" link, a numbered heading and a numbered field label. */
function storePage(): A11ySnapshot {
  const reviews = 'Prachtige mok, de koffie blijft lang warm. Fast delivery and a sturdy umbrella.'
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'file:///C:/site/examples/store/before.html',
    title: 'Untitled document',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-08T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'en',
      native: { tag: 'html', html: '<html lang="en">', langText: `New arrivals Shipping Click here Section 2 ${reviews} Field 1` },
      children: [
        node({
          ref: 'body',
          native: { tag: 'body' },
          children: [
            node({ ref: 'h1', role: 'heading', name: 'New arrivals', native: { tag: 'h1' }, children: [node({ ref: 'h1-text', text: 'New arrivals' })] }),
            node({ ref: 'p.ship', role: 'paragraph', text: 'Free shipping on orders over $50.', native: { tag: 'p' } }),
            node({
              ref: 'p.more',
              role: 'paragraph',
              native: { tag: 'p' },
              children: [
                node({
                  ref: 'a.more',
                  role: 'link',
                  name: 'Click here',
                  text: 'Click here',
                  native: { tag: 'a', attributes: { href: '/shipping' }, html: '<a href="/shipping">Click here</a>' },
                }),
              ],
            }),
            node({
              ref: 'a.logo',
              role: 'link',
              name: 'Corner Store',
              native: { tag: 'a', attributes: { href: '/' }, html: '<a href="/"><img alt="Corner Store"></a>' },
              children: [node({ ref: 'a.logo > img', role: 'img', name: 'Corner Store', native: { tag: 'img' } })],
            }),
            node({ ref: 'h2', role: 'heading', name: 'Section 2', native: { tag: 'h2' }, children: [node({ ref: 'h2-text', text: 'Section 2' })] }),
            node({ ref: 'blockquote', role: 'blockquote', text: reviews, native: { tag: 'blockquote' } }),
            node({ ref: 'h2.newsletter', role: 'heading', name: 'Newsletter', native: { tag: 'h2' } }),
            node({ ref: 'label', role: 'generic', text: 'Field 1', native: { tag: 'label', attributes: { for: 'email' } } }),
            node({
              ref: '#email',
              role: 'textbox',
              name: 'Field 1',
              native: { tag: 'input', attributes: { id: 'email', type: 'email', name: 'email', autocomplete: 'email' }, html: '<input id="email" type="email">' },
            }),
          ],
        }),
      ],
    }),
  }
}

describe('2.4.2 Page Titled', () => {
  it('judges a non-empty title with the headings and opening text of the page', () => {
    const [candidate, ...rest] = pageTitled.candidates(storePage(), noFindings)
    expect(rest).toHaveLength(0)
    expect(candidate?.context).toMatchObject({ title: 'Untitled document', address: 'before.html', headings: ['New arrivals', 'Section 2', 'Newsletter'] })
    expect(candidate?.context.opening).toContain('Free shipping')
  })

  it('leaves a missing title to the engine', () => {
    expect(pageTitled.candidates({ ...storePage(), title: '' }, noFindings)).toHaveLength(0)
    expect(pageTitled.candidates(storePage(), violation('document-title', 'html'))).toHaveLength(0)
  })

  it('keeps a fail only with the exact title and a different suggestion, and patches the title element', () => {
    const [candidate] = pageTitled.candidates(storePage(), noFindings)
    if (!candidate) throw new Error('no candidate')
    const fail = { verdict: 'fail', evidence: 'Untitled document', problem: 'generic', suggestedTitle: 'New arrivals at Corner Store', confidence: 'high' } as const
    expect(pageTitled.verify(fail, candidate, storePage())).toEqual({ ok: true })
    expect(pageTitled.verify({ ...fail, evidence: 'Corner Store' }, candidate, storePage()).ok).toBe(false)
    expect(pageTitled.verify({ ...fail, suggestedTitle: '' }, candidate, storePage()).ok).toBe(false)
    expect(pageTitled.verify({ ...fail, problem: 'none' }, candidate, storePage()).ok).toBe(false)
    expect(pageTitled.verify({ ...fail, verdict: 'pass' }, candidate, storePage()).ok).toBe(false)
    expect(pageTitled.patch?.(fail, candidate, storePage())).toMatchObject({
      kind: 'set-text',
      before: '<title>Untitled document</title>',
      after: '<title>New arrivals at Corner Store</title>',
    })
    expect(pageTitled.message(fail, candidate, 'pt-BR')).toBe('O título da página "Untitled document" não diz nada sobre esta página.')
  })
})

describe('2.4.4 Link Purpose (In Context)', () => {
  it('takes links with text, with their paragraph and the heading above, and leaves image links to 1.1.1', () => {
    const candidates = linkPurpose.candidates(storePage(), noFindings)
    expect(candidates.map((c) => c.ref)).toEqual(['a.more'])
    expect(candidates[0]?.context).toMatchObject({ name: 'Click here', href: '/shipping', heading: 'New arrivals', context: undefined })
  })

  it('leaves links the engine failed to the engine', () => {
    expect(linkPurpose.candidates(storePage(), violation('link-name', 'a.more'))).toHaveLength(0)
  })

  it('rejects a quote that is not the link text and a fail with nothing to suggest', () => {
    const [candidate] = linkPurpose.candidates(storePage(), noFindings)
    if (!candidate) throw new Error('no candidate')
    const fail = { verdict: 'fail', evidence: 'Click here', problem: 'generic', suggestedText: 'Shipping costs and times', confidence: 'high' } as const
    expect(linkPurpose.verify(fail, candidate, storePage())).toEqual({ ok: true })
    expect(linkPurpose.verify({ ...fail, evidence: 'Free shipping' }, candidate, storePage()).ok).toBe(false)
    expect(linkPurpose.verify({ ...fail, suggestedText: 'Click here' }, candidate, storePage()).ok).toBe(false)
    expect(linkPurpose.patch?.(fail, candidate, storePage())).toMatchObject({
      kind: 'set-text',
      before: '<a href="/shipping">Click here</a>',
      after: '<a href="/shipping">Shipping costs and times</a>',
    })
  })
})

describe('2.4.6 Headings and Labels', () => {
  it('reads each heading against the content it introduces, and each field label against the field', () => {
    const candidates = headingsAndLabels.candidates(storePage(), noFindings)
    expect(candidates.map((c) => `${c.context.kind}:${c.context.text}`)).toEqual(['heading:New arrivals', 'heading:Section 2', 'heading:Newsletter', 'label:Field 1'])
    const section2 = candidates.find((c) => c.context.text === 'Section 2')
    expect(section2?.context.content).toContain('Prachtige mok')
    expect(section2?.context.content).not.toContain('Field 1')
    const label = candidates.find((c) => c.context.kind === 'label')
    expect(label?.context.content).toContain('type="email"')
    expect(label?.context.content).toContain('autocomplete="email"')
    expect(label?.context.target?.ref).toBe('label')
  })

  it('patches the label element, not the field, and keeps the quote honest', () => {
    const label = headingsAndLabels.candidates(storePage(), noFindings).find((c) => c.context.kind === 'label')
    if (!label) throw new Error('no label')
    const fail = { named: '', verdict: 'fail', evidence: 'Field 1', problem: 'generic', suggestedText: 'Email address', confidence: 'high' } as const
    expect(headingsAndLabels.verify(fail, label, storePage())).toEqual({ ok: true })
    expect(headingsAndLabels.verify({ ...fail, evidence: 'Email' }, label, storePage()).ok).toBe(false)
    expect(headingsAndLabels.patch?.(fail, label, storePage())).toMatchObject({
      ref: 'label',
      kind: 'set-text',
      before: '<label for="email">Field 1</label>',
      after: '<label for="email">Email address</label>',
    })
    expect(headingsAndLabels.message(fail, label, 'en')).toBe('The label "Field 1" does not say what to enter.')
  })
})

describe('3.1.1 Language of Page', () => {
  it('reads the text that inherits the root language', () => {
    const [candidate] = languageOfPage.candidates(storePage(), noFindings)
    expect(candidate?.context).toMatchObject({ declared: 'en', startTag: '<html lang="en">' })
  })

  it('leaves a missing or invalid lang to the engine', () => {
    const page = storePage()
    expect(languageOfPage.candidates({ ...page, root: { ...page.root, lang: undefined } }, noFindings)).toHaveLength(0)
    expect(languageOfPage.candidates(page, violation('html-lang-valid', 'html'))).toHaveLength(0)
  })

  it('kills a fail that detects the declared language and a quote that is not on the page', () => {
    const [candidate] = languageOfPage.candidates(storePage(), noFindings)
    if (!candidate) throw new Error('no candidate')
    const fail = { verdict: 'fail', detectedLanguage: 'nl', evidence: 'Prachtige mok', confidence: 'high' } as const
    expect(languageOfPage.verify(fail, candidate, storePage())).toEqual({ ok: true })
    expect(languageOfPage.verify({ ...fail, detectedLanguage: 'en' }, candidate, storePage()).ok).toBe(false)
    expect(languageOfPage.verify({ ...fail, evidence: 'Mooie beker' }, candidate, storePage()).ok).toBe(false)
    expect(languageOfPage.verify({ ...fail, verdict: 'pass' }, candidate, storePage()).ok).toBe(false)
    expect(languageOfPage.patch?.(fail, candidate, storePage())).toMatchObject({ attribute: 'lang', after: '<html lang="nl">' })
  })
})
