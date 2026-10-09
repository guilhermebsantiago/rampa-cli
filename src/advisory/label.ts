import type { Locale } from '../i18n.ts'
import { patternTitle } from './coga.ts'
import { am } from './messages.ts'
import type { Basis, Impact } from './types.ts'

/** WCAG criteria the profile reports beyond the A/AA target. criterionLabel (src/wcag.ts) knows only 2.1 A/AA. */
const BEYOND_NAMES: Record<string, { en: string; 'pt-BR': string }> = {
  '3.1.4': { en: 'Abbreviations', 'pt-BR': 'Abreviaturas' },
  '3.1.5': { en: 'Reading Level', 'pt-BR': 'Nível de leitura' },
}

/**
 * The fixed label of an advisory, from code and never from a check's text: "Advisory · COGA o4p06 Use
 * Clear Visible Labels (not a WCAG requirement)", or "Beyond the target: WCAG 2.2 3.1.4 Abbreviations
 * (Level AAA)". It is what keeps an advisory from reading as a WCAG failure wherever it is shown.
 */
export function advisoryLabel(basis: Basis, locale: Locale): string {
  if (basis.framework === 'coga') return am(locale, 'labelAdvisory', { pattern: basis.pattern, title: patternTitle(basis.pattern, locale) })
  return am(locale, 'labelBeyond', { version: basis.version, id: basis.id, name: beyondName(basis.id, locale), level: basis.level })
}

/** The name of a WCAG criterion the profile reports beyond the target. */
export function beyondName(id: string, locale: Locale): string {
  const names = BEYOND_NAMES[id]
  return names?.[locale] ?? names?.en ?? ''
}

export function impactName(impact: Impact, locale: Locale): string {
  return am(locale, `impact_${impact}`)
}

/** A short name for a basis, in lists: "COGA o4p08", "WCAG 3.1.4". */
export function basisTag(basis: Basis): string {
  return basis.framework === 'coga' ? `COGA ${basis.pattern}` : `WCAG ${basis.id}`
}
