import type { Locale } from '../i18n.ts'
import type { Basis, Reference } from './types.ts'

/**
 * Guides the cognitive profile cites next to the W3C COGA patterns, and alone where no pattern covers a check:
 *
 * - GAIA, Guia de Acessibilidade de Interfaces para Autismo (https://gaia.wiki.br/): 28 recommendations from Talita
 *   Cristina Pagani Britto's master's dissertation (UFSCar, 2016; Britto and Pizzolato, RBIE 26(2), 2018). It targets
 *   autistic children and multitouch devices, was piloted with IT professionals, not with autistic people, and states
 *   no WCAG mapping. 16 of its recommendations cite WebAIM's WAVE cognitive checklist, so the two are related sources.
 * - WebAIM, "Evaluating Cognitive Web Accessibility" (https://webaim.org/articles/evaluatingcognitive/).
 *
 * Quotes are verbatim, read on 2026-10-15; GAIA's in Portuguese, as it is written. The English titles of GAIA's
 * recommendations are Rampa's own translation.
 */

export const GAIA_SOURCE = 'gaia.wiki.br 2026-10-15'
export const WEBAIM_SOURCE = 'webaim.org 2026-10-15'
export const WEBAIM_URL = 'https://webaim.org/articles/evaluatingcognitive/'

export interface GaiaRecommendation {
  /** G03 */
  id: string
  title: { en: string; 'pt-BR': string }
  url: string
}

/** The recommendations the checks cite. */
export const GAIA: Readonly<Record<string, GaiaRecommendation>> = {
  G03: { id: 'G03', title: { en: 'Legibility', 'pt-BR': 'Legibilidade' }, url: 'https://gaia.wiki.br/vocabulario-visual-e-textual/legibilidade' },
  G09: { id: 'G09', title: { en: 'Eliminate distractions', 'pt-BR': 'Eliminar distrações' }, url: 'https://gaia.wiki.br/engajamento/eliminar-distracoes' },
  G14: { id: 'G14', title: { en: 'Text equivalents', 'pt-BR': 'Equivalentes textuais' }, url: 'https://gaia.wiki.br/representacoes-redundantes/equivalentes-textuais' },
  // GAIA publishes G22 at its principle's address.
  G22: { id: 'G22', title: { en: 'Consistency', 'pt-BR': 'Consistência' }, url: 'https://gaia.wiki.br/reconhecimento-e-previsibilidade/' },
}

function gaia(id: string): GaiaRecommendation {
  const recommendation = GAIA[id]
  if (!recommendation) throw new Error(`Unknown GAIA recommendation ${id}`)
  return recommendation
}

export function gaiaTitle(id: string, locale: Locale): string {
  const recommendation = gaia(id)
  return recommendation.title[locale] ?? recommendation.title.en
}

/** A GAIA recommendation as the basis of an advisory, with the sentence screened. */
export function gaiaBasis(id: string, quote: string): Basis {
  return { framework: 'guide', guide: 'gaia', id, url: gaia(id).url, quote, source: GAIA_SOURCE }
}

/** WebAIM's checklist as the basis of an advisory: `id` names its section. */
export function webaimBasis(id: string, quote: string): Basis {
  return { framework: 'guide', guide: 'webaim', id, url: WEBAIM_URL, quote, source: WEBAIM_SOURCE }
}

/** A GAIA recommendation cited next to a COGA pattern. */
export function gaiaReference(id: string): Reference {
  const recommendation = gaia(id)
  return { kind: 'guideline', label: `GAIA ${id} ${recommendation.title['pt-BR']}`, url: recommendation.url }
}

export function webaimReference(section: string): Reference {
  return { kind: 'guideline', label: `WebAIM, Evaluating Cognitive Web Accessibility: ${section}`, url: WEBAIM_URL }
}

/** WCAG technique G201, Giving users advanced warning when opening a new window: advisory for 2.4.4, 2.4.6, 2.4.9 and 3.2.5. */
export const G201: Reference = {
  kind: 'technique',
  label: 'WCAG technique G201: Giving users advanced warning when opening a new window (advisory)',
  url: 'https://www.w3.org/WAI/WCAG22/Techniques/general/G201',
}
