import type { Locale } from '../i18n.ts'
import type { Basis, CogaStatement } from './types.ts'

/**
 * The 58 design patterns of the W3C Note "Making Content Usable for People with Cognitive and Learning
 * Disabilities" (COGA), 29 April 2021, as the WAI supplemental guidance lists them
 * (https://www.w3.org/WAI/WCAG2/supplemental/, slugs and titles read on 2026-10-09). The Portuguese
 * titles are Rampa's own, unofficial translation; the English title and the URL always go with them.
 *
 * COGA is supplemental guidance: "Following this guidance is not required for conformance to WCAG".
 * The Note defines no conformance, so Rampa never says a pattern is met or passed.
 */

export const COGA_SOURCE = 'coga-usable 2021-04-29'
export const COGA_TR = 'https://www.w3.org/TR/coga-usable/'
export const COGA_SUPPLEMENTAL = 'https://www.w3.org/WAI/WCAG2/supplemental/'

export interface CogaPattern {
  /** o4p06 */
  id: string
  /** o4p06-clear-labels */
  slug: string
  title: { en: string; 'pt-BR': string }
  /** The pattern's anchor in the W3C Note. */
  anchor: string
}

const p = (slug: string, en: string, pt: string, anchor: string): CogaPattern => ({
  id: slug.slice(0, 5),
  slug,
  title: { en, 'pt-BR': pt },
  anchor,
})

export const COGA_PATTERNS: readonly CogaPattern[] = [
  p('o1p01-clear-purpose', 'Make the Purpose of Your Page Clear', 'Deixe claro o propósito da página', 'make-the-purpose-of-your-page-clear-pattern'),
  p('o1p02-familiar-design', 'Use a Familiar Hierarchy and Design', 'Use hierarquia e design familiares', 'use-a-familiar-hierarchy-and-design-pattern'),
  p('o1p03-consistent-design', 'Use a Consistent Visual Design', 'Use um design visual consistente', 'use-a-consistent-visual-design-pattern'),
  p('o1p04-clear-steps', 'Make Each Step Clear', 'Deixe cada etapa clara', 'make-each-step-clear-pattern'),
  p('o1p05-clear-controls', 'Clearly Identify Controls and Their Use', 'Identifique com clareza os controles e o seu uso', 'clearly-identify-controls-and-their-use-pattern'),
  p(
    'o1p06-control-actions',
    'Make the Relationship Clear Between Controls and the Content They Affect',
    'Deixe clara a relação entre os controles e o conteúdo que eles afetam',
    'make-the-relationship-clear-between-controls-and-the-content-they-affect-pattern',
  ),
  p('o1p07-icons-used', 'Use Icons that Help the User', 'Use ícones que ajudem quem usa', 'use-icons-that-help-the-user-pattern'),
  p(
    'o2p01-site-important',
    'Make it Easy to Find the Most Important Tasks and Features',
    'Facilite encontrar as tarefas e os recursos mais importantes',
    'make-it-easy-to-find-the-most-important-tasks-and-features-of-the-site-pattern',
  ),
  p(
    'o2p02-site-structure',
    'Make the Site Hierarchy Easy to Understand and Navigate',
    'Torne a hierarquia do site fácil de entender e de navegar',
    'make-the-site-hierarchy-easy-to-understand-and-navigate-pattern',
  ),
  p('o2p03-page-structure', 'Use a Clear and Understandable Page Structure', 'Use uma estrutura de página clara e compreensível', 'use-a-clear-and-understandable-page-structure-pattern'),
  p(
    'o2p04-page-important',
    'Make it easy to find the most important actions and information on the page',
    'Facilite encontrar as ações e as informações mais importantes da página',
    'make-it-easy-to-find-the-most-important-actions-and-information-on-the-page-pattern',
  ),
  p('o2p05-chunked-media', 'Break Media into Chunks', 'Divida a mídia em partes', 'break-media-into-chunks-pattern'),
  p('o2p06-search', 'Provide Search', 'Ofereça busca', 'provide-search-pattern'),
  p('o3p01-clear-words', 'Use Clear Words', 'Use palavras claras', 'use-clear-words-pattern'),
  p('o3p02-simple-tense', 'Use a Simple Tense and Voice', 'Use tempo e voz verbais simples', 'use-a-simple-tense-and-voice-pattern'),
  p('o3p03-double-negatives', 'Avoid Double Negatives or Nested Clauses', 'Evite negativas duplas e orações encaixadas', 'avoid-double-negatives-or-nested-clauses-pattern'),
  p('o3p04-literal-language', 'Use Literal Language', 'Use linguagem literal', 'use-literal-language-pattern'),
  p('o3p05-succinct-text', 'Keep Text Succinct', 'Mantenha o texto sucinto', 'keep-text-succinct-pattern'),
  p(
    'o3p06-format-punctuation',
    'Use Clear, Unambiguous Formatting and Punctuation',
    'Use formatação e pontuação claras e sem ambiguidade',
    'use-clear-unambiguous-formatting-and-punctuation-pattern',
  ),
  p(
    'o3p07-symbols-letters',
    'Include Symbols and Letters Necessary to Decipher the Words',
    'Inclua os símbolos e as letras necessários para decifrar as palavras',
    'include-symbols-and-letters-necessary-to-decipher-the-words-pattern',
  ),
  p('o3p08-summary-provided', 'Provide Summary of Long Documents and Media', 'Ofereça resumo de documentos e mídias longos', 'provide-summary-of-long-documents-and-media-pattern'),
  p('o3p09-separated-instructions', 'Separate Each Instruction', 'Separe cada instrução', 'separate-each-instruction-pattern'),
  p('o3p10-whitespace', 'Use White Spacing', 'Use espaço em branco', 'use-white-spacing-pattern'),
  p(
    'o3p11-unobscured-foreground',
    'Ensure Foreground Content is not Obscured by Background',
    'Garanta que o conteúdo em primeiro plano não fique encoberto pelo fundo',
    'ensure-foreground-content-is-not-obscured-by-background-pattern',
  ),
  p('o3p12-implicit-explained', 'Explain Implied Content', 'Explique o conteúdo implícito', 'explain-implied-content-pattern'),
  p('o3p13-numerical-alternatives', 'Provide Alternatives for Numerical Concepts', 'Ofereça alternativas para conceitos numéricos', 'provide-alternatives-for-numerical-concepts-pattern'),
  p(
    'o4p01-unexpected-movement',
    'Ensure Controls and Content Do Not Move Unexpectedly',
    'Garanta que controles e conteúdo não se movam inesperadamente',
    'ensure-controls-and-content-do-not-move-unexpectedly-pattern',
  ),
  p('o4p02-back-undo', 'Let Users Go Back', 'Deixe a pessoa voltar', 'let-users-go-back-pattern'),
  p(
    'o4p03-declared-charges',
    'Notify Users of Fees and Charges at the Start of a Task',
    'Informe taxas e cobranças no início da tarefa',
    'notify-users-of-fees-and-charges-at-the-start-of-a-task-pattern',
  ),
  p('o4p04-supportive-forms', 'Design Forms to Prevent Mistakes', 'Projete formulários que evitem enganos', 'design-forms-to-prevent-mistakes-pattern'),
  p('o4p05-form-undo', 'Make it Easy to Undo Form Errors', 'Facilite desfazer enganos em formulários', 'make-it-easy-to-undo-form-errors-pattern'),
  p('o4p06-clear-labels', 'Use Clear Visible Labels', 'Use rótulos claros e visíveis', 'use-clear-visible-labels-pattern'),
  p('o4p07-step-instructions', 'Use Clear Step-by-step Instructions', 'Use instruções claras, passo a passo', 'use-clear-step-by-step-instructions-pattern'),
  p('o4p08-input-formats', 'Accept different input formats', 'Aceite diferentes formatos de entrada', 'accept-different-input-formats-pattern'),
  p('o4p09-data-loss', 'Avoid Data Loss and “Timeouts”', 'Evite perda de dados e “tempo esgotado”', 'avoid-data-loss-and-timeouts-pattern'),
  p('o4p10-status-feedback', 'Provide Feedback', 'Dê retorno sobre as ações', 'provide-feedback-pattern'),
  p('o4p11-user-safety', 'Help the user stay safe', 'Ajude a pessoa a se manter segura', 'help-the-user-stay-safe-pattern'),
  p('o4p12-familiar-metrics', 'Use Familiar Metrics and Units', 'Use métricas e unidades familiares', 'use-familiar-metrics-and-units-pattern'),
  p('o5p01-minimal-interruptions', 'Limit Interruptions', 'Limite as interrupções', 'limit-interruptions-pattern'),
  p('o5p02-short-paths', 'Make Short Critical Paths', 'Crie caminhos críticos curtos', 'make-short-critical-paths-pattern'),
  p('o5p03-manageable-quantity', 'Avoid Too Much Content', 'Evite conteúdo demais', 'avoid-too-much-content-pattern'),
  p(
    'o5p04-task-expectations',
    'Provide Information So a User Can Complete and Prepare for a Task',
    'Dê informações para que a pessoa possa se preparar e concluir uma tarefa',
    'provide-information-so-a-user-can-complete-and-prepare-for-a-task-pattern',
  ),
  p(
    'o6p01-login-cognition',
    'Provide a Login that Does Not Rely on Memory or Other Cognitive Skills',
    'Ofereça um login que não dependa de memória nem de outras habilidades cognitivas',
    'provide-a-login-that-does-not-rely-on-memory-or-other-cognitive-skills-pattern',
  ),
  p('o6p02-singlestep-login', 'Allow the User a Simple, Single Step, Login', 'Permita um login simples, em uma única etapa', 'allow-the-user-a-simple-single-step-login-pattern'),
  p('o6p03-concise-login', 'Provide a Login Alternative with Less Words', 'Ofereça uma alternativa de login com menos palavras', 'provide-a-login-alternative-with-less-words-pattern'),
  p('o6p04-voice-menus', 'Let Users Avoid Navigating Voice Menus', 'Deixe a pessoa evitar menus de voz', 'let-users-avoid-navigating-voice-menus-pattern'),
  p(
    'o6p05-low-cognition',
    'Do Not Rely on Users Calculations or Memorizing Information',
    'Não dependa de cálculos nem de memorização por parte da pessoa',
    'do-not-rely-on-users-calculations-or-memorizing-information-pattern',
  ),
  p('o7p01-human-help', 'Provide Human Help', 'Ofereça ajuda humana', 'provide-human-help-pattern'),
  p(
    'o7p02-alternative-content',
    'Provide Alternative Content for Complex Information and Tasks',
    'Ofereça conteúdo alternativo para informações e tarefas complexas',
    'provide-alternative-content-for-complex-information-and-tasks-pattern',
  ),
  p(
    'o7p03-supported-choice',
    'Clearly State the Results and Disadvantages of Actions, Options, and Selections',
    'Diga com clareza os resultados e as desvantagens de ações, opções e seleções',
    'clearly-state-the-results-and-disadvantages-of-actions-options-and-selections-pattern',
  ),
  p(
    'o7p04-described-interactions',
    'Provide Help for Forms and Non-standard Controls',
    'Ofereça ajuda para formulários e controles fora do padrão',
    'provide-help-for-forms-and-non-standard-controls-pattern',
  ),
  p('o7p05-findable-support', 'Make It Easy to Find Help and Give Feedback', 'Facilite encontrar ajuda e dar retorno', 'make-it-easy-to-find-help-and-give-feedback-pattern'),
  p('o7p06-supported-wayfinding', 'Provide Help with Directions', 'Ofereça ajuda com direções', 'provide-help-with-directions-pattern'),
  p('o7p07-reminders', 'Provide Reminders', 'Ofereça lembretes', 'provide-reminders-pattern'),
  p(
    'o8p01-motion',
    'Let Users Control When the Content Moves or Changes',
    'Deixe a pessoa controlar quando o conteúdo se move ou muda',
    'let-users-control-when-the-content-moves-or-changes-pattern',
  ),
  p('o8p02-apis', 'Enable APIs and Extensions', 'Habilite APIs e extensões', 'enable-apis-and-extensions-pattern'),
  p('o8p03-complexity', 'Support Simplification', 'Apoie a simplificação', 'support-simplification-pattern'),
  p('o8p04-interface', 'Support a Personalized and Familiar Interface', 'Apoie uma interface personalizada e familiar', 'support-a-personalized-and-familiar-interface-pattern'),
]

const BY_ID = new Map(COGA_PATTERNS.map((pattern) => [pattern.id, pattern]))

export function cogaPattern(id: string): CogaPattern {
  const pattern = BY_ID.get(id)
  if (!pattern) throw new Error(`Unknown COGA pattern ${id}`)
  return pattern
}

export function patternUrl(pattern: CogaPattern): string {
  return `${COGA_SUPPLEMENTAL}patterns/${pattern.slug}/`
}

export function patternTitle(id: string, locale: Locale): string {
  const pattern = cogaPattern(id)
  return pattern.title[locale] ?? pattern.title.en
}

/** The basis of a check: the pattern, the sentence of it the check screens, quoted from the Note. */
export function cogaBasis(id: string, statement: CogaStatement, quote: string): Basis {
  const pattern = cogaPattern(id)
  return {
    framework: 'coga',
    pattern: pattern.id,
    slug: pattern.slug,
    url: patternUrl(pattern),
    tr: `${COGA_TR}#${pattern.anchor}`,
    statement,
    quote,
    source: COGA_SOURCE,
  }
}
