import type { Locale } from './i18n.ts'

export type Level = 'A' | 'AA' | 'AAA'

export interface SuccessCriterion {
  id: string
  level: Level
  name: { en: string; 'pt-BR'?: string }
}

/** WCAG 2.1 levels A and AA: the 50 success criteria Rampa reports coverage against. */
export const WCAG21_A_AA: readonly SuccessCriterion[] = [
  { id: '1.1.1', level: 'A', name: { en: 'Non-text Content', 'pt-BR': 'Conteúdo não textual' } },
  { id: '1.2.1', level: 'A', name: { en: 'Audio-only and Video-only (Prerecorded)' } },
  { id: '1.2.2', level: 'A', name: { en: 'Captions (Prerecorded)' } },
  { id: '1.2.3', level: 'A', name: { en: 'Audio Description or Media Alternative (Prerecorded)' } },
  { id: '1.2.4', level: 'AA', name: { en: 'Captions (Live)' } },
  { id: '1.2.5', level: 'AA', name: { en: 'Audio Description (Prerecorded)' } },
  { id: '1.3.1', level: 'A', name: { en: 'Info and Relationships', 'pt-BR': 'Informações e relações' } },
  { id: '1.3.2', level: 'A', name: { en: 'Meaningful Sequence', 'pt-BR': 'Sequência com significado' } },
  { id: '1.3.3', level: 'A', name: { en: 'Sensory Characteristics' } },
  { id: '1.3.4', level: 'AA', name: { en: 'Orientation' } },
  { id: '1.3.5', level: 'AA', name: { en: 'Identify Input Purpose' } },
  { id: '1.4.1', level: 'A', name: { en: 'Use of Color', 'pt-BR': 'Uso de cor' } },
  { id: '1.4.2', level: 'A', name: { en: 'Audio Control' } },
  { id: '1.4.3', level: 'AA', name: { en: 'Contrast (Minimum)', 'pt-BR': 'Contraste (mínimo)' } },
  { id: '1.4.4', level: 'AA', name: { en: 'Resize Text' } },
  { id: '1.4.5', level: 'AA', name: { en: 'Images of Text' } },
  { id: '1.4.10', level: 'AA', name: { en: 'Reflow' } },
  { id: '1.4.11', level: 'AA', name: { en: 'Non-text Contrast' } },
  { id: '1.4.12', level: 'AA', name: { en: 'Text Spacing' } },
  { id: '1.4.13', level: 'AA', name: { en: 'Content on Hover or Focus' } },
  { id: '2.1.1', level: 'A', name: { en: 'Keyboard', 'pt-BR': 'Teclado' } },
  { id: '2.1.2', level: 'A', name: { en: 'No Keyboard Trap' } },
  { id: '2.1.4', level: 'A', name: { en: 'Character Key Shortcuts' } },
  { id: '2.2.1', level: 'A', name: { en: 'Timing Adjustable' } },
  { id: '2.2.2', level: 'A', name: { en: 'Pause, Stop, Hide' } },
  { id: '2.3.1', level: 'A', name: { en: 'Three Flashes or Below Threshold' } },
  { id: '2.4.1', level: 'A', name: { en: 'Bypass Blocks' } },
  { id: '2.4.2', level: 'A', name: { en: 'Page Titled', 'pt-BR': 'Página com título' } },
  { id: '2.4.3', level: 'A', name: { en: 'Focus Order' } },
  { id: '2.4.4', level: 'A', name: { en: 'Link Purpose (In Context)', 'pt-BR': 'Finalidade do link (em contexto)' } },
  { id: '2.4.5', level: 'AA', name: { en: 'Multiple Ways' } },
  { id: '2.4.6', level: 'AA', name: { en: 'Headings and Labels' } },
  { id: '2.4.7', level: 'AA', name: { en: 'Focus Visible' } },
  { id: '2.5.1', level: 'A', name: { en: 'Pointer Gestures' } },
  { id: '2.5.2', level: 'A', name: { en: 'Pointer Cancellation' } },
  { id: '2.5.3', level: 'A', name: { en: 'Label in Name' } },
  { id: '2.5.4', level: 'A', name: { en: 'Motion Actuation' } },
  { id: '3.1.1', level: 'A', name: { en: 'Language of Page', 'pt-BR': 'Idioma da página' } },
  { id: '3.1.2', level: 'AA', name: { en: 'Language of Parts', 'pt-BR': 'Idioma de partes' } },
  { id: '3.2.1', level: 'A', name: { en: 'On Focus' } },
  { id: '3.2.2', level: 'A', name: { en: 'On Input' } },
  { id: '3.2.3', level: 'AA', name: { en: 'Consistent Navigation' } },
  { id: '3.2.4', level: 'AA', name: { en: 'Consistent Identification' } },
  { id: '3.3.1', level: 'A', name: { en: 'Error Identification' } },
  { id: '3.3.2', level: 'A', name: { en: 'Labels or Instructions' } },
  { id: '3.3.3', level: 'AA', name: { en: 'Error Suggestion' } },
  { id: '3.3.4', level: 'AA', name: { en: 'Error Prevention (Legal, Financial, Data)' } },
  { id: '4.1.1', level: 'A', name: { en: 'Parsing' } },
  { id: '4.1.2', level: 'A', name: { en: 'Name, Role, Value', 'pt-BR': 'Nome, função, valor' } },
  { id: '4.1.3', level: 'AA', name: { en: 'Status Messages' } },
]

const BY_ID = new Map(WCAG21_A_AA.map((sc) => [sc.id, sc]))

export function successCriterion(id: string): SuccessCriterion | undefined {
  return BY_ID.get(id)
}

export function criterionLabel(id: string, locale: Locale): string {
  const sc = BY_ID.get(id)
  if (!sc) return `WCAG ${id}`
  return `WCAG ${id} (${sc.level}) — ${sc.name[locale] ?? sc.name.en}`
}

/** axe-core tags success criteria as `wcag111`, `wcag1410`... */
export function criterionFromAxeTag(tag: string): string | undefined {
  const match = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined
}

export function compareCriteria(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
