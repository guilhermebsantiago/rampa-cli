import { describe, expect, it } from 'vitest'
import { memoryCache } from '../src/core/cache.ts'
import { checkSnapshot } from '../src/core/check.ts'
import type { EngineResults } from '../src/core/types.ts'
import { homePageHost, pageTitled, siteNameIn } from '../src/criteria/page-titled.ts'
import type { ModelProvider } from '../src/providers/types.ts'
import type { A11ySnapshot } from '../src/snapshot/schema.ts'
import { node } from './helpers.ts'

const NO_ENGINE: EngineResults = { engine: { name: 'axe-core', version: 'test' }, rules: [] }

/** Modeled on the real-page study's dev split: home pages titled with the site's or the organization's name. */
function page(target: string, title: string): A11ySnapshot {
  return {
    schemaVersion: 1,
    surface: 'web',
    target,
    title,
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800, scale: 1 },
    collectedAt: '2026-10-09T00:00:00.000Z',
    collector: { name: 'test', version: '0' },
    root: node({
      ref: 'html',
      role: 'document',
      lang: 'pt-BR',
      children: [
        node({
          ref: 'body',
          native: { tag: 'body' },
          children: [
            node({ ref: 'h1', role: 'heading', name: 'Serviços e Informações do Brasil', native: { tag: 'h1' }, text: 'Serviços e Informações do Brasil' }),
            node({ ref: 'p', role: 'paragraph', text: 'Encontre serviços públicos, notícias e informações do governo.', native: { tag: 'p' } }),
          ],
        }),
      ],
    }),
  }
}

const silent: ModelProvider = {
  id: 'test:silent',
  async judge() {
    throw new Error('the model was asked')
  },
}

const options = (provider: ModelProvider | undefined) => ({
  criteria: [pageTitled],
  llm: true,
  provider,
  runs: 1,
  cache: memoryCache(),
  offline: false,
  locale: 'en' as const,
  minConfidence: 'low' as const,
  concurrency: 1,
})

describe('2.4.2 on a home page titled with the site name (G88)', () => {
  it('recognizes a site root and a language root, and nothing deeper', () => {
    expect(homePageHost('https://www.gov.br/pt-br')).toBe('www.gov.br')
    expect(homePageHost('https://www.ufc.br/pt')).toBe('www.ufc.br')
    expect(homePageHost('https://www.ufc.br/pt/')).toBe('www.ufc.br')
    expect(homePageHost('https://shop.example/')).toBe('shop.example')
    expect(homePageHost('https://shop.example')).toBe('shop.example')
    expect(homePageHost('https://shop.example/en-US/index.html')).toBe('shop.example')
    expect(homePageHost('https://shop.example/index.php?ref=ad')).toBe('shop.example')
    // A path that is not a language, a page under a root, a local file.
    expect(homePageHost('https://shop.example/faq')).toBeUndefined()
    expect(homePageHost('https://shop.example/go')).toBeUndefined()
    expect(homePageHost('https://www.gov.br/pt-br/servicos')).toBeUndefined()
    expect(homePageHost('file:///C:/site/index.html')).toBeUndefined()
    expect(homePageHost('examples/store/before.html')).toBeUndefined()
  })

  it('finds the site name in the title, as the address spells it', () => {
    expect(siteNameIn('GOV.BR', 'www.gov.br')).toBe('GOV.BR')
    expect(siteNameIn('Universidade Federal do Ceará', 'www.ufc.br')).toBe('Universidade Federal do Ceará')
    expect(siteNameIn('Corner Store | Mugs, umbrellas and gifts', 'www.cornerstore.example')).toBe('Corner Store')
    expect(siteNameIn('ACME - Associação Cearense de Música Erudita', 'acme.org.br')).toBe('ACME')
    expect(siteNameIn('Welcome to GOV.BR', 'www.gov.br')).toBe('Welcome to GOV.BR')
    expect(siteNameIn('Notícias', 'www.ufc.br')).toBeUndefined()
    expect(siteNameIn('React App', 'shop.example')).toBeUndefined()
  })

  it('passes it without asking the model, and says so in the coverage', async () => {
    for (const [target, title] of [
      ['https://www.gov.br/pt-br', 'GOV.BR'],
      ['https://www.ufc.br/pt', 'Universidade Federal do Ceará'],
    ] as const) {
      const snapshot = page(target, title)
      const [candidate] = pageTitled.candidates(snapshot, NO_ENGINE)
      if (!candidate) throw new Error('no candidate')
      expect(candidate.context).toMatchObject({ home: true, siteName: title })
      expect(pageTitled.decide?.(candidate, snapshot)).toMatchObject({ verdict: 'pass', evidence: title, problem: 'none' })
      const report = await checkSnapshot(snapshot, NO_ENGINE, options(silent))
      expect(report.findings).toEqual([])
      expect(report.belowThreshold).toEqual([])
      expect(report.usage.calls).toBe(0)
      expect(report.criteria.find((c) => c.criterion === '2.4.2')).toMatchObject({ judged: 1, passed: 1, decided: 1 })
      const record = report.coverage.criteria?.find((c) => c.id === '2.4.2')
      expect(record?.status).toBe('no-failure-found')
      expect(record?.methods).toContainEqual({ kind: 'rule', id: 'rampa/home-page-title', ran: true, applicable: 1, failures: 0, review: 0, maturity: 'stable' })
    }
  })

  it('still asks the model about a generic title on a home page, a name it cannot read, and inner pages', () => {
    const generic = page('https://www.gov.br/', 'Home')
    const [home] = pageTitled.candidates(generic, NO_ENGINE)
    if (!home) throw new Error('no candidate')
    expect(pageTitled.decide?.(home, generic)).toBeUndefined()

    // A home page whose title the address does not spell: the prompt tells the model it is one.
    const unknown = page('https://www.gov.br/pt-br', 'Portal do Governo')
    const [named] = pageTitled.candidates(unknown, NO_ENGINE)
    if (!named) throw new Error('no candidate')
    expect(named.context).toMatchObject({ home: true })
    expect(named.context.siteName).toBeUndefined()
    expect(pageTitled.decide?.(named, unknown)).toBeUndefined()
    expect(pageTitled.prompt(named, unknown).user).toContain("This page is the site's home page")
    expect(pageTitled.prompt(named, unknown).user).toContain('G88')

    // An inner page titled with the site name alone is the model's to judge, with no home-page line.
    const inner = page('https://www.gov.br/pt-br/servicos', 'GOV.BR')
    const [service] = pageTitled.candidates(inner, NO_ENGINE)
    if (!service) throw new Error('no candidate')
    expect(service.context.home).toBeUndefined()
    expect(pageTitled.decide?.(service, inner)).toBeUndefined()
    expect(pageTitled.prompt(service, inner).user).not.toContain('home page')
  })
})
