import { describe, expect, it } from 'vitest'
import type { EngineResults } from '../src/core/types.ts'
import { type LinkPurposeJudgment, destinationEvidence, linkPurpose } from '../src/criteria/link-purpose.ts'
import type { A11yNode, A11ySnapshot, Destination } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const noFindings: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

function link(ref: string, text: string, href: string): A11yNode {
  return node({ ref, role: 'link', name: text, native: { tag: 'a', attributes: { href } }, children: [node({ ref: `${ref}-text`, text })] })
}

/**
 * Modeled on the real-page study's dev split: a university home page titled with the university's name,
 * whose links lead to a page that only repeats that name, to category tiles that all read "Categorias",
 * to a page that redirects to /404, and to addresses where nothing was read.
 */
function home(): A11ySnapshot {
  const destinations: Record<string, Destination> = {
    '/cultura': { kind: 'page', status: 200, title: 'Universidade Federal do Ceará' },
    '/categorias/saude': { kind: 'page', status: 200, title: 'Categorias' },
    '/categorias/educacao': { kind: 'page', status: 200, title: 'Categorias' },
    '/categorias/trabalho': { kind: 'page', status: 200, title: 'Categorias' },
    '/fatura-verde': { kind: 'page', status: 200, finalUrl: 'https://www.ufc.test/404', title: 'Fatura Verde', heading: 'Fatura Verde' },
    '/sumiu': { kind: 'page', status: 200, title: 'Ops! Página não encontrada' },
    '/noticias/bolsas': { kind: 'page', status: 200, title: 'Seleção de bolsistas 2026', heading: 'Seleção de bolsistas 2026' },
    '/arquivo': { kind: 'unreadable', status: 403, reason: 'sign-in' },
  }
  return {
    schemaVersion: 1,
    surface: 'web',
    target: 'https://www.ufc.test/',
    title: 'Universidade Federal do Ceará',
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    destinations,
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'pt-BR',
      children: [
        node({
          ref: 'body',
          native: { tag: 'body' },
          children: [
            link('#cultura', 'CULTURA', '/cultura'),
            link('#saude', 'Saúde e Vigilância Sanitária', '/categorias/saude'),
            link('#educacao', 'Educação e Pesquisa', '/categorias/educacao'),
            link('#trabalho', 'Trabalho e Previdência', '/categorias/trabalho'),
            link('#fatura', 'Fatura Verde', '/fatura-verde'),
            link('#sumiu', 'Calendário 2025', '/sumiu'),
            link('#concurso', 'CONCURSO PÚBLICO Edital oferta 65 vagas', '/noticias/edital-61-vagas'),
            link('#blog', 'Blog', 'https://bits.ufc.test/'),
            link('#arquivo', 'Arquivo', '/arquivo'),
            link('#bolsas', 'Calendário acadêmico', '/noticias/bolsas'),
          ],
        }),
      ],
    }),
  }
}

const mismatch = (evidence: string): LinkPurposeJudgment => ({
  promises: '',
  leadsTo: '',
  verdict: 'fail',
  evidence,
  problem: 'mismatch',
  suggestedText: 'Outra página',
  confidence: 'high',
})

function verify(ref: string) {
  const page = home()
  const candidate = linkPurpose.candidates(page, noFindings).find((c) => c.ref === ref)
  if (!candidate) throw new Error(`no candidate ${ref}`)
  return linkPurpose.verify(mismatch(candidate.context.name), candidate, page)
}

describe('2.4.4 mismatch evidence', () => {
  it('drops a mismatch inferred from the address alone, with nothing read there', () => {
    expect(verify('#concurso')).toEqual({ ok: false, reason: 'mismatch without a known destination' })
    expect(verify('#blog')).toEqual({ ok: false, reason: 'mismatch without a known destination' })
    expect(verify('#arquivo')).toEqual({ ok: false, reason: 'mismatch without a known destination' })
  })

  it("drops a mismatch on a destination titled with the site's name", () => {
    expect(verify('#cultura')).toMatchObject({ ok: false, reason: expect.stringContaining('title says nothing') })
  })

  it('drops a mismatch on a title shared by pages at other addresses', () => {
    for (const ref of ['#saude', '#educacao', '#trabalho']) expect(verify(ref)).toMatchObject({ ok: false, reason: expect.stringContaining('title says nothing') })
  })

  it('drops a mismatch on a not-found page, by its address after redirects or by its title', () => {
    expect(verify('#fatura')).toMatchObject({ ok: false, reason: expect.stringContaining('not-found') })
    expect(verify('#sumiu')).toMatchObject({ ok: false, reason: expect.stringContaining('not-found') })
  })

  it('keeps a mismatch on a destination whose own title and heading were read', () => {
    expect(verify('#bolsas')).toEqual({ ok: true })
  })

  it('needs a title or heading: a page with neither, or a file, gives no evidence', () => {
    const page = home()
    expect(destinationEvidence({ kind: 'page', status: 200, description: 'Notícias' }, page)).toBe('unread')
    expect(destinationEvidence({ kind: 'file', contentType: 'application/pdf' }, page)).toBe('unread')
    expect(destinationEvidence({ kind: 'page', title: 'Universidade Federal do Ceará', heading: 'Cultura e Arte' }, page)).toBe('read')
  })
})
