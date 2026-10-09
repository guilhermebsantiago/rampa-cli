import { describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import { type HeadingsAndLabelsJudgment, headingsAndLabels, namesSeriesSubject, seriesStem } from '../src/criteria/headings-and-labels.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const noFindings: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }
const onScreen = { x: 40, y: 300, width: 320, height: 32 }

function heading(ref: string, level: number, text: string): A11yNode {
  return node({ ref, role: 'heading', name: text, native: { tag: `h${level}` }, children: [node({ ref: `${ref}-text`, text })] })
}

function paragraph(ref: string, text: string): A11yNode {
  return node({ ref, role: 'paragraph', text, native: { tag: 'p' } })
}

function page(children: A11yNode[], target = 'https://webaim.test/techniques/alttext/'): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target,
    title: 'Alternative Text',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'en', children: [node({ ref: 'body', native: { tag: 'body' }, children })] }),
  }
}

/**
 * Modeled on the real-page study's dev split: an article whose examples are headed "Example 1" to "Example 7",
 * each under a section heading that names what they are examples of, with the last one a level deeper; and a
 * footer whose column headings follow the article's last section.
 */
function article(): A11ySnapshot {
  return page([
    heading('h1', 1, 'Alternative Text'),
    heading('#intro', 2, 'Introduction'),
    paragraph('p.intro', 'Alternative text is a textual substitute for non-text content in web pages.'),
    heading('#context', 2, 'Context is Everything'),
    paragraph('p.context', 'The same image may need different alternative text in different places.'),
    heading('#example1', 3, 'Example 1'),
    paragraph('p.ex1', 'What would you choose as alt text for the image in Example 1?'),
    heading('#example2', 3, 'Example 2'),
    paragraph('p.ex2', 'What would you choose as alt text for the image in Example 2?'),
    heading('#functional', 2, 'Functional Images'),
    heading('#example3', 3, 'Example 3'),
    paragraph('p.ex3', 'The image is the only content of a link to the home page.'),
    heading('#advanced', 2, 'Advanced Images'),
    heading('#complex', 3, 'Complex images'),
    heading('#example7', 4, 'Example 7'),
    paragraph('p.ex7', 'What alt text would you choose for the painting in Example 7?'),
    node({
      ref: 'footer',
      role: 'contentinfo',
      native: { tag: 'footer' },
      children: [heading('#causes', 4, 'Causes'), paragraph('p.causes', 'Clean water Protected areas Forest restoration')],
    }),
  ])
}

const generic = (evidence: string): HeadingsAndLabelsJudgment => ({
  named: '',
  verdict: 'fail',
  evidence,
  problem: 'generic',
  suggestedText: 'Alt text for an astronaut portrait',
  confidence: 'high',
})

function candidate(snapshot: A11ySnapshot, ref: string) {
  const found = headingsAndLabels.candidates(snapshot, noFindings).find((c) => c.ref === ref)
  if (!found) throw new Error(`no candidate ${ref}`)
  return found
}

describe('2.4.6 headings read with their parent heading and their series', () => {
  it('gives a heading its parent heading and the numbered series it belongs to, across sections and levels', () => {
    const snapshot = article()
    const example1 = candidate(snapshot, '#example1')
    expect(example1.context.outline).toEqual(['Alternative Text', 'Context is Everything'])
    expect(example1.context.siblings).toEqual(['Example 2'])
    expect(example1.context.series).toEqual(['Example 1', 'Example 2', 'Example 3', 'Example 7'])
    const user = headingsAndLabels.prompt(example1, snapshot).user
    expect(user).toContain('It sits in the sections: Alternative Text > Context is Everything (its parent heading: Context is Everything)')
    expect(user).toContain('It is one of a numbered series of headings on the page: Example 1 | Example 2 | Example 3 | Example 7')
    expect(candidate(snapshot, '#example7').context.outline).toEqual(['Alternative Text', 'Advanced Images', 'Complex images'])
    // A heading with no number belongs to no series, and the prompt says nothing about one.
    expect(candidate(snapshot, '#intro').context.series).toBeUndefined()
    expect(headingsAndLabels.prompt(candidate(snapshot, '#intro'), snapshot).user).not.toContain('numbered series')
  })

  it('teaches the model that numbered and parallel headings under a descriptive parent pass', () => {
    const { system } = headingsAndLabels.prompt(candidate(article(), '#example1'), article())
    expect(system).toContain('Read a heading together with its parent heading')
    expect(system).toContain('"Example 1", "Example 2", "Example 3"')
    expect(system).toContain('"Do" and "Don\'t"')
    expect(system).toContain('"Introduction"')
  })

  it('drops a generic claim on a heading of a numbered series under a parent that names their subject', () => {
    const snapshot = article()
    for (const ref of ['#example1', '#example3', '#example7']) {
      const example = candidate(snapshot, ref)
      const verdict = headingsAndLabels.verify(generic(example.context.text), example, snapshot)
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.reason).toContain('numbered series')
    }
    // A mismatch is still the model's call: the series only says which example it is.
    const example1 = candidate(snapshot, '#example1')
    expect(headingsAndLabels.verify({ ...generic('Example 1'), problem: 'mismatch' }, example1, snapshot)).toEqual({ ok: true })
  })

  it('keeps a generic claim on a numbered heading with no series, or under a parent that is a number too', () => {
    // One "Section 2" alone is no series.
    const alone = page([heading('h1', 1, 'New arrivals'), heading('#s2', 2, 'Section 2'), paragraph('p', 'Fast delivery and a sturdy umbrella.')])
    expect(headingsAndLabels.verify(generic('Section 2'), candidate(alone, '#s2'), alone)).toEqual({ ok: true })
    // Every heading numbered, as the heading-generic pair of rampa eval writes them.
    const numbered = page([
      heading('h1', 1, 'Part 1'),
      paragraph('p1', 'Opening hours'),
      heading('#p2', 2, 'Part 2'),
      paragraph('p2', 'We are open Monday through Friday.'),
      heading('#p3', 2, 'Part 3'),
      paragraph('p3', 'It is going to rain tomorrow.'),
    ])
    expect(candidate(numbered, '#p2').context.series).toEqual(['Part 1', 'Part 2', 'Part 3'])
    expect(headingsAndLabels.verify(generic('Part 2'), candidate(numbered, '#p2'), numbered)).toEqual({ ok: true })
    // A numbered series with no parent heading at all.
    const top = page([heading('#s1', 2, 'Step 1'), paragraph('a', 'Open the box.'), heading('#s2', 2, 'Step 2'), paragraph('b', 'Plug it in.')])
    expect(headingsAndLabels.verify(generic('Step 2'), candidate(top, '#s2'), top)).toEqual({ ok: true })
  })

  it('lists parallel headings as siblings under their parent', () => {
    // As on a government portal: "DESTAQUE" next to "MAIS ACESSADOS", under "Serviços para você".
    const portal = page([
      heading('h2', 2, 'Serviços para você'),
      heading('#mais', 3, 'MAIS ACESSADOS'),
      paragraph('p1', 'Carteira de Trabalho Digital Consultar CPF'),
      heading('#destaque', 3, 'DESTAQUE'),
      paragraph('p2', 'Declaração do Imposto de Renda 2026'),
    ])
    const destaque = candidate(portal, '#destaque')
    expect(destaque.context.siblings).toEqual(['MAIS ACESSADOS'])
    const user = headingsAndLabels.prompt(destaque, portal).user
    expect(user).toContain('It sits in the sections: Serviços para você (its parent heading: Serviços para você)')
    expect(user).toContain('Other headings at its level in the same section: MAIS ACESSADOS')
  })

  it('keeps the claim but writes no patch that renames a heading after its parent or a sibling', () => {
    const store = page([
      heading('h1', 1, 'New arrivals'),
      heading('#s2', 2, 'Section 2'),
      paragraph('p', 'Fast delivery and a sturdy umbrella.'),
      heading('#news', 2, 'Newsletter'),
      paragraph('p2', 'Sign up for our offers.'),
    ])
    const section = candidate(store, '#s2')
    for (const taken of ['Newsletter', 'new arrivals']) {
      const claim = { ...generic('Section 2'), suggestedText: taken }
      expect(headingsAndLabels.verify(claim, section, store)).toEqual({ ok: true })
      expect(headingsAndLabels.patch?.(claim, section, store)).toBeUndefined()
    }
    expect(headingsAndLabels.patch?.({ ...generic('Section 2'), suggestedText: 'Customer reviews' }, section, store)).toMatchObject({ to: 'Customer reviews' })
  })

  it('does not give a footer heading a parent from the article above it, nor the article one from a header', () => {
    const snapshot = article()
    const causes = candidate(snapshot, '#causes')
    expect(causes.context.outline).toEqual([])
    expect(headingsAndLabels.prompt(causes, snapshot).user).not.toContain('parent heading')
    const banner = page([
      node({ ref: 'header', role: 'banner', native: { tag: 'header' }, children: [heading('#site', 1, 'Go to the home page')] }),
      heading('#news', 3, 'News'),
      paragraph('p', 'The council opens a new library.'),
    ])
    expect(candidate(banner, '#news').context.outline).toEqual([])
  })

  it('finds the numbered stem of a heading, and whether a parent names a subject', () => {
    expect(seriesStem('Example 1')).toBe('example #')
    expect(seriesStem('Example 12:')).toBe('example #')
    expect(seriesStem('Introduction')).toBeUndefined()
    expect(namesSeriesSubject('Context is Everything', 'Example 1')).toBe(true)
    expect(namesSeriesSubject('Chapter 3: Rivers', 'Section 1')).toBe(true)
    expect(namesSeriesSubject('Part 1', 'Part 2')).toBe(false)
    expect(namesSeriesSubject('Examples 2', 'Example 1')).toBe(false)
    expect(namesSeriesSubject('Section 2', 'Step 1')).toBe(false)
    expect(namesSeriesSubject('2026', 'Item 1')).toBe(false)
  })
})

function field(ref: string, attributes: Record<string, string>, name: string): A11yNode {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('')
  return node({ ref, role: 'textbox', name, bounds: onScreen, native: { tag: 'input', attributes, html: `<input${attrs}>` } })
}

/**
 * Modeled on the real-page study's dev split: a contact form whose fields are named in aria-label with English
 * words ("document", "phone") while people read Portuguese placeholders ("CPF*", "Telefone*").
 */
function contactForm(): A11ySnapshot {
  return page(
    [
      heading('h1', 1, 'Fale Conosco'),
      node({
        ref: 'form',
        role: 'form',
        native: { tag: 'form' },
        children: [
          field('#cpf', { type: 'text', name: 'cpf', 'aria-label': 'document', placeholder: 'CPF*' }, 'document'),
          field('#phone', { type: 'text', name: 'phone', 'aria-label': 'phone', placeholder: 'Telefone*' }, 'phone'),
          node({
            ref: 'label.city',
            role: 'generic',
            bounds: onScreen,
            native: { tag: 'label', attributes: { for: 'city' } },
            children: [node({ ref: 'label.city-text', text: 'Cidade', bounds: onScreen })],
          }),
          field('#city', { id: 'city', type: 'text', name: 'city', 'aria-label': 'city' }, 'city'),
          field('#search', { type: 'search', name: 'q', 'aria-label': 'Search the site' }, 'Search the site'),
        ],
      }),
    ],
    'https://www.sosma.test/contato',
  )
}

describe('2.4.6 judges the label people see, not a name in aria-label', () => {
  it('judges the placeholder of a field named in aria-label, and patches the placeholder', () => {
    const snapshot = contactForm()
    const cpf = candidate(snapshot, '#cpf')
    expect(cpf.context.text).toBe('CPF*')
    expect(cpf.context.target).toMatchObject({ ref: '#cpf', attribute: 'placeholder' })
    const user = headingsAndLabels.prompt(cpf, snapshot).user
    expect(user).toContain('<label>CPF*</label>')
    expect(user).not.toContain('<label>document</label>')
    const fail = { named: '', verdict: 'fail', evidence: 'CPF*', problem: 'generic', suggestedText: 'CPF (somente números)*', confidence: 'high' } as const
    expect(headingsAndLabels.verify(fail, cpf, snapshot)).toEqual({ ok: true })
    // A claim about the aria-label is not a claim about what people read.
    expect(headingsAndLabels.verify({ ...fail, evidence: 'document' }, cpf, snapshot).ok).toBe(false)
    expect(headingsAndLabels.patch?.(fail, cpf, snapshot)).toMatchObject({
      kind: 'set-attribute',
      attribute: 'placeholder',
      from: 'CPF*',
      after: '<input type="text" name="cpf" aria-label="document" placeholder="CPF (somente números)*">',
    })
    expect(headingsAndLabels.message(fail, cpf, 'en')).toBe('The label "CPF*" does not say what to enter.')
    expect(candidate(snapshot, '#phone').context.text).toBe('Telefone*')
  })

  it('judges the visible label element over aria-label, and still judges aria-label when nothing visible names the field', () => {
    const snapshot = contactForm()
    const city = candidate(snapshot, '#city')
    expect(city.context.text).toBe('Cidade')
    expect(city.context.target).toMatchObject({ ref: 'label.city' })
    const search = candidate(snapshot, '#search')
    expect(search.context.text).toBe('Search the site')
    expect(search.context.target).toMatchObject({ ref: '#search', attribute: 'aria-label' })
  })
})
