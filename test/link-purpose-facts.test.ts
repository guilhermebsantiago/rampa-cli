import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults } from '../src/core/types.ts'
import { genericLinkText, kindOnlyLinkText, namesOnlyFileKind } from '../src/criteria/generic-text.ts'
import { groundedLink, linkPurpose } from '../src/criteria/link-purpose.ts'
import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'
import type { A11yNode, A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

// The facts that ground a 2.4.4 fail the model got right on ACT 5effbb (Failed Examples 5 and 6) and on the
// link-mismatch pairs, and the real-page readings they must leave to the model (docs/studies/notes-remaining-errors.md).

const NO_ENGINE: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function page(children: A11yNode[], target = 'https://books.example/ulysses'): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target,
    title: 'Books Example',
    locale: 'en',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-23T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({ ref: 'html', role: 'document', lang: 'en', children: [node({ ref: 'body', native: { tag: 'body' }, children })] }),
  }
}

const link = (ref: string, name: string, href: string) => node({ ref, role: 'link', name, native: { tag: 'a', attributes: { href } }, children: [node({ ref: `${ref}-text`, text: name })] })
const text = (ref: string, value: string) => node({ ref, text: value })
const p = (ref: string, ...children: A11yNode[]) => node({ ref, role: 'paragraph', native: { tag: 'p' }, children })
const h2 = (ref: string, name: string) => node({ ref, role: 'heading', name, native: { tag: 'h2' }, children: [text(`${ref}-text`, name)] })
const li = (ref: string, ...children: A11yNode[]) => node({ ref, role: 'listitem', native: { tag: 'li' }, children })
const ul = (ref: string, ...children: A11yNode[]) => node({ ref, role: 'list', native: { tag: 'ul' }, children })
/** A cell at a column of 100 px; a header row's cell spans the three columns of the table, as colspan="3" does. */
const cell = (ref: string, role: string, ...children: A11yNode[]) => node({ ref, role, native: { tag: role === 'cell' ? 'td' : 'th' }, children })
const at = (column: number, c: A11yNode): A11yNode => ({ ...c, bounds: { x: column * 100, y: 40, width: 100, height: 20 } })
const spanning = (c: A11yNode): A11yNode => ({ ...c, bounds: { x: 0, y: 0, width: 300, height: 20 } })
const row = (ref: string, ...children: A11yNode[]) => node({ ref, role: 'row', native: { tag: 'tr' }, children })
const table = (...rows: A11yNode[]) => node({ ref: 'table', role: 'table', native: { tag: 'table' }, children: [node({ ref: 'tbody', native: { tag: 'tbody' }, children: rows })] })
const part = (ref: string, role: string, id: string, value: string) => node({ ref, role, native: { tag: 'div', attributes: { id } }, children: [text(`${ref}-text`, value)] })

const facts = (snapshot: A11ySnapshot) => linkPurpose.candidates(snapshot, NO_ENGINE).map((c) => c.context)
const generic = (snapshot: A11ySnapshot) => facts(snapshot).map((c) => groundedLink('generic', c))
const mismatch = (snapshot: A11ySnapshot) => facts(snapshot).map((c) => groundedLink('mismatch', c))
const alone = { sameText: undefined, context: undefined, headers: undefined, description: undefined }

const formats = (href = (format: string) => `u.${format}`) =>
  ul('ul', li('li1', link('#html', 'HTML', href('htm'))), li('li2', link('#epub', 'EPUB', href('epub'))), li('li3', link('#txt', 'Plain text', href('txt'))))

describe('a link text that names only what kind of file it gets', () => {
  it('reads formats, downloads and sizes, and nothing that names a document or a place', () => {
    for (const name of ['HTML', ' EPUB ', 'Plain text', 'Download', 'Download PDF', 'PDF (2 MB)', 'Baixar arquivo', 'Versão em PDF', 'Texto simples']) {
      expect(kindOnlyLinkText(name), name).toBe(true)
    }
    for (const name of ['Workshop', 'Tables', 'Download Debian', 'Getting Debian', 'Word', 'HTML Demo: <a>', 'Annual report 2025 (PDF)', '1.61MB', '']) {
      expect(kindOnlyLinkText(name), name).toBe(false)
    }
    // A size has a unit; a number without one, a year or an edition, says which document.
    for (const name of ['ZIP 1,2 GB', 'Download (1.61MB)', 'PDF 200k']) expect(kindOnlyLinkText(name), name).toBe(true)
    for (const name of ['2024 (PDF)', '751 PDF', 'PDF 2']) expect(kindOnlyLinkText(name), name).toBe(false)
    // An icon font's glyph before the words (unicamp.br's "Baixar PDF" link, as the browser names it) is no word.
    expect(kindOnlyLinkText('\uf019 Baixar PDF')).toBe(true)
    expect(kindOnlyLinkText('\uf019')).toBe(false)
    expect(genericLinkText('Download')).toBe(false)
    expect(namesOnlyFileKind('1.61MB')).toBe(true)
    expect(namesOnlyFileKind('Ulysses')).toBe(false)
  })

  it('grounds "HTML", "EPUB" and "Plain text" when their book is only a paragraph above the list (ACT 5effbb Failed Example 5)', () => {
    expect(generic(page([p('title', text('t', 'Ulysses')), formats()]))).toEqual([true, true, true])
  })

  it('leaves them to the model when something in their context could name the book', () => {
    // Passed Example 5: nested under the list item that names the book.
    expect(generic(page([ul('outer', li('book', text('b', 'Ulysses'), formats()))]))).toEqual([false, false, false])
    // Under a heading, in the site's menus, header or footer.
    expect(generic(page([h2('h', 'Ulysses'), formats()]))).toEqual([false, false, false])
    for (const role of ['navigation', 'banner', 'contentinfo']) {
      expect(generic(page([node({ ref: 'landmark', role, native: { tag: 'div' }, children: [formats()] })])), role).toEqual([false, false, false])
    }
    // With a sentence of its own.
    expect(generic(page([p('s', text('s1', 'Ulysses, the whole book in'), link('#html', 'HTML', 'u.htm'))]))).toEqual([false])
  })

  it('leaves a "Download" in a site menu to the model: debian.org\'s was a false positive on real pages', () => {
    const menu = ul('menu', li('m1', link('#about', 'About Debian', '/intro/about')), li('m2', link('#download', 'Download', '/download')), li('m3', link('#news', 'News', '/News/')))
    expect(facts(page([menu])).map((c) => c.menu)).toEqual([true, true, true])
    expect(generic(page([menu]))).toEqual([false, false, false])
  })

  it("leaves the site's header to the model however deep the link sits: a section in a header is still the header", () => {
    // The collector reads every <section> as a region, so the closest landmark of these links is "region".
    const header = (...links: A11yNode[]) =>
      node({ ref: 'header', role: 'banner', native: { tag: 'header' }, children: [node({ ref: 'cta', role: 'region', native: { tag: 'section' }, children: links })] })
    const snapshot = page([header(link('#dl', 'Download', '/download'), link('#pdf', 'PDF', '/manual.pdf')), h2('h', 'The project')])
    expect(facts(snapshot).map((c) => [c.landmark, c.chrome])).toEqual([['region', true], ['region', true]])
    expect(generic(snapshot)).toEqual([false, false])
  })

  it('leaves a "Download" with no format to the model outside a table row: it names an action or a download page', () => {
    // A top bar of plain links before the first heading, in no landmark and no list.
    const bar = node({ ref: 'bar', native: { tag: 'div' }, children: [link('#dl', 'Downloads', '/downloads'), link('#c', 'Contato', '/contato')] })
    expect(generic(page([bar, h2('h', 'Prefeitura')]))).toEqual([false, false])
    expect(generic(page([p('p1', link('#dl', 'Download', '/u.htm'))]))).toEqual([false])
    expect(generic(page([p('p1', link('#dl', 'Baixar', '/u.htm'))]))).toEqual([false])
    // With a format, the same link names only the file's kind.
    expect(generic(page([p('p1', link('#dl', 'Download PDF', '/u.pdf'))]))).toEqual([true])
  })

  it('grounds a "Baixar" whose document is a data cell of its row, on a Portuguese page', () => {
    const editais = table(
      row('r1', spanning(cell('h', 'columnheader', text('ht', 'Editais')))),
      row('r2', at(0, cell('c1', 'cell', text('e', 'Edital 12/2026 de bolsas'))), at(1, cell('c2', 'cell', link('#dl', 'Baixar', '/edital-12.pdf'))), at(2, cell('c3', 'cell', text('s', '350 KB')))),
    )
    const [baixar] = facts(page([editais], 'https://www.prefeitura.example.br/editais'))
    expect(baixar).toMatchObject({ headers: 'Editais', rowSubject: 'Edital 12/2026 de bolsas' })
    expect(groundedLink('generic', baixar!)).toBe(true)
  })

  it('grounds a "Download" whose book is a data cell of its row, not a row header (ACT 5effbb Failed Example 6)', () => {
    const books = table(
      row('r1', spanning(cell('h', 'columnheader', text('ht', 'Books')))),
      row('r2', at(0, cell('c1', 'cell', text('u', 'Ulysses'))), at(1, cell('c2', 'cell', link('#dl', 'Download', 'u.htm'))), at(2, cell('c3', 'cell', text('s', '1.61MB')))),
    )
    const [download] = facts(page([books]))
    expect(download).toMatchObject({ headers: 'Books', rowSubject: 'Ulysses' })
    expect(groundedLink('generic', download!)).toBe(true)
  })

  it('leaves the table to the model when a header names the book, a row header does, or only a size sits beside the link', () => {
    const titled = (header: string, ...cells: A11yNode[]) => page([table(row('r1', spanning(cell('h', 'columnheader', text('ht', header)))), row('r2', ...cells.map((c, i) => at(i, c))))])
    // Passed Example 6: the header row names the book.
    expect(generic(titled('Ulysses', cell('c1', 'cell', link('#html', 'HTML', 'u.htm')), cell('c2', 'cell', link('#epub', 'EPUB', 'u.epub'))))).toEqual([false, false])
    expect(generic(titled('Books', cell('rh', 'rowheader', text('u', 'Ulysses')), cell('c2', 'cell', link('#dl', 'Download', 'u.htm'))))).toEqual([false])
    expect(generic(titled('Books', cell('c2', 'cell', link('#dl', 'Download', 'u.htm')), cell('c3', 'cell', text('s', '1.61MB'))))).toEqual([false])
    expect(generic(titled('Ulysses', cell('c1', 'cell', text('u', 'Ulysses')), cell('c2', 'cell', link('#dl', 'Download', 'u.htm'))))).toEqual([false])
  })

  it('still leaves a specific text the model reads as saying nothing to review: "Workshop" (Failed Example 4), "TOC"', () => {
    const workshop = page([p('desc', text('d', 'The W3C held a workshop on June 9-10, 2005 at DERI Innsbruck.')), p('p2', link('#ws', 'Workshop', '/2005/04/FSWS/workshop-report.html'))])
    expect(generic(workshop)).toEqual([false])
    expect(groundedLink('generic', { ...alone, name: 'TOC' })).toBe(false)
    expect(groundedLink('generic', { ...alone, name: 'Download', headers: 'Books' })).toBe(false)
  })
})

describe('a link to a part of this page that its text names nothing of', () => {
  const hours = () => node({ ref: '#hours', role: 'paragraph', native: { tag: 'p', attributes: { id: 'hours' } }, children: [text('h', 'Opening hours: Monday to Friday, nine to five.')] })

  it("grounds the mismatch when the part's id and text name it and the link names none of it (the link-mismatch pairs)", () => {
    const pair = page([link('#a', 'See the description of this product.', '#hours'), p('desc', text('d', 'This product consists of several web pages.')), hours()])
    expect(facts(pair)[0]?.part).toMatchObject({ id: 'hours', role: 'paragraph' })
    expect(mismatch(pair)).toEqual([true])
    expect(mismatch(page([p('title', text('t', 'Ulysses')), formats(() => '#hours'), hours()]))).toEqual([true, true, true])
  })

  it('grounds a table of contents entry that points to another section', () => {
    const configuration = node({ ref: '#config', role: 'heading', name: 'Configuration', native: { tag: 'h2', attributes: { id: 'configuration' } }, children: [text('c', 'Configuration')] })
    expect(mismatch(page([ul('toc', li('t1', link('#i', 'Installation', '#configuration'))), configuration]))).toEqual([true])
  })

  it('leaves it to the model when the link names the part, the part is a region, or the page does not name the part', () => {
    const cases: Array<[string, string, A11yNode]> = [
      ['Opening hours', '#hours', hours()],
      ['Our hours', '#hours', hours()],
      ['Specifications', '#specs', part('#specs', 'generic', 'specs', 'Specs: weight 2 kg, height 40 cm')],
      ['Reviews', '#reviews', part('#reviews', 'generic', 'reviews', 'Four stars: a sturdy chair')],
      ['Skip to content', '#content', part('#content', 'main', 'content', 'Walking for everyone')],
      ['Pular para o conteúdo', '#main-content', part('#main', 'generic', 'main-content', 'Notícias do governo de hoje')],
      // An id that agrees with its text only through the site's own name ("health" of www.health.example).
      ['Ir para Área de Destaque', '#block-health-views-institucional', part('#b', 'generic', 'block-health-views-institucional', 'Presença nacional da Health em 16 estados')],
      ['Read more', '#hours', hours()],
      ['1', '#hours', hours()],
    ]
    for (const [name, href, target] of cases) {
      expect(mismatch(page([link('#a', name, href), target], 'https://www.health.example/')), name).toEqual([false])
    }
  })

  it('leaves skip links to the model whatever their target holds: a menu item, the search field, a wrapper, the footer', () => {
    const gov = 'https://www.servicos.example.gov.br/'
    const nav = (...children: A11yNode[]) => node({ ref: 'nav', role: 'navigation', native: { tag: 'nav' }, children })
    const button = (ref: string, id: string, name: string) => node({ ref, role: 'button', name, native: { tag: 'button', attributes: { id } }, children: [text(`${ref}-t`, name)] })
    const cases: Array<[string, A11yNode[]]> = [
      // berkeley.edu's dev shape ("Skip to main menu" to the menu's first button, "About"), with an id that names the item.
      ['berkeley', [link('#s', 'Skip to main menu', '#about'), nav(ul('m', li('m1', button('#about', 'about', 'About'))))]],
      ['menu link', [link('#s', 'Go to the menu', '#about'), nav(ul('m', li('m1', node({ ref: '#about', role: 'link', name: 'About us', native: { tag: 'a', attributes: { id: 'about', href: '/about' } }, children: [text('a', 'About us')] }))))]],
      // gov.br's "Ir para a busca" to a wrapper around the search field.
      ['search', [link('#s', 'Ir para a busca', '#portal-searchbox'), node({ ref: '#box', native: { tag: 'div', attributes: { id: 'portal-searchbox' } }, children: [text('l', 'Pesquisar no portal'), node({ ref: '#q', role: 'searchbox', native: { tag: 'input' } })] })]],
      ['wrapper', [link('#s', 'Navegação', '#portal-mainnav'), node({ ref: '#w', native: { tag: 'div', attributes: { id: 'portal-mainnav' } }, children: [nav(ul('m', li('m1', link('#n1', 'Portal', '/')), li('m2', link('#n2', 'Notícias', '/noticias'))))] })]],
      ['footer', [link('#s', 'Ir para o rodapé', '#portal-footer'), part('#f', 'generic', 'portal-footer', 'Portal da Transparência · Ouvidoria')]],
      ['top', [part('#t', 'generic', 'topo', 'Topo: Portal de Serviços'), link('#s', 'Voltar ao topo', '#topo')]],
    ]
    for (const [label, children] of cases) expect(mismatch(page(children, gov)).filter(Boolean), label).toEqual([])
  })

  it("leaves a carousel's arrows, a reply and a permalink to the model", () => {
    const slides = part('#c', 'generic', 'carouselNoticias', 'Notícias: Governo anuncia novo programa de saúde')
    expect(mismatch(page([slides, link('#n', 'Próximo »', '#carouselNoticias'), link('#p', 'Anterior', '#carouselNoticias')]))).toEqual([false, false])
    const thanks = part('#o', 'generic', 'obrigado', 'Obrigado pela avaliação!')
    expect(mismatch(page([p('q', text('q1', 'Esta página foi útil?'), link('#y', 'Sim', '#obrigado'), link('#no', 'Não', '#obrigado')), thanks]))).toEqual([false, false])
    const configuration = node({ ref: '#config', role: 'heading', name: 'Configuration', native: { tag: 'h2', attributes: { id: 'configuration' } }, children: [text('c', 'Configuration')] })
    expect(mismatch(page([link('#pl', 'Permalink', '#configuration'), configuration]))).toEqual([false])
  })

  it('leaves to the model a link to a part that holds a form field, such as a feedback form', () => {
    const form = node({ ref: '#fb', native: { tag: 'div', attributes: { id: 'feedback' } }, children: [text('f', 'Feedback: tell us what to improve'), node({ ref: '#ta', role: 'textbox', native: { tag: 'textarea' } })] })
    expect(mismatch(page([p('q', text('q1', 'Was this page useful?'), link('#r', 'Report a problem', '#feedback')), form]))).toEqual([false])
  })

  it("reads a heading's section, not its name alone, and an abbreviation its initials spell", () => {
    const h = (ref: string, id: string, name: string) => node({ ref, role: 'heading', name, native: { tag: 'h2', attributes: { id } }, children: [text(`${ref}-t`, name)] })
    // "GDP" in the section the heading opens.
    const gdp = page([p('i', text('i1', 'Quarterly'), link('#g', 'GDP', '#gross-domestic-product'), text('i2', 'figures are revised.')), h('#gdp', 'gross-domestic-product', 'Gross Domestic Product'), p('s', text('s1', 'Quarterly GDP grew by 0.3%.')), h('#inf', 'inflation', 'Inflation')])
    expect(facts(gdp)[0]?.part?.text).toBe('Gross Domestic Product Quarterly GDP grew by 0.3%.')
    expect(mismatch(gdp)).toEqual([false])
    // "FAQ" for "Frequently asked questions", with nothing in the section that says FAQ.
    expect(mismatch(page([ul('toc', li('t1', link('#f', 'FAQ', '#faq-section'))), h('#q', 'faq-section', 'Frequently asked questions'), p('a', text('a1', 'How do I apply?'))]))).toEqual([false])
    // A table of contents entry pointing to a section whose text names the entry is no mismatch either.
    expect(mismatch(page([ul('toc', li('t1', link('#i', 'Installation', '#configuration'))), h('#c', 'configuration', 'Configuration'), p('c1', text('c1t', 'After installation, set the options.'))]))).toEqual([false])
    // The section ends at the next heading of its level: what follows it is another section.
    expect(mismatch(page([ul('toc', li('t1', link('#i', 'Installation', '#configuration'))), h('#c', 'configuration', 'Configuration'), h('#n', 'installation', 'Installation'), p('n1', text('n1t', 'Run the installer.'))]))).toEqual([true])
  })

  it('reads the first element with an id, as a browser goes to it, when a template repeats the id', () => {
    const first = part('#d1', 'generic', 'destaques', 'Destaques da semana: museu reabre')
    const second = part('#d2', 'generic', 'destaques', 'Portal')
    const [c] = facts(page([link('#a', 'Destaques', '#destaques'), first, second]))
    expect(c?.target).toBe('Destaques da semana: museu reabre')
    expect(c?.part?.text).toBe('Destaques da semana: museu reabre')
    expect(groundedLink('mismatch', c!)).toBe(false)
  })

  it('still grounds a Portuguese table of contents entry pointing to another section, and pins what it cannot tell', () => {
    const h = (ref: string, id: string, name: string) => node({ ref, role: 'heading', name, native: { tag: 'h2', attributes: { id } }, children: [text(`${ref}-t`, name)] })
    const gov = 'https://www.servicos.example.gov.br/'
    expect(mismatch(page([ul('toc', li('t1', link('#i', 'Documentos necessários', '#horarios'))), h('#h', 'horarios', 'Horários de atendimento'), p('h1', text('h1t', 'Segunda a sexta, das 8h às 17h.'))], gov))).toEqual([true])
    // A synonym or a translation shares no word with the part, so the fact holds and only the model's verdict decides:
    // "Contato" for "Fale conosco" is a limit of the fact (docs/criteria.md), not a mismatch.
    expect(mismatch(page([ul('toc', li('t1', link('#c', 'Contato', '#fale-conosco'))), h('#f', 'fale-conosco', 'Fale conosco'), p('f1', text('f1t', 'Telefone 0800 000 0000.'))], gov))).toEqual([true])
  })

  it('never reads a hash route as a part of the page: no element has the id "/products"', () => {
    const app = node({ ref: '#app', native: { tag: 'div', attributes: { id: 'app' } }, children: [ul('m', li('m1', link('#p', 'Produtos', '#/products')), li('m2', link('#c', 'Carrinho', '#!/cart')))] })
    expect(facts(page([app])).map((c) => c.part)).toEqual([undefined, undefined])
    expect(mismatch(page([app]))).toEqual([false, false])
  })

  it('never grounds a mismatch with another page, whose title is a summary ("Declaração de Cookies" and a privacy notice)', () => {
    expect(groundedLink('mismatch', { ...alone, name: 'Declaração de Cookies' })).toBe(false)
    const read = page([link('#c', 'Declaração de Cookies', '/termos-de-uso')])
    read.destinations = { '/termos-de-uso': { kind: 'page', title: 'Termo de Uso e Aviso de Privacidade' } }
    expect(mismatch(read)).toEqual([false])
  })
})

/** A model that fails every link: "generic" on most, "mismatch" on a link to a part of the page. */
function failsEverything(): ModelProvider {
  return {
    id: 'test:fails',
    async judge<T>(request: JudgeRequest<T>) {
      const name = /<link>([\s\S]*?)<\/link>/.exec(request.user)?.[1] ?? ''
      const problem = /within this page/.test(request.user) ? 'mismatch' : 'generic'
      const output = { promises: '', leadsTo: '', verdict: 'fail', evidence: name, problem, suggestedText: `${name} of Ulysses`, confidence: 'high' }
      return { output: request.schema.parse(output), inputTokens: 10, outputTokens: 5, latencyMs: 1, modelId: 'fails' }
    },
  }
}

describe('what the facts make of a model that fails everything', () => {
  it('reports the kind-only links and the pointed-elsewhere link as findings, and the rest for review', async () => {
    const hours = node({ ref: '#hours', role: 'paragraph', native: { tag: 'p', attributes: { id: 'hours' } }, children: [text('h', 'Opening hours: Monday to Friday, nine to five.')] })
    const snapshot = page([p('title', text('t', 'Ulysses')), formats(), p('p2', link('#ws', 'Workshop', '/workshop')), p('p3', link('#see', 'See this product', '#hours')), hours])
    const report = await checkSnapshot(snapshot, NO_ENGINE, { criteria: [linkPurpose], llm: true, provider: failsEverything(), runs: 1, cache: memoryCache(), offline: false, locale: 'en', minConfidence: 'low', concurrency: 1 })
    expect(report.findings.map((f) => f.subject)).toEqual(['HTML', 'EPUB', 'Plain text', 'See this product'])
    expect(report.needsReview?.map((item) => item.ref)).toEqual(['#ws'])
  })
})
